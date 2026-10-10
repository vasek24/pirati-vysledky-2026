import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLLS_CLOSE as PRAGUE_POLLS_CLOSE } from '../councils.js';
import * as model from './indexModel.js';
import {
    POLLS_CLOSE, activeShards, buildRegions, bestSource, createShardPoller, doneSet, errorDelay, featuredShardIds, filterShardSummaries, flatOrder,
    initialMounted, isCounted, newlyCounted, pickSummary, regionHeader, rowView, shardSource,
} from './indexModel.js';
import { FIXTURE_ALL, FIXTURE_COUNCILS, FIXTURE_HIDDEN, FIXTURE_REGIONS, FIXTURE_SHARDS } from './index/devFixture.jsx';

const NOW = Date.parse('2026-10-10T15:45:00+02:00');
const byName = (name) => FIXTURE_COUNCILS.find((c) => c.name === name);
const sum = (over = {}) => ({
    z: 1, generated: '2026-10-10T15:42:10', phase: 'counting', counted: 10, total: 174, official: false, seats: 47, votes: 1000, turnout: 40, parties: [],
    pirates: { id: 11, votes: 123, pct: 12.34, seats: 5, passed: true, rank: 2 }, ...over,
});

describe('POLLS_CLOSE', () => {
    it('is the same instant as Prague\'s councils.js', () => {
        expect(POLLS_CLOSE).toBe(PRAGUE_POLLS_CLOSE);
    });
});

describe('shardSource', () => {
    it('is the useLiveResults-shaped source of one shard', () => {
        expect(shardSource('32-1', 1)).toEqual({ key: 'kraj.32-1', url: '/api/kraj?s=32-1', version: 1, arrivals: false });
    });
});

describe('filterShardSummaries (H2b)', () => {
    const shard = { id: '32-1', zastups: [554791, 555771] };
    const snapshot = {
        v: 1, precincts: { counted: 999, total: 1000 }, official: true, generated: 'x',
        councils: { 554791: sum({ z: 554791 }), 555771: sum({ z: 555771 }), 123456: sum({ z: 123456 }) },
    };
    it('keeps only the current members of the shard', () => {
        const out = filterShardSummaries(snapshot, shard);
        expect(Object.keys(out).sort()).toEqual(['554791', '555771']);
        expect(out[123456]).toBeUndefined();
    });
    it('returns summaries only: no shard-level sums (precincts, official)', () => {
        const out = filterShardSummaries(snapshot, shard);
        expect(JSON.stringify(out)).not.toContain('"precincts":{"counted":999');
        expect(Object.keys(out)).not.toContain('precincts');
        expect(Object.keys(out)).not.toContain('official');
    });
    it('tolerates a missing or malformed councils object', () => {
        expect(filterShardSummaries({}, shard)).toEqual({});
        expect(filterShardSummaries({ councils: null }, shard)).toEqual({});
        expect(filterShardSummaries(null, shard)).toEqual({});
    });
});

describe('pickSummary (H2c)', () => {
    const older = sum({ generated: '2026-10-10T15:42:10', counted: 9 });
    const newer = sum({ generated: '2026-10-10T15:43:00', counted: 10 });
    it('prefers the newer ČSÚ time, whichever argument it is', () => {
        expect(pickSummary(older, newer)).toBe(newer);
        expect(pickSummary(newer, older)).toBe(newer);
    });
    it('prefers a present summary over undefined', () => {
        expect(pickSummary(undefined, older)).toBe(older);
        expect(pickSummary(older, undefined)).toBe(older);
        expect(pickSummary(undefined, undefined)).toBeUndefined();
    });
    it('compares as Prague time, not as strings across a zone suffix', () => {
        const withZone = sum({ generated: '2026-10-10T13:44:00Z' }); // = 15:44 Prague
        expect(pickSummary(older, withZone)).toBe(withZone);
    });
    it('on equal times takes the more counted one, then the official one', () => {
        const a = sum({ counted: 5 });
        const b = sum({ counted: 6 });
        expect(pickSummary(a, b)).toBe(b);
        expect(pickSummary(sum({ counted: 6 }), sum({ counted: 6, official: true }))).toMatchObject({ official: true });
    });
    it('a summary without a valid time loses against one with a time', () => {
        const noTime = sum({ generated: null });
        expect(pickSummary(noTime, older)).toBe(older);
    });
});

