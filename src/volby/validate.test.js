import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { COUNCILS, POLLS_CLOSE } from '../councils.js';
import { createKvFeed } from './feed.js';
import { createOverviewFeed } from './overview.js';
import { mergeCandidate, validateCandidate, snapshotHash } from './validate.js';

// Kandidáty vznikají během testů přes skutečné createKvFeed / createOverviewFeed
// s falešným fetchImpl nad ručně psanými fixturami (__fixtures__/), protože
// upstream `{}` / `[]` se normalizuje na věrohodný snapshot (viz review H4).

const BASE = 'https://csu.test';
const fx = (name) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const fxJson = (name, mod) => {
    const json = JSON.parse(fx(name));
    mod?.(json);
    return json;
};

const response = (status, text) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    // jako skutečný fetch: HTML / useknuté JSON hodí SyntaxError
    json: async () => JSON.parse(text),
});

// routes: cesta -> objekt (JSON) | string (syrové tělo) | number (HTTP status).
// Chybějící cesta = 404. Objekt routes se čte při každém dotazu, lze ho měnit.
const fakeFetch = (routes) => async (url) => {
    const body = routes[String(url).replace(`${BASE}/`, '')];
    if (body === undefined) return response(404, '');
    if (typeof body === 'number') return response(body, '');
    return response(200, typeof body === 'string' ? body : JSON.stringify(body));
};

// ---- zastupitelstvo (Praha 3, okrsky 1–4, sečtené 1–2) ----------------------
const COUNCIL = { zastup: 500097, okres: 1100, seats: 5, precincts: 4, precinctFiles: true };
const PATH = {
    results: 'vysled/1100/500097.json',
    turnout: 'ucast/obec/1100/500097.json',
    precinct: (id) => `vysled/okrsek/1100/500097_${id}.json`,
};
const KV_OPTS = { council: COUNCIL, baseUrl: BASE, precinctWaitMs: 50, minIntervalMs: 0 };

function routes({
    results = fxJson('results.json'),
    turnout = fxJson('turnout.json'),
    precincts = { 1: fxJson('precinct-1.json'), 2: fxJson('precinct-2.json') },
} = {}) {
    return {
        [PATH.results]: results,
        [PATH.turnout]: turnout,
        ...Object.fromEntries(Object.entries(precincts).map(([id, body]) => [PATH.precinct(id), body])),
    };
}
const nextRoutes = (precincts, over = {}) => routes({
    results: fxJson('results-next.json'),
    turnout: fxJson('turnout-next.json'),
    precincts,
    ...over,
});
const allNext = () => ({ 1: fxJson('precinct-1.json'), 2: fxJson('precinct-2.json'), 3: fxJson('precinct-3.json') });

async function build(r) {
    const { snapshot, stale } = await createKvFeed({ ...KV_OPTS, fetchImpl: fakeFetch(r) }).snapshot();
    expect(stale).toBe(false);
    return snapshot;
}

// ---- přehled (dvě zastupitelstva) -------------------------------------------
const OV_COUNCILS = COUNCILS.filter((c) => [500097, 500054].includes(c.zastup))
    .map((c) => ({ ...c, pirateCandidates: [] }));
const ovPath = (z) => `vysled/1100/${z}.json`;
const ovRoutes = (a = fxJson('results.json'), b = fxJson('results.json')) => ({
    [ovPath(500097)]: a,
    [ovPath(500054)]: b,
});

async function buildOverview(r) {
    const feed = createOverviewFeed({
        councils: OV_COUNCILS, baseUrl: BASE, fetchImpl: fakeFetch(r), waitMs: 500, minIntervalMs: 0,
    });
    const { snapshot, stale } = await feed.snapshot();
    expect(stale).toBe(false);
    return snapshot;
}

// ---- ctx ---------------------------------------------------------------------
const ctx = (over = {}) => ({
    now: POLLS_CLOSE + 3600e3,
    pollsClose: POLLS_CLOSE,
    goodRefreshedAt: POLLS_CLOSE + 60e3,
    base: BASE,
    goodBase: BASE,
    ...over,
});
const validate = (candidate, good, over, kind = 'council') => {
    const c = ctx(over);
    const { merged, complete } = mergeCandidate(candidate, good, kind, c);
    return { ...validateCandidate(merged, good, c), complete };
};
// results bez stran, ale s časem generování (částečné tělo od upstreamu)
const NO_PARTIES = { generovano: '2026-10-10T15:00:00', prehled: [5, 1, 4, 2, 50, 1000, 600, 60, 0, 600, 590, 98, 2000] };

