// Logika indexu mesta.dg12.cz bez Reactu: řádky měst, hlavičky krajů, řazení
// a líné načítání shardů (/api/kraj?s=<id>). Neimportuje ./councils.js — města
// (COUNCILS = jen zobrazená), SHARDS a REGIONS dostává jako argumenty. Nikde
// nevrací ani neukazuje součty za shard nebo kraj (`precincts`, `official` z
// composeOverview); do hry jdou jen souhrny jednotlivých měst.
import { MIN_GAP_MS, clampTimeout, nextPollDelay, nextSkew, pickOffset, visibilityDelay } from '../hooks/schedule.js';
import { fmtPct, parseCsuTime, plural } from '../volby/format.js';

// Uzavření místností (14:00 pražského času) — stejný okamžik jako src/councils.js;
// fáze `phase` ze shardu se nevěří (CDN může podržet „pre" i po 14:00)
export const POLLS_CLOSE = Date.parse('2026-10-10T14:00:00+02:00');

export const DWELL_MS = 400; // řádek musí být vidět tak dlouho, než se načte jeho shard
export const GRACE_MS = 3000; // po odchodu řádku z obrazovky se shard ještě 3 s obnovuje
const ALL_INTERVAL_MS = 180_000; // „Jen sečtené": všechny kraje jednou za 3 min
const FAST_INTERVAL_MS = 60_000;
const RESUME_STAGGER_MS = 300;
const COLLATOR = new Intl.Collator('cs');

// ---------------------------------------------------------------------------
// Texty

export const townsText = (n) => `${n} ${plural(n, 'město', 'města', 'měst')}`;
export const seatsText = (n) => `${n} ${plural(n, 'mandát', 'mandáty', 'mandátů')}`;
export const moreText = (n) => `+ ${n} ${n >= 5 ? 'dalších' : 'další'} — upřesněte hledání`;
export const newlyCountedText = (n) => `Ukázat ${n} ${plural(n, 'nově sečtené město', 'nově sečtená města', 'nově sečtených měst')}`;

