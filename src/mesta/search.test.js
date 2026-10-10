import { describe, expect, it } from 'vitest';
import ALIASES from './aliases.js';
import { buildIndex, buildSearchIndex, foldCz, norm, osa, praguePageUrl, search, searchTowns, stripPrep } from './search.js';
import { FIXTURE_COUNCILS, FIXTURE_EXCLUDED, FIXTURE_HIDDEN } from './index/devFixture.jsx';

const index = buildIndex(FIXTURE_COUNCILS, ALIASES, FIXTURE_EXCLUDED);
const names = (q, limit = 6) => search(index, q, { limit }).items.map((i) => i.name);
const BRANDYS = 'Brandýs nad Labem-Stará Boleslav';

describe('norm / foldCz', () => {
    it.each([
        ['Plzeň', 'plzen'],
        ['  PLZEŇ ', 'plzen'],
        ['Frýdek-Místek', 'frydek mistek'],
        ['Frýdek – Místek', 'frydek mistek'],
        [BRANDYS, 'brandys nad labem stara boleslav'],
        ['Ústí n. L.', 'usti n l'],
        ['Ústí n/L', 'usti n l'],
        ['„Praha 7"', 'praha 7'],
        ['Dvůr Králové nad Labem', 'dvur kralove nad labem'],
    ])('norm(%j) = %j', (input, expected) => {
        expect(norm(input)).toBe(expected);
    });
    it('foldCz is the same normaliser', () => {
        expect(foldCz('Ústí nad Labem')).toBe('usti nad labem');
    });
});

describe('stripPrep', () => {
    it.each([
        ['v plzni', 'plzni'],
        ['ve zline', 'zline'],
        ['z plzne', 'plzne'],
        ['u', 'u'],
        ['usti', 'usti'],
        ['nachod', 'nachod'],
    ])('stripPrep(%j) = %j', (input, expected) => {
        expect(stripPrep(input)).toBe(expected);
    });
});

describe('osa', () => {
    it('counts a transposition as one edit', () => {
        expect(osa('plzne', 'plzen')).toBe(1);
        expect(osa('olomuc', 'olomouc')).toBe(1);
        expect(osa('abc', 'abc')).toBe(0);
    });
});

describe('search: the proposal pairs', () => {
    it.each([
        ['plzen', ['Plzeň', 'Plzeňský kraj']],
        ['v Plzni', ['Plzeň']],
        ['z Plzně', ['Plzeň']],
        ['frydek', ['Frýdek-Místek']],
        ['Frýdek Místek', ['Frýdek-Místek']],
        ['Brandys', [BRANDYS]],
        ['Stará Boleslav', [BRANDYS]],
        ['Boleslav', ['Mladá Boleslav', BRANDYS]],
        ['Olomouc', ['Olomouc', 'Uničov', 'Olomoucký kraj']],
        ['olomuc', ['Olomouc']],
        ['Karvina', ['Karviná', 'Orlová', 'Český Těšín']],
        ['Praha-východ', [BRANDYS, 'Říčany', 'Čelákovice']],
        ['Praha 7', ['Praha']],
        ['v Praze', ['Praha']],
        ['Havířov', ['Havířov']],
        ['CB', ['České Budějovice']],
        ['budejky', ['České Budějovice']],
        ['hk', ['Hradec Králové']],
        ['Hradec', ['Hradec Králové', 'Jindřichův Hradec']],
        ['Kralove', ['Hradec Králové', 'Dvůr Králové nad Labem', 'Královéhradecký kraj']],
        ['Mostě', ['Most']],
        ['ve Zlíně', ['Zlín']],
        ['ústí n. l.', ['Ústí nad Labem']],
        ['ustecky', ['Ústecký kraj']],
        ['vysocina', ['Kraj Vysočina']],
        ['xyzabc', []],
    ])('%j → %j', (query, expected) => {
        expect(names(query)).toEqual(expected);
    });

    it('the five acceptance searches give the right first result', () => {
        for (const [q, first] of [['plzen', 'Plzeň'], ['frydek', 'Frýdek-Místek'], ['v Plzni', 'Plzeň'], ['Brandys', BRANDYS], ['Olomouc', 'Olomouc']]) {
            expect(names(q)[0]).toBe(first);
        }
    });
});

