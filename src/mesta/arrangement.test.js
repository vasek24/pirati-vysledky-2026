// Banner „Jak tu kandidují Piráti": čistý view-model + jednoduchý render (SSR) pro přístupnost.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { arrangementView, MAX_PEOPLE, TEXT } from './arrangement.js';
import MestaArrangement from './MestaArrangement.jsx';

const base = {
    kraj: 3200, krajName: 'Plzeňský kraj', precincts: 174, seats: 47, confidence: 'high', shown: true,
    map: false, precinctFiles: false, pirateCandidates: [],
};
const arr = (type, list, rest = {}) => ({ type, list, members: [], others: [], flags: [], ...rest });

const PARTY = { id: 11, name: 'Česká pirátská strana', short: 'Česká pirátská strana', short8: 'Piráti', vstrana: 720, kind: 'party', partners: [], independents: false };
const COALITION = { id: 4, name: 'PIRÁTI a STAROSTOVÉ', short: 'PIRÁTI a STAROSTOVÉ', short8: 'STAN+Piráti', vstrana: 1350, kind: 'coalition', partners: [{ code: 166, short: 'STAN' }], independents: false };
const ASSOCIATION = { id: 4, name: 'Piráti a nezávislí', short: 'Piráti a nezávislí', short8: 'Piráti+NK', vstrana: 541, kind: 'association', partners: [], independents: true };

const plzen = { ...base, slug: 'plzen', name: 'Plzeň', zastup: 554791, pirates: 11, arrangement: arr('a', PARTY) };
const hradec = { ...base, slug: 'hradec-kralove', name: 'Hradec Králové', zastup: 569810, kraj: 5200, pirates: 4, arrangement: arr('b', COALITION) };
const jablonec = { ...base, slug: 'jablonec-nad-nisou', name: 'Jablonec nad Nisou', zastup: 563510, kraj: 5100, pirates: 4, arrangement: arr('b', ASSOCIATION) };
const hidden = { ...base, slug: 'skryte', name: 'Skryté', zastup: 999001, shown: false, pirates: null, arrangement: arr('b', COALITION) };
const sokolov = { ...base, slug: 'sokolov', name: 'Sokolov', zastup: 560286, pirates: null, arrangement: arr('c', null, { others: [{ list: 7, listName: 'Sokolov sobě', n: 5, name: 'Lukáš Zykán', nominatedBy: 'STAN' }] }) };
const havirov = { ...base, slug: 'havirov', name: 'Havířov', zastup: 555088, pirates: null, arrangement: arr('d', null) };

const members = (n, list = 11) => Array.from({ length: n }, (_, i) => ({ list, n: i + 1, name: `Člen ${i + 1}` }));
const withMembers = (council, n) => ({ ...council, arrangement: { ...council.arrangement, members: members(n, council.arrangement.list?.id) } });

const noVotes = { hasVotes: false, official: false, councilors: {} };
const votes = (list, rows, official = false) => ({ hasVotes: true, official, councilors: { [list]: { list: rows } } });

describe('hidden and defensive cases', () => {
    it('returns null for a hidden town and the component renders nothing', () => {
        expect(arrangementView({ council: hidden, model: noVotes })).toBeNull();
        expect(renderToStaticMarkup(React.createElement(MestaArrangement, { council: hidden, model: noVotes }))).toBe('');
    });
    it('returns null without an arrangement', () => {
        expect(arrangementView({ council: { ...plzen, arrangement: undefined }, model: noVotes })).toBeNull();
    });
    it('works without a model at all (before the feed loads)', () => {
        const v = arrangementView({ council: withMembers(plzen, 2), model: null });
        expect(v.people).toHaveLength(2);
        expect(v.people[0].votes).toBeNull();
    });
    it('type a/b with pirates null is pending: ověřujeme, no people, no coalition claim', () => {
        const v = arrangementView({ council: { ...withMembers(hradec, 3), pirates: null }, model: noVotes });
        expect(v.pending).toBe(true);
        expect(v.title).toBe('Způsob kandidatury Pirátů ještě ověřujeme');
        expect(v.heading).toBe('Jak tu kandidují Piráti');
        expect(v.people).toEqual([]);
        expect(v.lines).toEqual([]);
        expect(v.footer).toContain('registr kandidátů ČSÚ (20261007)');
    });
});

