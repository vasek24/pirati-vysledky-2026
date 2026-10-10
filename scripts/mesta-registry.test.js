import { describe, it, expect, vi } from 'vitest';
import { compute, execute, pirates2022, fetchJmsez, buildDocs } from './mesta-registry.js';

describe('pirates2022', () => {
    const row = (extra) => ({ DATUMVOLEB: '20220923', KODZASTUP: '100', SLOZENI: '720', PROCHLSTR: '8.35', MAND_STR: '2', ...extra });

    it('keeps only the 2022 general election date (not later by-elections)', () => {
        const out = pirates2022([row({}), row({ DATUMVOLEB: '20240316', PROCHLSTR: '30.1', MAND_STR: '9' })]);
        expect(out.get(100)).toEqual({ pct: 8.35, seats: 2 });
    });

    it('picks the list with the highest percentage per council and ignores lists without 720', () => {
        const out = pirates2022([
            row({ PROCHLSTR: '4.1', MAND_STR: '0' }),
            row({ SLOZENI: '166,720', PROCHLSTR: '12.7', MAND_STR: '3' }),
            row({ SLOZENI: '053', PROCHLSTR: '40', MAND_STR: '9' }),
            row({ KODZASTUP: '200', SLOZENI: '001', PROCHLSTR: '50' }),
        ]);
        expect(out.get(100)).toEqual({ pct: 12.7, seats: 3 });
        expect(out.has(200)).toBe(false);
    });

    it('parses ".46" and blank values', () => {
        const out = pirates2022([row({ KODZASTUP: '1', PROCHLSTR: '.46', MAND_STR: '' }), row({ KODZASTUP: '2', PROCHLSTR: '', MAND_STR: '' })]);
        expect(out.get(1)).toEqual({ pct: 0.46, seats: 0 });
        expect(out.get(2)).toEqual({ pct: 0, seats: 0 });
    });
});

// Malý syntetický registr: 7 radnic + vesnice
const rzc = (z, name, pop, druh = 2) => ({
    KRAJ: '2100', OKRES: '2101', TYPZASTUP: '1', DRUHZASTUP: String(druh), KODZASTUP: String(z), NAZEVZAST: name, MANDATY: '21',
    POCOBYV: String(pop), MINOKRSEK1: '1', MAXOKRSEK1: '5',
});
const ros = (z, por, slozeni, vstrana, name = 'Seznam') => ({
    KODZASTUP: String(z), COBVODU: '1', POR_STR_HL: String(por), OSTRANA: String(vstrana), VSTRANA: String(vstrana), NAZEVCELK: name,
    ZKRATKAO30: name, ZKRATKAO8: name, SLOZENI: slozeni,
});
const rk = (z, por, n, pstrana, nstrana = pstrana) => ({
    KODZASTUP: String(z), COBVODU: '1', POR_STR_HL: String(por), OSTRANA: '1', PORCISLO: String(n), JMENO: 'Jan', PRIJMENI: `P${n}`,
    PSTRANA: String(pstrana), NSTRANA: String(nstrana), PLATNOST: 'A',
});

