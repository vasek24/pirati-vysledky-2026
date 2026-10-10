import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pollOnce, createPrecinctCollector, parseArgs } from './record.mjs';
import { toPragueIso, csuToIso, buildRecord, appendJsonl, readJsonl, countedRows, reducePrecinct } from './lib.mjs';

let dir;
const log = () => {};
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const snap = (over = {}) => ({
    refreshedAt: Date.parse('2026-10-10T13:00:00+02:00'),
    zastup: 500216,
    generated: '2026-10-10T15:05:00',
    phase: 'counting',
    official: false,
    precincts: { total: 43, counted: 2 },
    turnout: { voters: 3000, envelopes: 1200, pct: 40, validVotes: 39000 },
    parties: [{ id: 1, votes: 100, seats: null }, { id: 2, votes: 50, seats: null }],
    okrsky: { 9001: { voters: 1500, envelopes: 600, turnout: 40, validVotes: 19000, votes: { 1: 60, 2: 30 } }, 9002: { voters: 1500, validVotes: 20000, votes: null } },
    ...over,
});
const fakeFetch = (queue) => async (url, init) => {
    fakeFetch.calls.push({ url, init });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
};
fakeFetch.calls = [];
const ok = (body) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });

describe('lib', () => {
    it('toPragueIso gives +02:00 in summer and +01:00 in winter', () => {
        expect(toPragueIso(new Date('2026-10-10T12:31:05Z'))).toBe('2026-10-10T14:31:05+02:00');
        expect(toPragueIso(new Date('2026-12-01T12:31:05Z'))).toBe('2026-12-01T13:31:05+01:00');
    });
    it('csuToIso treats zone-less ČSÚ time as Prague', () => {
        expect(csuToIso('2026-10-10T15:05:00')).toBe('2026-10-10T15:05:00+02:00');
        expect(csuToIso(null)).toBeNull();
    });
    it('buildRecord is compact and keeps per-precinct votes where present', () => {
        const r = buildRecord(snap(), 'praha-9', new Date('2026-10-10T13:06:00Z'));
        expect(r.parties).toEqual({ 1: 100, 2: 50 });
        expect(r.okrsky[9001].votes).toEqual({ 1: 60, 2: 30 });
        expect(r.okrsky[9002].votes).toBeNull();
        expect(r.generated).toBe('2026-10-10T15:05:00+02:00');
        expect(r.fetchedAt).toBe('2026-10-10T15:06:00+02:00');
    });
    it('readJsonl skips a truncated last line and append repairs it', () => {
        const f = path.join(dir, 'x.jsonl');
        fs.writeFileSync(f, '{"a":1}\n{"b":');
        expect(readJsonl(f)).toEqual([{ a: 1 }]);
        appendJsonl(f, { c: 3 });
        expect(readJsonl(f)).toEqual([{ a: 1 }, { c: 3 }]);
    });
    it('countedRows keeps only counted precincts; reducePrecinct reduces votes', () => {
        const rows = countedRows({ okrsky: [[9001, 1500, 600, 40, 0, 0, 0, 0, 19000], [9002, 0, 0, 0]] });
        expect(rows).toEqual([{ okrsek: '9001', voters: 1500, envelopes: 600, validVotes: 19000 }]);
        const rec = reducePrecinct({ generovano: '2026-10-10T15:00:00', prehled: [1500, 600, 40, 0, 0, 0, 0, 19000], vysledky: [[1, 'A', 10000], [2, 'B', 9000]] }, rows[0]);
        expect(rec).toMatchObject({ okrsek: '9001', votes: { 1: 10000, 2: 9000 }, consistent: true, validVotes: 19000 });
        expect(reducePrecinct({ vysledky: [] }, rows[0])).toBeNull();
    });
});

