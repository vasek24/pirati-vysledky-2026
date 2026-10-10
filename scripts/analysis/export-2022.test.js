import { describe, it, expect } from 'vitest';
import { buildBaseline } from './export-2022.mjs';

const council = { slug: 'x', zastup: 1, name: 'X', seats: 5, precincts: 3, pirates: 2 };
const lists = {
    seatsTotal2022: 5,
    lists: [
        { id: 1, name: 'A', short8: 'A', vstrana: 11, slozeni: [11], candidates: 5, baseline: { ids: ['1', '2'], label: 'A22', exact: false }, split: null },
        { id: 2, name: 'Česká pirátská strana', short8: 'Piráti', vstrana: 720, slozeni: [720], candidates: 5, baseline: { ids: ['3'], label: 'Piráti', exact: true }, split: null },
        { id: 3, name: 'Nová', short8: 'N', vstrana: 99, slozeni: [99], candidates: 5, baseline: null, split: null },
    ],
    lists2022: [{ id: '1', name: 'a', short: 'a', slozeni: [], votes: 10, pct: 40, seats: 2 }],
};
const results2022 = {
    okrsky: {
        1: { voters: 100, envelopes: 50, validVotes: 250, votes: { 1: 100, 2: 50, 3: 100 } },
        2: { voters: 100, envelopes: 40, validVotes: 200, votes: { 1: 40, 2: 10, 3: 150 } },
    },
};

describe('buildBaseline', () => {
    const b = buildBaseline({ council, lists, results2022, now: new Date('2026-10-10T00:00:00Z') });
    it('marks the Pirate list and maps predecessors', () => {
        expect(b.lists2026.filter((l) => l.pirate).map((l) => l.id)).toEqual([2]);
        expect(b.piratesList2026.id).toBe(2);
        expect(b.lists2026[2].predecessors2022).toBeNull();
    });
    it('keeps per-precinct 2022 results and maps votes to 2026 lists', () => {
        expect(b.precincts[1].turnoutPct).toBe(50);
        expect(b.precincts[1].votes2026Equiv).toEqual({ 1: 150, 2: 100 });
        expect(b.precincts[2].votes2026Equiv).toEqual({ 1: 50, 2: 150 });
    });
    it('totals add up', () => {
        expect(b.totals2022).toMatchObject({ voters: 200, envelopes: 90, turnoutPct: 45, validVotes: 450 });
        expect(b.totals2022.partyVotes).toEqual({ 1: 140, 2: 60, 3: 250 });
        expect(b.precinctsCount2022).toBe(2);
        expect(b.precinctsCount2026).toBe(3);
    });
});