describe('type a: own list', () => {
    it('heading and title', () => {
        const v = arrangementView({ council: plzen, model: noVotes });
        expect(v.heading).toBe('Jak tu kandidují Piráti');
        expect(v.title).toBe('Samostatná kandidátka Pirátů · č. 11');
        expect(v.pending).toBe(false);
        expect(v.lines).toEqual([]);
        expect(v.people).toEqual([]);
        expect(v.peopleTitle).toBeNull();
    });
    it('members: position and name, no vote numbers before counting', () => {
        const v = arrangementView({ council: withMembers(plzen, 3), model: noVotes });
        expect(v.peopleTitle).toBe('Členové Pirátů na kandidátce');
        expect(v.people.map((p) => [p.key, p.name, p.where])).toEqual([
            ['11-1', 'Člen 1', '1. místo'],
            ['11-2', 'Člen 2', '2. místo'],
            ['11-3', 'Člen 3', '3. místo'],
        ]);
        for (const p of v.people) {
            expect(p).toMatchObject({ votes: null, pct: null, seat: null, official: false, votesLabel: null, seatLabel: null });
        }
        expect(v.more).toBe(0);
        expect(v.moreLabel).toBeNull();
    });
});

describe('type b: coalition and association', () => {
    it('coalition heading, title with partners, count line', () => {
        const v = arrangementView({ council: hradec, model: noVotes });
        expect(v.heading).toBe('Koalice s Piráty');
        expect(v.title).toBe('Koalice „PIRÁTI a STAROSTOVÉ“ (č. 4): Piráti + STAN');
        expect(v.lines).toEqual(['Hlasy a mandáty se počítají za celou kandidátku.']);
    });
    it('never says plain "Piráti" as the list for a coalition', () => {
        const v = arrangementView({ council: hradec, model: noVotes });
        expect(v.title).not.toMatch(/^Samostatná/);
        expect(v.heading).not.toBe('Jak tu kandidují Piráti');
    });
    it('coalition with independents adds "nezávislí"', () => {
        const c = { ...hradec, arrangement: arr('b', { ...COALITION, independents: true }) };
        expect(arrangementView({ council: c, model: noVotes }).title).toBe('Koalice „PIRÁTI a STAROSTOVÉ“ (č. 4): Piráti + STAN + nezávislí');
    });
    it('coalition of several partners', () => {
        const c = { ...hradec, arrangement: arr('b', { ...COALITION, partners: [{ code: 1, short: 'STAN' }, { code: 2, short: 'Zelení' }] }) };
        expect(arrangementView({ council: c, model: noVotes }).title).toBe('Koalice „PIRÁTI a STAROSTOVÉ“ (č. 4): Piráti + STAN + Zelení');
    });
    it('association of Pirates and independents', () => {
        const v = arrangementView({ council: jablonec, model: noVotes });
        expect(v.heading).toBe('Sdružení s Piráty');
        expect(v.title).toBe('Sdružení Pirátů a nezávislých „Piráti a nezávislí“ (č. 4)');
        expect(v.lines).toEqual(['Hlasy a mandáty se počítají za celou kandidátku.']);
    });
    it('association with partners names them', () => {
        const c = { ...jablonec, arrangement: arr('b', { ...ASSOCIATION, partners: [{ code: 166, short: 'STAN' }] }) };
        expect(arrangementView({ council: c, model: noVotes }).title).toBe('Sdružení „Piráti a nezávislí“ (č. 4): Piráti + STAN + nezávislí');
    });
    it('type a never carries the count line', () => {
        expect(arrangementView({ council: plzen, model: noVotes }).lines).not.toContain(TEXT.wholeListVotes);
    });
});

