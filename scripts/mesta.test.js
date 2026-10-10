import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Hermetic: temporary git repo with a copy of scripts/mesta.sh and FAKE npx/node
// (they only log their arguments) — nothing real is built, deployed or contacted.
const MESTA_SH = fileURLToPath(new URL('./mesta.sh', import.meta.url));

let repo;
let bin;
let log;

const sh = (cmd, args, cwd = repo) => {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
};
const fake = (name, body) => {
    writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
};
const put = (rel, body) => {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), body);
};
const run = (args, extra = {}) =>
    spawnSync('bash', ['scripts/mesta.sh', ...args], {
        cwd: repo,
        encoding: 'utf8',
        env: { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME, FAKE_LOG: log, ...extra },
    });
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);

beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'mesta-sh-'));
    bin = mkdtempSync(path.join(tmpdir(), 'mesta-bin-'));
    log = path.join(bin, 'calls.log');
    sh('git', ['init', '-q', '-b', 'mesta/main']);
    mkdirSync(path.join(repo, 'scripts'));
    writeFileSync(path.join(repo, 'scripts/mesta.sh'), readFileSync(MESTA_SH));
    put('scripts/check-prague-unchanged.sh', 'echo "guard $*" >> "$FAKE_LOG"\n');
    put('cloudflare/_headers', '/* X-Test: 1\n');
    put('cloudflare/wrangler.mesta.jsonc', '{\n  "name": "pirati-mesta",\n  "env": { "staging": { "name": "pirati-mesta-staging" } }\n}\n');
    put('.gitignore', '.cache\n');
    sh('git', ['add', '-A']);
    sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x']);
    // fake npx: logs "<cwd-basename>: npx args"; `vite build` creates the output dir
    fake('npx', 'echo "$(basename "$PWD"): npx $*" >> "$FAKE_LOG"\nif [[ "$*" == *"vite build"* ]]; then mkdir -p .cache/dist-mesta; echo html > .cache/dist-mesta/index.html; fi\nexit 0');
    fake('node', 'echo "node $*" >> "$FAKE_LOG"\nexit 0');
});

afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
});

describe('mesta.sh build', () => {
    it('builds, runs the build check, then copies _headers', () => {
        const r = run(['build']);
        expect(r.status).toBe(0);
        expect(calls()).toEqual([`${path.basename(repo)}: npx vite build -c vite.mesta.config.js`, 'node scripts/mesta-build-check.mjs', 'node scripts/mesta-data-check.mjs']);
        expect(readFileSync(path.join(repo, '.cache/dist-mesta/_headers'), 'utf8')).toBe('/* X-Test: 1\n');
    });

    it('does not copy _headers when the build check fails', () => {
        fake('node', 'exit 1');
        const r = run(['build']);
        expect(r.status).not.toBe(0);
        expect(existsSync(path.join(repo, '.cache/dist-mesta/_headers'))).toBe(false);
    });
});

describe('mesta.sh deploy-*', () => {
    it.each(['deploy-staging', 'deploy-prod'])('%s refuses outside mesta/main and runs nothing', (cmd) => {
        sh('git', ['checkout', '-q', '-b', 'mesta/t5-build']);
        const r = run([cmd]);
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('mesta/main');
        expect(calls()).toEqual([]);
    });

    it.each(['deploy-staging', 'deploy-prod'])('%s refuses a dirty tree unless MESTA_ALLOW_DIRTY=1', (cmd) => {
        writeFileSync(path.join(repo, 'cloudflare/_headers'), 'dirty\n');
        const r = run([cmd]);
        expect(r.status).not.toBe(0);
        expect(r.stderr).toMatch(/uncommitted/);
        expect(calls()).toEqual([]);
        const ok = run([cmd], { MESTA_ALLOW_DIRTY: '1' });
        expect(ok.status).toBe(0);
        expect(calls().some((c) => c.includes('wrangler deploy'))).toBe(true);
    });

    it('refuses on a detached HEAD', () => {
        sh('git', ['checkout', '-q', '--detach']);
        const r = run(['deploy-prod']);
        expect(r.status).not.toBe(0);
        expect(calls()).toEqual([]);
    });

    it('deploy-staging: build, name check, record deployments, deploy --env staging (from cloudflare/)', () => {
        const r = run(['deploy-staging']);
        expect(r.status).toBe(0);
        expect(calls().slice(3)).toEqual([
            'cloudflare: npx wrangler deployments list -c wrangler.mesta.jsonc --env staging',
            'cloudflare: npx wrangler deploy -c wrangler.mesta.jsonc --env staging',
        ]);
        expect(calls().slice(0, 3).slice(1)).toEqual(['node scripts/mesta-build-check.mjs', 'node scripts/mesta-data-check.mjs']);
    });

    it('deploy-prod passes an empty --env= (no "multiple environments" warning) and never --env staging', () => {
        const r = run(['deploy-prod']);
        expect(r.status).toBe(0);
        expect(calls().slice(3)).toEqual([
            'cloudflare: npx wrangler deployments list -c wrangler.mesta.jsonc --env=',
            'cloudflare: npx wrangler deploy -c wrangler.mesta.jsonc --env=',
        ]);
    });

    it('refuses when the config is not the pirati-mesta one, before any wrangler call', () => {
        put('cloudflare/wrangler.mesta.jsonc', '{ "name": "pirati-volby-zaloha" }\n');
        const r = run(['deploy-prod'], { MESTA_ALLOW_DIRTY: '1' });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('pirati-mesta');
        expect(calls().some((c) => c.includes('wrangler'))).toBe(false);
    });

    it('a missing previous deployment does not block the deploy, but is announced', () => {
        fake('npx', 'echo "$(basename "$PWD"): npx $*" >> "$FAKE_LOG"\nif [[ "$*" == *"vite build"* ]]; then mkdir -p .cache/dist-mesta; fi\nif [[ "$*" == *"deployments list"* ]]; then exit 1; fi\nexit 0');
        const r = run(['deploy-prod']);
        expect(r.status).toBe(0);
        expect(r.stderr).toMatch(/no previous deployment/i);
        expect(calls().some((c) => c.includes('wrangler deploy'))).toBe(true);
    });

    it('records the previous deployments under .cache before deploying', () => {
        const r = run(['deploy-prod']);
        expect(r.status).toBe(0);
        const files = spawnSync('ls', [path.join(repo, '.cache')], { encoding: 'utf8' }).stdout;
        expect(files).toMatch(/mesta-deployments-.*prod\.txt/);
    });
});

describe('mesta.sh other commands', () => {
    it('check-prague passes its arguments to the guard', () => {
        expect(run(['check-prague', 'abc123']).status).toBe(0);
        expect(calls()).toEqual(['guard abc123']);
    });

    it('data and registry call the node scripts', () => {
        put('scripts/build-data.js', '');
        put('scripts/mesta-registry.js', '');
        expect(run(['data']).status).toBe(0);
        expect(run(['registry', '--x']).status).toBe(0);
        expect(calls()).toEqual(['node scripts/build-data.js --product=mesta', 'node scripts/mesta-registry.js --x']);
    });

    it('prints usage and fails for an unknown or missing command', () => {
        for (const args of [[], ['nope']]) {
            const r = run(args);
            expect(r.status).toBe(2);
            expect(r.stderr).toMatch(/usage/i);
        }
    });
});
