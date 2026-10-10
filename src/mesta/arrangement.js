// Banner „Jak tu kandidují Piráti": čistý view-model. `arrangementView` vrací přesně to,
// co komponenta vykreslí; všechny české texty jsou na jednom místě (TEXT).
// Pravidla (spec §5, §6): „Piráti" samotní jen u typu a; u typu b název kandidátky a
// partneři, hlasy koalice se Pirátům nikdy nepřipisují.
import { fmtInt, fmtPct } from '../volby/format.js';

export const MAX_PEOPLE = 6;
const MAX_ELSEWHERE = 3;

export const TEXT = {
    heading: 'Jak tu kandidují Piráti',
    headingCoalition: 'Koalice s Piráty',
    headingAssociation: 'Sdružení s Piráty',
    pendingTitle: 'Způsob kandidatury Pirátů ještě ověřujeme',
    ownList: (id) => `Samostatná kandidátka Pirátů · č. ${id}`,
    coalition: (name, id, parts) => `Koalice „${name}“ (č. ${id})${parts ? `: ${parts}` : ''}`,
    association: (name, id) => `Sdružení Pirátů a nezávislých „${name}“ (č. ${id})`,
    associationWith: (name, id, parts) => `Sdružení „${name}“ (č. ${id}): ${parts}`,
    pirates: 'Piráti',
    independents: 'nezávislí',
    wholeListVotes: 'Hlasy a mandáty se počítají za celou kandidátku.',
    membersTitle: 'Členové Pirátů na kandidátce',
    othersListsTitle: 'Členové Pirátů na jiných kandidátkách',
    place: (n) => `${n}. místo`,
    onList: (list, listName) => `kandidátka č. ${list}${listName ? ` „${listName}“` : ''}`,
    nominatedBy: (party) => `navrhuje ${party}`,
    more: (n) => `+ dalších ${n}`,
    votes: (votes, pct) => `${fmtInt(votes)} hl. · ${fmtPct(pct)}`,
    seatEstimate: 'má mandát (odhad)',
    seatOfficial: 'má mandát (oficiálně)',
    noSeatEstimate: 'bez mandátu (odhad)',
    noSeatOfficial: 'bez mandátu',
    alsoElsewhere: (people, rest) => `Piráti kandidují i na jiných kandidátkách: ${people}${rest ? ` a ${rest} ${rest < 5 ? 'další' : 'dalších'}` : ''}.`,
    alsoElsewherePerson: (name, list, party) => `${name} (č. ${list}${party ? `, ${party}` : ''})`,
    noOwnList: 'Piráti tu nemají vlastní kandidátku',
    onlyOtherLists: 'Piráti kandidují jen na kandidátkách jiných stran.',
    notRunning: 'Piráti tu letos nekandidují (podle registru ČSÚ)',
    source: 'Zdroj: registr kandidátů ČSÚ (20261007)',
};

const byPosition = (a, b) => a.n - b.n;

// Čísla z modelu: jen když už jsou hlasy a kandidát na své kandidátce existuje
function person({ key, name, where, list, n }, model) {
    const found = model?.hasVotes ? model.councilors?.[list]?.list?.find((c) => c.n === n) : null;
    const base = { key, name, where, votes: null, pct: null, seat: null, official: false, votesLabel: null, seatLabel: null };
    if (!found) return base;
    const official = !!model.official;
    const seat = !!found.seat;
    return {
        ...base,
        votes: found.votes,
        pct: found.pct,
        seat,
        official,
        votesLabel: TEXT.votes(found.votes, found.pct),
        seatLabel: seat ? (official ? TEXT.seatOfficial : TEXT.seatEstimate) : (official ? TEXT.noSeatOfficial : TEXT.noSeatEstimate),
    };
}

function titleOf(list) {
    const parts = [...list.partners.map((p) => p.short), ...(list.independents ? [TEXT.independents] : [])];
    const joined = parts.length ? [TEXT.pirates, ...parts].join(' + ') : '';
    if (list.kind === 'association') {
        return !list.partners.length && list.independents
            ? TEXT.association(list.name, list.id)
            : TEXT.associationWith(list.name, list.id, joined || TEXT.pirates);
    }
    return TEXT.coalition(list.name, list.id, joined);
}

function elsewhere(others) {
    if (!others.length) return null;
    const shown = others.slice(0, MAX_ELSEWHERE).map((o) => TEXT.alsoElsewherePerson(o.name, o.list, o.nominatedBy));
    return TEXT.alsoElsewhere(shown.join(', '), others.length - shown.length);
}

function footerOf(council) {
    const note = String(council.note ?? council.arrangement?.note ?? '').trim();
    return note ? `${TEXT.source} · ${note}` : TEXT.source;
}

// council: objekt z src/mesta/councils.js; model: buildModel(...) (nebo null před načtením)
export function arrangementView({ council, model }) {
    const a = council?.arrangement;
    if (!council?.shown || !a) return null;

    const view = {
        heading: TEXT.heading,
        pending: false,
        title: '',
        lines: [],
        peopleTitle: null,
        people: [],
        more: 0,
        moreLabel: null,
        alsoElsewhere: null,
        footer: footerOf(council),
    };
    const withPeople = (title, rows, toPerson) => {
        const sorted = [...rows].sort(byPosition);
        const people = sorted.slice(0, MAX_PEOPLE).map((r) => person(toPerson(r), model));
        const more = Math.max(0, sorted.length - people.length);
        return { people, more, moreLabel: more ? TEXT.more(more) : null, peopleTitle: sorted.length ? title : null };
    };

    if (a.type === 'a' || a.type === 'b') {
        if (council.pirates == null || !a.list) return { ...view, pending: true, title: TEXT.pendingTitle };
        const own = a.type === 'a';
        return {
            ...view,
            heading: own ? TEXT.heading : a.list.kind === 'association' ? TEXT.headingAssociation : TEXT.headingCoalition,
            title: own ? TEXT.ownList(a.list.id) : titleOf(a.list),
            lines: own ? [] : [TEXT.wholeListVotes],
            ...withPeople(TEXT.membersTitle, a.members, (m) => ({ key: `${m.list}-${m.n}`, name: m.name, where: TEXT.place(m.n), list: m.list, n: m.n })),
            alsoElsewhere: elsewhere(a.others),
        };
    }

    if (a.type === 'c') {
        return {
            ...view,
            title: TEXT.noOwnList,
            lines: [TEXT.onlyOtherLists],
            ...withPeople(TEXT.othersListsTitle, a.others, (o) => ({
                key: `${o.list}-${o.n}`,
                name: o.name,
                where: [TEXT.place(o.n), TEXT.onList(o.list, o.listName), o.nominatedBy && TEXT.nominatedBy(o.nominatedBy)].filter(Boolean).join(' · '),
                list: o.list,
                n: o.n,
            })),
        };
    }

    if (a.type === 'd') return { ...view, title: TEXT.notRunning };
    return null;
}