describe('rowView', () => {
    const plzen = byName('Plzeň');
    it('counting: Pirate %, no seats unless official, own ČSÚ time', () => {
        const v = rowView(plzen, sum(), NOW);
        expect(v).toMatchObject({ state: 'counting', piratePct: 12.34, seatsOfficial: null, time: '15:42', timeLabel: 'ČSÚ 15:42', val: '12,3 %', seats: 'průběžně', txt: 'sečteno 5 % okrsků', bar: 10 / 174 });
    });
    it('official and fully counted: seats and "konečné výsledky", state done', () => {
        const v = rowView(plzen, sum({ counted: 174, total: 174, official: true }), NOW);
        expect(v).toMatchObject({ state: 'done', seatsOfficial: 5, seats: '5 mandátů', txt: 'konečné výsledky', bar: 1 });
    });
    it('all precincts counted but not declared', () => {
        const v = rowView(plzen, sum({ counted: 174, total: 174 }), NOW);
        expect(v).toMatchObject({ state: 'counted', seatsOfficial: null, seats: 'průběžně', txt: 'sečteno vše, čeká na vyhlášení' });
    });
    it('seat words follow Czech plurals', () => {
        const seats = (n) => rowView(plzen, sum({ counted: 174, total: 174, official: true, pirates: { pct: 8, seats: n } }), NOW).seats;
        expect([seats(0), seats(1), seats(2), seats(5)]).toEqual(['0 mandátů', '1 mandát', '2 mandáty', '5 mandátů']);
    });
    it('no summary: loading, or "?" when the shard failed', () => {
        expect(rowView(plzen, undefined, NOW)).toMatchObject({ state: 'loading', val: '', txt: 'načítám…', time: null });
        expect(rowView(plzen, undefined, NOW, { status: 'error' })).toMatchObject({ state: 'error', val: '?', txt: 'data se nepodařilo načíst' });
    });
    it('after 14:00 with nothing counted: waiting for the first precincts', () => {
        const v = rowView(plzen, sum({ counted: 0, pirates: null }), NOW);
        expect(v).toMatchObject({ state: 'waiting', txt: 'čeká na první okrsky', val: '–', time: '15:42', seats: '' });
    });
    it('before 14:00: "výsledky po 14:00", no time — the server phase is not trusted (CDN)', () => {
        const before = Date.parse('2026-10-10T12:00:00+02:00');
        const v = rowView(plzen, sum({ counted: 0, phase: 'counting' }), before);
        expect(v).toMatchObject({ state: 'pre', txt: 'výsledky po 14:00', val: '–', time: null });
        // a CDN copy that still says "pre" after 14:00 is judged by counted
        expect(rowView(plzen, sum({ phase: 'pre' }), NOW).state).toBe('counting');
    });
    it('a failing shard marks the row stale: ⚠ before the time, values stay', () => {
        const v = rowView(plzen, sum(), NOW, { stale: true });
        expect(v).toMatchObject({ stale: true, timeLabel: '⚠ ČSÚ 15:42', val: '12,3 %' });
    });
    it('shows times in Prague time (TZ=UTC in tests)', () => {
        expect(rowView(plzen, sum({ generated: '2026-10-10T00:17:30' }), NOW).time).toBe('0:17');
        expect(rowView(plzen, sum({ generated: '2026-10-10T13:44:00Z' }), NOW).time).toBe('15:44');
    });
    it('kind badge and list name come from the arrangement', () => {
        expect(rowView(byName('Plzeň'), undefined, NOW)).toMatchObject({ badge: 'Vlastní', badgeKind: 'party' });
        expect(rowView(byName('Hradec Králové'), undefined, NOW)).toMatchObject({ badge: 'Koalice', badgeKind: 'coalition', listName: 'PIRÁTI a STAROSTOVÉ' });
        expect(rowView(byName('Jablonec nad Nisou'), undefined, NOW)).toMatchObject({ badge: 'Sdružení', badgeKind: 'association' });
    });
    it('forced types c/d: own badges, no Pirate list value', () => {
        const c = { ...plzen, pirates: null, arrangement: { type: 'c', list: null, members: [], others: [{ list: 7, listName: 'Starostové', n: 5, name: 'Lukáš Zykán', nominatedBy: 'STAN' }], flags: [] } };
        const d = { ...plzen, pirates: null, arrangement: { type: 'd', list: null, members: [], others: [], flags: [] } };
        expect(rowView(c, sum({ pirates: null }), NOW)).toMatchObject({ badge: 'Jiné kandidátky', badgeKind: 'other', listName: 'Starostové', val: '–', seats: '' });
        expect(rowView(d, sum({ pirates: null }), NOW)).toMatchObject({ badge: 'Bez Pirátů', listName: 'Piráti tu letos nekandidují', val: '–' });
    });
    it('exposes no shard-level sums', () => {
        const v = rowView(plzen, sum({ precincts: { counted: 1 } }), NOW);
        expect(Object.keys(v)).not.toContain('precincts');
        expect(Object.keys(v)).not.toContain('official');
    });
});