const source = (extra = {}) => ({
    hashes: { reg: 'x' },
    kvrzcoco: [
        rzc(1001, 'Alfa', 20000), rzc(1002, 'Beta', 12000), rzc(1003, 'Gama', 15000), rzc(1004, 'Delta', 9000),
        rzc(1005, 'Epsilon', 8000), rzc(1006, 'Dzeta', 3000, 1), rzc(1007, 'Eta', 11000),
    ],
    kvros: [
        ros(1001, 3, '720', 720), ros(1002, 4, '166,720', 1350), ros(1003, 2, '080,166', 470), ros(1004, 5, '166,720', 1350),
        ros(1005, 6, '166,720', 1350), ros(1007, 1, '053', 53),
    ],
    kvrk: [
        rk(1001, 3, 1, 720), rk(1002, 4, 1, 720), rk(1002, 4, 2, 99, 720), rk(1003, 2, 5, 720, 166), rk(1004, 5, 1, 720), rk(1005, 6, 1, 720),
    ],
    cvs: [{ VSTRANA: '1350', TYPVS: 'K' }],
    cns: [{ NSTRANA: '80', ZKRATKAN8: 'NK' }, { NSTRANA: '166', ZKRATKAN8: 'STAN' }, { NSTRANA: '720', ZKRATKAN8: 'Piráti' }],
    cnumnuts: [{ NUMNUTS: '2100', NAZEVNUTS: 'Středočeský kraj' }, { NUMNUTS: '2101', NAZEVNUTS: 'Benešov' }],
    kvros2022: [{ DATUMVOLEB: '20220923', KODZASTUP: '1005', SLOZENI: '720', PROCHLSTR: '5.0', MAND_STR: '0' }],
    senate: { obvody: [] },
    ...extra,
});
const OWNER = 'Central Bohemia: Alfa · Gama · Delta\n';

const run = (src, owner = OWNER, opts = {}) => {
    const io = { write: vi.fn(), log: vi.fn(), err: vi.fn(), ...opts };
    return { code: execute(src, owner, io), io };
};

describe('compute (end to end on an in-memory registry)', () => {
    const res = compute(source(), OWNER, { reviewedAt: null, towns: {} });

    it('counts per inclusion', () => {
        const by = (inc) => res.towns.filter((t) => t.inclusion === inc).map((t) => t.name);
        expect(by('auto')).toEqual(['Alfa', 'Beta']);
        expect(by('borderline-included')).toEqual(['Delta']);
        expect(by('forced')).toEqual([]);
        expect(res.towns).toHaveLength(3);
        expect(res.records.filter((r) => r.dec.inclusion === 'borderline-excluded').map((r) => r.council.name)).toEqual(['Epsilon']);
        expect(res.problems).toEqual([]);
    });

    it('writes the three contract shapes in kraj/Czech order, specifics aligned', () => {
        expect(res.specifics.map((s) => s.zastup)).toEqual(res.towns.map((t) => t.zastup));
        expect(res.towns[0]).toMatchObject({ slug: 'alfa', zastup: 1001, shard: '21-1', featured: 'top-1', onOwnerList: true, populationCsu2025: null });
        expect(res.specifics.find((s) => s.zastup === 1002)).toMatchObject({ type: 'b', confidence: 'high' });
        expect(res.specifics.find((s) => s.zastup === 1002).list.nominatedNonMembers).toBe(1);
        expect(res.excluded.map((e) => [e.name, e.reason])).toEqual([
            ['Epsilon', 'borderline-no-reason'], ['Eta', 'no-pirate-list'], ['Gama', 'other-lists-only'],
        ]);
        expect(res.excluded[0]).toMatchObject({ okres: 2101, kraj: 2100, population: 8000, inclusion: 'borderline-excluded' });
    });

    it('a forced override publishes a tiny village; a bad override name is a problem', () => {
        const forced = compute(source(), OWNER, { reviewedAt: null, towns: { 1006: { name: 'Dzeta', include: true, reason: 'majitel' } } });
        expect(forced.towns.find((t) => t.name === 'Dzeta')).toMatchObject({ inclusion: 'forced' });
        const bad = compute(source(), OWNER, { reviewedAt: null, towns: { 1006: { name: 'Dzetta', include: true, reason: 'majitel' } } });
        expect(bad.problems[0]).toMatch(/overrides.*name/);
    });
});

