import { describe, it, expect } from 'vitest';
import { buildState, mergeCounted } from './summary.mjs';

const pre = (v1, v2) => ({ voters: 200, envelopes: 100, validVotes: v1 + v2, turnoutPct: 50, votes: { 1: v1, 2: v2 }, votes2026Equiv: { 1: v1, 2: v2 } });
const baseline = {
    slug: 'x', name: 'X', seats2026: 5,
    piratesList2026: { id: 2 },
    lists2026: [
        { id: 1, short: 'A', name: 'A', pirate: false, candidates: 5, predecessors2022: { ids: ['1'], label: 'A', exact: true }, share2022Pct: 55 },
        { id: 2, short: 'P', name: 'P', pirate: true, candidates: 5, predecessors2022: { ids: ['2'], label: 'P', exact: true }, share2022Pct: 45 },
    ],
    lists2022: [{ id: '1', seats: 3 }, { id: '2', seats: 2 }],
    precincts: { A: pre(60, 40), B: pre(60, 40), C: pre(50, 50), D: pre(50, 50) },
};
const rec = (generatedRaw, okrsky, parties, counted) => ({
    fetchedAt: '2026-10-10T16:00:00+02:00', generated: `${generatedRaw}+02:00`, generatedRaw, phase: 'counting', official: false,
    precincts: { total: 4, counted }, turnout: { voters: 400, envelopes: 200, pct: 50, validVotes: 200 }, parties, okrsky,
});
const okr = (votes) => ({ voters: 200, validVotes: 100, votes });

describe('buildState', () => {
    it('before counting returns only the shell and a timeline', () => {
        const { state } = buildState({ baseline, records: [rec('t0', {}, { 1: 0, 2: 0 }, 0)], computedAt: 'T' });
        expect(state.status).toBe('no-precincts-counted-yet');
        expect(state.timeline).toHaveLength(1);
    });

    it('pooled swing (no per-precinct votes) projects the remaining precincts', () => {
        const r = rec('t1', { A: okr(null), B: okr(null) }, { 1: 100, 2: 100 }, 2);
        const { state, detail } = buildState({ baseline, records: [r], computedAt: 'T' });
        expect(state.swingMethodUsed).toBe('pooled totals');
        const [a, p] = state.parties;
        expect(a.swingPp).toBe(-10);
        expect(p.swingPp).toBe(10);
        expect(a.pct2022SameCountedPrecincts).toBe(60);
        expect(a.NAIVE_expectedFinalVotes).toBe(180);
        expect(p.NAIVE_expectedFinalVotes).toBe(220);
        expect(p.NAIVE_expectedFinalPct).toBe(55);
        expect(state.progress).toMatchObject({ countedPrecincts: 2, matchedTo2022: 2, remainingListedFrom2022: 2, countedPctOf2022ValidVotes: 50 });
        expect(state.remaining.map((x) => x.okrsek)).toEqual(['C', 'D']);
        expect(detail.remaining.C.expectedPct).toEqual({ 1: 40, 2: 60 });
        expect(state.NAIVE_projection.label).toMatch(/NAIVE/);
        expect(state.parties.reduce((s, x) => s + x.NAIVE_expectedSeats, 0)).toBe(5);
    });

    it('per-precinct mode weights by 2022 valid votes and fills the pirate columns', () => {
        const r = rec('t1', { A: okr({ 1: 50, 2: 50 }), B: okr({ 1: 50, 2: 50 }) }, { 1: 100, 2: 100 }, 2);
        const { state } = buildState({ baseline, records: [r] });
        expect(state.swingMethodUsed).toMatch(/per-precinct/);
        expect(state.parties[1].swingPp).toBe(10);
        expect(state.counted[0]).toMatchObject({ okrsek: 'A', pirates2026Pct: 50, pirates2022Pct: 40, piratesSwingPp: 10 });
        expect(state.parties[1].NAIVE_crudeSePp).toBeNull(); // < 5 okrsků
    });

    it('is deterministic and merges per-precinct votes from the Magistrát file', () => {
        const r = rec('t1', { A: okr(null), B: okr(null) }, { 1: 100, 2: 100 }, 2);
        const pr = [{ okrsek: 'A', votes: { 1: 50, 2: 50 } }, { okrsek: 'B', votes: { 1: 50, 2: 50 } }];
        expect(mergeCounted([r], pr).A.votes).toEqual({ 1: 50, 2: 50 });
        const a = JSON.stringify(buildState({ baseline, records: [r], precinctRecords: pr, computedAt: 'T' }));
        const b = JSON.stringify(buildState({ baseline, records: [r], precinctRecords: pr, computedAt: 'T' }));
        expect(a).toBe(b);
    });

    it('flags counted precincts missing from the 2022 baseline', () => {
        const r = rec('t1', { A: okr(null), Z: okr({ 1: 70, 2: 30 }) }, { 1: 120, 2: 80 }, 2);
        const { state } = buildState({ baseline, records: [r] });
        expect(state.caveats[0]).toMatch(/Z/);
        expect(state.progress.matchedTo2022).toBe(1);
    });

    it('timeline follows the records', () => {
        const r1 = rec('t1', { A: okr(null) }, { 1: 50, 2: 50 }, 1);
        const r2 = rec('t2', { A: okr(null), B: okr(null) }, { 1: 100, 2: 100 }, 2);
        const { state } = buildState({ baseline, records: [r1, r2] });
        expect(state.timeline.map((t) => t.counted)).toEqual([1, 2]);
        expect(state.timeline[1].pct).toEqual({ 1: 50, 2: 50 });
    });
});