describe('pollOnce', () => {
    it('appends once per new generated, is idempotent and resumes after restart', async () => {
        const state = {};
        const f = fakeFetch([ok(snap()), ok(snap({ refreshedAt: 2 })), ok(snap({ generated: '2026-10-10T15:06:00', refreshedAt: 3 }))]);
        const run = (st) => pollOnce({ slug: 'praha-9', zastup: 500216, fetchImpl: f, outDir: dir, log, state: st });
        expect(await run(state)).toBe('appended');
        expect(await run(state)).toBe('unchanged'); // stejné generated, jiné refreshedAt
        expect(await run(state)).toBe('appended');
        expect(readJsonl(path.join(dir, 'live', 'praha-9.jsonl'))).toHaveLength(2);
        // restart: nový stav načte klíče ze souboru
        const f2 = fakeFetch([ok(snap({ generated: '2026-10-10T15:06:00' }))]);
        expect(await pollOnce({ slug: 'praha-9', zastup: 500216, fetchImpl: f2, outDir: dir, log, state: {} })).toBe('unchanged');
        expect(readJsonl(path.join(dir, 'live', 'praha-9.jsonl'))).toHaveLength(2);
    });
    it('sends the identifying User-Agent and survives 5xx, timeouts and bad JSON', async () => {
        fakeFetch.calls.length = 0;
        const f = fakeFetch([{ ok: false, status: 503 }, new Error('timeout'), { ok: true, status: 200, json: async () => { throw new Error('bad'); } }]);
        for (let i = 0; i < 3; i++) {
            expect(await pollOnce({ slug: 'magistrat', zastup: 554782, fetchImpl: f, outDir: dir, log, state: {} })).toBe('error');
        }
        expect(fakeFetch.calls[0].init.headers['User-Agent']).toBe('pirati-analysis/1.0 (+420 777 954 389)');
        expect(fakeFetch.calls[0].url).toBe('https://praha.dg12.cz/api/volby?z=554782');
        expect(fs.existsSync(path.join(dir, 'live', 'magistrat.jsonl'))).toBe(false);
    });
});

describe('createPrecinctCollector (opt-in)', () => {
    const csu = (turnoutRows, files) => async (url) => {
        csu.urls.push(url);
        if (url.includes('/ucast/obec/1100/554782.json')) return { ok: true, status: 200, json: async () => ({ okrsky: turnoutRows }), headers: { get: () => '"e1"' } };
        const id = /554782_(\d+)\.json/.exec(url)[1];
        if (!files[id]) return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
        return { ok: true, status: 200, json: async () => files[id], headers: { get: () => null } };
    };
    csu.urls = [];
    const file = (v1, v2) => ({ generovano: '2026-10-10T15:00:00', prehled: [100, 50, 50, 0, 0, 0, 0, v1 + v2], vysledky: [[1, 'A', v1], [2, 'B', v2]] });

    it('fetches each counted precinct once, with the right UA and spacing', async () => {
        csu.urls.length = 0;
        const rows = [[1001, 100, 50, 50, 0, 0, 0, 0, 30], [1002, 100, 50, 50, 0, 0, 0, 0, 30], [1003, 0]];
        const stamps = [];
        const inner = csu(rows, { 1001: file(10, 20), 1002: file(15, 15) });
        const fetchImpl = async (url, init) => {
            stamps.push(Date.now());
            expect(init.headers['User-Agent']).toBe('pirati-analysis/1.0 (+420 777 954 389)');
            return inner(url, init);
        };
        const c = createPrecinctCollector({ fetchImpl, outDir: dir, log, gapMs: 40 });
        expect(await c.runPass()).toBe(2);
        expect(await c.runPass()).toBe(0); // už staženo
        const out = readJsonl(path.join(dir, 'live', 'magistrat-precincts.jsonl'));
        expect(out.map((r) => r.okrsek).sort()).toEqual(['1001', '1002']);
        expect(out[0].votes).toBeTruthy();
        expect(csu.urls.filter((u) => u.includes('okrsek/1100/554782_1001'))).toHaveLength(1);
        for (let i = 1; i < stamps.length; i++) expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(35);
        // restart nestahuje znovu
        const c2 = createPrecinctCollector({ fetchImpl, outDir: dir, log, gapMs: 1 });
        expect(await c2.runPass()).toBe(0);
    });
    it('retries a missing or inconsistent file on a later pass', async () => {
        const rows = [[1001, 100, 50, 50, 0, 0, 0, 0, 999]];
        const files = {};
        const c = createPrecinctCollector({ fetchImpl: csu(rows, files), outDir: dir, log, gapMs: 1 });
        await c.runPass();
        expect(c.done.size).toBe(0); // 404
        files[1001] = file(10, 20); // součet 30 ≠ 999 -> zatím neukládat
        await c.runPass();
        expect(c.done.size).toBe(0);
    });
});

describe('parseArgs', () => {
    it('enforces a 60 s minimum interval and defaults magistrat-precincts off', () => {
        expect(parseArgs([]).magPrecincts).toBe(false);
        expect(parseArgs(['--interval', '5']).intervalMs).toBe(60000);
        expect(parseArgs(['--magistrat-precincts', '--once'])).toMatchObject({ magPrecincts: true, once: true });
        expect(() => parseArgs(['--nope'])).toThrow();
    });
});