describe('isCounted / doneSet / newlyCounted', () => {
    it('counted ≥ total > 0', () => {
        expect(isCounted(sum({ counted: 174, total: 174 }))).toBe(true);
        expect(isCounted(sum({ counted: 173, total: 174 }))).toBe(false);
        expect(isCounted(sum({ counted: 0, total: 0 }))).toBe(false);
        expect(isCounted(undefined)).toBe(false);
    });
    const summaries = { 554791: sum({ counted: 174, total: 174 }), 555771: sum(), 569810: sum({ counted: 5, total: 5 }), 999001: sum({ counted: 5, total: 5 }) };
    it('doneSet counts only the given (shown) towns', () => {
        expect([...doneSet(summaries, FIXTURE_COUNCILS)].sort()).toEqual([554791, 569810]);
    });
    it('newlyCounted is what is counted now but not in the snapshot', () => {
        expect(newlyCounted(summaries, FIXTURE_COUNCILS, new Set([554791])).map((c) => c.zastup)).toEqual([569810]);
        expect(newlyCounted(summaries, FIXTURE_COUNCILS, new Set([554791, 569810]))).toEqual([]);
    });
});

describe('buildRegions and regionHeader', () => {
    const regions = buildRegions(FIXTURE_COUNCILS, FIXTURE_SHARDS, FIXTURE_REGIONS);
    const ms = regions.find((r) => r.kraj === 8100);
    it('hidden towns are not in any region (H1); shards without a shown town are not required', () => {
        expect(FIXTURE_ALL.some((c) => c.zastup === FIXTURE_HIDDEN[0].zastup)).toBe(true);
        expect(regions.flatMap((r) => r.zastups)).not.toContain(FIXTURE_HIDDEN[0].zastup);
        expect(regions.flatMap((r) => r.zastups)).toHaveLength(FIXTURE_COUNCILS.length);
    });
    it('regions are in kraj order, towns in Czech name order, with every shard that has a shown town', () => {
        expect(regions.map((r) => r.kraj)).toEqual([...regions.map((r) => r.kraj)].sort((a, b) => a - b));
        expect(regions).toHaveLength(13);
        expect(ms.shardIds).toEqual(['81-1', '81-2']);
        const names = ms.councils.map((c) => c.name);
        expect(names).toEqual([...names].sort(new Intl.Collator('cs').compare));
    });
    const small = { kraj: 1, name: 'Testovací kraj', zastups: [1, 2, 3], shardIds: ['1-1'] };
    const shown = new Set([1, 2, 3]);
    const loadedShard = { '1-1': { status: 'ok', hasData: true } };
    it('counts only: "10 měst" (Czech plural)', () => {
        const h = (n) => regionHeader({ ...small, zastups: Array.from({ length: n }, (_, i) => i + 1) }, { shown: new Set(Array.from({ length: n }, (_, i) => i + 1)), summaries: {}, shards: {} }).text;
        expect([h(1), h(3), h(10)]).toEqual(['1 město', '3 města', '10 měst']);
    });
    it('loading → "… · načítám…", never "Sečteno" (partial)', () => {
        const h = regionHeader(small, { shown, summaries: {}, shards: { '1-1': { status: 'loading', hasData: false } } });
        expect(h).toMatchObject({ text: '3 města · načítám…', doneText: null, error: false });
    });
    it('all shards loaded → "Sečteno 1 z 3 měst"', () => {
        const summaries = { 1: sum({ counted: 5, total: 5 }), 2: sum(), 3: sum({ counted: 0 }) };
        expect(regionHeader(small, { shown, summaries, shards: loadedShard })).toMatchObject({ doneText: 'Sečteno 1 z 3 měst', text: 'Sečteno 1 z 3 měst', error: false });
    });
    it('with several shards, one still missing → partial (no done text)', () => {
        const two = { ...small, shardIds: ['1-1', '1-2'] };
        const h = regionHeader(two, { shown, summaries: {}, shards: { '1-1': { status: 'ok', hasData: true }, '1-2': { status: 'idle', hasData: false } } });
        expect(h.doneText).toBeNull();
        expect(h.text).toBe('3 města');
    });
    it('before counting every town says "výsledky po 14:00"', () => {
        const pre = { 1: sum({ counted: 0 }), 2: sum({ counted: 0 }), 3: sum({ counted: 0 }) };
        expect(regionHeader(small, { shown, summaries: pre, shards: loadedShard, now: Date.parse('2026-10-10T12:00:00+02:00') }).text).toBe('3 města · výsledky po 14:00');
        expect(regionHeader(small, { shown, summaries: pre, shards: loadedShard, now: NOW }).doneText).toBe('Sečteno 0 z 3 měst');
    });
    it('failed shard: ⚠ stale line when it had data, "nepodařilo načíst" when it never had', () => {
        const stale = regionHeader(small, { shown, summaries: {}, shards: { '1-1': { status: 'error', hasData: true } } });
        expect(stale).toMatchObject({ text: '⚠ Data kraje jsou zastaralá — zkouším znovu', error: true, doneText: null });
        const none = regionHeader(small, { shown, summaries: {}, shards: { '1-1': { status: 'error', hasData: false } } });
        expect(none).toMatchObject({ text: '⚠ Data se nepodařilo načíst — zkouším znovu', error: true });
    });
    it('a server-side stale flag counts as stale as well', () => {
        expect(regionHeader(small, { shown, summaries: {}, shards: { '1-1': { status: 'ok', hasData: true, stale: true } } }).text).toBe('⚠ Data kraje jsou zastaralá — zkouším znovu');
    });
    it('hidden zastups of the region are not counted', () => {
        const withHidden = { ...small, zastups: [1, 2, 3, 99] };
        expect(regionHeader(withHidden, { shown, summaries: {}, shards: {} }).text).toBe('3 města');
    });
});

