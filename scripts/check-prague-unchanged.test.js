import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Hermetic: throw-away git repo, stub build/worker commands (no npm ci, no vite,
// no wrangler, no network). Testuje allow-list, vyříznutí cest, porovnání hashů,
// cache základu, kontrolu determinismu a úklid dočasného adresáře.
const SCRIPT = fileURLToPath(new URL('./check-prague-unchanged.sh', import.meta.url));

let repo;
let tmpRoot;
let counter;

const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
};
const write = (rel, body) => {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), body);
};
const commit = (msg) => {
    git('add', '-A');
    git('commit', '-q', '-m', msg);
};

// „Build“ = hash celého nevyřazeného stromu (jména i obsah) do dist/: kdyby se z STRIP
// vypustila jakákoli položka, hash se u mesta-only změny liší (viz test „every STRIP entry“).
const BUILD = [
    'rm -rf dist && mkdir dist',
    "find . -type f -not -path './dist/*' -not -path './node_modules/*' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum > dist/tree.sha",
    'cp -r src dist/src && cp index.html dist/',
    `echo built >> "${'$'}{GUARD_COUNTER}"`,
].join(' && ');
const WORKER = 'mkdir -p "$WORKER_OUT" && cp cloudflare/worker.js "$WORKER_OUT/worker.js"';

const run = (args = [], env = {}) =>
    spawnSync('bash', [SCRIPT, ...args], {
        cwd: repo,
        encoding: 'utf8',
        env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            TMPDIR: tmpRoot,
            GUARD_INSTALL_CMD: 'true',
            GUARD_BUILD_CMD: BUILD,
            GUARD_WORKER_CMD: WORKER,
            GUARD_COUNTER: counter,
            ...env,
        },
    });
const out = (r) => `${r.stdout}\n${r.stderr}`;
const builds = () => (existsSync(counter) ? readFileSync(counter, 'utf8').trim().split('\n').filter(Boolean).length : 0);

beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'guard-repo-'));
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'guard-tmp-'));
    counter = path.join(tmpRoot, '..', `${path.basename(tmpRoot)}.count`);
    git('init', '-q', '-b', 'main');
    write('.gitignore', 'dist\n.cache\n');
    write('package.json', '{}');
    write('index.html', '<html>prague</html>');
    write('vite.config.js', 'export default {}');
    write('src/app.js', 'export const a = 1');
    write('src/notes.md', 'prague note kept');
    write('cloudflare/worker.js', 'export default {}');
    write('README.md', 'readme');
    write('docs/a.md', 'doc');
    write('scripts/x.sh', 'echo');
    commit('base');
    git('branch', 'base');
    git('checkout', '-q', '-b', 'mesta/work');
});

afterEach(() => {
    for (const p of [repo, tmpRoot, counter]) rmSync(p, { recursive: true, force: true });
});

describe('allow-list', () => {
    it('passes when only allow-listed paths change, and strips them before comparing', () => {
        write('src/mesta/new.jsx', 'banner');
        write('public-mesta/data/x/lists.json', '{}');
        write('docs/b.md', 'doc 2');
        write('scripts/y.sh', 'echo 2');
        write('tools/t.js', '1');
        write('placeholder/p.html', '1');
        write('README.md', 'changed readme');
        write('CLAUDE.md', 'rules');
        write('vite.mesta.config.js', 'export default {}');
        write('cloudflare/mesta-worker.js', 'x');
        write('cloudflare/mestaWiring.js', 'x');
        write('cloudflare/mestaWiring.test.js', 'x');
        write('cloudflare/mestaWorker.drift.test.js', 'x');
        write('cloudflare/wrangler.mesta.jsonc', '{}');
        write('.github/workflows/mesta.yml', 'name: Mesta');
        commit('mesta only');
        const r = run(['base']);
        expect(out(r)).toContain('PRAGUE UNCHANGED');
        expect(r.status).toBe(0);
    });

    it('prints the scope of the guarantee on success', () => {
        write('src/mesta/new.jsx', 'banner');
        commit('mesta');
        const r = run(['base']);
        expect(r.status).toBe(0);
        expect(out(r)).toMatch(/stripped Prague build identical; never deploy Prague from mesta\/\* branches/);
    });

    it('handles non-ASCII paths: allowed ones pass, forbidden ones are named unquoted', () => {
        write('docs/příloha-Říčany.md', 'doc');
        write('src/mesta/Říčany.jsx', 'x');
        commit('allowed non-ascii');
        expect(run(['base']).status).toBe(0);
        write('src/Říčany.jsx', 'x');
        commit('forbidden non-ascii');
        const r = run(['base']);
        expect(r.status).toBe(1);
        expect(out(r)).toContain('src/Říčany.jsx');
        expect(out(r)).not.toContain('\\305');
    });

    it.each([
        'src/app.js',
        'src/mestax.js',
        'src/components/New.jsx',
        'src/notes.md',
        'package.json',
        'package-lock.json',
        'cloudflare/package.json',
        'cloudflare/worker.js',
        'cloudflare/mesta-worker.js.bak',
        'cloudflare/wrangler.jsonc',
        'index.html',
        'vite.config.js',
        '.gitignore',
        'eslint.config.js',
        'vitest.config.js',
        'vercel.json',
        'public/data/praha-1/lists.json',
        'api/volby.js',
        '.github/workflows/ci.yml',
        'sub/dir/readme.md',
    ])('fails when %s changes', (file) => {
        write(file, `changed ${Math.random()}`);
        commit('forbidden');
        const r = run(['base']);
        expect(r.status).toBe(1);
        expect(out(r)).toContain(file);
        expect(out(r)).not.toContain('PRAGUE UNCHANGED');
        // a ještě než se cokoli stavělo
        expect(builds()).toBe(0);
    });

    it('fails on a deleted Prague file', () => {
        git('rm', '-q', 'src/app.js');
        commit('delete');
        const r = run(['base']);
        expect(r.status).toBe(1);
        expect(out(r)).toContain('src/app.js');
    });

    it('fails on a Prague file renamed into src/mesta (both paths are checked)', () => {
        mkdirSync(path.join(repo, 'src/mesta'), { recursive: true });
        git('mv', 'src/app.js', 'src/mesta/app.js');
        commit('rename');
        const r = run(['base']);
        expect(r.status).toBe(1);
        expect(out(r)).toContain('src/app.js');
    });
});

