import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../lib/util.js';
import { loadMestaCouncils } from '../build-data.js';
import { OUT, baselineFor, buildBaselines, serialize } from './baseline2022.js';

const results2022 = (rows) => ({ okrsky: Object.fromEntries(rows.map(([id, validVotes, votes]) => [id, { validVotes, votes }])) });
const lists2022 = [
    { id: '5', slozeni: [720], seats: 4 },
    { id: '7', slozeni: [1], seats: 3 },
    { id: '9', slozeni: [47], seats: 1 },
];
const R = results2022([['1', 1000, { 5: 80, 7: 300, 9: 50 }], ['2', 1000, { 5: 62, 7: 300, 9: 50 }]]); // 5: 7.1 %, 7: 30 %

describe('baselineFor', () => {
    const mk = (list) => ({ pirates: 11, lists: { lists: [{ id: 11, ...list }], lists2022 }, results2022: R });
    it('same list as today (exact): pct over all precincts, seats from lists2022, no label', () => {
        expect(baselineFor(mk({ baseline: { ids: ['5'], label: 'Česká pirátská strana', exact: true }, split: null }))).toEqual({ pct: 7.1, seats: 4, label: null });
    });
    it('merged baseline (several 2022 lists, not exact): summed pct and seats, 2022 label kept', () => {
        expect(baselineFor(mk({ baseline: { ids: ['5', '9'], label: 'Piráti + KSČM', exact: false }, split: null }))).toEqual({ pct: 12.1, seats: 5, label: 'Piráti + KSČM' });
    });
    it('split since 2022: the Pirates\' own 2022 list (the one with code 720), not the partners', () => {
        const split = [{ id: '7', label: 'SPOLU' }, { id: '5', label: 'Česká pirátská strana' }];
        expect(baselineFor(mk({ baseline: null, split }))).toEqual({ pct: 7.1, seats: 4, label: 'Česká pirátská strana' });
    });
    it('no baseline and no Pirate part in the split: null (bez srovnatelného výsledku)', () => {
        expect(baselineFor(mk({ baseline: null, split: null }))).toBeNull();
        expect(baselineFor(mk({ baseline: null, split: [{ id: '7', label: 'SPOLU' }] }))).toBeNull();
    });
    it('no Pirate list (forced c/d or hidden town) or no precinct data: null', () => {
        expect(baselineFor({ ...mk({}), pirates: null })).toBeNull();
        expect(baselineFor({ ...mk({ baseline: { ids: ['5'], exact: true } }), results2022: { okrsky: {} } })).toBeNull();
    });
    it('seats stay null when lists2022 is missing', () => {
        const m = mk({ baseline: { ids: ['5'], exact: true } });
        expect(baselineFor({ ...m, lists: { lists: m.lists.lists } }).seats).toBeNull();
    });
});

describe('buildBaselines', () => {
    it('is deterministic and ordered by zastup, whatever the input order', () => {
        const councils = [{ zastup: 9, slug: 'b', pirates: 11 }, { zastup: 3, slug: 'a', pirates: null }];
        const read = () => ({ lists: { lists: [], lists2022 }, results2022: R });
        const a = serialize(buildBaselines(councils, read));
        expect(serialize(buildBaselines([...councils].reverse(), read))).toBe(a);
        expect(Object.keys(JSON.parse(a))).toEqual(['3', '9']);
        expect(a.endsWith('\n')).toBe(true);
    });
});

// Drift guard: the committed JSON must equal what the script makes from public-mesta
describe('baseline2022.generated.json', () => {
    const committed = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    it('covers every town of the product (shown and hidden) and every shown town has a key', async () => {
        const councils = await loadMestaCouncils();
        expect(Object.keys(committed).sort()).toEqual(councils.map((c) => String(c.zastup)).sort());
        expect(councils.filter((c) => c.shown).length).toBeGreaterThan(70);
        for (const c of councils.filter((x) => x.shown)) expect(committed, c.name).toHaveProperty(String(c.zastup));
    });
    it('is in sync with public-mesta (run: node scripts/mesta/baseline2022.js)', async () => {
        const councils = await loadMestaCouncils();
        const read = (slug) => {
            const dir = path.join(ROOT, 'public-mesta/data', slug);
            return { lists: JSON.parse(fs.readFileSync(path.join(dir, 'lists.json'), 'utf8')), results2022: JSON.parse(fs.readFileSync(path.join(dir, 'results2022.json'), 'utf8')) };
        };
        expect(serialize(buildBaselines(councils, read))).toBe(fs.readFileSync(OUT, 'utf8'));
    });
    it('entries have the documented shape', () => {
        for (const [z, e] of Object.entries(committed)) {
            if (e === null) continue;
            expect(Number.isFinite(e.pct), z).toBe(true);
            expect(e.seats === null || Number.isInteger(e.seats), z).toBe(true);
            expect(e.label === null || typeof e.label === 'string', z).toBe(true);
        }
    });
});