describe('flatOrder', () => {
    it('A–Z uses the Czech collator (Č after C, Ch after H)', () => {
        const order = flatOrder(FIXTURE_COUNCILS, 'az').map((c) => c.name);
        expect(order).toEqual([...order].sort(new Intl.Collator('cs').compare));
        expect(order.indexOf('Cheb')).toBeGreaterThan(order.indexOf('Hradec Králové'));
        expect(order.indexOf('Česká Lípa')).toBeGreaterThan(order.indexOf('Břeclav'));
    });
    it('Velikost: population descending, name as tie-break, input untouched', () => {
        const input = [...FIXTURE_COUNCILS].reverse();
        const order = flatOrder(input, 'velikost');
        expect(order[0].name).toBe('Brno');
        expect(order.map((c) => c.population)).toEqual([...order.map((c) => c.population)].sort((a, b) => b - a));
        expect(input[0]).toBe([...FIXTURE_COUNCILS].reverse()[0]);
    });
    it('never orders by the Pirate result: there is no such mode', () => {
        expect(() => flatOrder(FIXTURE_COUNCILS, 'pirati')).toThrow();
        expect(model.sortRows).toBeUndefined();
        expect(model.piratesSortEnabled).toBeUndefined();
    });
});

describe('activeShards / initialMounted', () => {
    it('first load on a phone: the two featured shards', () => {
        expect(initialMounted({ width: 375 })).toEqual(['top-1', 'top-2']);
        expect(initialMounted({ width: 1280 })).toEqual(['top-1', 'top-2']);
        expect(featuredShardIds(FIXTURE_SHARDS)).toEqual(['top-1', 'top-2']);
    });
    it('adds Moje obec\'s shard, visible shards and all-once, without duplicates', () => {
        expect(activeShards({ featured: ['top-1', 'top-2'], mineShard: '52-1', visibleShardIds: ['52-1', '32-1'], allOnce: [] })).toEqual(['top-1', 'top-2', '52-1', '32-1']);
        expect(activeShards({ featured: ['top-1'], mineShard: null, visibleShardIds: [], allOnce: ['21-1', '21-2', 'top-1'] })).toEqual(['top-1', '21-1', '21-2']);
    });
});

