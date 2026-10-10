import { describe, expect, it } from 'vitest';
import { shouldAutoReload } from './reload.js';

describe('shouldAutoReload', () => {
    it('visible tab on election night is never reloaded', () => {
        expect(shouldAutoReload({ hidden: false, electionNight: true })).toBe(false);
    });
    it('hidden tab on election night is reloaded', () => {
        expect(shouldAutoReload({ hidden: true, electionNight: true })).toBe(true);
    });
    it('visible tab outside election night is reloaded', () => {
        expect(shouldAutoReload({ hidden: false, electionNight: false })).toBe(true);
    });
    it('hidden tab outside election night is reloaded', () => {
        expect(shouldAutoReload({ hidden: true, electionNight: false })).toBe(true);
    });
});
