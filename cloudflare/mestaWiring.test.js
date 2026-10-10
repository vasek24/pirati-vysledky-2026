import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMestaWiring, fnv1a8, MESTA_USER_AGENT } from './mestaWiring.js';
import results from '../src/volby/__fixtures__/results.json';
import turnoutNext from '../src/volby/__fixtures__/turnout-next.json';

const T0 = Date.parse('2026-10-10T16:00:00+02:00');

// Inline fixture councils (frozen contract, plan "Shared contracts")
const town = (over) => ({
    seats: 15, precincts: 5, pirateCandidates: [], shown: true, map: false, precinctFiles: false, featured: null, ...over,
});
const plzen = town({ slug: 'plzen', name: 'Plzeň', zastup: 554791, okres: 3203, kraj: 3200, shard: '32-1', featured: 'top-1', population: 187863, pirates: 11 });
const hradec = town({ slug: 'hradec-kralove', name: 'Hradec Králové', zastup: 569810, okres: 5201, kraj: 5200, shard: '52-1', featured: 'top-1', population: 90000, pirates: 4 });
const jablonec = town({ slug: 'jablonec-nad-nisou', name: 'Jablonec nad Nisou', zastup: 563510, okres: 5102, kraj: 5100, shard: '51-1', population: 44000, pirates: 4 });
const hidden = town({ slug: 'skryte', name: 'Skryté', zastup: 999001, okres: 5102, kraj: 5100, shard: '51-1', population: 8000, pirates: null, shown: false });
const COUNCILS = [plzen, hradec, jablonec, hidden];
const SHARDS = [
    { id: '32-1', kind: 'region', kraj: 3200, name: 'Plzeňský kraj', zastups: [554791] },
    { id: '51-1', kind: 'region', kraj: 5100, name: 'Liberecký kraj', zastups: [563510, 999001] },
    { id: '52-1', kind: 'region', kraj: 5200, name: 'Královéhradecký kraj', zastups: [569810] },
    { id: 'top-1', kind: 'featured', kraj: null, name: 'Největší města', zastups: [554791, 569810] },
];

const wiring = () => createMestaWiring({ councils: COUNCILS, shards: SHARDS });
const route = (path, method = 'GET') => wiring().route(new URL(path, 'https://mesta.test'), method);

describe('fnv1a8', () => {
    it('matches the FNV-1a 32-bit reference vectors, always 8 hex', () => {
        expect(fnv1a8('')).toBe('811c9dc5');
        expect(fnv1a8('a')).toBe('e40c292c');
        expect(fnv1a8('foobar')).toBe('bf9cf968');
        expect(fnv1a8('554791,569810')).toMatch(/^[0-9a-f]{8}$/);
    });
});

describe('route', () => {
    it('town api: normalized key and path, extra params ignored', () => {
        expect(route('/api/volby?z=554791&x=1')).toEqual({ kind: 'api', key: '554791', path: '/api/volby?z=554791' });
        expect(route('/api/volby?x=1&z=554791')).toEqual(route('/api/volby?z=554791'));
        expect(route('/api/volby?z=0554791').key).toBe('554791');
    });
    it('hidden (published but not shown) towns are served', () => {
        expect(route('/api/volby?z=999001').kind).toBe('api');
    });
    it('unknown or missing council: 400 unknown-council', () => {
        for (const p of ['/api/volby?z=1', '/api/volby', '/api/volby?z=abc', '/api/volby?z=554791x', '/api/volby?z=500119']) {
            const out = route(p);
            expect(out).toMatchObject({ kind: 'bad', status: 400 });
            expect(JSON.parse(out.body)).toEqual({ error: 'unknown-council' });
        }
    });
    it('shard api: key kraj-<id>, normalized path', () => {
        expect(route('/api/kraj?s=32-1&x=1')).toEqual({ kind: 'api', key: 'kraj-32-1', path: '/api/kraj?s=32-1' });
        expect(route('/api/kraj?s=top-1')).toEqual({ kind: 'api', key: 'kraj-top-1', path: '/api/kraj?s=top-1' });
    });
    it('unknown shard: 400 unknown-shard', () => {
        for (const p of ['/api/kraj?s=99-9', '/api/kraj?s=../x', '/api/kraj', '/api/kraj?s=top-9', '/api/kraj?s=32-1/..']) {
            const out = route(p);
            expect(out).toMatchObject({ kind: 'bad', status: 400 });
            expect(JSON.parse(out.body)).toEqual({ error: 'unknown-shard' });
        }
    });
    it('other /api/* is a 404 JSON', () => {
        for (const p of ['/api/other', '/api/prehled', '/api/bug', '/api/volby/', '/api']) {
            const out = route(p);
            expect(out).toMatchObject({ kind: 'bad', status: 404 });
            expect(JSON.parse(out.body)).toEqual({ error: 'not-found' });
        }
    });
    it('non GET/HEAD: 405, HEAD is treated like GET', () => {
        expect(route('/api/volby?z=554791', 'POST')).toMatchObject({ kind: 'bad', status: 405 });
        expect(route('/api/kraj?s=32-1', 'PUT')).toMatchObject({ kind: 'bad', status: 405 });
        expect(route('/brno', 'POST')).toMatchObject({ kind: 'bad', status: 405 });
        expect(route('/api/volby?z=554791', 'HEAD')).toEqual(route('/api/volby?z=554791', 'GET'));
        expect(route('/brno', 'HEAD')).toEqual({ kind: 'app' });
    });
    it('app paths render the index; anything else is not found', () => {
        for (const p of ['/', '/brno', '/brno/', '/neexistuje', '/plzen']) expect(route(p)).toEqual({ kind: 'app' });
        for (const p of ['/a/b', '/x.js', '/Brno', '/hlaseni/x', '/api/../x.js']) expect(route(p)).toEqual({ kind: 'notfound' });
    });
});