describe('members, votes and mandates', () => {
    it('shows at most 6 rows and "+ dalších N"', () => {
        const v = arrangementView({ council: withMembers(hradec, 8), model: noVotes });
        expect(MAX_PEOPLE).toBe(6);
        expect(v.people).toHaveLength(6);
        expect(v.people.at(-1).name).toBe('Člen 6');
        expect(v.more).toBe(2);
        expect(v.moreLabel).toBe('+ dalších 2');
    });
    it('exactly 6 members: no "more"', () => {
        const v = arrangementView({ council: withMembers(hradec, 6), model: noVotes });
        expect(v.people).toHaveLength(6);
        expect(v.more).toBe(0);
    });
    it('orders by list position even if the input is shuffled', () => {
        const c = { ...hradec, arrangement: { ...hradec.arrangement, members: [{ list: 4, n: 9, name: 'B' }, { list: 4, n: 2, name: 'A' }] } };
        expect(arrangementView({ council: c, model: noVotes }).people.map((p) => p.name)).toEqual(['A', 'B']);
    });
    it('estimate: seat true, official false, wording "odhad"', () => {
        const model = votes(11, [{ n: 1, votes: 500, pct: 4.1, seat: true }, { n: 2, votes: 40, pct: 0.3, seat: false }]);
        const v = arrangementView({ council: withMembers(plzen, 2), model });
        expect(v.people[0]).toMatchObject({ votes: 500, pct: 4.1, seat: true, official: false, seatLabel: 'má mandát (odhad)' });
        expect(v.people[0].votesLabel).toBe('500 hl. · 4,1 %');
        expect(v.people[1]).toMatchObject({ votes: 40, seat: false, official: false, seatLabel: 'bez mandátu (odhad)' });
    });
    it('official: wording "oficiálně"', () => {
        const model = votes(11, [{ n: 1, votes: 5000, pct: 12.34, seat: true }, { n: 2, votes: 40, pct: 0.3, seat: false }], true);
        const v = arrangementView({ council: withMembers(plzen, 2), model });
        expect(v.people[0]).toMatchObject({ seat: true, official: true, seatLabel: 'má mandát (oficiálně)' });
        expect(v.people[0].votesLabel).toBe('5\u00a0000 hl. · 12,3 %');
        expect(v.people[1]).toMatchObject({ seat: false, official: true, seatLabel: 'bez mandátu (oficiálně)' });
    });
    it('with votes, seat holders come first, then list position; the cut keeps them', () => {
        const rows = Array.from({ length: 9 }, (_, i) => ({ n: i + 1, votes: 100 - i, pct: 1, seat: i + 1 === 9 || i + 1 === 2 }));
        const v = arrangementView({ council: withMembers(plzen, 9), model: votes(11, rows) });
        expect(v.people.map((p) => p.name)).toEqual(['Člen 2', 'Člen 9', 'Člen 1', 'Člen 3', 'Člen 4', 'Člen 5']);
        expect(v.people[1].where).toBe('9. místo');
        expect(v.more).toBe(3);
    });
    it('without votes the order is plain list position', () => {
        const v = arrangementView({ council: withMembers(plzen, 9), model: noVotes });
        expect(v.people.map((p) => p.name)).toEqual(['Člen 1', 'Člen 2', 'Člen 3', 'Člen 4', 'Člen 5', 'Člen 6']);
    });
    it('matches positions numerically even if the feed gives strings', () => {
        const model = votes(11, [{ n: '1', votes: 12, pct: 1, seat: true }]);
        expect(arrangementView({ council: withMembers(plzen, 1), model }).people[0]).toMatchObject({ votes: 12, seat: true });
        const c = { ...plzen, arrangement: { ...plzen.arrangement, members: [{ list: 11, n: '1', name: 'Text' }] } };
        expect(arrangementView({ council: c, model: votes(11, [{ n: 1, votes: 5, pct: 1, seat: false }]) }).people[0].votes).toBe(5);
    });
    it('looks the person up on the Pirate list of the council, not on another list', () => {
        const model = { hasVotes: true, official: false, councilors: { 99: { list: [{ n: 1, votes: 9999, pct: 50, seat: true }] }, 4: { list: [{ n: 1, votes: 7, pct: 1, seat: false }] } } };
        const v = arrangementView({ council: withMembers(hradec, 1), model });
        expect(v.people[0]).toMatchObject({ votes: 7, seat: false });
    });
    it('hasVotes but the candidate is missing in the model: no numbers, no invented seat', () => {
        const v = arrangementView({ council: withMembers(plzen, 2), model: votes(11, [{ n: 1, votes: 5, pct: 1, seat: false }]) });
        expect(v.people[1]).toMatchObject({ votes: null, pct: null, seat: null, seatLabel: null });
    });
    it('hasVotes false hides numbers even if the model carries zero rows', () => {
        const model = { hasVotes: false, official: false, councilors: { 11: { list: [{ n: 1, votes: 0, pct: 0, seat: false }] } } };
        const v = arrangementView({ council: withMembers(plzen, 1), model });
        expect(v.people[0]).toMatchObject({ votes: null, seat: null });
    });
});

