// mesta-worker.js nejde načíst ve Vitestu (importuje cloudflare:workers), proto
// hlídáme text: HTTP lepidlo zkopírované z worker.js se nesmí rozejít a mesta
// Worker nesmí sáhnout na pražský registr (spec mesta §3.1, M10).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { COUNCILS as PRAGUE_COUNCILS } from '../src/councils.js';
import { createMestaWiring } from './mestaWiring.js';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const prague = read('worker.js');
const mesta = read('mesta-worker.js');

// Tělo deklarace nejvyšší úrovně: od `function name(` / `async function name(`
// po první `\n}\n`, u `const name = …` první řádek (jednořádkové lambdy a konstanty)
function declaration(source, name) {
    const start = source.search(new RegExp(`^(?:async function |function |const )${name}\\b`, 'm'));
    if (start < 0) return null;
    const rest = source.slice(start);
    const isFunction = /^(?:async )?function /.test(rest);
    const end = rest.indexOf(isFunction ? '\n}\n' : '\n');
    return end < 0 ? null : rest.slice(0, end + (isFunction ? 2 : 0));
}

const importsOf = (source) => [...source.matchAll(/^import\s+([\s\S]*?)\s+from\s+'([^']+)';/gm)]
    .map(([, clause, from]) => ({
        from,
        names: [...clause.matchAll(/[\w$]+/g)].map((m) => m[0]).filter((n) => n !== 'as'),
    }));

describe('copied HTTP glue stays identical to worker.js', () => {
    for (const name of ['sMaxAge', 'reply', 'lastResort', 'logFeedFailure', 'JSON_TYPE', 'RPC_TIMEOUT_MS', 'FAIL_LOG_EVERY_MS']) {
        it(name, () => {
            const original = declaration(prague, name);
            expect(original, `${name} not found in worker.js`).toBeTruthy();
            expect(declaration(mesta, name), `${name} differs or is missing in mesta-worker.js`).toBe(original);
        });
    }
});

describe('mesta-worker.js does not touch the Prague registry', () => {
    const imports = importsOf(mesta);
    const from = (module) => imports.filter((i) => i.from === module).flatMap((i) => i.names);

    it('does not import buildFeed/feedKind from ./feedWiring.js (only makeLog/phaseOfSnapshot)', () => {
        expect(from('./feedWiring.js').sort()).toEqual(['makeLog', 'phaseOfSnapshot']);
    });
    it('does not import feedTarget from ./warmup.js (only runWarmup)', () => {
        expect(from('./warmup.js')).toEqual(['runWarmup']);
    });
    it('imports ALL_COUNCILS (not COUNCILS) from the mesta registry and never the Prague one', () => {
        const registry = from('../src/mesta/councils.js');
        expect(registry).toContain('ALL_COUNCILS');
        expect(registry).toContain('SHARDS');
        expect(registry).not.toContain('COUNCILS');
        expect(imports.map((i) => i.from)).not.toContain('../src/councils.js');
        expect(imports.map((i) => i.from)).not.toContain('./feedClasses.js');
    });
    it('uses the wiring for routing, feed targets and first-class keys', () => {
        expect(from('./mestaWiring.js')).toContain('createMestaWiring');
        expect(mesta).toMatch(/wiring\.route\(/);
        expect(mesta).toMatch(/wiring\.feedTarget\(/);
        expect(mesta).toMatch(/wiring\.firstClassKeys/);
    });
});

describe('importsOf', () => {
    it('parses named, aliased and default imports', () => {
        expect(importsOf("import a, { b as c, d } from './x.js';")).toEqual([{ from: './x.js', names: ['a', 'b', 'c', 'd'] }]);
    });
});

// Bundle a registr — jen pokud už existuje src/mesta/councils.js (T2). Wrangler
// nedokáže vyměnit relativní import ../src/councils.js (alias v esbuildu platí
// jen pro holá jména balíků), takže pražský registr v bundlu zůstává jako
// neaktivní data z feed.js/overview.js/refresh.js. Kontroluje se tedy, že (a) se
// do něj nedostane pražské lepidlo a (b) žádné mesto nekoliduje s pražským
// kódem (composeOverview volá councilByZastup(s.z)?.magistrat z pražského registru).
const MESTA_REGISTRY = new URL('../src/mesta/councils.js', import.meta.url);

describe.skipIf(!existsSync(MESTA_REGISTRY))('mesta registry and bundle', () => {
    it('no mesta town shares a code with the Prague registry; shards are consistent', async () => {
        const { ALL_COUNCILS, SHARDS } = await import(/* @vite-ignore */ MESTA_REGISTRY.href);
        const prague = new Set(PRAGUE_COUNCILS.map((c) => c.zastup));
        expect(ALL_COUNCILS.filter((c) => prague.has(c.zastup)).map((c) => c.zastup)).toEqual([]);
        expect(ALL_COUNCILS.every((c) => c.precinctFiles === false && c.map === false)).toBe(true);
        const wiring = createMestaWiring({ councils: ALL_COUNCILS, shards: SHARDS });
        expect(ALL_COUNCILS.filter((c) => c.featured)).toHaveLength(12);
        expect(wiring.firstClassKeys).toHaveLength(SHARDS.length + 12);
    });

    it('bundle: mesta UA present, no Prague wiring, UA or error text', async () => {
        const out = await build({
            entryPoints: [fileURLToPath(new URL('./mesta-worker.js', import.meta.url))],
            bundle: true,
            write: false,
            metafile: true,
            format: 'esm',
            platform: 'neutral',
            mainFields: ['module', 'main'],
            conditions: ['workerd', 'worker', 'browser'],
            external: ['cloudflare:workers'],
            logLevel: 'silent',
        });
        const code = out.outputFiles[0].text;
        expect(code).toContain('pirati-mesta/1.0');
        expect(code).not.toContain('pirati-vysledky-2026/1.0'); // api/_http.js
        expect(code).not.toContain('unknown feed key'); // feedWiring.buildFeed / warmup.feedTarget
        const contributed = Object.values(out.metafile.outputs)[0].inputs;
        const used = (suffix) => Object.entries(contributed).some(([file, { bytesInOutput }]) => file.endsWith(suffix) && bytesInOutput > 0);
        for (const file of ['api/_http.js', 'api/volby.js', 'api/bug.js', 'cloudflare/feedClasses.js']) {
            expect(used(file), file).toBe(false);
        }
    });
});