describe('byte comparison (defense in depth)', () => {
    it('catches a change the path check was told to allow', () => {
        write('src/app.js', 'export const a = 2');
        commit('prague change');
        const r = run(['base'], { GUARD_ALLOW_REGEX: '^src/' });
        expect(r.status).toBe(1);
        expect(out(r)).toContain('PRAGUE CHANGED');
        expect(out(r)).not.toContain('PRAGUE UNCHANGED');
        expect(out(r)).toContain('src/app.js');
    });

    it('catches a worker-only change', () => {
        write('cloudflare/worker.js', 'export default { changed: 1 }');
        commit('worker change');
        const r = run(['base'], { GUARD_ALLOW_REGEX: '^cloudflare/' });
        expect(r.status).toBe(1);
        expect(out(r)).toContain('worker.js');
    });

    it('skipping the worker step is PARTIAL: exit 4, first line PARTIAL:, never a pass', () => {
        write('src/mesta/new.jsx', 'banner');
        commit('mesta');
        const r = run(['base'], { GUARD_SKIP_WORKER: '1' });
        expect(r.status).toBe(4);
        expect(r.stdout.split('\n')[0]).toMatch(/^PARTIAL:/);
        expect(out(r)).not.toContain('PRAGUE UNCHANGED');
    });

    it('a real difference is still PRAGUE CHANGED (exit 1) when the worker step is skipped', () => {
        write('src/app.js', 'export const a = 3');
        commit('prague change');
        const r = run(['base'], { GUARD_ALLOW_REGEX: '^src/', GUARD_SKIP_WORKER: '1' });
        expect(r.status).toBe(1);
        expect(out(r)).toContain('PRAGUE CHANGED');
    });
});

describe('the strip list is load-bearing', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    const block = /STRIP=\(([^)]*)\)/.exec(script)[1];
    const entries = block.split(/\s+/).filter(Boolean);

    const withoutEntry = (entry) => {
        const copy = path.join(tmpRoot, `guard-no-${entry.replace(/\W/g, '_')}.sh`);
        writeFileSync(copy, script.replace(block, block.split(/\s+/).filter((e) => e && e !== entry).join(' ')));
        return copy;
    };
    const runScript = (file, args) => spawnSync('bash', [file, ...args], { cwd: repo, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpRoot, GUARD_INSTALL_CMD: 'true', GUARD_BUILD_CMD: BUILD, GUARD_WORKER_CMD: WORKER, GUARD_COUNTER: counter } });

    beforeEach(() => {
        for (const rel of ['src/mesta/a.jsx', 'public-mesta/data/x.json', 'tools/t.js', 'placeholder/p.html', 'cloudflare/mesta-worker.js', 'cloudflare/mestaWiring.js', 'cloudflare/mestaWiring.test.js', 'cloudflare/mestaWorker.drift.test.js', 'cloudflare/wrangler.mesta.jsonc', 'vite.mesta.config.js', '.github/workflows/mesta.yml', 'docs/new.md', 'docs/new.txt', 'scripts/new.sh', 'NOTES.md']) write(rel, `mesta ${rel}`);
        commit('all mesta paths');
    });

    it('the unmodified script passes on a commit touching every allow-listed path', () => {
        expect(runScript(SCRIPT, ['base']).status).toBe(0);
    });

    it('lists the expected entries', () => {
        expect(entries).toContain('src/mesta');
        expect(entries.length).toBeGreaterThanOrEqual(12);
    });

    it.each(entries)('dropping %s from STRIP makes the guard report a change', (entry) => {
        const r = runScript(withoutEntry(entry), ['base']);
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout + r.stderr).toContain('PRAGUE CHANGED');
    });

    it('dropping the *.md rule makes the guard report a change', () => {
        const copy = path.join(tmpRoot, 'guard-no-md.sh');
        writeFileSync(copy, script.replace(/ && find \. -name '\*\.md'[^)]*-delete/, ''));
        expect(readFileSync(copy, 'utf8')).not.toContain("-name '*.md'");
        const r = runScript(copy, ['base']);
        expect(r.status).toBe(1);
    });
});