describe('bestSource', () => {
    const plzen = byName('Plzeň'); // featured top-1, shard 32-1
    const state = (over) => ({ shards: {}, summaries: {}, ...over });
    it('picks the freshest of the region and the featured shard, with its source status', () => {
        const snap = state({
            shards: { 'top-1': { status: 'ok', hasData: true }, '32-1': { status: 'error', hasData: true } },
            summaries: { 'top-1': { 554791: sum({ generated: '2026-10-10T15:43:00' }) }, '32-1': { 554791: sum({ generated: '2026-10-10T15:41:00' }) } },
        });
        const best = bestSource(plzen, snap);
        expect(best.summary.generated).toBe('2026-10-10T15:43:00');
        expect(best).toMatchObject({ status: 'ok', stale: false });
    });
    it('a stale (failing) source is flagged on the row', () => {
        const snap = state({ shards: { '32-1': { status: 'error', hasData: true } }, summaries: { '32-1': { 554791: sum() } } });
        expect(bestSource(plzen, snap)).toMatchObject({ stale: true });
    });
    it('without a summary: loading while a shard loads, error when one failed, idle otherwise', () => {
        expect(bestSource(plzen, state({ shards: { 'top-1': { status: 'loading' } } })).status).toBe('loading');
        expect(bestSource(plzen, state({ shards: { '32-1': { status: 'error' } } })).status).toBe('error');
        expect(bestSource(plzen, state({})).status).toBe('idle');
    });
});

describe('errorDelay', () => {
    it('retries after 15 s, then 30 s, then 60 s (±15 %)', () => {
        expect([1, 2, 3, 4, 9].map((n) => Math.round(errorDelay(n, 0.5) / 1000))).toEqual([15, 30, 60, 60, 60]);
        expect(errorDelay(1, 0)).toBeCloseTo(15000 * 0.85);
        expect(errorDelay(1, 1)).toBeCloseTo(15000 * 1.15);
    });
});

