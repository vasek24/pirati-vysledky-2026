import { describe, it, expect, vi } from 'vitest';
import { compute, execute, pirates2022 } from './mesta-registry.js';

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

describe('execute: exit codes', () => {
    it('0 and writes all three files for a clean run', () => {
        const { code, io } = run(source());
        expect(code).toBe(0);
        expect(io.write).toHaveBeenCalledTimes(1);
        expect(Object.keys(io.write.mock.calls[0][0])).toEqual(['towns', 'specifics', 'excluded']);
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