describe('compute: ČSÚ 2025 population cross-check (population-band-differs)', () => {
    const pop = (entries) => new Map(Object.entries(entries).map(([z, population]) => [Number(z), { name: 'x', population }]));
    const find = (res, name) => ({ t: res.towns.find((x) => x.name === name), s: res.specifics.find((x) => x.zastup === res.towns.find((t) => t.name === name).zastup) });

    it('fills populationCsu2025; a differing band flags the town low but never changes inclusion', () => {
        // Alfa 20 000 -> 9 990 (jiné pásmo), Beta 12 000 -> 12 100 (stejné), Delta 9 000 -> 10 050 (jiné), Gama není v tabulce
        const res = compute({ ...source(), pop2025: pop({ 1001: 9990, 1002: 12100, 1004: 10050 }) }, OWNER, { reviewedAt: null, towns: {} });
        const alfa = find(res, 'Alfa');
        expect(alfa.t).toMatchObject({ populationCsu2025: 9990, inclusion: 'auto' });
        expect(alfa.s.flags).toContain('population-band-differs');
        expect(alfa.s.confidence).toBe('low');
        expect(find(res, 'Beta').t.populationCsu2025).toBe(12100);
        expect(find(res, 'Beta').s.flags).not.toContain('population-band-differs');
        expect(find(res, 'Beta').s.confidence).toBe('high');
        const delta = find(res, 'Delta');
        expect(delta.t).toMatchObject({ populationCsu2025: 10050, inclusion: 'borderline-included' });
        expect(delta.s.flags).toContain('population-band-differs');
        expect(res.towns.map((t) => t.name)).toEqual(['Alfa', 'Beta', 'Delta']);
        expect(res.problems).toEqual([]);
    });

    it('without the table (null) populationCsu2025 stays null and no flag appears', () => {
        const res = compute({ ...source(), pop2025: null }, OWNER, { reviewedAt: null, towns: {} });
        expect(res.towns.every((t) => t.populationCsu2025 === null)).toBe(true);
        expect(res.specifics.flatMap((s) => s.flags)).not.toContain('population-band-differs');
    });

    it('a published town missing from the table warns and stays null', () => {
        const res = compute({ ...source(), pop2025: pop({ 1001: 20000 }) }, OWNER, { reviewedAt: null, towns: {} });
        expect(find(res, 'Beta').t.populationCsu2025).toBeNull();
        expect(res.warnings.join('\n')).toMatch(/Beta \(1002\).*2025/);
    });

    it('a differing band on an unpublished town sets no flag (it only matters for published ones)', () => {
        const res = compute({ ...source(), pop2025: pop({ 1005: 12000 }) }, OWNER, { reviewedAt: null, towns: {} });
        expect(res.records.find((r) => r.council.name === 'Epsilon').flags).not.toContain('population-band-differs');
    });
});

describe('compute: jmsez cross-check (jmsez-mismatch)', () => {
    const jm = (rows) => ({ generovano: 't', platni: { 3: { stranaNazev: 'X', seznam: rows } } });

    it('a Piráti label missing from members/others flags the town low; matching jmsez does not', () => {
        const ok = jm([[1, 'P1 Jan', 40, 'Piráti', 'Piráti']]);
        const bad = jm([[1, 'P1 Jan', 40, 'Piráti', 'Piráti'], [9, 'Cizí Karel', 40, 'Piráti', 'Piráti']]);
        const res = compute({ ...source(), jmsez: new Map([[1001, ok], [1002, bad]]) }, OWNER, { reviewedAt: null, towns: {} });
        const s = (z) => res.specifics.find((x) => x.zastup === z);
        expect(s(1001).flags).not.toContain('jmsez-mismatch');
        expect(s(1002).flags).toContain('jmsez-mismatch');
        expect(s(1002).confidence).toBe('low');
        expect(res.towns.map((t) => t.name)).toEqual(['Alfa', 'Beta', 'Delta']);
    });

    it('reverse direction: a registry member without a Piráti label in jmsez flags the town; a list absent from jmsez does not', () => {
        const noLabel = jm([[1, 'P1 Jan', 40, 'BEZPP', 'BEZPP']]); // člen 3:1 nemá štítek
        const res = compute({ ...source(), jmsez: new Map([[1001, noLabel], [1002, jm([[1, 'X', 40, 'BEZPP', 'BEZPP']])]]) }, OWNER, { reviewedAt: null, towns: {} });
        const s = (z) => res.specifics.find((x) => x.zastup === z);
        expect(s(1001).flags).toContain('jmsez-mismatch');
        expect(s(1002).flags).not.toContain('jmsez-mismatch'); // jmsez zná jen kandidátku 3, 1002 má kandidátku 4
    });

    it('exposes the 2022 results and the chosen list row for the reports', () => {
        const res = compute(source(), OWNER, { reviewedAt: null, towns: {} });
        expect(res.pirates2022.get(1005)).toEqual({ pct: 5, seats: 0 });
        expect(res.records.find((r) => r.council.name === 'Beta').listRow).toMatchObject({ VSTRANA: '1350', SLOZENI: '166,720' });
    });
});

