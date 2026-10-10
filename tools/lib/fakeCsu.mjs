// Falešný volby.gov.cz pro ověření mapy okrsků města (bez sítě): ze skutečných polygonů
// (public-mesta/data/<slug>/okrsky.geojson) a kandidátek (lists.json) vyrobí soubory ve tvaru
// ČSÚ — souhrn města, účast po okrscích a okrskové soubory. Část okrsků je „sečtená“, u části
// sečtených okrskový soubor chybí (404 = hlasy se ještě dotahují), zbytek je nesečtený.
// Podíl Pirátů se plynule mění po ploše města (aby heat mapa nebyla jednobarevná).
// Deterministické podle `seed`. Nic se nezapisuje.

function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const firstRing = (g) => (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]);
const centroid = (g) => {
    const ring = firstRing(g);
    return [ring.reduce((s, c) => s + c[0], 0) / ring.length, ring.reduce((s, c) => s + c[1], 0) / ring.length];
};

/**
 * @param {{council: object, lists: object, geo: object}} input council = položka z buildCouncils,
 *   lists = lists.json města, geo = okrsky.geojson města
 * @param {{counted?: number, pending?: number, seed?: number, generated?: string}} opts
 *   counted = podíl sečtených okrsků (0–1), pending = podíl sečtených, kterým chybí okrskový soubor
 * @returns {{files: Record<string, object>, stats: object}} files = cesta → JSON, jak ji dává ČSÚ
 */
export function buildFakeCsu({ council, lists, geo }, { counted = 0.3, pending = 0, seed = 1, generated = '2026-10-10T16:40:00' } = {}) {
    const rand = rng(seed);
    const listIds = lists.lists.map((l) => l.id);
    const ours = council.pirates;
    // základní podíly kandidátek (náhodné, součet 1); Piráti zhruba 12 %
    const raw = Object.fromEntries(listIds.map((id) => [id, id === ours ? 1.4 : 0.3 + rand() * 1.6]));
    const rawSum = Object.values(raw).reduce((s, v) => s + v, 0);
    const base = Object.fromEntries(listIds.map((id) => [id, raw[id] / rawSum]));
    base[ours] = 0.12;

    const cents = geo.features.map((f) => ({ id: Number(f.properties.cislo), c: centroid(f.geometry) }));
    const xs = cents.map((p) => p.c[0]);
    const ys = cents.map((p) => p.c[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // všechny okrsky 2026 (i ty bez polygonu): polygony + doplnění do council.precincts
    const ids = cents.map((p) => p.id);
    for (let k = 1; ids.length < council.precincts; k++) if (!ids.includes(90000 + k)) ids.push(90000 + k);
    const pos = new Map(cents.map((p) => [p.id, [(p.c[0] - x0) / (x1 - x0 || 1), (p.c[1] - y0) / (y1 - y0 || 1)]]));

    const order = [...ids].sort(() => rand() - 0.5);
    const nCounted = Math.round(ids.length * counted);
    const countedIds = new Set(order.slice(0, nCounted));
    const pendingIds = new Set([...countedIds].slice(0, Math.round(nCounted * pending)));

    const precinct = new Map();
    for (const id of countedIds) {
        const [gx, gy] = pos.get(id) || [rand(), rand()];
        const g = 0.5 * gx + 0.5 * (1 - gy); // 0–1 po ploše
        const voters = 600 + Math.floor(rand() * 1800);
        const envelopes = Math.round(voters * (0.32 + rand() * 0.25));
        const share = { ...base };
        share[ours] = Math.min(0.45, base[ours] * (0.35 + 1.9 * g) * (0.9 + rand() * 0.2));
        const rest = Object.keys(share).filter((k) => Number(k) !== ours);
        const restSum = rest.reduce((s, k) => s + base[k] * (0.8 + rand() * 0.4), 0);
        const weights = Object.fromEntries(rest.map((k) => [k, (base[k] * (0.8 + rand() * 0.4)) / restSum * (1 - share[ours])]));
        weights[ours] = share[ours];
        const total = envelopes * 5;
        const votes = Object.fromEntries(listIds.map((l) => [l, Math.round(total * weights[l])]));
        const validVotes = Object.values(votes).reduce((s, v) => s + v, 0);
        precinct.set(id, { voters, envelopes, votes, validVotes });
    }

    const sum = (f) => [...precinct.values()].reduce((s, p) => s + f(p), 0);
    const totalVotes = Object.fromEntries(listIds.map((l) => [l, sum((p) => p.votes[l])]));
    const validVotes = sum((p) => p.validVotes);
    const voters = sum((p) => p.voters);
    const envelopes = sum((p) => p.envelopes);
    const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : 0);
    const nameOf = new Map(lists.lists.map((l) => [l.id, l.short30]));

    const files = {};
    const dir = `${council.okres}/${council.zastup}`;
    files[`vysled/${dir}.json`] = {
        generovano: generated,
        zvoleno: false,
        prehled: [council.seats, 1, council.precincts, precinct.size, pct(precinct.size, council.precincts), voters, envelopes, pct(envelopes, voters), 0, envelopes, envelopes, 99, validVotes],
        vysledky: listIds.map((l) => [l, nameOf.get(l), totalVotes[l], pct(totalVotes[l], validVotes), 0, totalVotes[l], pct(totalVotes[l], validVotes)]),
        plne_nazvy_stran: listIds.map((l) => [l, nameOf.get(l)]),
        hlasy: {},
        hranice: {},
    };
    files[`ucast/obec/${council.okres}/${council.zastup}.json`] = {
        generovano: generated,
        okrsky: ids.map((id) => {
            const p = precinct.get(id);
            return p
                ? [id, p.voters, p.envelopes, pct(p.envelopes, p.voters), 0, p.envelopes, p.envelopes, 99, p.validVotes, '1']
                : [id, 0, 0, 0, 0, 0, 0, 0, 0, '1'];
        }),
    };
    for (const [id, p] of precinct) {
        if (pendingIds.has(id)) continue; // soubor ještě není → 404
        files[`vysled/okrsek/${council.okres}/${council.zastup}_${id}.json`] = {
            generovano: generated,
            prehled: [p.voters, p.envelopes, pct(p.envelopes, p.voters), 0, p.envelopes, p.envelopes, 99, p.validVotes],
            vysledky: listIds.map((l) => [l, nameOf.get(l), p.votes[l]]),
        };
    }
    return {
        files,
        stats: { precincts: ids.length, polygons: cents.length, counted: precinct.size, pending: pendingIds.size, withoutPolygon: ids.length - cents.length },
    };
}

/** Falešný fetch pro createKvFeed: cesta za `/appdata/kv2026/<datum>/` (nebo /base/) → JSON, jinak 404. */
export function fakeFetch(files) {
    return async (url) => {
        const path = String(url).replace(/^https?:\/\/[^/]+\/(?:base\/)?(?:appdata\/kv2026\/\d+\/)?/, '');
        const f = files[path];
        if (f === undefined) return new Response('{}', { status: 404 });
        return new Response(JSON.stringify(f), { status: 200, headers: { etag: `"${path}"` } });
    };
}
