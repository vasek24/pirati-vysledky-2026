// Čisté sestavení zastupitelstev pro produkt „mesta“ z vygenerovaných dat
// (towns/specifics.generated.json) a ručních overrides. Bez importu JSONu, takže
// ho umí použít i Node (scripts/build-data.js) a testy s vlastními fixturami.

export const TITLE_BY_DRUH = {
    1: 'Zastupitelstvo obce',
    2: 'Zastupitelstvo města',
    3: 'Zastupitelstvo statutárního města',
    6: 'Zastupitelstvo městyse',
};

const FEATURED_RE = /^top-\d+$/;

/**
 * Pravidlo zobrazení (spec 4.4, H1). Nízkou důvěru nastavenou přes override
 * (`confidence: 'low'`) uvolní jen vlastní `reviewed: true`; globální `reviewedAt`
 * uvolní jen nízkou důvěru z generátoru.
 */
export function isShown(spec, override, reviewedAt) {
    const o = override || {};
    if (o.confidence === 'low') return o.reviewed === true;
    return spec.confidence !== 'low' || !!reviewedAt || o.reviewed === true;
}

function mergedList(list, override) {
    if (override === undefined) return list;
    if (override === null) return null;
    return { ...list, ...override };
}

/**
 * Všechna publikovaná města (i skrytá) jako objekty ve tvaru Prahy.
 * `pirates` se vždy odvozuje z `arrangement.list.id`; skryté město má
 * `pirates: null` a `pirateCandidates: []`; jeho arrangement má jen typ a
 * příznaky (list null, members/others prázdné) pro banner „ověřujeme“.
 */
export function buildCouncils(towns, specifics, overrides) {
    const byZastup = new Map(specifics.map((s) => [s.zastup, s]));
    const ov = overrides?.towns || {};

    return towns.map((t) => {
        const spec = byZastup.get(t.zastup);
        if (!spec) throw new Error(`buildCouncils: no specifics for ${t.slug} (${t.zastup})`);
        const o = ov[t.zastup] || {};

        const title = o.title ?? (TITLE_BY_DRUH[t.druh] && `${TITLE_BY_DRUH[t.druh]} ${t.name}`);
        if (!title) throw new Error(`buildCouncils: unknown druh ${t.druh} for ${t.slug}`);
        if (!new RegExp(`^${t.kraj / 100}-\\d+$`).test(t.shard)) {
            throw new Error(`buildCouncils: shard ${t.shard} does not belong to kraj ${t.kraj} (${t.slug})`);
        }

        if (o.name !== undefined && o.name !== t.name) {
            throw new Error(`buildCouncils: override name "${o.name}" != "${t.name}" for ${t.zastup}`);
        }

        const type = o.type ?? spec.type;
        // Typ c/d = Piráti nemají vlastní kandidátku: seznam se maže, aby `pirates`
        // (a tím banner i Hemicycle) nemohl být nastaven.
        const list = type === 'c' || type === 'd' ? null : mergedList(spec.list, o.list);
        if ((type === 'a' || type === 'b') && !list) {
            throw new Error(`buildCouncils: type ${type} without a Pirate list (${t.slug})`);
        }
        if (type === 'd' && o.pirateCandidates !== undefined) {
            throw new Error(`buildCouncils: pirateCandidates on a type d town (${t.slug})`);
        }
        const shown = isShown(spec, o, overrides?.reviewedAt);
        // Skryté město: z arrangementu zůstává jen typ a příznaky (banner „ověřujeme“).
        const arrangement = shown
            ? { type, list, members: spec.members, others: spec.others, flags: spec.flags, note: o.note }
            : { type, list: null, members: [], others: [], flags: spec.flags, note: undefined };

        return {
            slug: t.slug,
            name: t.name,
            title,
            zastup: t.zastup,
            okres: t.okres,
            kraj: t.kraj,
            krajName: t.krajName,
            shard: t.shard,
            featured: t.featured,
            population: t.population,
            seats: t.seats,
            precincts: t.precincts,
            pirates: shown ? (list?.id ?? null) : null,
            pirateCandidates:
                shown && type !== 'd'
                    ? (o.pirateCandidates ?? spec.others.map(({ list, n, name }) => ({ list, n, name })))
                    : [],
            arrangement,
            confidence: o.confidence === 'low' ? 'low' : spec.confidence,
            shown,
            magistrat: false,
            coalition: null,
            lists: Object.fromEntries(Object.entries(o.lists || {}).map(([id, l]) => [id, { ...l }])),
            photos: {},
            candidatePhotos: false,
            map: false,
            precinctFiles: false,
            beta: false,
        };
    });
}

const shardIndex = (id) => Number(id.split('-')[1]);

/**
 * Shardy pro index a Worker: regionální (`<KRAJ/100>-<i>`, dané generátorem) a
 * `top-N` (největší města). Počítá se ze VŠECH zastupitelstev, aby uvolnění
 * skrytého města nikdy nezměnilo složení shardu.
 */
export function deriveShards(allCouncils) {
    const regions = new Map();
    const featured = new Map();
    for (const c of allCouncils) {
        if (!regions.has(c.shard)) regions.set(c.shard, { id: c.shard, kind: 'region', kraj: c.kraj, name: c.krajName, zastups: [] });
        regions.get(c.shard).zastups.push(c.zastup);
        if (c.featured == null) continue;
        if (!FEATURED_RE.test(c.featured)) throw new Error(`deriveShards: bad featured ${c.featured} (${c.slug})`);
        if (!featured.has(c.featured)) featured.set(c.featured, []);
        featured.get(c.featured).push(c);
    }
    const regionShards = [...regions.values()].sort((a, b) => a.kraj - b.kraj || shardIndex(a.id) - shardIndex(b.id));
    const featuredShards = [...featured.entries()]
        .sort(([a], [b]) => shardIndex(a) - shardIndex(b))
        .map(([id, members]) => ({
            id,
            kind: 'featured',
            kraj: null,
            name: 'Největší města',
            zastups: [...members].sort((a, b) => b.population - a.population).map((c) => c.zastup),
        }));
    return [...regionShards, ...featuredShards];
}

/**
 * Kraje podle pořadí kódu kraje. Volající předává jen zobrazená města, aby
 * hlavička „Sečteno N z M měst“ i seznam nikdy neobsahovaly skrytá.
 */
export function deriveRegions(councils) {
    const regions = new Map();
    for (const c of councils) {
        if (!regions.has(c.kraj)) regions.set(c.kraj, { kraj: c.kraj, name: c.krajName, shardIds: [], zastups: [] });
        const r = regions.get(c.kraj);
        if (!r.shardIds.includes(c.shard)) r.shardIds.push(c.shard);
        r.zastups.push(c.zastup);
    }
    return [...regions.values()]
        .sort((a, b) => a.kraj - b.kraj)
        .map((r) => ({ ...r, shardIds: r.shardIds.sort((a, b) => shardIndex(a) - shardIndex(b)) }));
}
