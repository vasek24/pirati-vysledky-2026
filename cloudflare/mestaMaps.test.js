// Mapa okrsků ve Workeru měst (T10): co se stane, když Durable Object startuje (nebo se vyhodí
// z paměti) UPROSTŘED sčítání velkého města — Brno 353 okrsků, ~210 už sečtených, okrskový soubor
// ČSÚ ~0,4 s na stažení, souběžnost 6. Skutečný feed (mestaWiring.buildFeed) + skutečný refresher
// nad falešným ČSÚ z tools/lib/fakeCsu.mjs (skutečná čísla okrsků a kandidátek Brna).
// Běží s TZ=UTC jako Worker (`npm test`).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCouncils } from '../src/mesta/buildCouncils.js';
import { buildFakeCsu } from '../tools/lib/fakeCsu.mjs';
import { phaseOfSnapshot } from './feedWiring.js';
import { createMestaWiring } from './mestaWiring.js';
import { REFRESH, createRefresher } from './refresh.js';

const json = (rel) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const councils = buildCouncils(json('src/mesta/towns.generated.json'), json('src/mesta/specifics.generated.json'), { reviewedAt: null, towns: {} });
const brno = councils.find((c) => c.slug === 'brno');
const input = { council: brno, lists: json('public-mesta/data/brno/lists.json'), geo: json('public-mesta/data/brno/okrsky.geojson') };
const wiring = createMestaWiring({ councils, shards: [] });

const T0 = Date.parse('2026-10-10T16:45:00+02:00');
const PRECINCT_MS = 400;

// falešný ČSÚ s latencí okrskových souborů; `down` = okrskové soubory vrací 500
function csuFetch(files, { down = () => false, latency = PRECINCT_MS } = {}) {
    const calls = { precinct: 0, summary: 0 };
    const fetchImpl = async (url) => {
        const path = String(url).replace(/^https?:\/\/[^/]+\/(?:appdata\/kv2026\/\d+\/)?/, '');
        const isPrecinct = path.startsWith('vysled/okrsek/');
        if (isPrecinct) {
            calls.precinct++;
            if (latency) await new Promise((r) => setTimeout(r, latency));
            if (down()) return new Response('{}', { status: 500 });
        } else calls.summary++;
        const f = files[path];
        return f === undefined ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(f), { status: 200, headers: { etag: `"${path}"` } });
    };
    return { fetchImpl, calls };
}

function memStorage() {
    const data = new Map();
    return { data, get: async (k) => data.get(k), put: async (o) => { for (const [k, v] of Object.entries(o)) data.set(k, v); } };
}

// DO: nový feed + nový refresher nad stejným úložištěm (= vyhození z paměti a studený start)
function startDo(storage, fetchImpl) {
    const log = vi.fn();
    const refresher = createRefresher({
        now: Date.now, random: () => 0.5, storage, log, base: 'https://csu.test', kind: 'council', firstClass: true,
        phaseOf: phaseOfSnapshot, feed: wiring.buildFeed(String(brno.zastup), {}, { fetchImpl }),
    });
    return { refresher, log };
}

const parse = (res) => JSON.parse(res.body);
const withVotes = (s) => Object.values(s.okrsky).filter((o) => o.votes).length;