describe('search: result shape and rules', () => {
    it('towns carry the "město (okres)" label, a slug and a kraj; the town comes with its okres line', () => {
        const [plzen] = search(index, 'plzen', { limit: 6 }).items;
        expect(plzen).toMatchObject({ kind: 'town', slug: 'plzen', zastup: 554791, label: 'Plzeň (Plzeň-město)', sub: 'okres Plzeň-město · Plzeňský kraj' });
    });
    it('the kraj option is appended after the towns and counts towns', () => {
        const items = search(index, 'plzen', { limit: 6 }).items;
        expect(items[1]).toMatchObject({ kind: 'kraj', kraj: 3200, name: 'Plzeňský kraj', count: 5 });
    });
    it('Praha answers with the link, not a town', () => {
        const [praha] = search(index, 'v Praze', { limit: 6 }).items;
        expect(praha).toMatchObject({ kind: 'other', name: 'Praha', url: 'https://praha.dg12.cz' });
        expect(praguePageUrl).toBe('https://praha.dg12.cz');
    });
    it('a town we do not cover answers with its reason', () => {
        expect(search(index, 'Havířov', { limit: 6 }).items[0]).toMatchObject({ kind: 'other', name: 'Havířov', note: expect.stringContaining('nemají vlastní ani koaliční') });
        expect(search(index, 'Sokolov', { limit: 6 }).items[0].note).toContain('jen na kandidátkách jiných stran');
    });
    it('typos are shown only when nothing better exists, and flagged', () => {
        const r = search(index, 'olomuc', { limit: 6 });
        expect(r.fuzzy).toBe(true);
        expect(search(index, 'olomouc', { limit: 6 }).fuzzy).toBe(false);
    });
    it('respects the limit and reports the total', () => {
        const r = search(index, 'm', { limit: 3 });
        expect(r.items).toHaveLength(3);
        expect(r.total).toBeGreaterThan(3);
    });
    it('an empty or whitespace query gives nothing', () => {
        expect(search(index, '   ', { limit: 6 })).toEqual({ items: [], total: 0, fuzzy: false });
    });
    it('searchTowns / buildSearchIndex are the same functions with positional arguments', () => {
        expect(buildSearchIndex).toBe(buildIndex);
        expect(searchTowns(index, 'plzen', 6).items.map((i) => i.name)).toEqual(['Plzeň', 'Plzeňský kraj']);
    });
    it('published towns come before a not-covered entry of the same rank, then population', () => {
        // „Ostrov" (not covered) never outranks the published town "Ostrava" for the prefix "ostr"
        expect(names('ostr').slice(0, 2)).toEqual(['Ostrava', 'Ostrov']);
    });
});

describe('hidden towns (H1)', () => {
    it('a town that is not in `towns` (COUNCILS) is never a result', () => {
        expect(FIXTURE_HIDDEN[0].shown).toBe(false);
        expect(names('Skrytá')).toEqual([]);
        expect(names('lhota')).toEqual([]);
    });
    it('unless the caller lists it as "unverified": then only a non-navigating entry', () => {
        const withUnverified = buildIndex(FIXTURE_COUNCILS, ALIASES, FIXTURE_EXCLUDED, { unverified: FIXTURE_HIDDEN });
        const [hit] = search(withUnverified, 'Skrytá', { limit: 6 }).items;
        expect(hit).toMatchObject({ kind: 'verify', name: 'Skrytá Lhota', note: 'Způsob kandidatury Pirátů ještě ověřujeme' });
        expect(hit.slug).toBeUndefined();
    });
});

describe('alias table', () => {
    const byZastup = new Map(FIXTURE_COUNCILS.map((c) => [String(c.zastup), c]));
    const entries = Object.entries(ALIASES);

    it('every key names the town that has this KODZASTUP (typo guard)', () => {
        for (const [z, e] of entries) {
            const town = byZastup.get(z);
            if (town) expect(e.name, z).toBe(town.name);
        }
    });
    it('covers every published town with an okres', () => {
        for (const c of FIXTURE_COUNCILS) expect(ALIASES[String(c.zastup)]?.okres, c.name).toBeTruthy();
    });
    it('the first result for each alias form is its own town', () => {
        for (const [z, e] of entries) {
            const town = byZastup.get(z);
            if (!town) continue;
            for (const form of e.forms) {
                const first = search(index, form, { limit: 6 }).items[0];
                expect(first?.name, `${form} → ${town.name}`).toBe(town.name);
            }
        }
    });
    it('no alias form equals another town\'s name or okres', () => {
        const taken = new Map();
        for (const c of FIXTURE_COUNCILS) taken.set(norm(c.name), c.name);
        for (const [z, e] of entries) {
            const own = byZastup.get(z);
            for (const form of e.forms) {
                const clash = taken.get(norm(form));
                expect(clash === undefined || clash === own?.name, `${form} clashes with ${clash}`).toBe(true);
            }
        }
        const okresy = new Set(Object.values(ALIASES).map((e) => norm(e.okres)));
        for (const [z, e] of entries) {
            for (const form of e.forms) {
                if (okresy.has(norm(form))) {
                    // „Olomouc" as a form of the okres Olomouc is fine only for the town of the same name
                    expect(norm(form), `${z} ${form}`).toBe(norm(e.name));
                }
            }
        }
    });
    it('an alias with the wrong name is ignored by the index, not applied to another town', () => {
        const bad = { ...ALIASES, 554791: { name: 'Brno', okres: 'Brno-město', forms: ['Pilsen'] } };
        const idx = buildIndex(FIXTURE_COUNCILS, bad, []);
        expect(search(idx, 'Pilsen', { limit: 6 }).items).toEqual([]);
    });
    it('auto initials are exact-only and dropped when ambiguous', () => {
        const initials = index.entries.filter((e) => e.initials).map((e) => e.initials);
        expect(new Set(initials).size).toBe(initials.length);
        expect(names('ct')).not.toContain('Česká Třebová');
        // „ct" would be Česká Třebová and Český Těšín → dropped (Český Těšín still matches by its words)
        expect(index.entries.find((e) => e.name === 'Česká Třebová').initials).toBeNull();
        expect(index.entries.find((e) => e.name === 'Hradec Králové').initials).toBe('hk');
    });
});