describe('feedTarget / feedKind / isFirstClass / firstClassKeys', () => {
    it('town target', () => {
        expect(wiring().feedTarget('554791')).toEqual({ name: 'volby', path: '/api/volby?z=554791', doName: 'volby?z=554791' });
        expect(wiring().feedTarget(554791).doName).toBe('volby?z=554791');
    });
    it('shard target: DO name carries a hash of the sorted member list', () => {
        const t = wiring().feedTarget('kraj-51-1');
        expect(t).toMatchObject({ name: 'kraj', path: '/api/kraj?s=51-1' });
        expect(t.doName).toBe(`kraj?s=51-1-${fnv1a8('563510,999001')}`);
        // pořadí členů ve vstupu na jméno nemá vliv
        const reversed = createMestaWiring({
            councils: COUNCILS,
            shards: SHARDS.map((s) => (s.id === '51-1' ? { ...s, zastups: [999001, 563510] } : s)),
        });
        expect(reversed.feedTarget('kraj-51-1').doName).toBe(t.doName);
    });
    it('H2a: a changed member list starts a fresh DO name', () => {
        const before = wiring().feedTarget('kraj-51-1').doName;
        const after = createMestaWiring({
            councils: COUNCILS,
            shards: SHARDS.map((s) => (s.id === '51-1' ? { ...s, zastups: [563510] } : s)),
        }).feedTarget('kraj-51-1').doName;
        expect(after).not.toBe(before);
        expect(after.startsWith('kraj?s=51-1-')).toBe(true);
    });
    it('unknown keys throw; a shard naming an unknown town fails at creation', () => {
        expect(() => wiring().feedTarget('1')).toThrow(/unknown mesta feed key/);
        expect(() => wiring().feedTarget('kraj-99-9')).toThrow(/unknown mesta feed key/);
        expect(() => createMestaWiring({ councils: COUNCILS, shards: [{ id: '32-1', kind: 'region', zastups: [1] }] })).toThrow(/unknown zastup 1/);
    });
    it('feedKind: overview for shards, council for towns', () => {
        expect(wiring().feedKind('kraj-32-1')).toBe('overview');
        expect(wiring().feedKind('554791')).toBe('council');
    });
    it('firstClassKeys = all shard keys + the featured towns; isFirstClass agrees', () => {
        const many = Array.from({ length: 14 }, (_, i) => town({
            slug: `t${i}`, zastup: 600000 + i, okres: 1100, kraj: 1000, shard: '10-1', population: 20000 - i, featured: i < 12 ? (i < 6 ? 'top-1' : 'top-2') : null,
        }));
        const shards = [
            { id: '10-1', kind: 'region', kraj: 1000, zastups: many.map((c) => c.zastup) },
            { id: 'top-1', kind: 'featured', kraj: null, zastups: many.slice(0, 6).map((c) => c.zastup) },
            { id: 'top-2', kind: 'featured', kraj: null, zastups: many.slice(6, 12).map((c) => c.zastup) },
        ];
        const w = createMestaWiring({ councils: many, shards });
        expect(w.firstClassKeys).toEqual([
            'kraj-10-1', 'kraj-top-1', 'kraj-top-2',
            ...many.slice(0, 12).map((c) => String(c.zastup)),
        ]);
        expect(w.firstClassKeys).toHaveLength(15);
        expect(w.isFirstClass('kraj-top-2')).toBe(true);
        expect(w.isFirstClass(600011)).toBe(true);
        expect(w.isFirstClass('600012')).toBe(false);
        expect(w.isFirstClass('prehled')).toBe(false);
    });
});