describe('feed + fake fetch → candidate shape (fixtures sanity)', () => {
    it('builds the baseline council snapshot', async () => {
        const s = await build(routes());
        expect(s.generated).toBe('2026-10-10T15:00:00');
        expect(s.precincts.counted).toBe(2);
        expect(s.parties.map((p) => p.votes)).toEqual([1200, 800]);
        expect(s.okrsky[1].votes).toEqual({ 1: 600, 2: 400 });
        expect(Object.keys(s.okrsky)).toEqual(['1', '2']);
    });
});

describe('mergeCandidate — council', () => {
    it('returns the candidate as-is and complete when there is no good snapshot', async () => {
        const cand = await build(routes({ precincts: {} }));
        const { merged, complete } = mergeCandidate(cand, null, 'council');
        expect(merged).toBe(cand);
        expect(complete).toBe(true);
    });

    it('treats a newly counted precinct with votes:null as normal and complete', async () => {
        const good = await build(routes());
        const cand = await build(nextRoutes({ 1: fxJson('precinct-1.json'), 2: fxJson('precinct-2.json') }));
        expect(cand.okrsky[3].votes).toBeNull();
        const { merged, complete } = mergeCandidate(cand, good, 'council', ctx());
        expect(complete).toBe(true);
        expect(merged.okrsky[3].votes).toBeNull();
        expect(merged.okrsky[1].votes).toEqual({ 1: 600, 2: 400 });
        expect(validateCandidate(merged, good, ctx())).toEqual({ outcome: 'ok' });
    });

    it('fills a lost precinct (votes:null, same row) from the good snapshot', async () => {
        const good = await build(routes());
        // precinct 1 file lost (404) in the candidate build
        const cand = await build(nextRoutes({ 2: fxJson('precinct-2.json'), 3: fxJson('precinct-3.json') }));
        expect(cand.okrsky[1].votes).toBeNull();
        const { merged, complete } = mergeCandidate(cand, good, 'council', ctx());
        expect(complete).toBe(true);
        expect(merged.okrsky[1].votes).toEqual(good.okrsky[1].votes);
        expect(cand.okrsky[1].votes).toBeNull(); // vstup se nemění
        expect(validateCandidate(merged, good, ctx())).toEqual({ outcome: 'ok' });
    });

    it('is incomplete when a precinct that had votes still has none (changed row)', async () => {
        const good = await build(routes());
        const turnout = fxJson('turnout.json', (j) => { j.okrsky[0][1] = 501; }); // změněný řádek okrsku 1
        const cand = await build(routes({ turnout, precincts: { 2: fxJson('precinct-2.json') } }));
        const { merged, complete } = mergeCandidate(cand, good, 'council', ctx());
        expect(complete).toBe(false);
        expect(merged.okrsky[1].votes).toBeNull();
    });

    it('is incomplete for a present precinct with votes:null whose good votes cannot be copied', async () => {
        const good = await build(routes());
        // okrsek 1 přítomen s votes:null, ale řádek se liší (voličů 501) → nekopíruje se
        const turnout = fxJson('turnout.json', (j) => { j.okrsky[0][1] = 501; });
        const cand = await build(routes({ turnout, precincts: { 2: fxJson('precinct-2.json') } }));
        expect(cand.okrsky[1].votes).toBeNull();
        expect(validate(cand, good)).toEqual({ outcome: 'ok', complete: false });
    });

    it('a vanished precinct is neither merged back nor incomplete: it falls to precincts-fewer', async () => {
        const good = await build(routes());
        const turnout = fxJson('turnout.json', (j) => { j.okrsky.splice(1, 1); });
        const cand = await build(routes({ turnout }));
        expect(Object.keys(cand.okrsky)).toEqual(['1']);
        const { merged, complete } = mergeCandidate(cand, good, 'council', ctx());
        expect(complete).toBe(true);
        expect(Object.keys(merged.okrsky)).toEqual(['1']);
        expect(validate(cand, good)).toEqual({ outcome: 'rejected', reason: 'precincts-fewer', complete: true });
    });

    it('installs a cold partial candidate (no good snapshot): complete and ok', async () => {
        const cand = await build(routes({ precincts: {} })); // žádný okrskový soubor
        expect(cand.okrsky[1].votes).toBeNull();
        expect(validate(cand, null)).toEqual({ outcome: 'ok', complete: true });
    });
});

