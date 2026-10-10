import { describe, expect, it, vi } from 'vitest';
import { POLLS_CLOSE } from '../src/councils.js';
import { buildFeed, feedKind, makeLog, phaseOfSnapshot } from './feedWiring.js';

const BEFORE = POLLS_CLOSE - 60_000;
const AFTER = POLLS_CLOSE + 60_000;
const snap = (counted, official = false) => ({ precincts: { counted, total: 100 }, official });

describe('phaseOfSnapshot (adapter for feed.js phaseOf)', () => {
    it('null snapshot: pre before the polls close, waiting after', () => {
        expect(phaseOfSnapshot(null, BEFORE)).toBe('pre');
        expect(phaseOfSnapshot(null, POLLS_CLOSE)).toBe('waiting');
        expect(phaseOfSnapshot(null, AFTER)).toBe('waiting');
    });
    it('counted = 0: pre before close, waiting after', () => {
        expect(phaseOfSnapshot(snap(0), BEFORE)).toBe('pre');
        expect(phaseOfSnapshot(snap(0), AFTER)).toBe('waiting');
    });
    it('counted > 0: counting (regardless of the clock)', () => {
        expect(phaseOfSnapshot(snap(3), AFTER)).toBe('counting');
        expect(phaseOfSnapshot(snap(3), BEFORE)).toBe('counting');
    });
    it('official: final', () => {
        expect(phaseOfSnapshot(snap(100, true), AFTER)).toBe('final');
        expect(phaseOfSnapshot({ precincts: { counted: 0 }, official: true }, BEFORE)).toBe('final');
    });
    it('missing official / precincts do not throw', () => {
        expect(phaseOfSnapshot({ precincts: { counted: 5 } }, AFTER)).toBe('counting');
        expect(phaseOfSnapshot({}, BEFORE)).toBe('pre');
    });
});

describe('makeLog', () => {
    const sink = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    it('maps level to console method, default info, compact JSON with event', () => {
        const s = sink();
        const log = makeLog(s);
        log('rehydrated', { refreshedAt: 5 });
        log('rejected', { level: 'warn', reason: 'x' });
        log('older-persistent', { level: 'error', sinceMs: 1 });
        expect(s.info).toHaveBeenCalledTimes(1);
        expect(JSON.parse(s.info.mock.calls[0][0])).toEqual({ event: 'rehydrated', level: 'info', refreshedAt: 5 });
        expect(JSON.parse(s.warn.mock.calls[0][0])).toMatchObject({ event: 'rejected', reason: 'x' });
        expect(JSON.parse(s.error.mock.calls[0][0])).toMatchObject({ event: 'older-persistent', sinceMs: 1 });
        expect(s.info.mock.calls[0][0]).not.toContain('\n');
    });
    it('unknown level falls back to info; no data is fine; never throws', () => {
        const s = sink();
        const log = makeLog(s);
        log('a');
        log('b', { level: 'weird' });
        const circular = {};
        circular.self = circular;
        expect(() => log('c', circular)).not.toThrow();
        expect(s.info).toHaveBeenCalledTimes(3);
    });
});

describe('feedKind / buildFeed', () => {
    it('kind per key', () => {
        expect(feedKind('prehled')).toBe('overview');
        expect(feedKind('500216')).toBe('council');
    });
    it('returns a feed with build/invalidate for a council and for the overview', () => {
        for (const key of ['500216', 'prehled']) {
            const feed = buildFeed(key, { CSU_BASE: 'http://127.0.0.1:1' });
            expect(typeof feed.build).toBe('function');
            expect(typeof feed.invalidate).toBe('function');
        }
    });
    it('uses CSU_BASE from env, KV_BASE_URL otherwise, and sends our User-Agent', async () => {
        const calls = [];
        const fetchImpl = async (url, init) => {
            calls.push({ url: String(url), init });
            return new Response('{}', { status: 200 });
        };
        await buildFeed('500216', { CSU_BASE: 'http://mock.test/base' }, { fetchImpl }).build().catch(() => {});
        expect(calls[0].url.startsWith('http://mock.test/base/')).toBe(true);
        expect(JSON.stringify(calls[0].init.headers)).toContain('pirati-vysledky-2026');
        calls.length = 0;
        await buildFeed('500216', {}, { fetchImpl }).build().catch(() => {});
        expect(calls[0].url.startsWith('https://volby.gov.cz/appdata/kv2026/')).toBe(true);
    });
    it('throws for an unknown council key', () => {
        expect(() => buildFeed('1', {})).toThrow(/unknown feed key/);
    });
});