// Falešný volby.gov.cz: path -> JSON tělo (nebo číslo = HTTP status)
function fakeCsu(files) {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
        const path = String(url).replace(/^https?:\/\/[^/]+\/(?:base\/)?(?:appdata\/kv2026\/\d+\/)?/, '');
        calls.push({ url: String(url), path, init });
        const f = files[path];
        if (f === undefined) return new Response('{}', { status: 404 });
        if (typeof f === 'number') return new Response('{}', { status: f });
        return new Response(JSON.stringify(f), { status: 200, headers: { etag: `"${path}"` } });
    };
    return { fetchImpl, calls };
}

const withParties = (generated = '2026-10-10T15:00:00') => ({ ...results, generovano: generated });
const emptyParties = { ...results, vysledky: [] };

describe('buildFeed: town', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
    });
    afterEach(() => vi.useRealTimers());

    it('fetches only the two summary files for a town without a map, sends the mesta User-Agent', async () => {
        const { fetchImpl, calls } = fakeCsu({
            'vysled/3203/554791.json': withParties(),
            'ucast/obec/3203/554791.json': turnoutNext,
        });
        const snap = await wiring().buildFeed('554791', {}, { fetchImpl }).build();
        expect(snap.zastup).toBe(554791);
        expect(calls.map((c) => c.path).sort()).toEqual(['ucast/obec/3203/554791.json', 'vysled/3203/554791.json']);
        expect(calls.every((c) => c.url.startsWith('https://volby.gov.cz/appdata/kv2026/'))).toBe(true);
        for (const c of calls) expect(c.init.headers['User-Agent']).toBe(MESTA_USER_AGENT);
        expect(MESTA_USER_AGENT).toBe('pirati-mesta/1.0 (+https://mesta.dg12.cz/kontakt.txt)');
    });
    // okrskový soubor ČSÚ: vysledky = [kandidátka, název, hlasy], součet hlasů musí sedět s řádkem účasti
    const precinctFile = (a, b) => ({ generovano: '2026-10-10T15:01:00', prehled: [], vysledky: [[1, 'A', a], [2, 'B', b]] });
    const MAP_FILES = {
        'vysled/3203/554791.json': withParties(),
        'ucast/obec/3203/554791.json': turnoutNext,
        'vysled/okrsek/3203/554791_1.json': precinctFile(600, 400),
        'vysled/okrsek/3203/554791_2.json': precinctFile(250, 750),
        'vysled/okrsek/3203/554791_3.json': precinctFile(500, 300),
    };
    it('a town with precinctFiles (map set) fetches the precinct files of the counted precincts only, with the mesta User-Agent', async () => {
        const { fetchImpl, calls } = fakeCsu(MAP_FILES);
        const w = createMestaWiring({ councils: [{ ...plzen, map: true, precinctFiles: true }], shards: [] });
        const snap = await w.buildFeed('554791', {}, { fetchImpl }).build();
        expect(calls.map((c) => c.path).filter((p) => p.startsWith('vysled/okrsek/')).sort()).toEqual([
            'vysled/okrsek/3203/554791_1.json', 'vysled/okrsek/3203/554791_2.json', 'vysled/okrsek/3203/554791_3.json',
        ]); // okrsek 4 (voličů 0) není sečtený → žádný soubor
        for (const c of calls) expect(c.init.headers['User-Agent']).toBe(MESTA_USER_AGENT);
        expect(Object.keys(snap.okrsky).sort()).toEqual(['1', '2', '3']);
        expect(snap.okrsky[1].votes).toEqual({ 1: 600, 2: 400 });
        expect(snap.okrsky[3].votes).toEqual({ 1: 500, 2: 300 });
    });
    it('precinct files go through a limiter of 3 (12 durable objects x 3 = at most 36 concurrent requests to ČSÚ)', async () => {
        let active = 0;
        let peak = 0;
        const many = {};
        const rows = [];
        for (let i = 1; i <= 30; i++) {
            rows.push([i, 500, 300, 60, 0, 300, 295, 98, 1000, '1']);
            many[`vysled/okrsek/3203/554791_${i}.json`] = precinctFile(600, 400);
        }
        const files = { 'vysled/3203/554791.json': withParties(), 'ucast/obec/3203/554791.json': { generovano: '2026-10-10T15:01:00', okrsky: rows }, ...many };
        const inner = fakeCsu(files).fetchImpl;
        const fetchImpl = async (url, init) => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 10));
            active--;
            return inner(url, init);
        };
        const w = createMestaWiring({ councils: [{ ...plzen, map: true, precinctFiles: true }], shards: [] });
        const p = w.buildFeed('554791', {}, { fetchImpl }).build();
        await vi.advanceTimersByTimeAsync(2000);
        await p;
        expect(peak).toBe(3);
    });
    it('a town without precinctFiles (no map) still fetches only the two summary files', async () => {
        const { fetchImpl, calls } = fakeCsu(MAP_FILES);
        await wiring().buildFeed('554791', {}, { fetchImpl }).build(); // plzen: map false, precinctFiles false
        expect(calls.some((c) => c.path.startsWith('vysled/okrsek/'))).toBe(false);
        expect(calls).toHaveLength(2);
    });
    it('uses CSU_BASE from env only', async () => {
        const { fetchImpl, calls } = fakeCsu({});
        await wiring().buildFeed('554791', { CSU_BASE: 'http://mock.test/base' }, { fetchImpl }).build().catch(() => {});
        expect(calls[0].url.startsWith('http://mock.test/base/')).toBe(true);
    });
    it('a second build within 20 s makes no fetches', async () => {
        const { fetchImpl, calls } = fakeCsu({
            'vysled/3203/554791.json': withParties(),
            'ucast/obec/3203/554791.json': turnoutNext,
        });
        const feed = wiring().buildFeed('554791', {}, { fetchImpl });
        await feed.build();
        expect(calls).toHaveLength(2);
        vi.setSystemTime(T0 + 15_000);
        await feed.build();
        expect(calls).toHaveLength(2);
        vi.setSystemTime(T0 + 25_000);
        await feed.build();
        expect(calls).toHaveLength(4);
    });
    it('throws for an unknown key', () => {
        expect(() => wiring().buildFeed('1', {})).toThrow(/unknown mesta feed key/);
    });
});

