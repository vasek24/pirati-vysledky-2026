import { describe, expect, it } from 'vitest';
import { backoffDelay, computeSkew, nextPollDelay, pickOffset, visibilityDelay } from './schedule.js';

describe('pickOffset', () => {
    it('is uniform over [0, 25 s]', () => {
        expect(pickOffset(0)).toBe(0);
        expect(pickOffset(0.5)).toBe(12500);
        expect(pickOffset(1)).toBe(25000);
    });
});

describe('nextPollDelay', () => {
    const now = 1_000_000;

    it('future nextRefreshAt: wait for it plus the per-tab offset', () => {
        expect(nextPollDelay({ nextRefreshAt: now + 30_000, now, offset: 10_000, random: 0.5 })).toBe(40_000);
    });

    it('never polls more often than every 5 s', () => {
        expect(nextPollDelay({ nextRefreshAt: now + 1_000, now, offset: 0, random: 0.5 })).toBe(5000);
        expect(nextPollDelay({ nextRefreshAt: now + 1, now, offset: 100, random: 0.5 })).toBe(5000);
    });

    it('nextRefreshAt already past: retry in 5-10 s', () => {
        expect(nextPollDelay({ nextRefreshAt: now - 1, now, offset: 20_000, random: 0 })).toBe(5000);
        expect(nextPollDelay({ nextRefreshAt: now, now, offset: 20_000, random: 0.5 })).toBe(7500);
        expect(nextPollDelay({ nextRefreshAt: now - 90_000, now, offset: 0, random: 1 })).toBe(10_000);
    });

    it('nextRefreshAt absent: 60 s +-15 %', () => {
        expect(nextPollDelay({ nextRefreshAt: undefined, now, offset: 20_000, random: 0 })).toBeCloseTo(51_000);
        expect(nextPollDelay({ nextRefreshAt: undefined, now, offset: 20_000, random: 0.5 })).toBeCloseTo(60_000);
        expect(nextPollDelay({ nextRefreshAt: undefined, now, offset: 20_000, random: 1 })).toBeCloseTo(69_000);
        expect(nextPollDelay({ nextRefreshAt: null, now, offset: 0, random: 0.5 })).toBeCloseTo(60_000);
    });

    it('client clock +120 s with x-server-now: normal delay, not 5-10 s (skew)', () => {
        const serverNow = 5_000_000;
        const clientNow = serverNow + 120_000; // rychlé hodiny
        const skew = computeSkew(String(serverNow), clientNow);
        expect(skew).toBe(-120_000);
        const nextRefreshAt = serverNow + 30_000;
        // bez opravy by byl nextRefreshAt „v minulosti" → 5-10 s
        expect(nextPollDelay({ nextRefreshAt, now: clientNow, offset: 0, random: 0.5 })).toBe(7500);
        // s opravou normální pauza
        expect(nextPollDelay({ nextRefreshAt, now: clientNow + skew, offset: 4000, random: 0.5 })).toBe(34_000);
    });

    it('client clock -120 s (slow) is also corrected', () => {
        const serverNow = 5_000_000;
        const clientNow = serverNow - 120_000;
        const skew = computeSkew(String(serverNow), clientNow);
        expect(nextPollDelay({ nextRefreshAt: serverNow + 30_000, now: clientNow + skew, offset: 0, random: 0.5 })).toBe(30_000);
    });
});

describe('backoffDelay', () => {
    it('is floored at 5 s', () => {
        expect(backoffDelay(0, 0)).toBe(5000);
        expect(backoffDelay(3, 0.01)).toBe(5000);
    });
    it('grows as random * 5 s * 2^n', () => {
        expect(backoffDelay(2, 0.5)).toBe(10_000);
        expect(backoffDelay(4, 1)).toBe(80_000);
    });
    it('is capped at 300 s', () => {
        expect(backoffDelay(6, 1)).toBe(300_000);
        expect(backoffDelay(30, 1)).toBe(300_000);
        expect(backoffDelay(30, 0.5)).toBe(150_000);
    });
});

describe('visibilityDelay', () => {
    it('is random(0, 5 s)', () => {
        expect(visibilityDelay(0)).toBe(0);
        expect(visibilityDelay(0.5)).toBe(2500);
        expect(visibilityDelay(1)).toBe(5000);
    });
});

describe('computeSkew', () => {
    it('is serverNow - clientNow', () => {
        expect(computeSkew('1000500', 1_000_000)).toBe(500);
        expect(computeSkew(1_000_500, 1_001_000)).toBe(-500);
    });
    it('missing or invalid header means no correction', () => {
        expect(computeSkew(null, 1_000_000)).toBe(0);
        expect(computeSkew(undefined, 1_000_000)).toBe(0);
        expect(computeSkew('', 1_000_000)).toBe(0);
        expect(computeSkew('abc', 1_000_000)).toBe(0);
        expect(computeSkew('NaN', 1_000_000)).toBe(0);
        expect(computeSkew('0', 1_000_000)).toBe(0);
    });
});
