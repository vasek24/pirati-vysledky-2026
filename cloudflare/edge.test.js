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
    it('stale is capped at 5 s even in final/pre', () => {
        expect(ttl(40, { stale: true })).toBe(5);
        expect(ttl(400, { stale: true, phase: 'final' })).toBe(5);
        expect(ttl(1000, { stale: true, phase: 'pre' })).toBe(5);
    });
    it('final up to 600 s, pre up to 300 s', () => {
        expect(ttl(400, { phase: 'final' })).toBe(400);
        expect(ttl(900, { phase: 'final' })).toBe(600);
        expect(ttl(1000, { phase: 'pre' })).toBe(300);
        expect(ttl(120, { phase: 'pre' })).toBe(120);
    });
    it('unknown phase falls back to the 5 s cap', () => {
        expect(ttl(100, { phase: undefined })).toBe(5);
    });
    it('NaN / missing nextRefreshAt or now falls back to the 1 s floor', () => {
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
    const body = (stale) => `{"refreshedAt":1,"nextRefreshAt":2,"servedAt":3,"stale":${stale},"complete":true,"refreshing":false,"parties":[],"x":{"stale":false}}`;
    it('flips the first "stale":false in the spliced header and changes nothing else', () => {
        const out = markStale(body(false));
        expect(out).toBe(body(true));
        expect(JSON.parse(out).x.stale).toBe(false);
    });
    it('leaves an already-stale body unchanged', () => {
        expect(markStale(body(true))).toBe(body(true));
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
    it('uses a distinct path (not a fragment) and keeps the council query', () => {
        const main = new Request('https://volby.example/api/volby?z=500216');
        const lr = lastResortRequest(main.url);
        expect(new URL(lr.url).pathname).toBe('/__lastresort/api/volby');
        expect(new URL(lr.url).search).toBe('?z=500216');
        expect(lr.url).not.toBe(main.url);
        expect(lr.url.split('#')[0]).not.toBe(main.url);
    });
    it('differs per council and for the overview', () => {
        const a = lastResortRequest('https://h.example/api/volby?z=1').url;
        const b = lastResortRequest('https://h.example/api/volby?z=2').url;
        const c = lastResortRequest(new URL('https://h.example/api/prehled')).url;
        expect(new Set([a, b, c]).size).toBe(3);
        expect(c).toBe('https://h.example/__lastresort/api/prehled');
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