describe('buildFeed: shard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
    });
    afterEach(() => vi.useRealTimers());

    const SHARD_FILES = () => ({
        'vysled/5102/563510.json': withParties(),
        'vysled/5102/999001.json': withParties('2026-10-10T15:01:00'),
    });

    it('fetches exactly the shard towns results files with the mesta UA', async () => {
        const { fetchImpl, calls } = fakeCsu(SHARD_FILES());
        const snap = await wiring().buildFeed('kraj-51-1', {}, { fetchImpl }).build();
        expect(calls.map((c) => c.path).sort()).toEqual(['vysled/5102/563510.json', 'vysled/5102/999001.json']);
        for (const c of calls) expect(c.init.headers['User-Agent']).toBe(MESTA_USER_AGENT);
        expect(Object.keys(snap.councils).sort()).toEqual(['563510', '999001']);
        expect(snap.missing).toBe(0);
    });
    it('M4: a town with empty vysledky is dropped, counted in missing, the build does not throw', async () => {
        const files = { ...SHARD_FILES(), 'vysled/5102/999001.json': emptyParties };
        const { fetchImpl } = fakeCsu(files);
        const snap = await wiring().buildFeed('kraj-51-1', {}, { fetchImpl }).build();
        expect(Object.keys(snap.councils)).toEqual(['563510']);
        expect(snap.missing).toBe(1);
        expect(snap.official).toBe(false);
        expect(snap.generated).toBe('2026-10-10T15:00:00');
    });
    it('M4: a town with counted > total is dropped as well', async () => {
        const broken = { ...results, prehled: [5, 1, 4, 9, 50, 1000, 600, 60, 0, 600, 590, 98, 2000] };
        const files = { ...SHARD_FILES(), 'vysled/5102/563510.json': broken };
        const { fetchImpl } = fakeCsu(files);
        const snap = await wiring().buildFeed('kraj-51-1', {}, { fetchImpl }).build();
        expect(Object.keys(snap.councils)).toEqual(['999001']);
        expect(snap.missing).toBe(1);
    });
    it('M4: throws only when no town remains', async () => {
        const { fetchImpl } = fakeCsu({ 'vysled/5102/563510.json': emptyParties, 'vysled/5102/999001.json': emptyParties });
        await expect(wiring().buildFeed('kraj-51-1', {}, { fetchImpl }).build()).rejects.toThrow();
    });
    it('keeps a town whose file fails fetching in missing (inner behaviour passed through)', async () => {
        const { fetchImpl } = fakeCsu({ 'vysled/5102/563510.json': withParties(), 'vysled/5102/999001.json': 500 });
        const snap = await wiring().buildFeed('kraj-51-1', {}, { fetchImpl }).build();
        expect(Object.keys(snap.councils)).toEqual(['563510']);
        expect(snap.missing).toBe(1);
    });
    it('exposes snapshot and invalidate (passed through)', () => {
        const feed = wiring().buildFeed('kraj-51-1', {});
        expect(typeof feed.snapshot).toBe('function');
        expect(typeof feed.invalidate).toBe('function');
    });
    it('a second build within 20 s makes no fetches', async () => {
        const { fetchImpl, calls } = fakeCsu(SHARD_FILES());
        const feed = wiring().buildFeed('kraj-51-1', {}, { fetchImpl });
        await feed.build();
        vi.setSystemTime(T0 + 10_000);
        await feed.build();
        expect(calls).toHaveLength(2);
    });
});