describe('mergeCandidate — baseline context', () => {
    it('with ctx where the baseline is off, good is ignored (no copying, always complete)', async () => {
        const good = await build(routes());
        const cand = await build(routes({ precincts: {} })); // okrsek 1, 2 bez hlasů
        const off = ctx({ goodRefreshedAt: POLLS_CLOSE - 1 });
        const { merged, complete } = mergeCandidate(cand, good, 'council', off);
        expect(complete).toBe(true);
        expect(merged).toBe(cand);
        // s platnou baseline se hlasy z good doplní
        expect(mergeCandidate(cand, good, 'council', ctx()).merged.okrsky[1].votes).toEqual(good.okrsky[1].votes);
        expect(mergeCandidate(cand, good, 'council', ctx({ goodBase: 'https://drill.test' })).merged).toBe(cand);
    });
});

describe('ctx is required and validated (fail closed)', () => {
    const bad = [
        ['missing', undefined],
        ['goodRefreshedAt NaN', ctx({ goodRefreshedAt: NaN })],
        ['goodRefreshedAt undefined', ctx({ goodRefreshedAt: undefined })],
        ['pollsClose string', ctx({ pollsClose: '2026-10-10T14:00:00+02:00' })],
        ['base not a string', ctx({ base: 1 })],
        ['goodBase undefined', ctx({ goodBase: undefined })],
    ];

    it.each(bad)('mergeCandidate with a non-null good throws TypeError (%s)', async (_label, badCtx) => {
        const good = await build(routes());
        const cand = await build(routes());
        expect(() => mergeCandidate(cand, good, 'council', badCtx)).toThrow(TypeError);
        expect(() => mergeCandidate(cand, good, 'overview', badCtx)).toThrow(TypeError);
    });

    it.each(bad)('validateCandidate with a non-null good throws TypeError (%s)', async (_label, badCtx) => {
        const cand = await build(routes());
        expect(() => validateCandidate(cand, cand, badCtx)).toThrow(TypeError);
    });

    it.each(bad)('validateCandidate on a cold start (good == null) needs no valid ctx (%s)', async (_label, badCtx) => {
        const cand = await build(routes());
        expect(validateCandidate(cand, null, badCtx)).toEqual({ outcome: 'ok' });
        // strukturální kontroly platí dál
        const empty = await build(routes({ results: NO_PARTIES }));
        expect(validateCandidate(empty, null, badCtx)).toEqual({ outcome: 'rejected', reason: 'parties-empty' });
    });

    it('validateCandidate on a cold start works with no ctx at all and with a partial ctx', async () => {
        const cand = await build(routes());
        expect(validateCandidate(cand, null)).toEqual({ outcome: 'ok' });
        expect(validateCandidate(cand, null, { now: 1, pollsClose: POLLS_CLOSE, base: BASE })).toEqual({ outcome: 'ok' });
    });

    it('mergeCandidate without a good snapshot needs no ctx', async () => {
        const cand = await build(routes());
        expect(mergeCandidate(cand, null, 'council')).toEqual({ merged: cand, complete: true });
    });
});

