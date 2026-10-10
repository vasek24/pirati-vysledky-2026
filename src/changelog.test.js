import { describe, expect, it } from 'vitest';
import { APP_VERSION, CHANGELOG } from './changelog.js';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const parts = (v) => v.match(SEMVER).slice(1).map(Number);
const cmp = (a, b) => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
};

// version.json se generuje z APP_VERSION; otevřené záložky se podle ní
// poznají, že běží starý kód — verze se proto musí po každém nasazení zvednout.
describe('changelog / app version', () => {
    it('APP_VERSION is the version of the top changelog entry', () => {
        expect(APP_VERSION).toBe(CHANGELOG[0].version);
    });
    it('every version is valid semver', () => {
        for (const e of CHANGELOG) expect(e.version).toMatch(SEMVER);
    });
    it('is strictly newer than the version running in open tabs (1.5.1)', () => {
        expect(cmp(APP_VERSION, '1.5.1')).toBeGreaterThan(0);
    });
    it('entries are ordered newest first', () => {
        for (let i = 1; i < CHANGELOG.length; i++) {
            expect(cmp(CHANGELOG[i - 1].version, CHANGELOG[i].version)).toBeGreaterThan(0);
        }
    });
});