const timeFmt = new Intl.DateTimeFormat('cs-CZ', { hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Prague' });
// „H:MM" pražského času z ČSÚ `generated` (zone-less = pražský čas), jinak null
export function formatCsuTime(generated) {
    const d = parseCsuTime(generated);
    if (!d) return null;
    const parts = timeFmt.formatToParts(d);
    const part = (type) => parts.find((p) => p.type === type)?.value ?? '';
    return `${Number(part('hour'))}:${part('minute')}`;
}

// ---------------------------------------------------------------------------
// Shardy: zdroj, členové, výběr nejčerstvějšího souhrnu

export const shardSource = (id, version) => ({ key: `kraj.${id}`, url: `/api/kraj?s=${id}`, version, arrivals: false });

export const featuredShardIds = (shards) => shards.filter((s) => s.kind === 'featured').map((s) => s.id).sort();

// Souhrny jen současných členů shardu (shard po přeskupení může vrátit město,
// které už v něm není); součty za shard se zahodí
export function filterShardSummaries(snapshot, shard) {
    const out = {};
    const councils = snapshot?.councils;
    if (!councils || typeof councils !== 'object') return out;
    for (const z of shard.zastups) if (councils[z]) out[z] = councils[z];
    return out;
}

const csuMs = (s) => parseCsuTime(s?.generated)?.getTime() ?? -Infinity;

// Souhrn s novějším časem ČSÚ; přítomný přebije chybějící; při shodě času víc
// sečtených okrsků, pak vyhlášený; jinak `a`
export function pickSummary(a, b) {
    if (!a) return b;
    if (!b) return a;
    const ta = csuMs(a);
    const tb = csuMs(b);
    if (ta !== tb) return tb > ta ? b : a;
    if ((a.counted ?? 0) !== (b.counted ?? 0)) return (b.counted ?? 0) > (a.counted ?? 0) ? b : a;
    if (!!a.official !== !!b.official) return b.official ? b : a;
    return a;
}

// Nejčerstvější souhrn města z jeho krajského a „největší města" shardu + stav
// shardu, odkud pochází (stale = ten shard zrovna selhává / server hlásí stale);
// bez souhrnu: loading | error | idle podle shardů
export function bestSource(council, snapshot) {
    const ids = [council.featured, council.shard].filter(Boolean);
    let summary;
    let src = null;
    for (const id of ids) {
        const s = snapshot.summaries?.[id]?.[council.zastup];
        if (s && pickSummary(summary, s) === s && s !== summary) {
            summary = s;
            src = id;
        }
    }
    const state = (id) => snapshot.shards?.[id];
    if (summary) {
        const st = state(src);
        return { summary, source: src, status: st?.status ?? 'ok', stale: st?.status === 'error' || !!st?.stale };
    }
    const sts = ids.map(state).filter(Boolean);
    const status = sts.some((s) => s.status === 'loading') ? 'loading' : sts.some((s) => s.status === 'error') ? 'error' : 'idle';
    return { summary: undefined, source: null, status, stale: false };
}

// Které shardy mají být teď připojené (načtené a obnovované)
export function activeShards({ featured = [], mineShard = null, visibleShardIds = [], allOnce = [] } = {}) {
    return [...new Set([...featured, ...(mineShard ? [mineShard] : []), ...visibleShardIds, ...allOnce])];
}

// První načtení: jen „největší města"; řádky krajů přidá viditelnost (i na
// širokém displeji, kde jsou kraje rozbalené — pod okrajem se nic nenačítá)
export function initialMounted({ width = 0 } = {}) {
    void width;
    return ['top-1', 'top-2'];
}

// Kraje rozbalené při prvním vykreslení na širokém displeji: od prvního, dokud
// jejich shardy dohromady nepřesáhnou `maxShards` — na vysokém monitoru (1440 px
// a víc) by jinak rozbalené kraje spustily víc dotazů, než je cíl (2 největší
// města + nejvýš 2 shardy kraje = 4). Ostatní zůstanou sbalené (skok z levého seznamu).
export function initialOpenRegions(regions, maxShards = 2) {
    const open = [];
    let used = 0;
    for (const r of regions) {
        if (used + r.shardIds.length > maxShards) break;
        used += r.shardIds.length;
        open.push(r.kraj);
    }
    return open;
}

// ---------------------------------------------------------------------------
// Řádek města

const POLLS_CLOSED_TEXT = 'výsledky po 14:00';
const KIND_BADGE = { party: 'Vlastní', coalition: 'Koalice', association: 'Sdružení' };

// Odznak a název kandidátky podle toho, jak Piráti kandidují (arrangement)
function arrangementOf(council) {
    const a = council.arrangement;
    const list = a?.list;
    if (list && KIND_BADGE[list.kind]) return { badge: KIND_BADGE[list.kind], badgeKind: list.kind, listName: list.name || list.short || '' };
    if (a?.type === 'c') return { badge: 'Jiné kandidátky', badgeKind: 'other', listName: a.others?.[0]?.listName || 'Piráti na jiných kandidátkách' };
    if (a?.type === 'd') return { badge: 'Bez Pirátů', badgeKind: 'other', listName: 'Piráti tu letos nekandidují' };
    return { badge: '', badgeKind: 'other', listName: council.name };
}

// Druhý, tlumený řádek: výsledek v KV 2022 (data z baseline2022.generated.json).
// undefined = žádná data (řádek se vynechá), null = bez srovnatelného výsledku
export function baselineText(entry) {
    if (entry === undefined) return '';
    if (entry === null) return 'v roce 2022 bez srovnatelného výsledku';
    const seats = entry.seats === null || entry.seats === undefined ? '' : ` · ${entry.seats} mand.`;
    return entry.label ? `v roce 2022 ${entry.label} ${fmtPct(entry.pct)}${seats}` : `2022: ${fmtPct(entry.pct)}${seats}`;
}

export const isCounted = (s) => !!s && s.total > 0 && s.counted >= s.total;

// Hodnoty řádku. status/stale pocházejí z bestSource. `now` = čas serveru.
export function rowView(council, summary, now, { status = 'idle', stale = false, baseline } = {}) {
    const head = arrangementOf(council);
    const view = { ...head, base: baselineText(baseline), piratePct: null, val: '', seatsOfficial: null, seats: '', txt: '', time: null, timeLabel: '', bar: 0, stale: false, state: 'loading' };
    if (!summary) {
        const failed = status === 'error';
        return finish({ ...view, state: failed ? 'error' : 'loading', val: failed ? '?' : '', txt: failed ? 'data se nepodařilo načíst' : 'načítám…' });
    }
    const counted = summary.counted || 0;
    const total = summary.total || 0;
    const time = formatCsuTime(summary.generated);
    const stamp = time ? `${stale ? '⚠ ' : ''}ČSÚ ${time}` : '';
    if (summary.official) {
        // vyhlášené: hotovo, mandáty jen tady
        const seats = council.pirates && summary.pirates ? summary.pirates.seats : null;
        return finish({
            ...view, state: 'done', time, timeLabel: stamp, stale, bar: 1, txt: 'konečné výsledky',
            ...pirateValue(council, summary), seatsOfficial: seats, seats: seats === null ? '' : seatsText(seats),
        });
    }
    if (!counted) {
        if (now < POLLS_CLOSE) return finish({ ...view, state: 'pre', val: '–', txt: POLLS_CLOSED_TEXT });
        return finish({ ...view, state: 'waiting', val: '–', txt: 'čeká na první okrsky', time, timeLabel: stamp, stale });
    }
    const all = total > 0 && counted >= total;
    return finish({
        ...view, state: all ? 'counted' : 'counting', time, timeLabel: stamp, stale, bar: total ? Math.min(1, counted / total) : 0,
        txt: all ? 'sečteno vše, čeká na vyhlášení' : `sečteno ${Math.max(1, Math.floor((counted / total) * 100))} % okrsků`,
        ...pirateValue(council, summary), seats: council.pirates && summary.pirates ? 'průběžně' : '',
    });
}

function pirateValue(council, summary) {
    const pct = council.pirates && summary.pirates && Number.isFinite(summary.pirates.pct) ? summary.pirates.pct : null;
    return { piratePct: pct, val: pct === null ? '–' : fmtPct(pct) };
}

// klíč pro React.memo: řádek se překreslí jen při změně toho, co ukazuje
function finish(v) {
    return { ...v, viewKey: [v.state, v.val, v.seats, v.txt, v.time, v.stale ? 1 : 0, v.bar.toFixed(3), v.base].join('|') };
}

// ---------------------------------------------------------------------------
// Kraje

// Zobrazená města po krajích (v pořadí KRAJ, města podle českého abecedního
// pořadí); skrytá města a shardy bez zobrazeného města tu nejsou
export function buildRegions(councils, shards, regions) {
    const shown = new Map(councils.map((c) => [c.zastup, c]));
    const out = [];
    for (const r of regions) {
        const list = r.zastups.filter((z) => shown.has(z)).map((z) => shown.get(z)).sort((a, b) => COLLATOR.compare(a.name, b.name));
        if (!list.length) continue;
        const shardIds = r.shardIds.filter((id) => shards.find((s) => s.id === id)?.zastups.some((z) => shown.has(z)));
        out.push({ kraj: r.kraj, name: r.name, zastups: list.map((c) => c.zastup), councils: list, shardIds });
    }
    return out.sort((a, b) => a.kraj - b.kraj);
}

// Druhý řádek hlavičky kraje (pevná výška): „N měst" → „· načítám…" →
// „Sečteno k z N měst" (jen když jsou načtené všechny shardy kraje) →
// „⚠ Data kraje jsou zastaralá — zkouším znovu". `loaded` = { shown:Set,
// summaries:{z:summary}, shards:{id:{status,hasData,stale}}, now, active:Set }.
export function regionHeader(region, loaded) {
    const { shown, summaries = {}, shards = {}, now = Date.now(), active = null } = loaded;
    const towns = region.zastups.filter((z) => shown.has(z));
    const count = townsText(towns.length);
    const states = region.shardIds.map((id) => shards[id] ?? { status: 'idle', hasData: false });
    if (states.some((s) => s.status === 'error' || s.stale)) {
        // „zkouším znovu" jen, když se shard opravdu obnovuje (odpojený shard se nezkouší)
        const retrying = !active || region.shardIds.some((id, i) => (states[i].status === 'error' || states[i].stale) && active.has(id));
        const text = `${states.some((s) => s.hasData) ? '⚠ Data kraje jsou zastaralá' : '⚠ Data se nepodařilo načíst'}${retrying ? ' — zkouším znovu' : ''}`;
        return { text, doneText: null, error: true };
    }
    if (states.length && states.every((s) => s.status === 'ok' && s.hasData)) {
        if (now < POLLS_CLOSE && towns.every((z) => !summaries[z]?.counted)) return { text: `${count} · ${POLLS_CLOSED_TEXT}`, doneText: null, error: false };
        const doneText = `Sečteno ${towns.filter((z) => isCounted(summaries[z])).length} z ${towns.length} měst`;
        return { text: doneText, doneText, error: false };
    }
    if (states.some((s) => s.status === 'loading')) return { text: `${count} · načítám…`, doneText: null, error: false };
    return { text: count, doneText: null, error: false };
}

const krajPlural = (n) => plural(n, 'kraj se', 'kraje se', 'krajů se');
// Stav načítání všech krajů pro „Jen sečtené": chyba má přednost před průběhem;
// text null = vše načteno (volající ukáže nově sečtená města)
export function allProgress(regions, shards) {
    const ids = regions.flatMap((r) => r.shardIds);
    const loaded = ids.filter((id) => shards[id]?.hasData).length;
    const failed = regions.filter((r) => r.shardIds.some((id) => shards[id]?.status === 'error')).length;
    if (failed) return { loaded, total: ids.length, failed, text: `⚠ ${failed} ${krajPlural(failed)} nepodařilo načíst — zkouším znovu` };
    if (loaded < ids.length) return { loaded, total: ids.length, failed, text: `Načítám stav všech krajů: ${loaded} z ${ids.length}…` };
    return { loaded, total: ids.length, failed, text: null };
}

// Sečtená města (counted ≥ total > 0) z daných (zobrazených) měst
export function doneSet(summaries, councils) {
    return new Set(councils.filter((c) => isCounted(summaries[c.zastup])).map((c) => c.zastup));
}

// Co přibylo oproti snímku, který filtr „Jen sečtené" právě ukazuje
export function newlyCounted(summaries, councils, snapshotSet) {
    return councils.filter((c) => isCounted(summaries[c.zastup]) && !snapshotSet.has(c.zastup));
}

// Ploché řazení; pořadí je statické (z registru), obnovení dat ho nemění.
// Řazení podle výsledku Pirátů tu záměrně není.
export function flatOrder(councils, mode) {
    const byName = (a, b) => COLLATOR.compare(a.name, b.name);
    if (mode === 'az') return [...councils].sort(byName);
    if (mode === 'velikost') return [...councils].sort((a, b) => b.population - a.population || byName(a, b));
    throw new Error(`unknown order: ${mode}`);
}

// ---------------------------------------------------------------------------
// Plánovač shardů

// Po n-té chybě za sebou: 15 → 30 → 60 s (střed, strop), ×0,5–1,5 ať se klienti po
// výpadku nesešikují do jedné vlny
export const errorDelay = (n, random) => Math.min(60_000, 15_000 * 2 ** Math.max(0, n - 1)) * (0.5 + random);

// Jeden objekt pro všechny shardy: kdo je připojený určují piny (největší
// města, Moje obec), viditelné řádky (po 400 ms, odpojení po 3 s) a „Jen
// sečtené". Plánuje stejně jako useLiveResults (nextRefreshAt + posun
// záložky, skew z x-server-now, min. 5 s), skrytá záložka = žádné dotazy.
// Poslední souhrny zůstávají po odpojení v paměti.
export function createShardPoller({
    shards, version, fetchImpl = (...args) => fetch(...args), random = Math.random,
    isHidden = () => typeof document !== 'undefined' && document.hidden,
    dwellMs = DWELL_MS, graceMs = GRACE_MS, timeoutMs = 25_000, maxParallel = 4, allIntervalMs = ALL_INTERVAL_MS,
}) {
    const byId = new Map(shards.map((s) => [s.id, s]));
    const st = new Map();
    const get = (id) => {
        if (!st.has(id)) st.set(id, { status: 'idle', hasData: false, stale: false, okAt: 0, errors: 0, dueAt: 0, lastAttempt: 0, timer: null, inflight: false });
        return st.get(id);
    };
    let featured = [];
    let mine = null;
    let allIds = [];
    const rowKeys = new Map(); // id -> Set(klíč viditelného řádku)
    const settled = new Set(); // shardy, jejichž řádek je vidět dost dlouho
    const dwell = new Map();
    const offset = pickOffset(random());
    const waiting = [];
    const listeners = new Set();
    let running = 0;
    let skew = 0;
    let summaries = {};
    let active = new Set();
    let fast = new Set();
    let tick = 0;
    let snapshot = { tick, shards: {}, summaries, active: [], skew };
    let dead = false;

    const serverNow = () => Date.now() + skew;
    const emit = () => {
        tick += 1;
        const shardStates = {};
        for (const [id, s] of st) shardStates[id] = { status: s.status, hasData: s.hasData, stale: s.stale, okAt: s.okAt, errors: s.errors, dueAt: s.dueAt };
        snapshot = { tick, shards: shardStates, summaries, active: [...active], skew };
        for (const fn of listeners) fn();
    };

    function schedule(id, ms) {
        const s = get(id);
        clearTimeout(s.timer);
        s.timer = null;
        const wait = clampTimeout(Math.max(ms, MIN_GAP_MS - (Date.now() - s.lastAttempt), 0));
        s.dueAt = serverNow() + wait;
        if (isHidden() || dead) return;
        s.timer = setTimeout(() => load(id), wait);
    }

    const isFast = (id) => featured.includes(id) || mine === id || settled.has(id);

    async function load(id) {
        const s = get(id);
        s.timer = null;
        if (dead || !active.has(id) || s.inflight || isHidden()) return;
        if (running >= maxParallel) {
            if (!waiting.includes(id)) waiting.push(id);
            return;
        }
        running += 1;
        s.inflight = true;
        s.lastAttempt = Date.now();
        if (!s.hasData) s.status = 'loading';
        emit();
        let delay;
        try {
            const sent = Date.now();
            const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
            const res = await fetchImpl(shardSource(id, version).url, { headers: { Accept: 'application/json' }, signal });
            skew = nextSkew(skew, res.headers.get('x-server-now'), (sent + Date.now()) / 2);
            // Vite dev bez API / výpadek funkce vrátí HTML → chyba (poslední data zůstávají)
            if (!(res.headers.get('content-type') || '').includes('application/json')) throw new Error('proxy-unavailable');
            const body = await res.json();
            if (!res.ok || body?.v !== version || !body.councils || typeof body.councils !== 'object') throw new Error(body?.error || `proxy-${res.status}`);
            summaries = { ...summaries, [id]: filterShardSummaries(body, byId.get(id)) };
            Object.assign(s, { status: 'ok', hasData: true, stale: !!body.stale, okAt: serverNow(), errors: 0 }); // stejné hodiny jako dueAt a porovnání níže
            const normal = nextPollDelay({ nextRefreshAt: Number.isFinite(body.nextRefreshAt) ? body.nextRefreshAt : undefined, now: serverNow(), offset, random: random() });
            delay = isFast(id) ? normal : Math.max(normal, allIntervalMs * (0.85 + random() * 0.3));
        } catch {
            s.errors += 1;
            s.status = 'error';
            delay = errorDelay(s.errors, random());
        }
        running -= 1;
        s.inflight = false;
        if (dead) return;
        if (active.has(id)) schedule(id, delay);
        else s.dueAt = serverNow() + delay; // odpojený za běhu: znovupřipojení do termínu data jen ukáže
        emit();
        pump();
    }

    function pump() {
        while (running < maxParallel && waiting.length) {
            const id = waiting.shift();
            if (active.has(id)) load(id);
        }
    }

    function start(id) {
        const s = get(id);
        const left = s.dueAt - serverNow();
        if (s.hasData && left > 0) schedule(id, left);
        else schedule(id, 0);
    }

    function stop(id) {
        const s = get(id);
        clearTimeout(s.timer);
        s.timer = null;
        const i = waiting.indexOf(id);
        if (i >= 0) waiting.splice(i, 1);
    }

    function reconcile() {
        const visible = [...settled];
        const want = new Set(activeShards({ featured, mineShard: mine, visibleShardIds: visible, allOnce: allIds }).filter((id) => byId.has(id)));
        const before = active;
        active = want;
        for (const id of before) if (!want.has(id)) stop(id);
        for (const id of want) if (!before.has(id)) start(id);
        // shard, který se z „jen sečtené" (3 min) stal viditelným, jde na rychlý rytmus
        const nowFast = new Set([...want].filter(isFast));
        for (const id of nowFast) {
            const s = get(id);
            if (!fast.has(id) && before.has(id) && !s.inflight && s.hasData && s.dueAt - serverNow() > FAST_INTERVAL_MS + 30_000) {
                schedule(id, Math.max(0, s.okAt + FAST_INTERVAL_MS + offset - serverNow()));
            }
        }
        fast = nowFast;
        emit();
    }

    function touchDwell(id) {
        clearTimeout(dwell.get(id));
        dwell.delete(id);
        const n = rowKeys.get(id)?.size ?? 0;
        if (n > 0 && !settled.has(id)) {
            dwell.set(id, setTimeout(() => {
                dwell.delete(id);
                if (rowKeys.get(id)?.size) { settled.add(id); reconcile(); }
            }, dwellMs));
        } else if (n === 0 && settled.has(id)) {
            dwell.set(id, setTimeout(() => {
                dwell.delete(id);
                if (!rowKeys.get(id)?.size) { settled.delete(id); reconcile(); }
            }, graceMs));
        }
    }

    function disconnect() {
        dead = true;
        for (const s of st.values()) { clearTimeout(s.timer); s.timer = null; }
        for (const t of dwell.values()) clearTimeout(t);
        dwell.clear();
        waiting.length = 0;
        active = new Set();
        fast = new Set();
    }

    return {
        getSnapshot: () => snapshot,
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        serverNow,
        setFeatured(ids) { featured = [...ids]; reconcile(); },
        setMine(id) { mine = id ?? null; reconcile(); },
        // „Jen sečtené": všechny kraje jednou, pak co 3 min; null = vypnuto
        setAll(ids) { allIds = ids ? [...ids] : []; reconcile(); },
        setRowVisible(id, key, visible) {
            if (!byId.has(id)) return;
            if (!rowKeys.has(id)) rowKeys.set(id, new Set());
            if (visible) rowKeys.get(id).add(key);
            else rowKeys.get(id).delete(key);
            touchDwell(id);
        },
        // volat z události visibilitychange
        pageVisibilityChanged() {
            if (isHidden()) {
                for (const s of st.values()) { clearTimeout(s.timer); s.timer = null; }
                emit();
                return;
            }
            let i = 0;
            for (const id of active) {
                const s = get(id);
                if (s.inflight) continue;
                const left = s.dueAt - serverNow();
                if (s.hasData && left > 0) schedule(id, left);
                else schedule(id, RESUME_STAGGER_MS * i++); // po návratu po jednom, ne všechny naráz
            }
        },
        // volat z události online
        online() {
            if (isHidden()) return;
            for (const id of active) if (get(id).errors > 0 && !get(id).inflight) schedule(id, visibilityDelay(random()));
        },
        // React StrictMode (a návrat na stránku) spouští efekty znovu: connect/disconnect jsou vratné
        connect() {
            dead = false;
            reconcile();
        },
        disconnect,
        destroy() {
            disconnect();
            listeners.clear();
        },
    };
}