describe('mergeCandidate — overview', () => {
    it('copies a council missing from the candidate from good and keeps aggregates consistent', async () => {
        const good = await buildOverview(ovRoutes(fxJson('results.json'), fxJson('results.json')));
        expect(good.precincts.counted).toBe(4);
        // 500054 soubor nedorazil (404) → souhrn chybí, ostatní se aktualizovaly
        const cand = await buildOverview({ [ovPath(500097)]: fxJson('results-next.json') });
        expect(Object.keys(cand.councils)).toEqual(['500097']);
        expect(cand.missing).toBe(1);
        const { merged, complete } = mergeCandidate(cand, good, 'overview', ctx());
        expect(complete).toBe(true);
        expect(Object.keys(merged.councils).sort()).toEqual(['500054', '500097']);
        expect(merged.councils[500054]).toEqual(good.councils[500054]);
        expect(merged.councils[500097].counted).toBe(3);
        // bez přepočtu by součet klesl (3 < 4) a propadl by na counted-decreased
        expect(merged.precincts.counted).toBe(5);
        expect(validateCandidate(merged, good, ctx())).toEqual({ outcome: 'ok' });
    });

    it('is incomplete when a council that had data arrives with none', async () => {
        const good = await buildOverview(ovRoutes());
        const cand = await buildOverview(ovRoutes(fxJson('results-next.json'), fxJson('raw-empty-object.json')));
        expect(cand.councils[500054].parties).toEqual([]);
        expect(mergeCandidate(cand, good, 'overview', ctx()).complete).toBe(false);
    });

    it('returns the candidate as-is and complete without a good snapshot', async () => {
        const cand = await buildOverview({ [ovPath(500097)]: fxJson('results.json') });
        const { merged, complete } = mergeCandidate(cand, null, 'overview');
        expect(merged).toBe(cand);
        expect(complete).toBe(true);
    });
});

describe('validateCandidate — structural rejects through the real feed (H4)', () => {
    it('results without a party table → parties-empty', async () => {
        const cand = await build(routes({ results: NO_PARTIES }));
        expect(cand.parties).toEqual([]);
        expect(validate(cand, null)).toMatchObject({ outcome: 'rejected', reason: 'parties-empty' });
        expect(validate(cand, await build(routes()))).toMatchObject({ outcome: 'rejected', reason: 'parties-empty' });
    });

    it('upstream {} for the results file only → generated-null (feed.js spreads results.generated over the max)', async () => {
        // turnout má generated, ale snapshot.generated bere z results (…results
        // za řádkem generated přepíše max) — proto null
        const cand = await build(routes({ results: fxJson('raw-empty-object.json') }));
        expect(cand.generated).toBeNull();
        expect(cand.parties).toEqual([]);
        expect(validate(cand, null)).toMatchObject({ outcome: 'rejected', reason: 'generated-null' });
    });

    it.each([
        ['{}', 'raw-empty-object.json'],
        ['[]', 'raw-empty-array.json'],
    ])('upstream %s for results and turnout → generated-null', async (_label, file) => {
        const cand = await build(routes({ results: fxJson(file), turnout: fxJson(file), precincts: {} }));
        expect(cand.generated).toBeNull();
        expect(cand.parties).toEqual([]);
        expect(validate(cand, null)).toMatchObject({ outcome: 'rejected', reason: 'generated-null' });
        expect(validate(cand, await build(routes()))).toMatchObject({ outcome: 'rejected', reason: 'generated-null' });
    });

    it('unparseable generated is rejected too', async () => {
        const cand = { ...(await build(routes())), generated: 'včera' };
        expect(validate(cand, null)).toMatchObject({ outcome: 'rejected', reason: 'generated-invalid' });
    });

    it('upstream turnout {} while results are fine → precincts-fewer', async () => {
        const good = await build(nextRoutes(allNext()));
        const cand = await build(nextRoutes({}, { turnout: fxJson('raw-empty-object.json') }));
        expect(Object.keys(cand.okrsky)).toHaveLength(0);
        expect(validate(cand, good)).toMatchObject({ outcome: 'rejected', reason: 'precincts-fewer' });
        expect(validate(cand, null).outcome).toBe('ok'); // bez good jen strukturální kontroly
    });

    it('fewer parties than the good snapshot → parties-fewer', async () => {
        const good = await build(nextRoutes(allNext()));
        const results = fxJson('results-next.json', (j) => { j.vysledky.pop(); });
        const cand = await build(nextRoutes(allNext(), { results }));
        expect(validate(cand, good)).toMatchObject({ outcome: 'rejected', reason: 'parties-fewer' });
    });

    it('counted above total → counted-out-of-range', async () => {
        const results = fxJson('results.json', (j) => { j.prehled[3] = 9; });
        const cand = await build(routes({ results }));
        expect(cand.precincts.counted).toBe(9);
        expect(validate(cand, null)).toMatchObject({ outcome: 'rejected', reason: 'counted-out-of-range' });
    });

    it('negative counted → counted-out-of-range', async () => {
        const cand = await build(routes());
        const bad = { ...cand, precincts: { ...cand.precincts, counted: -1 } };
        expect(validate(bad, null)).toMatchObject({ outcome: 'rejected', reason: 'counted-out-of-range' });
    });
});

