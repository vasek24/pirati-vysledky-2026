import { describe, expect, it } from 'vitest';
import { FIRST_CLASS_KEYS, isFirstClass } from './feedClasses.js';

describe('feedClasses', () => {
    it('has 12 unique first-class keys', () => {
        expect(FIRST_CLASS_KEYS).toHaveLength(12);
        expect(new Set(FIRST_CLASS_KEYS).size).toBe(12);
        for (const key of ['554782', '500216', 'prehled']) expect(FIRST_CLASS_KEYS).toContain(key);
    });

    it('classifies keys', () => {
        expect(isFirstClass('500216')).toBe(true);
        expect(isFirstClass('prehled')).toBe(true);
        expect(isFirstClass('538531')).toBe(false);
    });
});
