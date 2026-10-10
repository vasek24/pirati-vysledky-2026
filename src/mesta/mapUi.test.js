import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PENDING_FILL, isPending, oursButtonLabel, oursLongLabel } from './mapUi.js';
import { setActiveCouncil, partyMeta } from '../volby/council.js';
import { getMapMode } from '../volby/mapModes.js';
import { precinctShare } from '../volby/compute.js';
import { UNCOUNTED_FILL, PIRATE_RAMP } from '../volby/colors.js';
import { buildCouncils } from './buildCouncils.js';
import { applyPatches } from './patches.js';

const json = (rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe('isPending (sečteno, hlasy se dotahují)', () => {
    it('jen sečtený okrsek bez hlasů; nesečtený ani okrsek s hlasy ne', () => {
        expect(isPending(undefined, 'ours')).toBe(false);
        expect(isPending({ turnout: 50, votes: null }, 'ours')).toBe(true);
        expect(isPending({ turnout: 50, votes: { 1: 10 } }, 'ours')).toBe(false);
    });
    it('v režimu účasti se nic nedotahuje (účast už je)', () => {
        expect(isPending({ turnout: 50, votes: null }, 'turnout')).toBe(false);
    });
    it('barva čekajících okrsků se liší od šedé nesečtených', () => {
        expect(PENDING_FILL).not.toBe(UNCOUNTED_FILL);
    });
});

describe('popisky režimu Piráti', () => {
    it('samostatná kandidátka: Piráti; koalice: S Piráty + jméno kandidátky', () => {
        expect(oursButtonLabel({ members: [{ short: 'Piráti' }], short: 'Piráti' })).toBe('Piráti');
        expect(oursButtonLabel({ members: [{}, {}], short: 'PIRÁTI a STAROSTOVÉ' })).toBe('S Piráty');
        expect(oursLongLabel({ members: [{}, {}], short: 'PIRÁTI a STAROSTOVÉ' }, 'Piráti — podíl hlasů')).toBe('PIRÁTI a STAROSTOVÉ — podíl hlasů');
        expect(oursLongLabel({ members: [{}], short: 'X' }, 'Piráti — podíl hlasů')).toBe('Piráti — podíl hlasů');
        expect(oursLongLabel(undefined, 'Piráti — podíl hlasů')).toBe('Piráti — podíl hlasů');
    });
});

// Skutečná data: číslo kandidátky Pirátů (společná kandidátka = id kandidátky, ne Piráti sami)
describe('heat map "ours" uses the town Pirate list id (real data)', () => {
    const councils = buildCouncils(json('src/mesta/towns.generated.json'), json('src/mesta/specifics.generated.json'), { reviewedAt: null, towns: {} });
    const activate = (slug) => {
        const council = councils.find((c) => c.slug === slug);
        setActiveCouncil(council, json(`public-mesta/data/${slug}/lists.json`));
        return council;
    };

    for (const [slug, id, other] of [['brno', 15, 3], ['hradec-kralove', 4, 1], ['plzen', 11, 1]]) {
        it(`${slug}: Pirate list ${id}`, () => {
            const council = activate(slug);
            expect(council.map).toBe(true);
            expect(council.pirates).toBe(id);
            expect(partyMeta(id).pirates).toBe(true);
            const mode = getMapMode('ours');
            // okrsek: 30 % pro naši kandidátku, 70 % pro jinou
            const o = { votes: { [id]: 300, [other]: 700 }, turnout: 40 };
            expect(mode.value(o)).toBeCloseTo(30);
            expect(precinctShare(o, council.pirates)).toBeCloseTo(30);
            // Pirátova škála (žlutá → černá), ne škála barvy kandidátky
            expect(PIRATE_RAMP).toContain(mode.color(30));
            expect(mode.color(3)).not.toBe(mode.color(30));
            // okrsek bez hlasů mapa jako „sečtený s procenty“ nikdy neukáže
            expect(mode.value({ votes: null, turnout: 40 })).toBeNull();
            // okrsek, kde naše kandidátka nemá řádek, není 0 %
            expect(mode.value({ votes: { [other]: 10 } })).toBeNull();
        });
    }
});

describe('mapModesFor + patch: bez režimu „vs 2022“ pro města (precinctHistory: false)', () => {
    const MODES = 'src/volby/mapModes.js';
    // vytáhne MAP_MODES a mapModesFor z ZAPLATOVANÉHO zdroje a spustí je
    const load = (code) => {
        const start = code.indexOf('export const MAP_MODES');
        const mid = code.indexOf('const SHARE_BREAKS');
        const fnStart = code.indexOf('export function mapModesFor');
        const fnEnd = code.indexOf('export function getMapMode');
        const src = `${code.slice(start, mid)}\n${code.slice(fnStart, fnEnd)}`.replace(/export /g, '');
        return new Function(`${src}; return { MAP_MODES, mapModesFor };`)();
    };
    const ids = (fn, council) => fn(council).map((m) => m.id);

    it('originál (Praha): swing je dostupný, když jsou Piráti', () => {
        const { mapModesFor } = load(read(MODES));
        expect(ids(mapModesFor, { pirates: 1 })).toEqual(['ours', 'winner', 'swing', 'party', 'turnout']);
    });
    it('s precinctHistory: false swing zmizí, ostatní režimy zůstanou', () => {
        const { mapModesFor } = load(applyPatches(MODES, read(MODES)));
        expect(ids(mapModesFor, { pirates: 11, precinctHistory: false })).toEqual(['ours', 'winner', 'party', 'turnout']);
        expect(ids(mapModesFor, { pirates: 11, precinctHistory: false, coalition: { lists: [1] } })).toEqual(['ours', 'winner', 'coalition', 'party', 'turnout']);
        // Praha (bez příznaku) se záplatou nezměnila
        expect(ids(mapModesFor, { pirates: 1 })).toEqual(['ours', 'winner', 'swing', 'party', 'turnout']);
    });
    it('bez Pirátů zůstává bez „ours“ i „swing“', () => {
        const { mapModesFor } = load(applyPatches(MODES, read(MODES)));
        expect(ids(mapModesFor, { pirates: null, precinctHistory: false })).toEqual(['winner', 'party', 'turnout']);
    });
});

describe('FitBounds: prázdná kolekce nesmí shodit mapu', () => {
    const MAP = 'src/components/ResultsMap.jsx';
    it('záplata vloží kontrolu platnosti hranic hned za výpočet hranic', () => {
        const out = applyPatches(MAP, read(MAP));
        const a = out.indexOf('const bounds = L.geoJSON(data).getBounds();');
        const b = out.indexOf('if (!bounds.isValid()) return undefined;');
        expect(a).toBeGreaterThan(0);
        expect(b).toBeGreaterThan(a);
        expect(b - a).toBeLessThan(120);
        expect(out.indexOf('map.fitBounds')).toBeGreaterThan(b);
    });
    it('Leaflet: hranice prázdné FeatureCollection jsou neplatné, polygonu platné (podmínka v záplatě stačí)', () => {
        const stubs = { window: { screen: {}, devicePixelRatio: 1 }, document: { documentElement: { style: {} }, createElement: () => ({ style: {} }), addEventListener() {} }, navigator: { userAgent: '', platform: '' } };
        const saved = Object.fromEntries(Object.keys(stubs).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
        for (const [k, v] of Object.entries(stubs)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
        try {
            const L = createRequire(import.meta.url)('leaflet');
            expect(L.geoJSON({ type: 'FeatureCollection', features: [] }).getBounds().isValid()).toBe(false);
            const poly = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[16, 49], [16.1, 49], [16.1, 49.1], [16, 49]]] } };
            expect(L.geoJSON({ type: 'FeatureCollection', features: [poly] }).getBounds().isValid()).toBe(true);
        } finally {
            for (const [k, d] of Object.entries(saved)) {
                if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
            }
        }
    });
});