describe('feed failures never reach the validator', () => {
    // Skutečné chování (feed.js:205): res.json() na HTML / useknutém JSONu hodí
    // SyntaxError, build() propadne a snapshot() bez předchozího úspěšného
    // běhu chybu předá výš (není co vrátit jako stale). S předchozím úspěšným
    // během vrátí { snapshot: <poslední>, stale: true, error } — nové tělo
    // se tedy nikdy nedostane do validateCandidate.
    it.each([
        ['HTML', 'raw-html.txt'],
        ['truncated JSON', 'raw-truncated.txt'],
    ])('%s body → snapshot() throws on a cold feed', async (_label, file) => {
        const r = routes({ results: fx(file) });
        await expect(createKvFeed({ ...KV_OPTS, fetchImpl: fakeFetch(r) }).snapshot()).rejects.toThrow(SyntaxError);
    });

    it.each([
        ['HTML', 'raw-html.txt'],
        ['truncated JSON', 'raw-truncated.txt'],
    ])('%s body after a good run → stale last snapshot with the error', async (_label, file) => {
        const r = routes();
        const feed = createKvFeed({ ...KV_OPTS, fetchImpl: fakeFetch(r) });
        const first = await feed.snapshot();
        r[PATH.results] = fx(file);
        const second = await feed.snapshot();
        expect(second.stale).toBe(true);
        expect(second.error).toBeInstanceOf(SyntaxError);
        expect(second.snapshot).toBe(first.snapshot);
    });

    it('overview: every council returning HTML → build throws', async () => {
        const feed = createOverviewFeed({
            councils: OV_COUNCILS, baseUrl: BASE, waitMs: 500, minIntervalMs: 0,
            fetchImpl: fakeFetch(ovRoutes(fx('raw-html.txt'), fx('raw-truncated.txt'))),
        });
        await expect(feed.snapshot()).rejects.toThrow(SyntaxError);
    });

    it('overview: one council returning HTML → candidate lacks it (merge fills it from good)', async () => {
        const good = await buildOverview(ovRoutes());
        const cand = await buildOverview(ovRoutes(fxJson('results-next.json'), fx('raw-html.txt')));
        expect(Object.keys(cand.councils)).toEqual(['500097']);
        const { merged, complete } = mergeCandidate(cand, good, 'overview', ctx());
        expect(complete).toBe(true);
        expect(merged.councils[500054]).toEqual(good.councils[500054]);
    });
});

describe('validateCandidate — baseline (C4)', () => {
    const testData = () => fxJson('results.json', (j) => {
        j.generovano = '2026-10-10T12:00:00';
        j.prehled[2] = 60;
        j.prehled[3] = 50;
    });
    const testTurnout = () => fxJson('turnout.json', (j) => { j.generovano = '2026-10-10T12:00:00'; });
    const realReset = () => routes({
        results: fxJson('results.json', (j) => {
            j.generovano = '2026-10-10T14:05:00';
            j.prehled[3] = 0;
            j.vysledky.forEach((r) => { r[2] = 0; });
        }),
        turnout: { generovano: '2026-10-10T14:05:00', okrsky: [] },
        precincts: {},
    });

    it('good refreshed before 14:00 with counted=50, post-14:00 candidate with counted=0 → ok', async () => {
        const good = await build(routes({ results: testData(), turnout: testTurnout() }));
        expect(good.precincts.counted).toBe(50);
        const cand = await build(realReset());
        expect(cand.precincts.counted).toBe(0);
        const out = validate(cand, good, { goodRefreshedAt: POLLS_CLOSE - 3600e3 });
        expect(out).toEqual({ outcome: 'ok', complete: true });
    });

    it('same pair with good refreshed after 14:00 is rejected (monotonic checks on)', async () => {
        const good = await build(routes({ results: testData(), turnout: testTurnout() }));
        const cand = await build(realReset());
        expect(validate(cand, good, { goodRefreshedAt: POLLS_CLOSE + 1 }))
            .toEqual({ outcome: 'rejected', reason: 'precincts-fewer', complete: true });
    });

    it('monotonic checks are off when the base differs (ČSÚ test data), even after 14:00', async () => {
        const good = await build(routes({ results: testData(), turnout: testTurnout() }));
        const cand = await build(realReset());
        expect(validate(cand, good, { goodBase: 'https://drill.test' }).outcome).toBe('ok');
    });

    it('an older generated is not "older" while the baseline is off', async () => {
        const good = await build(nextRoutes(allNext()));
        const cand = await build(routes()); // generated 15:00 < 15:01
        expect(validate(cand, good, { goodRefreshedAt: POLLS_CLOSE - 1 }).outcome).toBe('ok');
    });

    it('absolute structural rejects still apply with the baseline off', async () => {
        const good = await build(routes());
        const cand = await build(routes({ results: NO_PARTIES }));
        expect(validate(cand, good, { goodRefreshedAt: POLLS_CLOSE - 1 }))
            .toMatchObject({ outcome: 'rejected', reason: 'parties-empty' });
    });
});