describe('execute: exit codes', () => {
    it('0 and writes the three JSON files plus the reports and the extract for a clean run', () => {
        const { code, io } = run(source());
        expect(code).toBe(0);
        expect(io.write).toHaveBeenCalledTimes(1);
        const keys = Object.keys(io.write.mock.calls[0][0]);
        expect(keys.slice(0, 3)).toEqual(['towns', 'specifics', 'excluded']);
        expect(keys).toEqual(expect.arrayContaining([
            'docs/analysis/mesta-specifics.md', 'docs/analysis/mesta-list-verification.md',
            'docs/analysis/mesta-extract/README.md', 'docs/analysis/mesta-extract/councils.csv', 'docs/analysis/mesta-extract/jmsez-pirati.json',
        ]));
        expect(io.write.mock.calls[0][0]['docs/analysis/mesta-list-verification.md']).toMatch(/## 1\. Potvrzená/);
        expect(JSON.parse(io.write.mock.calls[0][0].towns)).toHaveLength(3);
        expect(io.err).not.toHaveBeenCalled();
    });

    it('1 and nothing written for an unmatched owner name', () => {
        const { code, io } = run(source(), `${OWNER}Central Bohemia: Nowhere\n`);
        expect(code).toBe(1);
        expect(io.write).not.toHaveBeenCalled();
        expect(io.err.mock.calls.join('\n')).toMatch(/unmatched "Nowhere"/);
    });

    it('1 for an ambiguous owner name', () => {
        const src = source();
        src.kvrzcoco.push(rzc(2001, 'Alfa', 900, 2));
        const { code, io } = run(src);
        expect(code).toBe(1);
        expect(io.err.mock.calls.join('\n')).toMatch(/ambiguous "Alfa"/);
    });

    it('1 for a reserved slug', () => {
        const src = source();
        src.kvrzcoco.push(rzc(3001, 'Data', 30000));
        src.kvros.push(ros(3001, 1, '720', 720));
        const { code, io } = run(src);
        expect(code).toBe(1);
        expect(io.err.mock.calls.join('\n')).toMatch(/reserved slug "data"/);
        expect(io.write).not.toHaveBeenCalled();
    });

    it('1 for invalid overrides', () => {
        const { code, io } = run(source(), OWNER, { ovr: { reviewedAt: null, towns: { 1001: { name: 'Alfa', pirates: 3 } } } });
        expect(code).toBe(1);
        expect(io.err.mock.calls.join('\n')).toMatch(/pirates must not be set/);
    });

    it('a candidate whose list row is missing warns on stderr but does not stop', () => {
        const src = source();
        src.kvrk.push(rk(1001, 9, 7, 720));
        const { code, io } = run(src);
        expect(code).toBe(0);
        expect(io.err.mock.calls.join('\n')).toMatch(/WARNING: Alfa \(1001\).*list row is missing/);
        expect(JSON.parse(io.write.mock.calls[0][0].specifics).find((s) => s.zastup === 1001).flags).toContain('candidate-without-list');
    });
});

describe('fetchJmsez', () => {
    const towns = [1, 2, 3, 4, 5].map((z) => ({ zastup: z, okres: 2101, name: `T${z}` }));

    it('collects every town and reports ok; the URL is built from okres and zastup', async () => {
        const urls = [];
        const out = await fetchJmsez(towns, { get: async (u) => { urls.push(u); return { platni: {} }; }, warn: () => {} });
        expect(out.meta).toMatchObject({ status: 'ok', fetched: 5, failed: [] });
        expect(out.map.size).toBe(5);
        expect(urls[0]).toMatch(/\/jmsez\/2101\/1\.json$/);
    });

    it('single failures give "partial" and name the failed towns', async () => {
        const warn = vi.fn();
        const out = await fetchJmsez(towns, { get: async (u) => { if (u.includes('/3.json')) throw new Error('500'); return {}; }, warn });
        expect(out.meta).toMatchObject({ status: 'partial', fetched: 4, failed: [3] });
        expect(warn.mock.calls.join('\n')).toMatch(/T3 \(3\).*500/);
    });

    it('three failures in a row mean not-run with a clear warning (nothing partial is used)', async () => {
        const warn = vi.fn();
        const out = await fetchJmsez(towns, { get: async () => { throw new Error('ECONNREFUSED'); }, warn });
        expect(out.map).toBeNull();
        expect(out.meta).toMatchObject({ status: 'not-run' });
        expect(out.meta.reason).toMatch(/nedostupné/);
        expect(warn.mock.calls.join('\n')).toMatch(/PŘESKOČENA/);
    });

    it('a blown time budget means not-run', async () => {
        const out = await fetchJmsez(towns, { get: async () => ({}), warn: () => {}, budgetMs: -1 });
        expect(out.meta).toMatchObject({ status: 'not-run' });
        expect(out.meta.reason).toMatch(/pomalé/);
    });
});

describe('buildDocs: notes', () => {
    it('names unpublished towns with a Pirate list whose band differs in the 2025 table (flag is not used there)', () => {
        const src = source();
        src.kvrzcoco.push(rzc(1008, 'Zeta', 6990, 2));
        src.kvros.push(ros(1008, 1, '720', 720));
        src.kvrk.push(rk(1008, 1, 1, 720));
        src.pop2025 = new Map([[1008, { name: 'Zeta', population: 7010 }]]);
        const res = compute(src, OWNER, { reviewedAt: null, towns: {} });
        const md = buildDocs(res, src, { reviewedAt: null, towns: {} }, res.owner.length)['docs/analysis/mesta-list-verification.md'];
        expect(md).toMatch(/Zeta \(6 990 \/ 7 010\)/);
        expect(md).toMatch(/skupina 4/);
        const spec = buildDocs(res, src, { reviewedAt: null, towns: {} }, res.owner.length)['docs/analysis/mesta-specifics.md'];
        expect(spec).toContain("'1008': { name: 'Zeta', include: true,");
        expect(res.towns.map((t) => t.name)).not.toContain('Zeta');
    });
});

describe('buildDocs: Litovel note and the three tables', () => {
    it('adds a mentioned-by-owner town (Litovel 503444) with the Senate note when the registry has it without a Pirate list', () => {
        const src = source();
        src.kvrzcoco.push(rzc(503444, 'Litovel', 9448, 2));
        src.kvros.push(ros(503444, 1, '053', 53));
        src.senate = { obvody: [{ obvod: 66, nazevObvodu: 'Litovel' }] };
        const res = compute(src, OWNER, { reviewedAt: null, towns: {} });
        const files = buildDocs(res, src, { reviewedAt: null, towns: {} }, res.owner.length);
        const md = files['docs/analysis/mesta-list-verification.md'];
        const line = md.split('\n').find((l) => l.startsWith('|') && l.includes('Litovel'));
        expect(line).toMatch(/Litovel je senátní obvod 66 \(volby 2026\); případná pirátská vazba patří do Senátu, ne do tohoto produktu/);
        expect(line).not.toMatch(/podle majitele/);
        expect(line).toMatch(/typ d/);
        expect(md).toMatch(/potvrzeno: 2/);
        expect(md).toMatch(/zamítnuto z vašeho seznamu: 1\n/); // Gama; Litovel je mimo soubor seznamu
        expect(files['docs/analysis/mesta-extract/lists.csv']).toContain('503444');
    });
});
