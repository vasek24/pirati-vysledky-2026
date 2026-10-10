// Kontrola nad skutečnými daty (COUNCILS, aliases.js, excluded.generated.json),
// ne nad vývojovou fixturou: když generátor přidá město, tabulka aliasů nebo
// hledání se musí ozvat tady.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ALIASES from './aliases.js';
import { ALL_COUNCILS, COUNCILS } from './councils.js';
import EXCLUDED from './excluded.generated.json';
import { buildIndex, norm, search } from './search.js';

const index = buildIndex(COUNCILS, ALIASES, EXCLUDED, { unverified: ALL_COUNCILS.filter((c) => !c.shown) });
const first = (q, limit = 8) => search(index, q, { limit }).items[0];

describe('real COUNCILS in search', () => {
    it('has towns to test', () => {
        expect(COUNCILS.length).toBeGreaterThan(50);
    });
    it('every shown town has an alias entry with its own name and an okres', () => {
        for (const c of COUNCILS) {
            const a = ALIASES[String(c.zastup)];
            expect(a, `${c.name} (${c.zastup}) is missing in aliases.js`).toBeTruthy();
            expect(a.name, `${c.zastup}`).toBe(c.name);
            expect(a.okres, `${c.name} okres`).toBeTruthy();
        }
    });
    it('every shown town is found by its name (first, unless another town has the same name) and by its okres', () => {
        for (const c of COUNCILS) {
            const same = COUNCILS.filter((x) => norm(x.name) === norm(c.name));
            const byName = search(index, c.name, { limit: 8 }).items;
            expect(byName.some((i) => i.zastup === c.zastup), `${c.name} by name`).toBe(true);
            if (same.length === 1) expect(byName[0].zastup, `${c.name} first`).toBe(c.zastup);
            const byOkres = search(index, ALIASES[String(c.zastup)].okres, { limit: 40 }).items;
            expect(byOkres.some((i) => i.zastup === c.zastup), `${c.name} by okres ${ALIASES[String(c.zastup)].okres}`).toBe(true);
        }
    });
    it('every alias form resolves to its own town first', () => {
        const shown = new Map(COUNCILS.map((c) => [String(c.zastup), c]));
        for (const [z, a] of Object.entries(ALIASES)) {
            const c = shown.get(z);
            if (!c) continue;
            for (const form of a.forms) expect(first(form)?.zastup, `${form} → ${c.name}`).toBe(c.zastup);
        }
    });
    it('every excluded town answers with its own entry first and its reason', () => {
        const names = new Map();
        for (const e of EXCLUDED) names.set(norm(e.name), (names.get(norm(e.name)) ?? 0) + 1);
        const published = new Set(COUNCILS.map((c) => norm(c.name)));
        for (const e of EXCLUDED) {
            if (published.has(norm(e.name)) || names.get(norm(e.name)) > 1) continue; // same name as a published or another excluded town
            const hit = first(e.name);
            expect(hit, e.name).toMatchObject({ kind: 'other', zastup: e.zastup });
            expect(hit.note, e.name).toBeTruthy();
        }
    });
    it('a hidden town is only a non-navigating "verify" entry', () => {
        for (const c of ALL_COUNCILS.filter((x) => !x.shown)) {
            const hit = search(index, c.name, { limit: 8 }).items.find((i) => i.zastup === c.zastup);
            expect(hit?.kind, c.name).toBe('verify');
            expect(hit.slug).toBeUndefined();
        }
    });
});

describe('index page source', () => {
    const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
    it('links back to the front door volby.dg12.cz at the top and in the footer', () => {
        expect(read('./index/IndexHeader.jsx')).toContain('href="https://volby.dg12.cz"');
        expect(read('./index/IndexHeader.jsx')).toContain('← Všechny volby 2026');
        expect(read('./index/IndexPage.jsx')).toContain('href="https://volby.dg12.cz"');
    });
    it('MestaIndex passes the 2022 baselines to the page', () => {
        expect(read('./MestaIndex.jsx')).toContain('baseline2022.generated.json');
    });
    it('footer says "Zdroj: ČSÚ (volby.gov.cz)", never the Prague marker wording (case-insensitive)', () => {
        const src = readFileSync(new URL('./index/IndexPage.jsx', import.meta.url), 'utf8');
        expect(src).toContain('Zdroj: ČSÚ (volby.gov.cz)');
        expect(src.toLowerCase()).not.toContain('data čsú (volby.gov.cz)');
    });
});