describe('validateCandidate — older replica and content regression', () => {
    it('generated older than good → older (checked before the "fewer precincts" rules)', async () => {
        const good = await build(nextRoutes(allNext()));
        const cand = await build(routes()); // 2 okrsky, generated 15:00 < 15:01
        expect(validate(cand, good)).toMatchObject({ outcome: 'older' });
    });

    it('compares generated through parseCsuTime, not as strings', async () => {
        const good = { ...(await build(nextRoutes(allNext()))), generated: '2026-10-10T13:50:00Z' };
        // zone-less 14:30 = 12:30Z je starší než 13:50Z, i když řetězec je větší
        const older = { ...good, generated: '2026-10-10T14:30:00' };
        expect(validate(older, good).outcome).toBe('older');
        // 13:30Z je novější než zone-less 15:01 (13:01Z), i když řetězec je menší
        const newer = { ...(await build(nextRoutes(allNext()))), generated: '2026-10-10T13:30:00Z' };
        const goodLocal = await build(nextRoutes(allNext()));
        expect(validate(newer, goodLocal).outcome).toBe('ok');
    });

    it('equal generated is not older', async () => {
        const good = await build(nextRoutes(allNext()));
        expect(validate(good, good)).toEqual({ outcome: 'ok', complete: true });
    });

    it('counted decreased with advancing generated → rejected counted-decreased', async () => {
        // results už mají 3 sečtené okrsky, přehled účasti teprve 2 řádky
        const good = await build(nextRoutes({ 1: fxJson('precinct-1.json'), 2: fxJson('precinct-2.json') }, {
            turnout: fxJson('turnout.json', (j) => { j.generovano = '2026-10-10T15:01:00'; }),
        }));
        expect(good.precincts.counted).toBe(3);
        const cand = await build(routes({
            results: fxJson('results-next.json', (j) => {
                j.generovano = '2026-10-10T15:02:00';
                j.prehled[3] = 2;
            }),
            turnout: fxJson('turnout.json', (j) => { j.generovano = '2026-10-10T15:02:00'; }),
        }));
        expect(cand.precincts.counted).toBe(2);
        expect(validate(cand, good)).toMatchObject({ outcome: 'rejected', reason: 'counted-decreased' });
    });

    it('party votes dropped to 0 → rejected votes-decreased', async () => {
        const good = await build(nextRoutes(allNext()));
        const results = fxJson('results-next.json', (j) => {
            j.generovano = '2026-10-10T15:02:00';
            j.vysledky[1][2] = 0;
        });
        const cand = await build(nextRoutes(allNext(), { results }));
        expect(cand.parties[1].votes).toBe(0);
        expect(validate(cand, good)).toMatchObject({ outcome: 'rejected', reason: 'votes-decreased' });
    });

    it('a normal advance (more precincts, more votes) is ok', async () => {
        const good = await build(routes());
        const cand = await build(nextRoutes(allNext()));
        expect(validate(cand, good)).toEqual({ outcome: 'ok', complete: true });
    });
});

