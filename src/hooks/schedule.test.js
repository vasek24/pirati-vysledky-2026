import { describe, expect, it } from 'vitest';
import { MAX_TIMEOUT_MS, backoffDelay, clampTimeout, computeSkew, nextPollDelay, nextSkew, pickOffset, pollingDone, visibilityDelay } from './schedule.js';

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
        const serverNow = 1_790_000_000_000;
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
        const serverNow = 1_790_000_000_000;
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
        expect(computeSkew('1790000000500', 1_790_000_000_000)).toBe(500);
        expect(computeSkew(1_790_000_000_500, 1_790_000_001_000)).toBe(-500);
    });
    it('missing or invalid header means "no update" (null)', () => {
        expect(computeSkew(null, 1_790_000_000_000)).toBeNull();
        expect(computeSkew(undefined, 1_790_000_000_000)).toBeNull();
        expect(computeSkew('', 1_790_000_000_000)).toBeNull();
        expect(computeSkew('abc', 1_790_000_000_000)).toBeNull();
        expect(computeSkew('NaN', 1_790_000_000_000)).toBeNull();
        expect(computeSkew('0', 1_790_000_000_000)).toBeNull();
    });
    it('a header in seconds (< 1e12) is rejected', () => {
        expect(computeSkew('1790000000', 1_790_000_000_000)).toBeNull();
    });
    it('a clock more than a day off is rejected', () => {
        expect(computeSkew(String(1_790_000_000_000 + 86_400_001), 1_790_000_000_000)).toBeNull();
        expect(computeSkew(String(1_790_000_000_000 - 86_400_001), 1_790_000_000_000)).toBeNull();
        expect(computeSkew(String(1_790_000_000_000 + 86_400_000), 1_790_000_000_000)).toBe(86_400_000);
    });
});

describe('nextSkew', () => {
    const client = 1_790_000_000_000;
    it('takes a valid header', () => {
        expect(nextSkew(-5000, String(client + 300), client)).toBe(300);
    });
    it('keeps the last valid skew when the header is missing or invalid', () => {
        expect(nextSkew(-120_000, null, client)).toBe(-120_000);
        expect(nextSkew(-120_000, 'abc', client)).toBe(-120_000);
        expect(nextSkew(-120_000, '1790000000', client)).toBe(-120_000);
    });
    it('starts from 0 for a header-less server', () => {
        expect(nextSkew(0, null, client)).toBe(0);
    });
});

describe('delays stay sane for garbage input (no tight loop, no timer overflow)', () => {
    const now = 1_790_000_000_000;
    const cases = {
        'year 2100': Date.UTC(2100, 0, 1),
        'seconds, not ms': 1.79e9,
        'a year ahead': now + 365 * 86_400_000,
        'a day behind': now - 86_400_000,
        'Infinity': Infinity,
        'negative': -1e15,
        'huge': 1e300,
    };
    for (const [name, nextRefreshAt] of Object.entries(cases)) {
        it(`nextRefreshAt ${name}: 5 s <= delay <= 15 min`, () => {
            for (const random of [0, 0.5, 1]) {
                const d = nextPollDelay({ nextRefreshAt, now, offset: 25_000, random });
                expect(d).toBeGreaterThanOrEqual(5000);
                expect(d).toBeLessThanOrEqual(900_000);
            }
        });
    }
    it('out-of-window nextRefreshAt falls back to 60 s +-15 %', () => {
        expect(nextPollDelay({ nextRefreshAt: Date.UTC(2100, 0, 1), now, offset: 0, random: 0.5 })).toBeCloseTo(60_000);
        expect(nextPollDelay({ nextRefreshAt: 1.79e9, now, offset: 0, random: 0 })).toBeCloseTo(51_000);
        expect(nextPollDelay({ nextRefreshAt: now + 900_001, now, offset: 0, random: 1 })).toBeCloseTo(69_000);
        expect(nextPollDelay({ nextRefreshAt: now - 3_600_001, now, offset: 0, random: 1 })).toBeCloseTo(69_000);
    });
    it('window edges are still honoured', () => {
        expect(nextPollDelay({ nextRefreshAt: now + 900_000, now, offset: 25_000, random: 0.5 })).toBe(900_000);
        expect(nextPollDelay({ nextRefreshAt: now - 3_600_000, now, offset: 0, random: 0.5 })).toBe(7500);
    });
    it('a far-future offset never exceeds 15 min', () => {
        expect(nextPollDelay({ nextRefreshAt: now + 890_000, now, offset: 25_000, random: 0.5 })).toBe(900_000);
    });
    it('clampTimeout keeps setTimeout below 2^31-1', () => {
        expect(MAX_TIMEOUT_MS).toBe(2_147_483_647);
        expect(clampTimeout(1e15)).toBe(2_147_483_647);
        expect(clampTimeout(Infinity)).toBe(2_147_483_647);
        expect(clampTimeout(NaN)).toBe(5000);
        expect(clampTimeout(-5)).toBe(0);
        expect(clampTimeout(1234)).toBe(1234);
    });
});

describe('pollingDone', () => {
    const final = { phase: 'final', official: true, precincts: { counted: 100, total: 100 } };

    it('official snapshot with every precinct counted: stop polling', () => {
        expect(pollingDone(final)).toBe(true);
    });
    it('keeps polling while counting, waiting or before the vote', () => {
        expect(pollingDone({ ...final, phase: 'counting', official: false })).toBe(false);
        expect(pollingDone({ ...final, phase: 'waiting', official: false, precincts: { counted: 0, total: 100 } })).toBe(false);
        expect(pollingDone({ ...final, phase: 'pre', official: false })).toBe(false);
    });
    it('keeps polling when official but some precincts are missing', () => {
        expect(pollingDone({ ...final, precincts: { counted: 99, total: 100 } })).toBe(false);
    });
    it('keeps polling when the snapshot is stale or absent', () => {
        expect(pollingDone({ ...final, stale: true })).toBe(false);
        expect(pollingDone(null)).toBe(false);
        expect(pollingDone(undefined)).toBe(false);
    });
});
