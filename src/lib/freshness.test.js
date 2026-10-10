import { describe, expect, it } from 'vitest';
import { ageSeconds, formatAge, liveState, nextCheckLabel } from './freshness.js';

// zone-less ČSÚ čas = pražský čas; 14:31:05 CEST = 12:31:05 UTC (testy běží s TZ=UTC)
const GENERATED = '2026-10-10T14:31:05';
const GENERATED_MS = Date.parse('2026-10-10T12:31:05Z');
const POLLS_CLOSE = Date.parse('2026-10-10T14:00:00+02:00');

describe('ageSeconds', () => {
    it('parses zone-less Prague time, not the runtime zone', () => {
        expect(ageSeconds(GENERATED_MS + 12_000, GENERATED)).toBe(12);
    });
    it('floors to whole seconds', () => {
        expect(ageSeconds(GENERATED_MS + 12_999, GENERATED)).toBe(12);
    });
    it('clamps at 0 when the corrected clock is behind generated', () => {
        expect(ageSeconds(GENERATED_MS - 30_000, GENERATED)).toBe(0);
        expect(ageSeconds(GENERATED_MS, GENERATED)).toBe(0);
    });
    it('missing or invalid generated gives 0', () => {
        expect(ageSeconds(GENERATED_MS, null)).toBe(0);
        expect(ageSeconds(GENERATED_MS, 'nesmysl')).toBe(0);
    });
    it('is corrected by skew (client clock +120 s)', () => {
        const clientNow = GENERATED_MS + 12_000 + 120_000;
        expect(ageSeconds(clientNow, GENERATED)).toBe(132);
        expect(ageSeconds(clientNow - 120_000, GENERATED)).toBe(12);
    });
});

describe('formatAge', () => {
    it('seconds 0-59', () => {
        expect(formatAge(0)).toBe('před 0 s');
        expect(formatAge(12)).toBe('před 12 s');
        expect(formatAge(59)).toBe('před 59 s');
    });
    it('minutes 1-59', () => {
        expect(formatAge(60)).toBe('před 1 min');
        expect(formatAge(119)).toBe('před 1 min');
        expect(formatAge(120)).toBe('před 2 min');
        expect(formatAge(3599)).toBe('před 59 min');
    });
    it('hours from 60 min', () => {
        expect(formatAge(3600)).toBe('před 1 h');
        expect(formatAge(7199)).toBe('před 1 h');
        expect(formatAge(7200)).toBe('před 2 h');
    });
    it('negative or non-finite is 0', () => {
        expect(formatAge(-5)).toBe('před 0 s');
        expect(formatAge(NaN)).toBe('před 0 s');
    });
});

describe('nextCheckLabel', () => {
    const now = 1_000_000;
    it('formats M:SS', () => {
        expect(nextCheckLabel(now + 42_000, now)).toBe('0:42');
        expect(nextCheckLabel(now + 5_000, now)).toBe('0:05');
        expect(nextCheckLabel(now + 59_000, now)).toBe('0:59');
        expect(nextCheckLabel(now + 60_000, now)).toBe('1:00');
        expect(nextCheckLabel(now + 3_600_000, now)).toBe('60:00');
    });
    it('rounds partial seconds up', () => {
        expect(nextCheckLabel(now + 41_100, now)).toBe('0:42');
    });
    it('never negative', () => {
        expect(nextCheckLabel(now, now)).toBe('0:00');
        expect(nextCheckLabel(now - 10_000, now)).toBe('0:00');
    });
    it('no scheduled check (paused tab) gives null', () => {
        expect(nextCheckLabel(null, now)).toBeNull();
        expect(nextCheckLabel(undefined, now)).toBeNull();
    });
});

describe('liveState', () => {
    const after = POLLS_CLOSE + 60_000;
    const before = POLLS_CLOSE - 60_000;
    const base = { pollsClose: POLLS_CLOSE, online: true };

    it('cold load after 14:00 with no snapshot yet is live', () => {
        expect(liveState({ ...base, snapshot: null, status: 'loading', now: after })).toBe('live');
    });
    it('no snapshot before 14:00 is pre', () => {
        expect(liveState({ ...base, snapshot: null, status: 'loading', now: before })).toBe('pre');
    });
    it('counting and waiting are live', () => {
        expect(liveState({ ...base, snapshot: { phase: 'counting' }, status: 'ok', now: after })).toBe('live');
        expect(liveState({ ...base, snapshot: { phase: 'waiting' }, status: 'ok', now: after })).toBe('live');
    });
    it('a CDN-held pre snapshot after 14:00 is live', () => {
        expect(liveState({ ...base, snapshot: { phase: 'pre' }, status: 'ok', now: after })).toBe('live');
    });
    it('pre snapshot before 14:00 is pre', () => {
        expect(liveState({ ...base, snapshot: { phase: 'pre' }, status: 'ok', now: before })).toBe('pre');
    });
    it('final phase is final', () => {
        expect(liveState({ ...base, snapshot: { phase: 'final' }, status: 'ok', now: after })).toBe('final');
    });
    it('stale snapshot is stale, even when final', () => {
        expect(liveState({ ...base, snapshot: { phase: 'counting', stale: true }, status: 'ok', now: after })).toBe('stale');
        expect(liveState({ ...base, snapshot: { phase: 'final', stale: true }, status: 'ok', now: after })).toBe('stale');
    });
    it('browser offline wins over everything', () => {
        expect(liveState({ ...base, online: false, snapshot: { phase: 'counting', stale: true }, status: 'ok', now: after })).toBe('offline');
        expect(liveState({ ...base, online: false, snapshot: null, status: 'error', now: before })).toBe('offline');
    });
    it('online undefined is treated as online', () => {
        expect(liveState({ pollsClose: POLLS_CLOSE, snapshot: { phase: 'counting' }, status: 'ok', now: after })).toBe('live');
    });
});