describe('validateCandidate — overview', () => {
    it('a council with parties.length === 0 → rejected, even without a good snapshot', async () => {
        const cand = await buildOverview(ovRoutes(fxJson('results.json'), fxJson('raw-empty-object.json')));
        expect(cand.councils[500054].parties).toEqual([]);
        expect(validate(cand, null, {}, 'overview'))
            .toMatchObject({ outcome: 'rejected', reason: 'council-parties-empty' });
    });

    it('a council with fewer parties than good → rejected', async () => {
        const good = await buildOverview(ovRoutes());
        const fewer = fxJson('results-next.json', (j) => { j.vysledky.pop(); });
        const cand = await buildOverview(ovRoutes(fewer, fxJson('results-next.json')));
        expect(validate(cand, good, {}, 'overview'))
            .toMatchObject({ outcome: 'rejected', reason: 'council-parties-fewer' });
    });

    it('a normal advance is ok', async () => {
        const good = await buildOverview(ovRoutes());
        const cand = await buildOverview(ovRoutes(fxJson('results-next.json'), fxJson('results-next.json')));
        expect(validate(cand, good, {}, 'overview')).toEqual({ outcome: 'ok', complete: true });
    });

    it('an all-lagging candidate is merged back to good: ok, nothing regresses, never "older"', async () => {
        const good = await buildOverview(ovRoutes(fxJson('results-next.json'), fxJson('results-next.json')));
        const cand = await buildOverview(ovRoutes());
        const { merged } = mergeCandidate(cand, good, 'overview', ctx());
        expect(merged.councils).toEqual(good.councils);
        expect(merged.precincts).toEqual(good.precincts);
        expect(merged.generated).toBe(good.generated);
        expect(validate(cand, good, {}, 'overview')).toEqual({ outcome: 'ok', complete: true });
    });

    it('one lagging council replica keeps good for that council while the advancing one is published', async () => {
        const good = await buildOverview(ovRoutes(fxJson('results.json'), fxJson('results-next.json')));
        // 500097 postoupil (15:01), 500054 dorazil ze zpožděné repliky (15:00 < 15:01 v good)
        const cand = await buildOverview(ovRoutes(fxJson('results-next.json'), fxJson('results.json')));
        expect(cand.generated).toBe(good.generated);
        const { merged, complete } = mergeCandidate(cand, good, 'overview', ctx());
        expect(complete).toBe(true);
        expect(merged.councils[500054]).toEqual(good.councils[500054]);
        expect(merged.councils[500097]).toEqual(cand.councils[500097]);
        expect(merged.councils[500097].counted).toBe(3);
        expect(merged.precincts.counted).toBe(6); // 3 + 3, ne 3 + 2
        expect(validate(cand, good, {}, 'overview')).toEqual({ outcome: 'ok', complete: true });
    });

    const finalResults = () => fxJson('results-next.json', (j) => {
        j.zvoleno = true;
        j.vysledky[0][7] = 3;
        j.vysledky[1][7] = 2;
    });

    it('final good + candidate MISSING a council: the council is copied from good and final stays final', async () => {
        const good = await buildOverview(ovRoutes(finalResults(), finalResults()));
        expect(good.official).toBe(true);
        const cand = await buildOverview({ [ovPath(500097)]: finalResults() });
        expect(cand.official).toBe(false); // kandidát sám final není
        const { merged } = mergeCandidate(cand, good, 'overview', ctx());
        expect(Object.keys(merged.councils)).toHaveLength(2);
        expect(merged.official).toBe(true);
        expect(merged.phase).toBe('final');
    });

    it('final good + one lagging non-final council replica: no flapping back to counting', async () => {
        const good = await buildOverview(ovRoutes(finalResults(), finalResults()));
        expect(good.phase).toBe('final');
        // 500054 přišel ze zpožděné repliky: starší generated, zvoleno:false
        const lagging = fxJson('results-next.json', (j) => { j.generovano = '2026-10-10T15:00:30'; });
        const cand = await buildOverview(ovRoutes(finalResults(), lagging));
        expect(cand.official).toBe(false);
        const { merged } = mergeCandidate(cand, good, 'overview', ctx());
        expect(merged.councils[500054]).toEqual(good.councils[500054]);
        expect(merged.official).toBe(true);
        expect(merged.phase).toBe('final');
        expect(validate(cand, good, {}, 'overview')).toEqual({ outcome: 'ok', complete: true });
    });

    it('a merge cannot declare official when neither the candidate nor good was official', async () => {
        const nonFinal = fxJson('results-next.json');
        const good = await buildOverview({ [ovPath(500097)]: finalResults(), [ovPath(500054)]: nonFinal });
        expect(good.official).toBe(false);
        const cand = await buildOverview({ [ovPath(500097)]: finalResults() });
        const { merged } = mergeCandidate(cand, good, 'overview', ctx());
        expect(merged.official).toBe(false);
        expect(merged.phase).not.toBe('final');
    });

    it('a council counted decreased with advancing generated → rejected counted-decreased', async () => {
        const good = await buildOverview(ovRoutes(fxJson('results-next.json'), fxJson('results-next.json')));
        const regressed = fxJson('results-next.json', (j) => {
            j.generovano = '2026-10-10T15:02:00';
            j.prehled[3] = 2;
        });
        const cand = await buildOverview(ovRoutes(regressed, fxJson('results-next.json')));
        expect(validate(cand, good, {}, 'overview'))
            .toMatchObject({ outcome: 'rejected', reason: 'counted-decreased' });
    });

    it('a council party votes dropped → rejected votes-decreased', async () => {
        const good = await buildOverview(ovRoutes(fxJson('results-next.json'), fxJson('results-next.json')));
        const dropped = fxJson('results-next.json', (j) => {
            j.generovano = '2026-10-10T15:02:00';
            j.vysledky[1][2] = 0;
        });
        const cand = await buildOverview(ovRoutes(dropped, fxJson('results-next.json')));
        expect(validate(cand, good, {}, 'overview'))
            .toMatchObject({ outcome: 'rejected', reason: 'votes-decreased' });
    });

    it('baseline off (good before 14:00) lets a reset through', async () => {
        const good = await buildOverview(ovRoutes(fxJson('results-next.json'), fxJson('results-next.json')));
        const cand = await buildOverview(ovRoutes());
        expect(validate(cand, good, { goodRefreshedAt: POLLS_CLOSE - 1 }, 'overview').outcome).toBe('ok');
    });
});

