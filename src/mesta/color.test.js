import { describe, it, expect } from 'vitest';
import { isNearWhite, luminance } from './color.js';

describe('isNearWhite', () => {
    it('bílá a světle šedá jsou téměř bílé', () => {
        expect(isNearWhite('#FFFFFF')).toBe(true);
        expect(isNearWhite('#F5F5F5')).toBe(true);
        expect(isNearWhite('#fafafa')).toBe(true);
        expect(isNearWhite('#FFF')).toBe(true);
    });
    it('barvy stran nejsou téměř bílé', () => {
        expect(isNearWhite('#FEC900')).toBe(false);
        expect(isNearWhite('#000000')).toBe(false);
        expect(isNearWhite('#E0E0E0')).toBe(false);
    });
    it('neplatný vstup je false', () => {
        expect(isNearWhite('')).toBe(false);
        expect(isNearWhite(null)).toBe(false);
        expect(isNearWhite(undefined)).toBe(false);
        expect(isNearWhite('white')).toBe(false);
        expect(isNearWhite('#GGGGGG')).toBe(false);
        expect(isNearWhite('#FFFF')).toBe(false);
    });
    it('luminance je v rozsahu 0–1', () => {
        expect(luminance('#000000')).toBe(0);
        expect(luminance('#FFFFFF')).toBeCloseTo(1, 10);
        expect(luminance('nope')).toBeNull();
    });
});
