import { describe, expect, it, vi } from 'vitest';
import { FIRST_CLASS_KEYS } from './feedClasses.js';
import { feedTarget, runWarmup } from './warmup.js';

const silent = () => ({ log: vi.fn(), warn: vi.fn() });

describe('feedTarget', () => {
    it('maps council keys to path and DO name', () => {
        expect(feedTarget('554782')).toEqual({ name: 'volby', path: '/api/volby?z=554782', doName: 'volby?z=554782' });
    });
    it('maps prehled', () => {
        expect(feedTarget('prehled')).toEqual({ name: 'prehled', path: '/api/prehled', doName: 'prehled' });
    });
    it('throws on unknown council', () => {
        expect(() => feedTarget('1')).toThrow();
    });
    it('every first-class key is mappable', () => {
        for (const key of FIRST_CLASS_KEYS) expect(() => feedTarget(key)).not.toThrow();
    });
});

describe('runWarmup', () => {
    it('logs warmup-ok with status and never exceeds concurrency', async () => {
        const out = silent();
        let active = 0;
        let peak = 0;
        const call = async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 5));
            active--;
            return { status: 200 };
        };
        await runWarmup(FIRST_CLASS_KEYS, call, { concurrency: 4, timeoutMs: 1000, ...out });
        expect(peak).toBeLessThanOrEqual(4);
        expect(peak).toBeGreaterThan(1);
        expect(out.log).toHaveBeenCalledTimes(12);
        expect(out.log).toHaveBeenCalledWith('warmup-ok', '554782', 200);
        expect(out.warn).not.toHaveBeenCalled();
    });

    it('a throw or non-200 does not stop the others', async () => {
        const out = silent();
        const call = async (key) => {
            if (key === 'a') throw new Error('boom');
            if (key === 'b') return { status: 503 };
            return { status: 200 };
        };
        await runWarmup(['a', 'b', 'c', 'd', 'e', 'f'], call, { concurrency: 2, timeoutMs: 1000, ...out });
        expect(out.warn).toHaveBeenCalledWith('warmup-failed', 'a', 'boom');
        expect(out.warn).toHaveBeenCalledWith('warmup-failed', 'b', 'status 503');
        expect(out.log).toHaveBeenCalledTimes(4);
    });

    it('logs a timeout as warmup-failed', async () => {
        const out = silent();
        const call = (key) => (key === 'slow' ? new Promise(() => {}) : Promise.resolve({ status: 200 }));
        await runWarmup(['slow', 'fast'], call, { concurrency: 4, timeoutMs: 20, ...out });
        expect(out.warn).toHaveBeenCalledWith('warmup-failed', 'slow', 'timeout');
        expect(out.log).toHaveBeenCalledWith('warmup-ok', 'fast', 200);
    });
});