describe('snapshotHash', () => {
    it('is equal when only generated / fetchedAt / phase / missing / fetchId / response meta differ', async () => {
        const a = await build(routes());
        const b = {
            ...a,
            generated: '2026-10-10T15:09:00',
            fetchedAt: '2030-01-01T00:00:00.000Z',
            phase: 'counting',
            missing: 3,
            fetchId: '7.8',
            refreshedAt: 1,
            nextRefreshAt: 2,
            servedAt: 3,
            stale: true,
            complete: false,
            refreshing: true,
        };
        expect(snapshotHash(b)).toBe(snapshotHash({ ...a, phase: 'waiting' }));
        expect(snapshotHash(b)).toBe(snapshotHash(a));
        expect(typeof snapshotHash(a)).toBe('string');
    });

    it('ignores generated at every level (overview councils)', async () => {
        const a = await buildOverview(ovRoutes());
        const later = (j) => fxJson('results.json', (x) => { x.generovano = j; });
        const b = await buildOverview(ovRoutes(later('2026-10-10T15:30:00'), later('2026-10-10T15:31:00')));
        expect(b.councils[500097].generated).not.toBe(a.councils[500097].generated);
        expect(snapshotHash(b)).toBe(snapshotHash(a));
    });

    it('differs when content differs', async () => {
        const a = await build(routes());
        const b = await build(nextRoutes(allNext()));
        expect(snapshotHash(a)).not.toBe(snapshotHash(b));
        const c = { ...a, parties: a.parties.map((p, i) => (i ? { ...p, votes: p.votes + 1 } : p)) };
        expect(snapshotHash(c)).not.toBe(snapshotHash(a));
    });

    it('does not depend on key order', () => {
        expect(snapshotHash({ a: 1, b: { c: 2, d: [1, { y: 1, x: 2 }] } }))
            .toBe(snapshotHash({ b: { d: [1, { x: 2, y: 1 }], c: 2 }, a: 1 }));
    });
});
