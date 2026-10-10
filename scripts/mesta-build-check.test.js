import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDist } from './mesta-build-check.mjs';

const dirs = [];
afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const BUILD = 'abc1234-0a1b2c';

// Minimální „dobrý“ výstup mesta: entry s markerem, lazy MestaIndex a CouncilApp
// se záplatami, version.json, žádný Landing.
function fixture(mutate = () => {}) {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesta-dist-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'assets'));
    const files = {
        'index.html': '<!doctype html><title>Volby 2026 · Piráti ve městech</title><script type="module" crossorigin src="/assets/index-AAA.js"></script>',
        'version.json': JSON.stringify({ version: `mesta-${BUILD}` }),
        'assets/index-AAA.js': `const b="${BUILD}",v="mesta-"+b,t="Piráti ve městech";`,
        'assets/MestaIndex-BBB.js': 'export default 1',
        'humans.txt': 'MAINTAINER Václav Vislous, Phone +420 777 954 389',
        'kontakt.txt': 'Václav Vislous, tel. +420 777 954 389',
        'assets/CouncilApp-CCC.js': 'a="Kandidátka s Piráty";b="pražských výsledcích 2022";c="Ostatní města";d="Postaveno na kódu"',
    };
    mutate(files);
    for (const [name, body] of Object.entries(files)) {
        if (body === null) continue;
        writeFileSync(path.join(dir, name), body);
    }
    return dir;
}

describe('checkDist', () => {
    it('accepts a good mesta build', () => {
        expect(checkDist(fixture())).toEqual([]);
    });

    it('reports a missing dist directory', () => {
        expect(checkDist('/nonexistent-mesta-dist')).toEqual([expect.stringContaining('not found')]);
    });

    it('fails on a Landing chunk', () => {
        const problems = checkDist(fixture((f) => { f['assets/Landing-ZZZ.js'] = 'x'; }));
        expect(problems.join('\n')).toMatch(/Landing/);
    });

    it('fails when Prague Landing content got bundled under another name', () => {
        const problems = checkDist(fixture((f) => { f['assets/index-AAA.js'] += 'x="Verze · data ČSÚ (volby.gov.cz)"'; }));
        expect(problems.join('\n')).toMatch(/Landing/);
    });

    it('fails when the entry chunk lacks the mesta marker', () => {
        const problems = checkDist(fixture((f) => { f['assets/index-AAA.js'] = `const b="${BUILD}";`; }));
        expect(problems.join('\n')).toMatch(/entry chunk/);
    });

    it('fails when the entry script of index.html is missing', () => {
        const problems = checkDist(fixture((f) => { f['index.html'] = '<title>x</title>'; }));
        expect(problems.join('\n')).toMatch(/entry/);
    });

    it('fails when version.json is not a mesta version', () => {
        const problems = checkDist(fixture((f) => { f['version.json'] = JSON.stringify({ version: '1.6.0' }); }));
        expect(problems.join('\n')).toMatch(/version\.json/);
    });

    it('fails when the version id is not in the bundle', () => {
        const problems = checkDist(fixture((f) => { f['version.json'] = JSON.stringify({ version: 'mesta-ffffff-000000' }); }));
        expect(problems.join('\n')).toMatch(/not in the bundle/);
    });

    it('fails on Prague wording and on a direct ČSÚ URL', () => {
        const a = checkDist(fixture((f) => { f['assets/CouncilApp-CCC.js'] += 'x="Záložní kopie originálu"'; }));
        expect(a.join('\n')).toMatch(/Záložní kopie originálu/);
        const b = checkDist(fixture((f) => { f['assets/CouncilApp-CCC.js'] += 'x="https://volby.gov.cz/appdata/kv2026/"'; }));
        expect(b.join('\n')).toMatch(/appdata\/kv2026/);
    });

    it('fails when a patch did not reach the bundle', () => {
        const problems = checkDist(fixture((f) => { f['assets/CouncilApp-CCC.js'] = 'nothing'; }));
        expect(problems.join('\n')).toMatch(/Kandidátka s Piráty/);
    });

    it('fails without a MestaIndex chunk and without Prague title cleanup', () => {
        const a = checkDist(fixture((f) => { f['assets/MestaIndex-BBB.js'] = null; }));
        expect(a.join('\n')).toMatch(/MestaIndex/);
        const b = checkDist(fixture((f) => { f['index.html'] = f['index.html'].replace('Piráti ve městech', 'Piráti Praha'); }));
        expect(b.join('\n')).toMatch(/index\.html/);
    });

    it('fails on Prague wording left in index.html', () => {
        for (const bad of ['<!-- Záložní kopie originálu x -->', 'Václav Vislous spravuje tuto kopii']) {
            const problems = checkDist(fixture((f) => { f['index.html'] += bad; }));
            expect(problems.join('\n')).toMatch(/index\.html contains/);
        }
    });

    it('requires mesta humans.txt and kontakt.txt with the maintainer name and phone', () => {
        for (const name of ['humans.txt', 'kontakt.txt']) {
            expect(checkDist(fixture((f) => { f[name] = null; })).join('\n')).toContain(name);
            expect(checkDist(fixture((f) => { f[name] = 'Václav Vislous'; })).join('\n')).toContain(name);
            expect(checkDist(fixture((f) => { f[name] = '+420 777 954 389'; })).join('\n')).toContain(name);
        }
    });

    it('reads files from disk (sanity)', () => {
        const dir = fixture();
        expect(readFileSync(path.join(dir, 'version.json'), 'utf8')).toContain('mesta-');
    });
});
