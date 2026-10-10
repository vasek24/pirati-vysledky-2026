import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAST_RESORT_TTL, cacheControlFor, edgeTtl, lastResortRequest, markStale, withTimeout } from './edge.js';

const NOW = 1_000_000;
const ttl = (secondsAhead, extra = {}) => edgeTtl({ nextRefreshAt: NOW + secondsAhead * 1000, now: NOW, stale: false, phase: 'counting', ...extra });

describe('edgeTtl (H2, M1)', () => {
    it('past nextRefreshAt -> floor of 1 s, never 0', () => {
        expect(ttl(-30)).toBe(1);
        expect(ttl(0)).toBe(1);
    });
    it('rounds up and follows nextRefreshAt', () => {
        expect(ttl(3)).toBe(3);
        expect(edgeTtl({ nextRefreshAt: NOW + 2100, now: NOW, stale: false, phase: 'counting' })).toBe(3);
    });
    it('counting is capped at 5 s', () => {
        expect(ttl(40)).toBe(5);
        expect(ttl(40, { phase: 'waiting' })).toBe(5);
    });
    it('stale is capped at 5 s even in final/idle', () => {
        expect(ttl(40, { stale: true })).toBe(5);
        expect(ttl(400, { stale: true, phase: 'final' })).toBe(5);
        expect(ttl(1000, { stale: true, phase: 'idle' })).toBe(5);
    });
    it('final up to 600 s, idle up to 300 s', () => {
        expect(ttl(400, { phase: 'final' })).toBe(400);
        expect(ttl(900, { phase: 'final' })).toBe(600);
        expect(ttl(1000, { phase: 'idle' })).toBe(300);
        expect(ttl(120, { phase: 'idle' })).toBe(120);
    });
    it('idle past nextRefreshAt still floors at 1 s', () => {
        expect(ttl(-5, { phase: 'idle' })).toBe(1);
        expect(ttl(0, { phase: 'idle' })).toBe(1);
    });
    it('unknown phase falls back to the 5 s cap', () => {
        expect(ttl(100, { phase: undefined })).toBe(5);
    });
    it('NaN / missing nextRefreshAt or now falls back to the 1 s floor', () => {
        expect(edgeTtl({ nextRefreshAt: NaN, now: NOW, stale: false, phase: 'idle' })).toBe(1);
        expect(edgeTtl({ nextRefreshAt: NaN, now: NOW, stale: false, phase: 'final' })).toBe(1);
        expect(edgeTtl({ nextRefreshAt: undefined, now: NOW, stale: false, phase: 'final' })).toBe(1);
        expect(edgeTtl({ nextRefreshAt: NOW, now: NaN, stale: false, phase: 'final' })).toBe(1);
    });
    it('always an integer', () => {
        expect(Number.isInteger(edgeTtl({ nextRefreshAt: NOW + 3333, now: NOW, stale: false, phase: 'counting' }))).toBe(true);
    });
});

describe('cacheControlFor', () => {
    it('has max-age=0 and s-maxage only (no swr / stale-if-error)', () => {
        expect(cacheControlFor(7)).toBe('public, max-age=0, s-maxage=7');
    });
});

describe('markStale', () => {
    const body = (stale) => `{"refreshedAt":1,"nextRefreshAt":2,"servedAt":3,"stale":${stale},"phase":"idle","v":1,"obvody":[],"x":{"stale":false}}`;
    it('flips the first "stale":false in the spliced header and changes nothing else', () => {
        const out = markStale(body(false));
        expect(out).toBe(body(true));
        expect(JSON.parse(out).x.stale).toBe(false);
    });
    it('leaves an already-stale body unchanged', () => {
        expect(markStale(body(true))).toBe(body(true));
    });
    it('flips "stale":false when it follows meta fields incl. phase (within 300 chars)', () => {
        const meta = '{"refreshedAt":1760000000000,"nextRefreshAt":1760000060000,"servedAt":1760000001000,"phase":"counting","stale":false,"v":1,';
        const full = `${meta}"obvody":[{"n":1,"stale":false}]}`;
        expect(full.indexOf('"stale":')).toBeLessThan(300);
        const out = markStale(full);
        expect(out).toBe(full.replace('"stale":false,"v"', '"stale":true,"v"'));
        expect(JSON.parse(out).obvody[0].stale).toBe(false);
    });
    it('does not touch a "stale":false that is past the header window', () => {
        const long = `{"pad":"${'a'.repeat(400)}","stale":false}`;
        expect(markStale(long)).toBe(long);
    });
    it('returns non-matching input as is', () => {
        expect(markStale('{"error":"unavailable"}')).toBe('{"error":"unavailable"}');
        expect(markStale('')).toBe('');
    });
});

describe('lastResortRequest (C2)', () => {
    it('uses a distinct path (not a fragment) and keeps the query', () => {
        const main = new Request('https://volby.example/api/senat?x=1');
        const lr = lastResortRequest(main.url);
        expect(new URL(lr.url).pathname).toBe('/__lastresort/api/senat');
        expect(new URL(lr.url).search).toBe('?x=1');
        expect(lr.url).not.toBe(main.url);
        expect(lr.url.split('#')[0]).not.toBe(main.url);
    });
    it('maps /api/senat to /__lastresort/api/senat and differs per query', () => {
        const a = lastResortRequest('https://h.example/api/senat').url;
        const b = lastResortRequest('https://h.example/api/senat?x=2').url;
        expect(a).toBe('https://h.example/__lastresort/api/senat');
        expect(new Set([a, b]).size).toBe(2);
    });
    it('LAST_RESORT_TTL (1200 s) outlives the largest edge cap (600 s, final)', () => {
        expect(LAST_RESORT_TTL).toBe(1200);
        expect(LAST_RESORT_TTL).toBeGreaterThan(edgeTtl({ nextRefreshAt: Infinity, now: 0, stale: false, phase: 'final' }));
    });
});

describe('withTimeout', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('resolves with the value and clears the timer', async () => {
        const p = withTimeout(Promise.resolve('ok'), 13000);
        await expect(p).resolves.toBe('ok');
        expect(vi.getTimerCount()).toBe(0);
    });
    it('passes a rejection through and clears the timer', async () => {
        const p = withTimeout(Promise.reject(new Error('boom')), 13000);
        await expect(p).rejects.toThrow('boom');
        expect(vi.getTimerCount()).toBe(0);
    });
    it('rejects with a timeout error when the promise hangs', async () => {
        const p = withTimeout(new Promise(() => {}), 13000);
        const assertion = expect(p).rejects.toThrow(/timeout/);
        await vi.advanceTimersByTimeAsync(12999);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(2);
        await assertion;
        expect(vi.getTimerCount()).toBe(0);
    });
    it('a late result after the timeout is ignored (no unhandled rejection)', async () => {
        let reject;
        const p = withTimeout(new Promise((_, r) => { reject = r; }), 100);
        const assertion = expect(p).rejects.toThrow(/timeout/);
        await vi.advanceTimersByTimeAsync(101);
        await assertion;
        reject(new Error('late'));
        await vi.advanceTimersByTimeAsync(0);
    });
});
