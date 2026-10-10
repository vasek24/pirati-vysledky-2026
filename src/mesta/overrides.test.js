import { describe, it, expect } from 'vitest';
import overrides from './overrides.js';
import { validateOverrides } from '../../scripts/mesta/registryCore.js';

const ok = (towns, reviewedAt = null) => validateOverrides({ reviewedAt, towns });

describe('mesta overrides', () => {
    it('the committed overrides are valid', () => {
        expect(validateOverrides(overrides)).toEqual([]);
    });

    it('name is required (and must be a non-empty string)', () => {
        expect(ok({ 582786: {} })[0]).toMatch(/name/);
        expect(ok({ 582786: { name: '' } })[0]).toMatch(/name/);
        expect(ok({ 582786: { name: 'Brno' } })).toEqual([]);
    });

    it('keys are KODZASTUP strings', () => {
        expect(ok({ brno: { name: 'Brno' } })[0]).toMatch(/KODZASTUP/);
    });

    it.each([
        ['include', false],
        ['type', 'c'],
        ['list', { short: 'X' }],
        ['pirateCandidates', []],
    ])('%s needs a reason or a note', (key, value) => {
        expect(ok({ 1: { name: 'X', [key]: value } })[0]).toMatch(/reason|note/);
        expect(ok({ 1: { name: 'X', [key]: value, reason: 'proč' } })).toEqual([]);
        expect(ok({ 1: { name: 'X', [key]: value, note: 'poznámka' } })).toEqual([]);
    });

    it('pirates is never set directly (derived from list.id)', () => {
        expect(ok({ 1: { name: 'X', pirates: 11, reason: 'r' } })[0]).toMatch(/pirates/);
    });

    it("confidence:'low' is allowed only with a note", () => {
        expect(ok({ 1: { name: 'X', confidence: 'low' } })[0]).toMatch(/note/);
        expect(ok({ 1: { name: 'X', confidence: 'low', reason: 'jen reason' } })[0]).toMatch(/note/);
        expect(ok({ 1: { name: 'X', confidence: 'low', note: 'Codex: nejasné' } })).toEqual([]);
        expect(ok({ 1: { name: 'X', confidence: 'medium', note: 'n' } })[0]).toMatch(/confidence/);
    });

    it('reviewedAt is null or an ISO date', () => {
        expect(ok({}, null)).toEqual([]);
        expect(ok({}, '2026-10-10T15:30:00+02:00')).toEqual([]);
        expect(ok({}, '2026-10-10')).toEqual([]);
        expect(ok({}, 'včera')[0]).toMatch(/reviewedAt/);
        expect(validateOverrides({ towns: {} })[0]).toMatch(/reviewedAt/);
    });

    it('reviewed must be boolean and borderlineReason a non-empty string', () => {
        expect(ok({ 1: { name: 'X', reviewed: 'ano' } })[0]).toMatch(/reviewed/);
        expect(ok({ 1: { name: 'X', reviewed: true } })).toEqual([]);
        expect(ok({ 1: { name: 'X', borderlineReason: '' } })[0]).toMatch(/borderlineReason/);
        expect(ok({ 1: { name: 'X', borderlineReason: 42 } })[0]).toMatch(/borderlineReason/);
        expect(ok({ 1: { name: 'X', borderlineReason: 'Domov kandidáta' } })).toEqual([]);
    });

    it('rejects unknown keys and wrong types', () => {
        expect(ok({ 1: { name: 'X', nope: 1 } })[0]).toMatch(/nope/);
        expect(ok({ 1: { name: 'X', include: 'ano', reason: 'r' } })[0]).toMatch(/include/);
        expect(ok({ 1: { name: 'X', type: 'z', reason: 'r' } })[0]).toMatch(/type/);
        expect(validateOverrides({ reviewedAt: null })[0]).toMatch(/towns/);
    });
});