// ---------------------------------------------------------------------------
describe('createShardPoller', () => {
    let hidden;
    let calls;
    let serverNow;
    let responses; // id -> () => { ok, body } | Error
    const T0 = Date.parse('2026-10-10T15:45:00+02:00');

    const respond = (id) => {
        const make = responses[id] ?? (() => ({ nextRefreshAt: Date.now() + 60_000 }));
        const r = make();
        if (r instanceof Error) throw r;
        const shard = FIXTURE_SHARDS.find((s) => s.id === id);
        const councils = Object.fromEntries(shard.zastups.map((z) => [z, sum({ z })]));
        return { v: 1, nextRefreshAt: r.nextRefreshAt, stale: !!r.stale, councils, precincts: { counted: 1, total: 2 }, official: true };
    };
    const fetchImpl = vi.fn(async (url) => {
        const id = new URL(url, 'http://x').searchParams.get('s');
        calls.push(id);
        const body = respond(id);
        return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'application/json' : h === 'x-server-now' ? String(serverNow()) : null) }, json: async () => body };
    });
    const make = (over = {}) => createShardPoller({ shards: FIXTURE_SHARDS, version: 1, fetchImpl, random: () => 0.5, isHidden: () => hidden, ...over });
    const flush = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        hidden = false;
        calls = [];
        responses = {};
        serverNow = () => Date.now();
        fetchImpl.mockClear();
    });
    afterEach(() => { vi.useRealTimers(); });

    it('pinned featured shards load once at start; nothing else', async () => {
        const p = make();
        p.setFeatured(['top-1', 'top-2']);
        await flush(10);
        expect(calls.sort()).toEqual(['top-1', 'top-2']);
        const snap = p.getSnapshot();
        expect(snap.shards['top-1']).toMatchObject({ status: 'ok', hasData: true, errors: 0 });
        expect(Object.keys(snap.summaries['top-1'])).toHaveLength(6);
        p.destroy();
    });

    it('keeps only current members and never exposes shard-level sums in the snapshot', async () => {
        const p = make();
        p.setFeatured(['top-1']);
        await flush(10);
        const snap = p.getSnapshot();
        expect(JSON.stringify(snap)).not.toContain('"official":true');
        expect(JSON.stringify(snap)).not.toContain('"precincts":{"counted":1');
        p.destroy();
    });

    it('a row must stay visible 400 ms before its shard is requested, and leaving unmounts 3 s later', async () => {
        const p = make();
        p.setRowVisible('32-1', 'row-a', true);
        await flush(399);
        expect(calls).toEqual([]);
        await flush(2);
        expect(calls).toEqual(['32-1']);
        // scrolled away: still polled during the grace period, stopped afterwards
        p.setRowVisible('32-1', 'row-a', false);
        await flush(2900);
        expect(p.getSnapshot().active).toContain('32-1');
        await flush(200);
        expect(p.getSnapshot().active).not.toContain('32-1');
        // data stays (no skeleton flash on re-expand)
        expect(p.getSnapshot().shards['32-1'].hasData).toBe(true);
        p.destroy();
    });

    it('a fast scroll past a row (< 400 ms) requests nothing', async () => {
        const p = make();
        p.setRowVisible('21-1', 'row-a', true);
        await flush(300);
        p.setRowVisible('21-1', 'row-a', false);
        await flush(5000);
        expect(calls).toEqual([]);
        p.destroy();
    });

    it('a second visible row of the same shard does not reload it; leaving one of two keeps it mounted', async () => {
        const p = make();
        p.setRowVisible('32-1', 'a', true);
        p.setRowVisible('32-1', 'b', true);
        await flush(500);
        p.setRowVisible('32-1', 'a', false);
        await flush(4000);
        expect(calls).toEqual(['32-1']);
        expect(p.getSnapshot().active).toContain('32-1');
        p.destroy();
    });

    it('re-mounting within nextRefreshAt reuses the data: no new request', async () => {
        const p = make();
        p.setRowVisible('32-1', 'a', true);
        await flush(500);
        p.setRowVisible('32-1', 'a', false);
        await flush(3500);
        p.setRowVisible('32-1', 'a', true);
        await flush(500);
        expect(calls).toEqual(['32-1']);
        p.destroy();
    });

    it('polls by nextRefreshAt plus the per-tab offset (0–25 s), never faster than 5 s', async () => {
        responses['top-1'] = () => ({ nextRefreshAt: Date.now() + 60_000 });
        const p = make();
        p.setFeatured(['top-1']);
        await flush(10);
        await flush(60_000);
        expect(calls).toEqual(['top-1']); // offset 12.5 s with random 0.5 → not yet
        await flush(13_000);
        expect(calls).toEqual(['top-1', 'top-1']);
        p.destroy();
    });

    it('a hidden tab makes no requests; on return overdue shards reload staggered by 300 ms', async () => {
        const p = make();
        p.setFeatured(['top-1', 'top-2']);
        await flush(10);
        calls.length = 0;
        hidden = true;
        p.pageVisibilityChanged();
        await flush(10 * 60_000);
        expect(calls).toEqual([]);
        hidden = false;
        p.pageVisibilityChanged();
        await flush(10);
        expect(calls).toHaveLength(1);
        await flush(300);
        expect(calls).toHaveLength(2);
        p.destroy();
    });

    it('does not start a new request while the page is hidden (visible rows arrive in the background)', async () => {
        hidden = true;
        const p = make();
        p.setFeatured(['top-1']);
        await flush(5000);
        expect(calls).toEqual([]);
        hidden = false;
        p.pageVisibilityChanged();
        await flush(10);
        expect(calls).toEqual(['top-1']);
        p.destroy();
    });

    it('a failing shard keeps its last good data, flags errors and retries 15 → 30 → 60 s', async () => {
        const p = make();
        p.setFeatured(['top-1']);
        await flush(10);
        responses['top-1'] = () => new Error('503');
        // run until the first failed poll (due ≈ 72 s after the first answer)
        for (let i = 0; i < 100 && p.getSnapshot().shards['top-1'].errors < 1; i++) await flush(1000);
        const failedAt = Date.now();
        let snap = p.getSnapshot();
        expect(snap.shards['top-1']).toMatchObject({ status: 'error', hasData: true, errors: 1 });
        expect(Object.keys(snap.summaries['top-1'])).toHaveLength(6); // last good kept
        const n = calls.length;
        await flush(14_000);
        expect(calls.length).toBe(n); // 15 s
        await flush(2_000);
        expect(calls.length).toBe(n + 1);
        expect(p.getSnapshot().shards['top-1'].errors).toBe(2);
        await flush(27_000);
        expect(calls.length).toBe(n + 1); // 30 s
        await flush(2_000);
        expect(calls.length).toBe(n + 2);
        expect(Date.now() - failedAt).toBeLessThan(50_000);
        // recovers
        responses['top-1'] = () => ({ nextRefreshAt: Date.now() + 60_000 });
        await flush(61_000);
        expect(p.getSnapshot().shards['top-1']).toMatchObject({ status: 'ok', errors: 0 });
        p.destroy();
    });

    it('a body with another version or without councils is an error', async () => {
        const bad = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ v: 2, councils: {} }) }));
        const p = make({ fetchImpl: bad });
        p.setFeatured(['top-1']);
        await flush(10);
        expect(p.getSnapshot().shards['top-1']).toMatchObject({ status: 'error', hasData: false });
        p.destroy();
    });

    it('a non-JSON response (HTML from a broken deploy) is an error', async () => {
        const html = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => { throw new Error('no'); } }));
        const p = make({ fetchImpl: html });
        p.setFeatured(['top-1']);
        await flush(10);
        expect(p.getSnapshot().shards['top-1'].status).toBe('error');
        p.destroy();
    });

    it('server stale flag is kept on the shard (orange line) while polling continues', async () => {
        responses['top-1'] = () => ({ nextRefreshAt: Date.now() + 30_000, stale: true });
        const p = make();
        p.setFeatured(['top-1']);
        await flush(10);
        expect(p.getSnapshot().shards['top-1']).toMatchObject({ status: 'ok', stale: true });
        p.destroy();
    });

    it('Moje obec pins its own shard: a featured one adds no request', async () => {
        const p = make();
        p.setFeatured(['top-1', 'top-2']);
        p.setMine('top-1');
        await flush(10);
        expect(calls.sort()).toEqual(['top-1', 'top-2']);
        p.setMine('52-1');
        await flush(10);
        expect(calls.sort()).toEqual(['52-1', 'top-1', 'top-2']);
        p.destroy();
    });

    it('"all" loads each region shard once with at most 4 in flight, then every 3 min — visible ones at their own pace', async () => {
        let inflight = 0;
        let peak = 0;
        const slow = vi.fn(async (url) => {
            inflight += 1;
            peak = Math.max(peak, inflight);
            const id = new URL(url, 'http://x').searchParams.get('s');
            calls.push(id);
            await new Promise((r) => setTimeout(r, 300));
            inflight -= 1;
            const shard = FIXTURE_SHARDS.find((s) => s.id === id);
            return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) }, json: async () => ({ v: 1, nextRefreshAt: Date.now() + 60_000, councils: Object.fromEntries(shard.zastups.map((z) => [z, sum({ z })])) }) };
        });
        const p = make({ fetchImpl: slow });
        const regionIds = FIXTURE_SHARDS.filter((s) => s.kind === 'region').map((s) => s.id);
        p.setAll(regionIds);
        await flush(3000);
        expect(calls.sort()).toEqual([...regionIds].sort());
        expect(peak).toBeLessThanOrEqual(4);
        const n = calls.length;
        await flush(100_000);
        expect(calls.length).toBe(n); // not at the 60 s pace
        await flush(100_000);
        expect(calls.length).toBeGreaterThan(n); // every ~3 min
        p.setAll(null);
        p.destroy();
    });

    it('subscribers are told about every change; unsubscribe stops it', async () => {
        const p = make();
        const seen = vi.fn();
        const off = p.subscribe(seen);
        p.setFeatured(['top-1']);
        await flush(10);
        expect(seen).toHaveBeenCalled();
        const count = seen.mock.calls.length;
        off();
        p.setFeatured(['top-1', 'top-2']);
        await flush(10);
        expect(seen.mock.calls.length).toBe(count);
        p.destroy();
    });

    it('disconnect stops all requests and connect resumes them (React StrictMode runs effects twice)', async () => {
        const p = make();
        p.connect();
        p.setFeatured(['top-1']);
        await flush(10);
        p.disconnect();
        calls.length = 0;
        await flush(10 * 60_000);
        expect(calls).toEqual([]);
        p.connect();
        await flush(10);
        expect(calls).toEqual(['top-1']);
        p.destroy();
    });

    it('derives the client clock skew from x-server-now', async () => {
        serverNow = () => Date.now() + 90_000;
        const p = make();
        p.setFeatured(['top-1']);
        await flush(10);
        expect(Math.round(p.getSnapshot().skew / 1000)).toBe(90);
        p.destroy();
    });
});
