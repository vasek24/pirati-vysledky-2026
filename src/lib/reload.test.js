import { readFileSync } from 'node:fs';
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

// R7: i opakovaný pokus (setInterval) musí znovu zkontrolovat volební noc —
// noc může začít, zatímco je upozornění na novou verzi už naplánované
describe('UpdateManager retry path', () => {
    it('visible tab: election night starting after the retry was scheduled blocks the reload', () => {
        const visible = { hidden: false };
        expect(shouldAutoReload({ ...visible, electionNight: false })).toBe(true);
        expect(shouldAutoReload({ ...visible, electionNight: true })).toBe(false);
    });
    it('tryReload consults shouldAutoReload with a fresh election-night check', () => {
        const src = readFileSync(new URL('../components/UpdateManager.jsx', import.meta.url), 'utf8');
        const body = src.slice(src.indexOf('const tryReload'), src.indexOf('const initial'));
        expect(body).toMatch(/shouldAutoReload\(\{[^}]*electionNight: isElectionNight\(\)[^}]*\}\)/);
    });
});