describe('Brno-size cold start mid-count (210 counted precincts, 6 concurrent, 0.4 s each)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
    });
    afterEach(() => vi.useRealTimers());

    const fixture = () => buildFakeCsu(input, { counted: 0.6, seed: 5 });

    it('cold get() answers after the 3 s precinct wait (not 35 s, not the 12 s deadline) with votes for part of the precincts and null — never zeros — for the rest', async () => {
        const { files, stats } = fixture();
        const { fetchImpl } = csuFetch(files);
        const { refresher } = startDo(memStorage(), fetchImpl);
        const started = Date.now();
        const p = refresher.get();
        await vi.advanceTimersByTimeAsync(3100);
        const res = await p;
        expect(Date.now() - started).toBeLessThan(REFRESH.DEADLINE_MS);
        expect(res.status).toBe(200);
        const s = parse(res);
        expect(res.meta.complete).toBe(true);
        expect(s.precincts).toMatchObject({ total: 353, counted: stats.counted });
        expect(Object.keys(s.okrsky)).toHaveLength(stats.counted); // všechny sečtené okrsky jsou v odpovědi
        const n = withVotes(s);
        expect(n).toBeGreaterThan(20);
        expect(n).toBeLessThan(stats.counted); // ← neúplné hlasy po okrscích …
        for (const o of Object.values(s.okrsky)) {
            // … ale nikdy vymyšlené nuly: buď skutečné hlasy (součet = platné hlasy okrsku), nebo null
            if (o.votes) expect(Object.values(o.votes).reduce((a, b) => a + b, 0)).toBe(o.validVotes);
            else expect(o.votes).toBeNull();
        }
        // souhrn za město (strany, mandáty) je úplný bez ohledu na okrsky
        expect(s.parties.reduce((a, b) => a + b.votes, 0)).toBeGreaterThan(0);
    });

    it('stale-while-refresh: later requests are answered at once with the last good snapshot while a refresh runs in the background; the background top-up (~14 s) completes before the next refresh, so all precincts have votes after one more cycle', async () => {
        const { files, stats } = fixture();
        const { fetchImpl, calls } = csuFetch(files);
        const { refresher } = startDo(memStorage(), fetchImpl);
        let p = refresher.get();
        await vi.advanceTimersByTimeAsync(3100);
        let s = parse(await p);
        const seen = [withVotes(s)];
        const totals = s.parties.map((x) => x.votes).join();
        for (let i = 0; i < 12 && withVotes(s) < stats.counted; i++) {
            await vi.advanceTimersByTimeAsync(REFRESH.FLOOR_MS + 1000); // refresh je splatný
            const t = Date.now();
            p = refresher.get();
            const res = await p; // vrací okamžitě (good), refresh běží na pozadí
            expect(Date.now() - t).toBe(0);
            expect(res.meta.refreshing).toBe(true);
            await vi.advanceTimersByTimeAsync(3100); // build doběhne (čeká max 3 s na okrskové soubory, zbytek dotahuje na pozadí)
            await vi.advanceTimersByTimeAsync(REFRESH.FLOOR_MS);
            s = parse(await refresher.get());
            seen.push(withVotes(s));
            expect(s.parties.map((x) => x.votes).join()).toBe(totals); // souhrn se kvůli okrskům nemění
        }
        expect(seen[seen.length - 1]).toBe(stats.counted);
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
        expect(seen[0]).toBeLessThan(stats.counted); // první publikace je neúplná …
        expect(seen.length).toBeLessThanOrEqual(3); // … a do dvou dalších obnov (≤ 2 × 20 s) je úplná
        // každý okrskový soubor se stáhl jednou (žádné opakování pro okrsky, které už mají hlasy)
        expect(calls.precinct).toBe(stats.counted);
    });

    it('DO evicted mid-count: the new instance serves the persisted snapshot at once and never loses precinct votes it had', async () => {
        const { files, stats } = fixture();
        const storage = memStorage();
        const a = csuFetch(files);
        const first = startDo(storage, a.fetchImpl);
        const p = first.refresher.get();
        await vi.advanceTimersByTimeAsync(3100);
        const before = parse(await p);
        const n0 = withVotes(before);
        await vi.advanceTimersByTimeAsync(REFRESH.FLOOR_MS + 1000);

        // nová instance: prázdná paměť feedu, v úložišti poslední publikovaný snapshot
        const b = csuFetch(files);
        const second = startDo(storage, b.fetchImpl);
        const t = Date.now();
        const res = await second.refresher.get();
        expect(Date.now() - t).toBe(0); // stale-while-refresh: žádné čekání na studený build
        expect(withVotes(parse(res))).toBe(n0);
        await vi.advanceTimersByTimeAsync(3100);
        await vi.advanceTimersByTimeAsync(REFRESH.FLOOR_MS);
        const after = parse(await second.refresher.get());
        // sjednocení: okrsky z úložiště + nově stažené, nikdy méně
        expect(withVotes(after)).toBeGreaterThanOrEqual(n0);
        for (const [id, o] of Object.entries(before.okrsky)) {
            if (o.votes) expect(after.okrsky[id].votes, `okrsek ${id}`).toEqual(o.votes);
        }
        expect(stats.counted).toBeGreaterThan(n0);
        // cena vyhození z paměti: feed si hlasy z úložiště nepřebírá, nová instance stahuje okrskové
        // soubory VŠECH sečtených okrsků znovu (zázemí jen do výše, kterou stihne za obnovu) — viz docs/analysis/mesta-maps-load.md
        console.log(`eviction: first instance fetched ${a.calls.precinct} precinct files, the new one ${b.calls.precinct} (counted ${stats.counted})`);
        expect(b.calls.precinct).toBe(stats.counted);
    });

    it('ČSÚ precinct files down (500): summary and counted precincts are still published (votes null), no zero votes, and the page recovers when they return', async () => {
        const { files, stats } = fixture();
        let down = true;
        const { fetchImpl } = csuFetch(files, { down: () => down });
        const { refresher } = startDo(memStorage(), fetchImpl);
        let p = refresher.get();
        await vi.advanceTimersByTimeAsync(3100);
        let s = parse(await p);
        expect(s.precincts.counted).toBe(stats.counted);
        expect(withVotes(s)).toBe(0);
        expect(Object.values(s.okrsky).every((o) => o.votes === null && o.voters > 0)).toBe(true);
        down = false;
        for (let i = 0; i < 12 && withVotes(s) < stats.counted; i++) {
            await vi.advanceTimersByTimeAsync(REFRESH.FLOOR_MS + 1000);
            p = refresher.get();
            await p;
            await vi.advanceTimersByTimeAsync(5000);
            await vi.advanceTimersByTimeAsync(REFRESH.FLOOR_MS);
            s = parse(await refresher.get());
        }
        expect(withVotes(s)).toBe(stats.counted);
    });
});

describe('snapshot size for the biggest map towns (1.5 MB guard)', () => {
    it('Brno, all 353 precincts counted with votes, is far below the persistence guard', async () => {
        const { files } = buildFakeCsu(input, { counted: 1, seed: 2 });
        const { fetchImpl } = csuFetch(files, { latency: 0 });
        const feed = wiring.buildFeed(String(brno.zastup), {}, { fetchImpl, precinctWaitMs: 60_000 });
        const snap = await feed.build();
        expect(Object.values(snap.okrsky).filter((o) => o.votes)).toHaveLength(353);
        const bytes = new TextEncoder().encode(JSON.stringify(snap)).length;
        console.log(`Brno 353/353 precincts: snapshot ${bytes} bytes (guard ${REFRESH.MAX_BYTES})`);
        expect(bytes).toBeLessThan(REFRESH.MAX_BYTES / 5);
    });
});
