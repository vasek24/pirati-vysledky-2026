import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLLS_CLOSE } from '../src/councils.js';
import { phaseOf } from '../src/volby/feed.js';
import { parseCsuTime } from '../src/volby/format.js';
import { composeOverview } from '../src/volby/overview.js';
import { REFRESH, computeNextRefreshAt, createRefresher } from './refresh.js';

// Čas v testech: vitest fake timers (mockují i Date), `now` = Date.now.
// Testy běží s TZ=UTC jako Worker (npm test) — zone-less `generated` se
// proto musí číst přes parseCsuTime (+02:00), ne přes bare Date.parse.
const at = (iso) => Date.parse(iso);
const T0 = at('2026-10-10T15:00:00+02:00'); // po 14:00, sčítá se
const S = 1000;
const MIN = 60 * S;

// ČSÚ čas bez zóny (místní pražský, +02:00) z epoch ms
const csu = (ms) => new Date(ms + 2 * 3600 * S).toISOString().slice(0, 19);

const phaseOfSnap = (s, now) => (s ? phaseOf({ counted: s.precincts.counted, official: !!s.official }, now) : 'pre');

// ---- fixtures ---------------------------------------------------------------

const row = (voters = 1000, votes = [10, 20]) => ({
    voters, envelopes: 600, turnout: 60, validVotes: 590, votes,
});

function council({
    counted = 10, total = 100, generated = csu(T0), fetchId = 'f1', okrsky = null,
    parties = [{ id: 1, votes: 100 }, { id: 2, votes: 50 }], official = false, extra = {},
} = {}) {
    return {
        v: 1,
        zastup: 500097,
        fetchedAt: new Date(T0).toISOString(),
        generated,
        phase: 'counting',
        official,
        precincts: { total, counted, pct: (counted / total) * 100 },
        parties,
        okrsky: okrsky ?? { 1: row(), 2: row(2000) },
        fetchId,
        ...extra,
    };
}

function memStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        get: vi.fn(async (k) => data.get(k)),
        put: vi.fn(async (obj) => {
            for (const [k, v] of Object.entries(obj)) data.set(k, v);
        }),
    };
}

