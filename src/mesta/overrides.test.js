import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import overrides from './overrides.js';
import { buildCouncils } from './buildCouncils.js';
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

describe('committed tiny labels of the map towns', () => {
    const json = (rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
    const towns = json('src/mesta/towns.generated.json');
    const specifics = json('src/mesta/specifics.generated.json');
    const councils = buildCouncils(towns, specifics, overrides);

    it('every override names the registry town and an existing list of that town; Pirate list gets a short label', () => {
        for (const [zastup, o] of Object.entries(overrides.towns).filter(([, x]) => x.lists)) {
            const t = towns.find((x) => String(x.zastup) === zastup);
            expect(t, zastup).toBeTruthy();
            expect(o.name).toBe(t.name);
            const lists = json(`public-mesta/data/${t.slug}/lists.json`).lists;
            for (const [id, l] of Object.entries(o.lists)) {
                expect(lists.some((x) => String(x.id) === id), `${t.slug} list ${id}`).toBe(true);
                expect(l.tiny.length).toBeLessThanOrEqual(15);
            }
            // je to kandidátka Pirátů města
            expect(Object.keys(o.lists)).toEqual([String(specifics.find((s) => String(s.zastup) === zastup).list.id)]);
        }
        expect(Object.values(overrides.towns).filter((o) => o.lists)).toHaveLength(10);
    });

    it('label overrides do not touch reviewed/confidence; only the owner-released 7-10k towns carry reviewed', () => {
        for (const o of Object.values(overrides.towns).filter((x) => x.lists)) {
            expect(Object.keys(o).sort()).toEqual(['lists', 'name']);
        }
        const released = Object.entries(overrides.towns).filter(([, o]) => !o.lists);
        expect(released.map(([z, o]) => [z, o.name, o.reviewed])).toEqual([['584649', 'Mikulov', true], ['599107', 'Rychvald', true]]);
        expect(councils.filter((c) => c.map && c.shown)).toHaveLength(12);
        expect(councils.filter((c) => c.shown)).toHaveLength(81);
    });
});