describe('Pirates on other lists', () => {
    const others = [
        { list: 7, listName: 'Za Sokolov', n: 5, name: 'Lukáš Zykán', nominatedBy: 'STAN' },
        { list: 9, listName: 'Nezávislí', n: 2, name: 'Jana Nováková', nominatedBy: 'NK' },
    ];
    it('a/b with others gets exactly one note line', () => {
        const c = { ...plzen, arrangement: { ...plzen.arrangement, others } };
        const v = arrangementView({ council: c, model: noVotes });
        expect(v.alsoElsewhere).toBe('Piráti kandidují i na jiných kandidátkách: Lukáš Zykán (č. 7, navrhuje STAN), Jana Nováková (č. 9, navrhuje NK).');
    });
    it('a/b without others: no note', () => {
        expect(arrangementView({ council: plzen, model: noVotes }).alsoElsewhere).toBeNull();
    });
    it('the note is capped and stays one line', () => {
        const many = Array.from({ length: 5 }, (_, i) => ({ list: 7, listName: 'X', n: i + 1, name: `Osoba ${i + 1}`, nominatedBy: 'STAN' }));
        const v = arrangementView({ council: { ...hradec, arrangement: { ...hradec.arrangement, others: many } }, model: noVotes });
        expect(v.alsoElsewhere).toBe('Piráti kandidují i na jiných kandidátkách: Osoba 1 (č. 7, navrhuje STAN), Osoba 2 (č. 7, navrhuje STAN), Osoba 3 (č. 7, navrhuje STAN) a 2 další.');
        expect(v.alsoElsewhere).not.toContain('\n');
    });
});

describe('forced c and d towns', () => {
    it('c: no own list, people from other lists with their list and nominating party', () => {
        const v = arrangementView({ council: sokolov, model: noVotes });
        expect(v.heading).toBe('Jak tu kandidují Piráti');
        expect(v.title).toBe('Piráti tu nemají vlastní kandidátku');
        expect(v.lines).toEqual(['Piráti kandidují jen na kandidátkách jiných stran.']);
        expect(v.peopleTitle).toBe('Členové Pirátů na jiných kandidátkách');
        expect(v.people).toHaveLength(1);
        expect(v.people[0]).toMatchObject({ key: '7-5', name: 'Lukáš Zykán', where: '5. místo · kandidátka č. 7 „Sokolov sobě“ · navrhuje STAN' });
        expect(v.alsoElsewhere).toBeNull();
    });
    it('c: votes and mandates come from the list the person is actually on', () => {
        const model = votes(7, [{ n: 5, votes: 321, pct: 2.5, seat: true }]);
        const v = arrangementView({ council: sokolov, model });
        expect(v.people[0]).toMatchObject({ votes: 321, seat: true, seatLabel: 'má mandát (odhad)' });
    });
    it('c: more than 6 people are capped', () => {
        const others = Array.from({ length: 9 }, (_, i) => ({ list: 7, listName: 'L', n: i + 1, name: `P${i + 1}`, nominatedBy: 'STAN' }));
        const v = arrangementView({ council: { ...sokolov, arrangement: arr('c', null, { others }) }, model: noVotes });
        expect(v.people).toHaveLength(6);
        expect(v.moreLabel).toBe('+ dalších 3');
    });
    it('d: Pirates do not run according to the ČSÚ register', () => {
        const v = arrangementView({ council: havirov, model: noVotes });
        expect(v.title).toBe('Piráti tu letos nekandidují (podle registru ČSÚ)');
        expect(v.lines).toEqual([]);
        expect(v.people).toEqual([]);
        expect(v.peopleTitle).toBeNull();
        expect(v.pending).toBe(false);
    });
});

describe('neutral flag', () => {
    it('is true for pending and type d, false for a, b and c', () => {
        expect(arrangementView({ council: havirov, model: noVotes }).neutral).toBe(true);
        expect(arrangementView({ council: { ...hradec, pirates: null }, model: noVotes }).neutral).toBe(true);
        expect(arrangementView({ council: { ...plzen, pirates: null }, model: noVotes }).neutral).toBe(true);
        for (const c of [plzen, hradec, jablonec, sokolov]) expect(arrangementView({ council: c, model: noVotes }).neutral).toBe(false);
    });
});