describe('base cache and determinism', () => {
    it('the cache key includes the script itself (an edited guard does not reuse a stale base)', () => {
        write('src/mesta/new.jsx', 'banner');
        commit('mesta');
        run(['base']);
        const script = readFileSync(SCRIPT, 'utf8');
        const copy = path.join(tmpRoot, 'guard-edited.sh');
        writeFileSync(copy, `${script}\n# edited\n`);
        spawnSync('bash', [copy, 'base'], { cwd: repo, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpRoot, GUARD_INSTALL_CMD: 'true', GUARD_BUILD_CMD: BUILD, GUARD_WORKER_CMD: WORKER, GUARD_COUNTER: counter } });
        expect(readdirSync(path.join(repo, '.cache')).filter((f) => f.startsWith('prague-base-'))).toHaveLength(2);
    });

    it('builds the base twice on a first run, then reuses the cache', () => {
        write('src/mesta/new.jsx', 'banner');
        commit('mesta');
        const first = run(['base']);
        expect(first.status).toBe(0);
        expect(builds()).toBe(3); // base, base again (determinism), HEAD
        expect(readdirSync(path.join(repo, '.cache')).filter((f) => f.startsWith('prague-base-'))).toHaveLength(1);

        const second = run(['base']);
        expect(second.status).toBe(0);
        expect(out(second)).toContain('cached');
        expect(builds()).toBe(4); // jen HEAD
    });

    it('a different base sha does not hit the cache', () => {
        write('src/mesta/new.jsx', 'banner');
        commit('mesta 1');
        run(['base']);
        write('src/mesta/other.jsx', 'banner 2');
        commit('mesta 2');
        const r = run(['mesta/work~1']);
        expect(r.status).toBe(0);
        expect(readdirSync(path.join(repo, '.cache')).filter((f) => f.startsWith('prague-base-'))).toHaveLength(2);
    });

    it('stops with exit 2 when the build is not deterministic', () => {
        write('src/mesta/new.jsx', 'banner');
        commit('mesta');
        const flaky = `${BUILD} && echo "$RANDOM$RANDOM" > dist/flaky.txt`;
        const r = run(['base'], { GUARD_BUILD_CMD: flaky });
        expect(r.status).toBe(2);
        expect(out(r)).toContain('not deterministic');
    });

    it('stops with exit 2 when the worker output is not deterministic', () => {
        write('src/mesta/new.jsx', 'banner');
        commit('mesta');
        const r = run(['base'], { GUARD_WORKER_CMD: `${WORKER} && echo "$RANDOM$RANDOM" > "$WORKER_OUT/flaky.txt"` });
        expect(r.status).toBe(2);
        expect(out(r)).toContain('not deterministic');
    });

    it('a failing build is an error, not "unchanged"', () => {
        write('src/mesta/new.jsx', 'banner');
        commit('mesta');
        const r = run(['base'], { GUARD_BUILD_CMD: 'false' });
        expect(r.status).not.toBe(0);
        expect(out(r)).not.toContain('PRAGUE UNCHANGED');
    });

    it('prints timings', () => {
        write('src/mesta/new.jsx', 'banner');
        commit('mesta');
        expect(out(run(['base']))).toMatch(/\[timing\].*build.*\d+s/);
    });
});

describe('housekeeping', () => {
    it('removes only its own temp dir and leaves the repo working tree alone', () => {
        write('src/mesta/new.jsx', 'banner');
        commit('mesta');
        writeFileSync(path.join(tmpRoot, 'keep.txt'), 'not mine');
        const r = run(['base']);
        expect(r.status).toBe(0);
        expect(readdirSync(tmpRoot)).toEqual(['keep.txt']);
        expect(git('status', '--porcelain')).toBe('');
        expect(existsSync(path.join(repo, 'src/mesta/new.jsx'))).toBe(true);
    });

    it('cleans up after a failure too', () => {
        write('src/mesta/new.jsx', 'banner');
        commit('mesta');
        run(['base'], { GUARD_BUILD_CMD: 'false' });
        expect(readdirSync(tmpRoot)).toEqual([]);
    });

    it('defaults the base to the merge-base with origin/main', () => {
        write('src/mesta/new.jsx', 'banner');
        commit('mesta');
        git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'base'));
        const r = run([]);
        expect(r.status).toBe(0);
        expect(out(r)).toContain('PRAGUE UNCHANGED');
    });

    it('rejects an unknown base', () => {
        const r = run(['no-such-rev']);
        expect(r.status).not.toBe(0);
    });
});