// build vrací postupně zadané kandidáty; funkce se volá při každém buildu
function setup({ build, random = () => 0.5, firstClass = true, kind = 'council', base = 'https://csu.test', storage, pollsClose, time = T0 } = {}) {
    vi.setSystemTime(time);
    const st = storage ?? memStorage();
    const feed = { build: vi.fn(build ?? (async () => council())), invalidate: vi.fn() };
    const log = vi.fn();
    const waitUntil = vi.fn();
    const r = createRefresher({
        now: () => Date.now(),
        random: (...a) => random(...a),
        storage: st,
        feed,
        kind,
        phaseOf: phaseOfSnap,
        firstClass,
        base,
        log,
        waitUntil,
        ...(pollsClose === undefined ? {} : { pollsClose }),
    });
    return { r, st, feed, log, waitUntil };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const advance = (ms) => vi.advanceTimersByTimeAsync(ms);
const parse = (res) => JSON.parse(res.body);
// jedno "kolo": get() spustí obnovu (je-li splatná), nechá ji doběhnout
async function poll(r) {
    const res = await r.get();
    await settle();
    await settle();
    return res;
}
const events = (log, name) => log.mock.calls.filter(([e]) => e === name);

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

// ---- computeNextRefreshAt ----------------------------------------------------

describe('computeNextRefreshAt', () => {
    const base = { failures: 0, random: () => 0.5 };

    it('counting: zone-less generated is read as Prague time even under TZ=UTC (C1)', () => {
        const refreshedAt = at('2026-10-10T14:31:20+02:00');
        const generatedMs = parseCsuTime('2026-10-10T14:31:05').getTime();
        expect(computeNextRefreshAt({ ...base, phase: 'counting', refreshedAt, generatedMs, now: refreshedAt }))
            .toBe(at('2026-10-10T14:32:05+02:00'));
    });

    it('C1 end to end: zone-less generated from the feed gives nextRefreshAt = G+60 s (not 10 min)', async () => {
        const refreshedAt = at('2026-10-10T14:31:20+02:00');
        const { r, st } = setup({ time: refreshedAt, build: async () => council({ generated: '2026-10-10T14:31:05' }) });
        const res = await r.get();
        expect(parse(res).nextRefreshAt).toBe(at('2026-10-10T14:32:05+02:00'));
        expect(st.put.mock.calls[0][0].meta.generatedMs).toBe(at('2026-10-10T14:31:05+02:00'));
    });

    it('counting: clamps G+60 s to [refreshedAt+20 s, refreshedAt+60 s]', () => {
        const refreshedAt = T0;
        // G dávno v minulosti → spodní mez
        expect(computeNextRefreshAt({ ...base, phase: 'counting', refreshedAt, generatedMs: refreshedAt - 10 * MIN, now: refreshedAt }))
            .toBe(refreshedAt + 20 * S);
        // G čerstvě → horní mez 60 s
        expect(computeNextRefreshAt({ ...base, phase: 'counting', refreshedAt, generatedMs: refreshedAt + 30 * S, now: refreshedAt }))
            .toBe(refreshedAt + 60 * S);
    });

    it('counting: generated hours in the future or null → refreshedAt+20 s', () => {
        const refreshedAt = T0;
        expect(computeNextRefreshAt({ ...base, phase: 'counting', refreshedAt, generatedMs: refreshedAt + 2 * 3600 * S, now: refreshedAt }))
            .toBe(refreshedAt + 20 * S);
        expect(computeNextRefreshAt({ ...base, phase: 'counting', refreshedAt, generatedMs: refreshedAt + 121 * S, now: refreshedAt }))
            .toBe(refreshedAt + 20 * S);
        expect(computeNextRefreshAt({ ...base, phase: 'counting', refreshedAt, generatedMs: null, now: refreshedAt }))
            .toBe(refreshedAt + 20 * S);
    });

    it('waiting +60 s, final +10 min, pre capped at 14:00 CEST', () => {
        expect(computeNextRefreshAt({ ...base, phase: 'waiting', refreshedAt: T0, generatedMs: null, now: T0 })).toBe(T0 + 60 * S);
        expect(computeNextRefreshAt({ ...base, phase: 'final', refreshedAt: T0, generatedMs: null, now: T0 })).toBe(T0 + 10 * MIN);
        const t1358 = at('2026-10-10T13:58:00+02:00');
        expect(computeNextRefreshAt({ ...base, phase: 'pre', refreshedAt: t1358, generatedMs: null, now: t1358 }))
            .toBe(at('2026-10-10T14:00:00+02:00'));
        const t1000 = at('2026-10-10T10:00:00+02:00');
        expect(computeNextRefreshAt({ ...base, phase: 'pre', refreshedAt: t1000, generatedMs: null, now: t1000 }))
            .toBe(t1000 + 5 * MIN);
    });

    it('failures → now + retry(n): 20 s, 20–40 s, 20–60 s (random 1 and 0)', () => {
        const f = (failures, random) => computeNextRefreshAt({ phase: 'counting', refreshedAt: T0, generatedMs: null, now: T0, failures, random: () => random }) - T0;
        expect([1, 2, 3, 4, 9].map((n) => f(n, 1))).toEqual([20 * S, 40 * S, 60 * S, 60 * S, 60 * S]);
        expect([1, 2, 3, 4].map((n) => f(n, 0))).toEqual([20 * S, 20 * S, 20 * S, 20 * S]);
    });

    it('exports the constants', () => {
        expect(REFRESH).toMatchObject({ FLOOR_MS: 20_000, DEADLINE_MS: 12_000, MAX_BYTES: 1_500_000, FINAL_MS: 600_000, POLLS_CLOSE });
    });
});

// ---- 1, 3: cold / due / not due ----------------------------------------------

describe('request path', () => {
    it('cold: get() awaits one build and persists {snapshot, meta} in one put', async () => {
        const { r, st, feed, waitUntil } = setup();
        const res = await r.get();
        expect(res.status).toBe(200);
        expect(feed.build).toHaveBeenCalledTimes(1);
        expect(st.put).toHaveBeenCalledTimes(1);
        const [obj] = st.put.mock.calls[0];
        expect(Object.keys(obj).sort()).toEqual(['meta', 'snapshot']);
        expect(typeof obj.snapshot).toBe('string');
        expect(obj.meta).toMatchObject({
            refreshedAt: T0, failures: 0, quarantine: null, base: 'https://csu.test', schema: 1,
            generatedMs: at('2026-10-10T15:00:00+02:00'),
        });
        expect(obj.meta.nextRefreshAt).toBe(T0 + 60 * S); // G+60 s v rozmezí [20,60] s
        const body = parse(res);
        expect(body).toMatchObject({ refreshedAt: T0, nextRefreshAt: T0 + 60 * S, servedAt: T0, stale: false, complete: true, refreshing: false, zastup: 500097 });
        expect(res.meta).toMatchObject({ refreshedAt: T0, stale: false, complete: true, refreshing: false });
        expect(waitUntil).toHaveBeenCalledTimes(1);
    });

    it('body is the persisted string with meta spliced in front (no re-serialization)', async () => {
        const { r, st } = setup();
        const res = await r.get();
        const persisted = st.put.mock.calls[0][0].snapshot;
        expect(res.body.endsWith(persisted.slice(1))).toBe(true);
        expect(res.body.startsWith('{"refreshedAt":')).toBe(true);
    });

    it('cold with failing build → 503 {"error":"unavailable"}, then backoff without new build', async () => {
        const { r, feed } = setup({ build: async () => { throw new Error('boom'); }, random: () => 1 });
        const res = await r.get();
        expect(res.status).toBe(503);
        expect(res.body).toBe('{"error":"unavailable"}');
        expect((await r.get()).status).toBe(503);
        expect(feed.build).toHaveBeenCalledTimes(1); // v okně zpětného odstupu se neopakuje
        await advance(20 * S);
        await r.get();
        expect(feed.build).toHaveBeenCalledTimes(2);
    });

    it('not due → no build; due → old snapshot at once, new one on the next get()', async () => {
        let n = 0;
        const { r, feed } = setup({
            build: async () => council({ counted: 10 + 5 * n++, generated: csu(Date.now()), fetchId: `f${n}` }),
        });
        await r.get();
        expect(feed.build).toHaveBeenCalledTimes(1);
        await advance(30 * S);
        const mid = parse(await r.get());
        expect(feed.build).toHaveBeenCalledTimes(1);
        expect(mid.precincts.counted).toBe(10);
        await advance(31 * S); // > nextRefreshAt
        const due = parse(await r.get());
        expect(due.precincts.counted).toBe(10); // staré hned
        expect(due.refreshing).toBe(true);
        expect(feed.build).toHaveBeenCalledTimes(2);
        await settle();
        const next = parse(await r.get());
        expect(next.precincts.counted).toBe(15);
        expect(next.refreshing).toBe(false);
    });

    it('2 000 concurrent get() when due → exactly one build, all get the old snapshot at once', async () => {
        let release;
        let calls = 0;
        const { r, feed } = setup({
            build: () => {
                calls++;
                if (calls === 1) return Promise.resolve(council());
                return new Promise((resolve) => { release = () => resolve(council({ counted: 20, generated: csu(Date.now()), fetchId: 'f2' })); });
            },
        });
        await r.get();
        await advance(61 * S);
        const all = await Promise.all(Array.from({ length: 2000 }, () => r.get()));
        expect(feed.build).toHaveBeenCalledTimes(2);
        expect(all.every((x) => x.status === 200 && JSON.parse(x.body).precincts.counted === 10)).toBe(true);
        release();
        await settle();
        expect(parse(await r.get()).precincts.counted).toBe(20);
    });

    it('2 000 concurrent cold get() → one build, all served', async () => {
        const { r, feed } = setup();
        const all = await Promise.all(Array.from({ length: 2000 }, () => r.get()));
        expect(feed.build).toHaveBeenCalledTimes(1);
        expect(all.every((x) => x.status === 200)).toBe(true);
    });
});

// ---- 5: failures ---------------------------------------------------------------

describe('failures', () => {
    // seed + build, který od druhého volání dělá `fail`
    function failing(fail, opts = {}) {
        let n = 0;
        return setup({
            build: async (...a) => (n++ === 0 ? council() : fail(...a)),
            ...opts,
        });
    }
    const dueAndRun = async (r, ms) => { await advance(ms); await poll(r); };

    it('build throws: snapshot unchanged, stale:true, retry 20 / 40 / 60 s with random()=1', async () => {
        const { r, feed } = failing(async () => { throw new Error('boom'); }, { random: () => 1 });
        await r.get();
        const first = parse(await r.get()).refreshedAt;
        await dueAndRun(r, 61 * S);
        let t = Date.now();
        let b = parse(await r.get());
        expect(b).toMatchObject({ stale: true, refreshedAt: first, nextRefreshAt: t + 20 * S });
        expect(b.precincts.counted).toBe(10);
        await dueAndRun(r, 20 * S);
        t = Date.now();
        b = parse(await r.get());
        expect(b.nextRefreshAt).toBe(t + 40 * S);
        await dueAndRun(r, 40 * S);
        t = Date.now();
        b = parse(await r.get());
        expect(b.nextRefreshAt).toBe(t + 60 * S);
        expect(feed.invalidate).not.toHaveBeenCalled(); // jen při rejected
    });

    it('random()=0 → always 20 s', async () => {
        const { r } = failing(async () => { throw new Error('boom'); }, { random: () => 0 });
        await r.get();
        await dueAndRun(r, 61 * S);
        for (let i = 0; i < 3; i++) {
            expect(parse(await r.get()).nextRefreshAt).toBe(Date.now() + 20 * S);
            await dueAndRun(r, 20 * S);
        }
    });

    it('12 s deadline: build that never settles → stale, and the next refresh is not blocked', async () => {
        let n = 0;
        const { r, feed } = setup({ build: () => (n++ === 0 ? Promise.resolve(council()) : new Promise(() => {})), random: () => 0 });
        await r.get();
        await advance(61 * S);
        await r.get();
        expect(parse(await r.get()).refreshing).toBe(true);
        await advance(11 * S);
        expect(parse(await r.get()).stale).toBe(false);
        await advance(1 * S + 1);
        const b = parse(await r.get());
        expect(b).toMatchObject({ stale: true, refreshing: false });
        await advance(20 * S);
        await r.get();
        expect(feed.build).toHaveBeenCalledTimes(3);
    });

    it('rejected candidate → good kept, stale, backoff, feed.invalidate()', async () => {
        const { r, feed, log } = failing(async () => council({ counted: 5, generated: csu(Date.now()), fetchId: 'f2' }), { random: () => 1 });
        await r.get();
        await dueAndRun(r, 61 * S);
        const b = parse(await r.get());
        expect(b).toMatchObject({ stale: true, nextRefreshAt: Date.now() + 20 * S });
        expect(b.precincts.counted).toBe(10);
        expect(feed.invalidate).toHaveBeenCalledTimes(1);
        expect(events(log, 'rejected')[0][1]).toMatchObject({ reason: 'counted-decreased' });
    });

    it('recovery: success resets failures and stale', async () => {
        let n = 0;
        const { r } = setup({
            build: async () => {
                n++;
                if (n === 2) throw new Error('boom');
                return council({ counted: 10 + n, generated: csu(Date.now()), fetchId: `f${n}` });
            },
            random: () => 0,
        });
        await r.get();
        await dueAndRun(r, 61 * S);
        expect(parse(await r.get()).stale).toBe(true);
        await dueAndRun(r, 20 * S);
        const b = parse(await r.get());
        expect(b.stale).toBe(false);
        expect(b.precincts.counted).toBe(13);
    });

    it('unexpected exception in merge/validate counts as a failure (never throws out of get)', async () => {
        const { r } = failing(async () => ({ generated: csu(Date.now()), precincts: null, parties: [{ id: 1, votes: 1 }] }));
        await r.get();
        await dueAndRun(r, 61 * S);
        expect(parse(await r.get())).toMatchObject({ stale: true });
    });
});

// ---- 6: merge ------------------------------------------------------------------

describe('merge (C3)', () => {
    const later = (extra) => ({ generated: csu(Date.now()), ...extra });

    it('newly counted precinct with votes:null replaces the snapshot, not stale; lost votes filled from good', async () => {
        let n = 0;
        const { r } = setup({
            build: async () => (n++ === 0
                ? council({ counted: 2 })
                : council(later({
                    counted: 3,
                    fetchId: 'f2',
                    okrsky: { 1: { ...row(), votes: null }, 2: row(2000), 3: { ...row(1500), votes: null } },
                }))),
        });
        await r.get();
        await advance(61 * S);
        await poll(r);
        const b = parse(await r.get());
        expect(b.stale).toBe(false);
        expect(b.complete).toBe(true);
        expect(b.precincts.counted).toBe(3);
        expect(b.okrsky[1].votes).toEqual([10, 20]); // doplněno z good
        expect(b.okrsky[3].votes).toBeNull(); // nově sečtený, ještě bez hlasů
    });

    it('cold DO installs a partial build', async () => {
        const partial = council({ okrsky: { 1: { ...row(), votes: null }, 2: { ...row(2000), votes: null } } });
        const { r } = setup({ build: async () => partial });
        const res = await r.get();
        expect(res.status).toBe(200);
        expect(parse(res).okrsky[1].votes).toBeNull();
    });

    // okrsek 1 změněný řádek (jiný počet voličů) a bez hlasů → doplnit nelze
    const incompleteCandidate = (extra = {}) => council({
        generated: csu(Date.now()),
        counted: 12,
        okrsky: { 1: { ...row(1111), votes: null }, 2: row(2000) },
        ...extra,
    });

    it('complete:false is not installed, not stale, retried at the 20 s floor', async () => {
        let n = 0;
        const { r, feed } = setup({ build: async () => (n++ === 0 ? council() : incompleteCandidate({ fetchId: `x${n}` })) });
        const first = parse(await r.get());
        await advance(61 * S);
        await poll(r);
        const b = parse(await r.get());
        expect(b).toMatchObject({ stale: false, refreshedAt: first.refreshedAt, nextRefreshAt: Date.now() + 20 * S });
        expect(b.precincts.counted).toBe(10);
        expect(feed.invalidate).not.toHaveBeenCalled();
        // znovu přesně po 20 s
        await advance(19 * S);
        await r.get();
        expect(feed.build).toHaveBeenCalledTimes(2);
        await advance(1 * S);
        await poll(r);
        expect(feed.build).toHaveBeenCalledTimes(3);
    });

    it('complete:false never counts toward quarantine (still not installed after many distinct fetches over 5 min)', async () => {
        let n = 0;
        const { r, log } = setup({ build: async () => (n++ === 0 ? council() : incompleteCandidate({ fetchId: `x${n}` })) });
        await r.get();
        await advance(61 * S);
        for (let i = 0; i < 16; i++) {
            await poll(r);
            await advance(20 * S);
        }
        const b = parse(await r.get());
        expect(b.precincts.counted).toBe(10);
        expect(events(log, 'quarantine-accepted')).toHaveLength(0);
    });

    it('complete:false persisting 5 minutes logs an error incomplete-persistent', async () => {
        let n = 0;
        const { r, log } = setup({ build: async () => (n++ === 0 ? council() : incompleteCandidate({ fetchId: `x${n}` })) });
        await r.get();
        await advance(61 * S);
        for (let i = 0; i < 12; i++) { // 4 min
            await poll(r);
            await advance(20 * S);
        }
        expect(events(log, 'incomplete-persistent')).toHaveLength(0);
        for (let i = 0; i < 6; i++) {
            await poll(r);
            await advance(20 * S);
        }
        const hits = events(log, 'incomplete-persistent');
        expect(hits.length).toBeGreaterThanOrEqual(1);
        expect(hits[0][1]).toMatchObject({ level: 'error' });
    });

    it('overview: council missing from the candidate is copied from good', async () => {
        const summary = (z, counted, votes, generated) => ({
            z, generated, phase: 'counting', counted, total: 10, official: false, seats: 5, votes: 100,
            turnout: 50, parties: [[1, votes, 2], [2, 10, 1]], pirates: null,
        });
        const g = csu(T0);
        const goodSummaries = { 500097: summary(500097, 3, 50, g), 500054: summary(500054, 2, 40, g) };
        const good = composeOverview(goodSummaries, { now: T0, expected: 2 });
        let n = 0;
        const { r } = setup({
            kind: 'overview',
            build: async () => {
                if (n++ === 0) return { ...good, fetchId: 'f1' };
                const next = { 500097: summary(500097, 4, 60, csu(Date.now())) };
                return { ...composeOverview(next, { now: Date.now(), expected: 2 }), fetchId: 'f2' };
            },
        });
        await r.get();
        await advance(61 * S);
        await poll(r);
        const b = parse(await r.get());
        expect(b.stale).toBe(false);
        expect(Object.keys(b.councils).sort()).toEqual(['500054', '500097']);
        expect(b.councils[500097].counted).toBe(4);
        expect(b.councils[500054].counted).toBe(2);
        expect(b.precincts.counted).toBe(6);
    });

    it('overview: all councils copied and identical to good → info log overview-all-lagging', async () => {
        const summary = (z, counted) => ({
            z, generated: csu(T0), phase: 'counting', counted, total: 10, official: false, seats: 5, votes: 100,
            turnout: 50, parties: [[1, 50, 2], [2, 10, 1]], pirates: null,
        });
        const good = composeOverview({ 500097: summary(500097, 3), 500054: summary(500054, 2) }, { now: T0, expected: 2 });
        let n = 0;
        const { r, log } = setup({
            kind: 'overview',
            build: async () => (n++ === 0 ? { ...good, fetchId: 'f1' } : { ...good, councils: {}, fetchedAt: new Date().toISOString(), fetchId: 'f2' }),
        });
        await r.get();
        await advance(61 * S);
        await poll(r);
        expect(events(log, 'overview-all-lagging')).toHaveLength(1);
        expect(events(log, 'overview-all-lagging')[0][1]).toMatchObject({ level: 'info' });
        expect(parse(await r.get()).stale).toBe(false);
    });
});

// ---- 7: baseline / older / regression -----------------------------------------

describe('baseline, older replica, regression (C4)', () => {
    it('pre-14:00 baseline then post-14:00 counted=0 is accepted', async () => {
        const t1330 = at('2026-10-10T13:30:00+02:00');
        let n = 0;
        const { r, feed } = setup({
            time: t1330,
            build: async () => {
                n++;
                return n === 1
                    ? council({ counted: 50, generated: csu(t1330), fetchId: 'a' })
                    : council({ counted: 0, generated: csu(Date.now()), fetchId: 'b', parties: [{ id: 1, votes: 0 }, { id: 2, votes: 0 }] });
            },
        });
        await r.get(); // testovací data před 14:00
        await advance(20 * MIN); // 13:50, ještě pre
        await advance(11 * MIN); // po 14:00
        expect(Date.now()).toBeGreaterThan(POLLS_CLOSE);
        await poll(r);
        const b = parse(await r.get());
        expect(b.precincts.counted).toBe(0);
        expect(b.stale).toBe(false);
        expect(feed.invalidate).not.toHaveBeenCalled();
    });

    it('older replica: good kept, stale:false, no backoff, no invalidate; never installed after 5 repeats', async () => {
        let n = 0;
        const { r, feed, log } = setup({
            build: async () => (n++ === 0
                ? council({ counted: 20, generated: csu(T0 + 10 * S), fetchId: 'a' })
                : council({ counted: 15, generated: csu(T0 + 5 * S), fetchId: `old${n}`, okrsky: { 1: row() } })),
            random: () => 1,
        });
        await r.get();
        await advance(61 * S);
        for (let i = 0; i < 6; i++) {
            await poll(r);
            const b = parse(await r.get());
            expect(b).toMatchObject({ stale: false, refreshedAt: T0, nextRefreshAt: Date.now() + 20 * S });
            expect(b.precincts.counted).toBe(20);
            await advance(20 * S);
        }
        expect(feed.build.mock.calls.length).toBeGreaterThanOrEqual(6);
        expect(feed.invalidate).not.toHaveBeenCalled();
        expect(events(log, 'older').length).toBeGreaterThanOrEqual(5);
        expect(events(log, 'older')[0][1]).toMatchObject({ level: 'info' });
        expect(events(log, 'quarantine-accepted')).toHaveLength(0);
    });

    it('older persisting 10 minutes logs error older-persistent', async () => {
        let n = 0;
        const { r, log } = setup({
            build: async () => (n++ === 0
                ? council({ generated: csu(T0 + 10 * S), fetchId: 'a' })
                : council({ generated: csu(T0 + 5 * S), fetchId: `old${n}` })),
        });
        await r.get();
        await advance(61 * S);
        for (let i = 0; i < 28; i++) { // 9 min 20 s
            await poll(r);
            await advance(20 * S);
        }
        expect(events(log, 'older-persistent')).toHaveLength(0);
        for (let i = 0; i < 6; i++) {
            await poll(r);
            await advance(20 * S);
        }
        const hit = events(log, 'older-persistent');
        expect(hit.length).toBeGreaterThanOrEqual(1);
        expect(hit[0][1]).toMatchObject({ level: 'error' });
    });

    // counted 50 → 40 s postupujícím `generated`
    const regression = (idOf) => {
        let n = 0;
        return async () => {
            n++;
            if (n === 1) return council({ counted: 50, generated: csu(T0), fetchId: 'a' });
            return council({ counted: 40, generated: csu(Date.now()), fetchId: idOf(n) });
        };
    };

    it('counted regression on 3 distinct fetchIds spanning >= 2 min → quarantine-accepted', async () => {
        const { r, log, feed } = setup({ build: regression((n) => `r${n}`), random: () => 0 });
        await r.get();
        await advance(61 * S);
        const accepted = [];
        for (let i = 0; i < 12 && !accepted.length; i++) {
            await poll(r);
            if (events(log, 'quarantine-accepted').length) accepted.push(Date.now());
            await advance(20 * S);
        }
        expect(accepted).toHaveLength(1);
        // až po >= 3 různých fetchích a >= 2 minutách od prvního odmítnutí
        const rejected = events(log, 'rejected');
        expect(rejected.length).toBeGreaterThanOrEqual(2);
        const b = parse(await r.get());
        expect(b.precincts.counted).toBe(40);
        expect(b.stale).toBe(false);
        expect(feed.invalidate.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('quarantine needs >= 2 min even with 3+ distinct fetches', async () => {
        const { r, log } = setup({ build: regression((n) => `r${n}`), random: () => 0 });
        await r.get();
        await advance(61 * S);
        for (let i = 0; i < 5; i++) { // 5 pokusů po 20 s: 0, 20, 40, 60, 80 s
            await poll(r);
            await advance(20 * S);
        }
        expect(events(log, 'quarantine-accepted')).toHaveLength(0);
        expect(parse(await r.get()).precincts.counted).toBe(50);
    });

    it('replays of the same fetchId do not count', async () => {
        const { r, log } = setup({ build: regression(() => 'same'), random: () => 0 });
        await r.get();
        await advance(61 * S);
        for (let i = 0; i < 20; i++) { // > 6 min
            await poll(r);
            await advance(20 * S);
        }
        expect(events(log, 'quarantine-accepted')).toHaveLength(0);
        const b = parse(await r.get());
        expect(b).toMatchObject({ stale: true });
        expect(b.precincts.counted).toBe(50);
    });

    it('different reason restarts the quarantine count', async () => {
        let n = 0;
        const { r, log } = setup({
            random: () => 0,
            build: async () => {
                n++;
                if (n === 1) return council({ counted: 50, generated: csu(T0), fetchId: 'a' });
                // střídá důvody: counted-decreased / votes-decreased
                return n % 2
                    ? council({ counted: 40, generated: csu(Date.now()), fetchId: `r${n}` })
                    : council({ counted: 50, generated: csu(Date.now()), fetchId: `r${n}`, parties: [{ id: 1, votes: 1 }, { id: 2, votes: 50 }] });
            },
        });
        await r.get();
        await advance(61 * S);
        for (let i = 0; i < 14; i++) {
            await poll(r);
            await advance(20 * S);
        }
        expect(events(log, 'quarantine-accepted')).toHaveLength(0);
    });

    it('absolute structural rejects (empty parties) are never quarantine-accepted', async () => {
        let n = 0;
        const { r, log } = setup({
            random: () => 0,
            build: async () => (n++ === 0 ? council() : council({ generated: csu(Date.now()), parties: [], fetchId: `e${n}` })),
        });
        await r.get();
        await advance(61 * S);
        for (let i = 0; i < 20; i++) {
            await poll(r);
            await advance(20 * S);
        }
        expect(events(log, 'quarantine-accepted')).toHaveLength(0);
        expect(parse(await r.get()).parties).toHaveLength(2);
    });

    it('a good fetch resets quarantine; then persisted meta has quarantine:null', async () => {
        let n = 0;
        const { r, st } = setup({
            random: () => 0,
            build: async () => {
                n++;
                if (n === 1) return council({ counted: 50, generated: csu(T0), fetchId: 'a' });
                if (n === 2) return council({ counted: 40, generated: csu(Date.now()), fetchId: 'b' });
                return council({ counted: 55, generated: csu(Date.now()), fetchId: `c${n}` });
            },
        });
        await r.get();
        await advance(61 * S);
        await poll(r); // rejected
        await advance(20 * S);
        await poll(r); // ok
        expect(parse(await r.get())).toMatchObject({ stale: false });
        expect(st.put.mock.calls.at(-1)[0].meta).toMatchObject({ quarantine: null, failures: 0 });
    });
});

// ---- 8: rehydrate -------------------------------------------------------------

describe('rehydrate', () => {
    it('new instance over the same storage serves the snapshot without a build when not due', async () => {
        const a = setup();
        await a.r.get();
        await advance(10 * S);
        const b = setup({ storage: a.st, time: Date.now() });
        const res = await b.r.get();
        expect(res.status).toBe(200);
        expect(b.feed.build).not.toHaveBeenCalled();
        expect(parse(res)).toMatchObject({ refreshedAt: T0, nextRefreshAt: T0 + 60 * S, stale: false, refreshing: false, zastup: 500097 });
    });

    it('rehydrated snapshot that is due refreshes in the background', async () => {
        const a = setup();
        await a.r.get();
        await advance(2 * MIN);
        const b = setup({ storage: a.st, time: Date.now() });
        const res = await b.r.get();
        expect(parse(res).refreshedAt).toBe(T0);
        expect(b.feed.build).toHaveBeenCalledTimes(1);
    });

    it('discards a stored snapshot whose meta.base differs', async () => {
        const a = setup({ base: 'https://csu.test' });
        await a.r.get();
        const b = setup({ storage: a.st, base: 'https://other.test' });
        await b.r.get();
        expect(b.feed.build).toHaveBeenCalledTimes(1);
        expect(b.st.put.mock.calls.at(-1)[0].meta.base).toBe('https://other.test');
    });

    it('discards a stored snapshot whose meta.schema differs', async () => {
        const a = setup();
        await a.r.get();
        a.st.data.set('meta', { ...a.st.data.get('meta'), schema: 2 });
        const b = setup({ storage: a.st });
        await b.r.get();
        expect(b.feed.build).toHaveBeenCalledTimes(1);
    });

    it('discards corrupt storage', async () => {
        const st = memStorage({ snapshot: '{not json', meta: { refreshedAt: T0, nextRefreshAt: T0 + 60 * S, base: 'https://csu.test', schema: 1 } });
        const { r, feed } = setup({ storage: st });
        expect((await r.get()).status).toBe(200);
        expect(feed.build).toHaveBeenCalledTimes(1);
    });

    it('post-14:00 base switch: good from another base is ignored (counted reset accepted)', async () => {
        const a = setup({ base: 'https://test-data.test', build: async () => council({ counted: 80 }) });
        await a.r.get();
        const b = setup({
            storage: a.st,
            base: 'https://csu.test',
            build: async () => council({ counted: 0, generated: csu(Date.now()), parties: [{ id: 1, votes: 0 }, { id: 2, votes: 0 }] }),
        });
        expect(parse(await b.r.get()).precincts.counted).toBe(0);
    });

    it('two concurrent get() on a fresh instance → one storage read pair (L15), no build', async () => {
        const a = setup();
        await a.r.get();
        const b = setup({ storage: a.st, time: T0 + 5 * S });
        b.st.get.mockClear();
        const [x, y] = await Promise.all([b.r.get(), b.r.get()]);
        expect(x.status).toBe(200);
        expect(y.status).toBe(200);
        expect(b.st.get.mock.calls.map(([k]) => k).sort()).toEqual(['meta', 'snapshot']);
        expect(b.feed.build).not.toHaveBeenCalled();
    });
});

// ---- 9: size guard ------------------------------------------------------------

describe('size guard', () => {
    it('> 1.5 MB UTF-8 bytes (multi-byte text) → no put, memory only, one log', async () => {
        // 800 000 znaků "ě" = 800 000 .length, ale 1 600 000 bajtů v UTF-8
        const big = 'ě'.repeat(800_000);
        let n = 0;
        const { r, st, log } = setup({
            build: async () => council({ counted: 10 + n++, generated: csu(Date.now()), fetchId: `f${n}`, extra: { note: big } }),
        });
        const res = await r.get();
        expect(res.status).toBe(200);
        expect(JSON.stringify(parse(res)).length).toBeLessThan(1_500_000);
        expect(st.put).not.toHaveBeenCalled();
        expect(events(log, 'size-guard')).toHaveLength(1);
        await advance(61 * S);
        await poll(r);
        expect(parse(await r.get()).precincts.counted).toBe(11); // paměť se obnovuje
        expect(st.put).not.toHaveBeenCalled();
        expect(events(log, 'size-guard')).toHaveLength(1);
    });

    it('just under the limit is persisted', async () => {
        const { r, st } = setup({ build: async () => council({ extra: { note: 'ě'.repeat(700_000) } }) });
        await r.get();
        expect(st.put).toHaveBeenCalledTimes(1);
    });

    it('storage.put failure does not break serving', async () => {
        const st = memStorage();
        st.put.mockRejectedValue(new Error('disk'));
        const { r, log } = setup({ storage: st });
        expect((await r.get()).status).toBe(200);
        expect(events(log, 'persist-failed')).toHaveLength(1);
    });
});

// ---- 10: S2 simulation ----------------------------------------------------------

describe('S2 simulated load', () => {
    // ČSÚ publikuje každou minutu (zarovnáno na minutu); build vrací poslední publikaci.
    // period 0 = nic nového (stále stejná, dávno publikovaná data)
    function upstream(period) {
        let calls = 0;
        return async () => {
            calls++;
            const published = period ? Date.now() - (Date.now() % (period * S)) : T0 - 5 * MIN;
            const k = period ? (published - T0) / (period * S) : 0;
            return council({ counted: 10 + k, generated: csu(published), fetchId: `u${k}.${calls}` });
        };
    }

    it('ČSÚ publishes every 60 s, 50 get()/s for 5 min → 5–15 builds', async () => {
        const { r, feed } = setup({ build: upstream(60), time: at('2026-10-10T15:00:30+02:00') });
        for (let t = 0; t < 300 * S; t += 100) {
            await Promise.all([r.get(), r.get(), r.get(), r.get(), r.get()]); // 50/s
            await advance(100);
        }
        const calls = feed.build.mock.calls.length;
        expect(calls).toBeGreaterThanOrEqual(5);
        expect(calls).toBeLessThanOrEqual(15);
    });

    it('ČSÚ unchanged → about one build per 20 s', async () => {
        const { r, feed } = setup({ build: async () => council({ fetchId: 'same', generated: csu(T0 - 5 * MIN) }), time: T0 });
        for (let t = 0; t < 300 * S; t += 100) {
            await Promise.all([r.get(), r.get(), r.get(), r.get(), r.get()]);
            await advance(100);
        }
        const calls = feed.build.mock.calls.length;
        expect(calls).toBeGreaterThanOrEqual(14);
        expect(calls).toBeLessThanOrEqual(16);
    });
});

// ---- 11: second class bounded wait --------------------------------------------

describe('second class bounded wait', () => {
    // seed, pak build čekající na ruční uvolnění
    function pending({ firstClass }) {
        let n = 0;
        const releases = [];
        const h = setup({
            firstClass,
            build: () => {
                if (n++ === 0) return Promise.resolve(council());
                return new Promise((resolve) => {
                    releases.push(() => resolve(council({ counted: 30, generated: csu(Date.now()), fetchId: 'f2' })));
                });
            },
        });
        return { ...h, releases };
    }

    it('snapshot older than 2 min: waits for the refresh and returns the new snapshot', async () => {
        const { r, releases } = pending({ firstClass: false });
        await r.get();
        await advance(2 * MIN + 1 * S);
        let done = null;
        const p = r.get().then((x) => { done = x; });
        await advance(1 * S);
        expect(done).toBeNull();
        releases[0]();
        await advance(0);
        await p;
        expect(parse(done)).toMatchObject({ refreshing: false, stale: false });
        expect(parse(done).precincts.counted).toBe(30);
    });

    it('wait expires after 3 s → old snapshot with refreshing:true', async () => {
        const { r } = pending({ firstClass: false });
        await r.get();
        await advance(3 * MIN);
        const t = Date.now();
        let done = null;
        const p = r.get().then((x) => { done = x; });
        await advance(2999);
        expect(done).toBeNull();
        await advance(1);
        await p;
        expect(Date.now() - t).toBe(3000);
        expect(parse(done)).toMatchObject({ refreshing: true, refreshedAt: T0 });
        expect(parse(done).precincts.counted).toBe(10);
    });

    it('younger than 2 min → immediate even though due', async () => {
        const { r, feed } = pending({ firstClass: false });
        await r.get();
        await advance(90 * S); // splatné (60 s), ale mladší než 2 min
        const res = await r.get(); // vyřeší se bez posunu času
        expect(parse(res)).toMatchObject({ refreshing: true, refreshedAt: T0 });
        expect(feed.build).toHaveBeenCalledTimes(2);
    });

    it('first class never waits', async () => {
        const { r } = pending({ firstClass: true });
        await r.get();
        await advance(5 * MIN);
        const res = await r.get();
        expect(parse(res)).toMatchObject({ refreshing: true, refreshedAt: T0 });
    });

    it('not due (final phase), old snapshot → no wait', async () => {
        let n = 0;
        const { r } = setup({
            firstClass: false,
            build: async () => (n++ === 0 ? council({ counted: 100, total: 100, official: true }) : council()),
        });
        await r.get();
        await advance(5 * MIN); // final: +10 min, nic splatného
        const res = await r.get();
        expect(parse(res)).toMatchObject({ refreshing: false, refreshedAt: T0 });
    });
});