describe('footer', () => {
    it('cites the register', () => {
        expect(arrangementView({ council: plzen, model: noVotes }).footer).toBe('Zdroj: registr kandidátů ČSÚ (20261007)');
    });
    it('appends the override note', () => {
        const v = arrangementView({ council: { ...plzen, arrangement: { ...plzen.arrangement, note: 'Ověřeno u krajského týmu.' } }, model: noVotes });
        expect(v.footer).toBe('Zdroj: registr kandidátů ČSÚ (20261007) · Ověřeno u krajského týmu.');
    });
    it('does not read a note from the council root (only arrangement.note)', () => {
        expect(arrangementView({ council: { ...plzen, note: 'Nemá se zobrazit.' }, model: noVotes }).footer).toBe('Zdroj: registr kandidátů ČSÚ (20261007)');
    });
    it('ignores a blank note', () => {
        expect(arrangementView({ council: { ...plzen, arrangement: { ...plzen.arrangement, note: '   ' } }, model: noVotes }).footer).toBe('Zdroj: registr kandidátů ČSÚ (20261007)');
    });
});

describe('MestaArrangement markup', () => {
    const html = (council, model = noVotes) => renderToStaticMarkup(React.createElement(MestaArrangement, { council, model }));
    it('is a labelled region with an h2 and a real list', () => {
        const out = html(withMembers(hradec, 8));
        expect(out).toMatch(/<section[^>]*aria-labelledby="mesta-arr-heading"/);
        expect(out).toMatch(/<h2[^>]*id="mesta-arr-heading"[^>]*>Koalice s Piráty<\/h2>/);
        expect(out).toMatch(/<h3[^>]*>Členové Pirátů na kandidátce<\/h3>/);
        expect(out.match(/<li/g)).toHaveLength(6);
        expect(out).toMatch(/<\/ul><p[^>]*>\+ dalších 2<\/p>/);
        expect(out).toContain('Hlasy a mandáty se počítají za celou kandidátku.');
        expect(out).toContain('registr kandidátů ČSÚ (20261007)');
    });
    it('mandate is text, not only colour', () => {
        const model = votes(4, [{ n: 1, votes: 500, pct: 4.1, seat: true }]);
        const out = html(withMembers(hradec, 1), model);
        expect(out).toContain('má mandát (odhad)');
        expect(out).toContain('500 hl.');
    });
    it('renders no list when there are no people (type d)', () => {
        const out = html(havirov);
        expect(out).not.toContain('<ul');
        expect(out).toContain('Piráti tu letos nekandidují (podle registru ČSÚ)');
    });
    it('renders the also-elsewhere note', () => {
        const others = [{ list: 7, listName: 'X', n: 3, name: 'Karel Cizí', nominatedBy: 'STAN' }];
        const out = html({ ...plzen, arrangement: { ...plzen.arrangement, others } });
        expect(out).toContain('Piráti kandidují i na jiných kandidátkách: Karel Cizí (č. 7, navrhuje STAN).');
    });
    it('renders pending for type a as well', () => {
        const out = html({ ...plzen, pirates: null });
        expect(out).toContain('Způsob kandidatury Pirátů ještě ověřujeme');
        expect(out).not.toContain('Samostatná kandidátka');
    });
    it('renders "bez mandátu (oficiálně)" for an official non-seat', () => {
        const model = votes(11, [{ n: 1, votes: 5, pct: 0.2, seat: false }], true);
        expect(html(withMembers(plzen, 1), model)).toContain('bez mandátu (oficiálně)');
    });
    it('d and pending cards are neutral (no yellow ring); own lists keep the accent', () => {
        for (const out of [html(havirov), html({ ...hradec, pirates: null })]) {
            expect(out).toContain('border-neutral-300');
            expect(out).not.toContain('ring-[#FEC900]');
        }
        expect(html(plzen)).toContain('ring-[#FEC900]');
    });
    it('renders the pending state without a list', () => {
        const out = html({ ...hradec, pirates: null });
        expect(out).toContain('Způsob kandidatury Pirátů ještě ověřujeme');
        expect(out).not.toContain('<ul');
    });
});
