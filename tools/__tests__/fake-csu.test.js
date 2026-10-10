import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFakeCsu, fakeFetch } from '../lib/fakeCsu.mjs';
import { buildCouncils } from '../../src/mesta/buildCouncils.js';
import { createMestaWiring } from '../../cloudflare/mestaWiring.js';

const json = (rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const councils = buildCouncils(json('src/mesta/towns.generated.json'), json('src/mesta/specifics.generated.json'), { reviewedAt: null, towns: {} });
const brno = councils.find((c) => c.slug === 'brno');
const input = { council: brno, lists: json('public-mesta/data/brno/lists.json'), geo: json('public-mesta/data/brno/okrsky.geojson') };

describe('fake ČSÚ for the Brno map (real polygon ids, real list ids)', () => {
    it('counts ~30 % of the 353 precincts, deterministic by seed, 1 precinct without polygon', () => {
        const a = buildFakeCsu(input, { counted: 0.3, seed: 7 });
        const b = buildFakeCsu(input, { counted: 0.3, seed: 7 });
        expect(a.stats).toEqual(b.stats);
        expect(a.stats).toMatchObject({ precincts: 353, polygons: 352, counted: 106, withoutPolygon: 1 });
        expect(Object.keys(buildFakeCsu(input, { counted: 0.3, seed: 8 }).files)).not.toEqual(Object.keys(a.files));
    });

    it('feeds the real mesta Worker feed: precinct votes sum to the row, Pirate list 15 varies across precincts', async () => {
        const { files, stats } = buildFakeCsu(input, { counted: 0.3, pending: 0.1, seed: 3 });
        const wiring = createMestaWiring({ councils, shards: [] });
        const snap = await wiring.buildFeed(String(brno.zastup), {}, { fetchImpl: fakeFetch(files) }).build();
        expect(snap.precincts).toMatchObject({ total: 353, counted: stats.counted });
        const ok = Object.values(snap.okrsky);
        expect(ok).toHaveLength(stats.counted);
        const withVotes = ok.filter((o) => o.votes);
        expect(ok.length - withVotes.length).toBe(stats.pending);
        const shares = withVotes.map((o) => (o.votes[15] / Object.values(o.votes).reduce((s, v) => s + v, 0)) * 100);
        expect(Math.max(...shares) - Math.min(...shares)).toBeGreaterThan(8); // heat mapa má co ukázat
        expect(Math.min(...shares)).toBeGreaterThan(1);
        expect(Math.max(...shares)).toBeLessThan(50);
    });
});
