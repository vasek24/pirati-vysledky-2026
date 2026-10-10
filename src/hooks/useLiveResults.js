// Živé výsledky KV 2026 s autorefreshem šetrným ke zdrojům:
//  - primárně /api/volby (jedna sdílená, CDN-cachovaná odpověď pro všechny),
//  - prohlížeč nikdy nesahá na volby.gov.cz; když náš server neodpovídá,
//    zůstává poslední snapshot (označený jako zastaralý) a zkouší se dál
//    jen náš server (backoff níže),
//  - další dotaz podle `nextRefreshAt` z odpovědi (čas serveru) + náhodný posun
//    záložky 0–25 s; hodiny klienta se opravují o rozdíl vůči `x-server-now`
//    (skew), jinak by rychlé hodiny dotazovaly každých 5–10 s. Nejméně 5 s
//    mezi dotazy (schedule.js),
//  - bez `nextRefreshAt` (starší Worker) interval podle fáze: před 14:00 jednou
//    za 10 min (probuzení přesně na uzavření místností), při sčítání 60 s,
//    po vyhlášení mandátů 15 min; ±15 % jitter, ať se klienti nesešikují,
//  - skrytý panel/tab = žádné dotazy; po návratu dotaz, když už je na čase,
//  - chyby = backoff s full jitter, strop 5 min (backoffDelay),
//  - obnovit dřív, než vyprší odpočet do další kontroly, nejde — ani
//    tlačítkem, ani reloadem stránky (poslední snapshot a čas další kontroly
//    drží sessionStorage, reload ho jen ukáže a počká),
//  - každý dotaz na naše API nese hlavičku X-Kv26-View pro anonymní měření
//    návštěvnosti (viewHeader níže, cloudflare/worker.js track()).
// Zdroj (source) je buď jedno zastupitelstvo (councilSource), nebo přehled
// všech zastupitelstev (OVERVIEW_SOURCE, /api/prehled).
import { useCallback, useEffect, useRef, useState } from 'react';
import { phaseOf, SNAPSHOT_VERSION } from '../volby/feed.js';
import { OVERVIEW_VERSION } from '../volby/overview.js';
import { POLLS_CLOSE } from '../councils.js';
import { MIN_GAP_MS, backoffDelay, clampTimeout, computeSkew, nextPollDelay, nextSkew, pickOffset, visibilityDelay } from './schedule.js';
import { nextLatency } from '../lib/latency.js';

const INTERVAL = { pre: 10 * 60e3, waiting: 60e3, counting: 60e3, final: 15 * 60e3 };
const DEMO_INTERVAL = 4000;
const MANUAL_GAP_MS = 15e3;
const PROXY_TIMEOUT_MS = 25e3;
const arrivalsKey = (source) => `kv26.arrivals.${source.key}`;
const SNAP_PREFIX = 'kv26.snap.';
const MAX_CACHED_WAIT_MS = 15 * 60e3;
const RESPONSE_META = ['stale', 'refreshedAt', 'nextRefreshAt', 'servedAt', 'complete', 'refreshing'];

// Zdroj = jedno zastupitelstvo; objekt je pro dané zastupitelstvo vždy
// stejný (hook podle něj plánuje dotazy)
const councilSources = new Map();
export function councilSource(council) {
    if (!councilSources.has(council.zastup)) {
        councilSources.set(council.zastup, {
            key: String(council.zastup),
            // Přesně tahle URL (bez dalších parametrů) — je to klíč CDN cache
            url: `/api/volby?z=${council.zastup}`,
            version: SNAPSHOT_VERSION,
            arrivals: true,
        });
    }
    return councilSources.get(council.zastup);
}

// Přehled všech zastupitelstev
export const OVERVIEW_SOURCE = {
    key: 'prehled',
    url: '/api/prehled',
    version: OVERVIEW_VERSION,
    arrivals: false,
};

// Anonymní návštěvnost: kolik sekund od minulého dotazu byla stránka otevřená
// a viditelná (s), první dotaz po načtení stránky = návštěva (v) s doménou,
// odkud člověk přišel (r), a dotykové ovládání (t). Žádné identifikátory.
// Jen pro naše API (stejný původ).
const REFERRER = (() => {
    try {
        const host = new URL(document.referrer).hostname;
        return host === window.location.hostname ? '(web)' : host.replace(/^(www|m|l|lm)\./, '');
    } catch {
        return '';
    }
})();
const TOUCH = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

function viewHeader(seconds, visit) {
    const q = new URLSearchParams({ s: String(Math.round(seconds)) });
    if (visit) q.set('v', '1');
    if (visit && REFERRER) q.set('r', REFERRER);
    if (TOUCH) q.set('t', '1');
    return q.toString();
}

async function fetchProxy(source, view, onServerNow) {
    const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(PROXY_TIMEOUT_MS) : undefined;
    const sent = Date.now();
    const res = await fetch(source.url, { headers: { Accept: 'application/json', 'X-Kv26-View': view }, signal });
    // hodiny serveru hned (i u chybové odpovědi); klient = střed mezi odesláním a příjmem
    onServerNow(res.headers.get('x-server-now'), (sent + Date.now()) / 2);
    const type = res.headers.get('content-type') || '';
    // Vite dev bez API / výpadek funkce vrátí HTML nebo chybu → chyba (poslední data zůstávají)
    if (!type.includes('application/json')) throw new Error('proxy-unavailable');
    const body = await res.json();
    if (!res.ok || body?.v !== source.version) throw new Error(body?.error || `proxy-${res.status}`);
    // metadata plánovače a čerstvosti nejsou součástí snapshotu
    const snapshot = { ...body };
    for (const k of RESPONSE_META) delete snapshot[k];
    return {
        snapshot,
        stale: !!body.stale,
        nextRefreshAt: Number.isFinite(body.nextRefreshAt) ? body.nextRefreshAt : undefined,
        // čas serveru z těla odpovědi (starší Worker je nemá) — řetězec zpoždění v hlavičce
        refreshedAt: body.refreshedAt,
        servedAt: body.servedAt,
    };
}

function readArrivals(source) {
    if (!source.arrivals) return {};
    try {
        const raw = JSON.parse(localStorage.getItem(arrivalsKey(source)) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

function writeArrivals(source, map) {
    if (!source.arrivals) return;
    try {
        localStorage.setItem(arrivalsKey(source), JSON.stringify(map));
    } catch {
        /* private mode — feed jen v paměti */
    }
}

// Poslední úspěšný snapshot záložky (sessionStorage = přežije reload, ne
// zavření záložky). Platí jen do naplánované další kontroly.
function readCached(source) {
    try {
        const c = JSON.parse(sessionStorage.getItem(SNAP_PREFIX + source.key) || 'null');
        const wait = (c?.nextAt || 0) - (Date.now() + (c?.skew || 0));
        return c?.snapshot?.v === source.version && wait > 0 && wait <= MAX_CACHED_WAIT_MS ? c : null;
    } catch {
        return null;
    }
}

function writeCached(source, entry) {
    const key = SNAP_PREFIX + source.key;
    const body = JSON.stringify(entry);
    try {
        sessionStorage.setItem(key, body);
    } catch {
        // plná kvóta (Magistrát + desítky MČ) → staré snapshoty pryč, zkusit znovu
        try {
            for (const k of Object.keys(sessionStorage)) if (k.startsWith(SNAP_PREFIX)) sessionStorage.removeItem(k);
            sessionStorage.setItem(key, body);
        } catch {
            /* private mode — reload pak stáhne data znovu */
        }
    }
}

// Pauza do dalšího dotazu. `now` = čas serveru (Date.now() + skew),
// `nextRefreshAt` z odpovědi (undefined = starší Worker → interval podle fáze).
function delayFor({ phase, errors, demo, nextRefreshAt, now, offset }) {
    if (demo) return DEMO_INTERVAL;
    if (errors > 0) return backoffDelay(errors, Math.random());
    if (nextRefreshAt !== undefined) return nextPollDelay({ nextRefreshAt, now, offset, random: Math.random() });
    let base = INTERVAL[phase] ?? 60e3;
    if (phase === 'pre') base = Math.min(base, Math.max(15e3, POLLS_CLOSE - now + 5e3));
    return Math.max(MIN_GAP_MS, base * (0.85 + Math.random() * 0.3));
}

// demo = true: čekat na demoFeed (simulace), na síť nesahat
// source = councilSource(council) nebo OVERVIEW_SOURCE
export function useLiveResults({ source: target, demo = false, demoFeed = null }) {
    const idle = demo && !demoFeed;
    // Reload před vypršením odpočtu: ukázat poslední data a počkat
    const [cached] = useState(() => (demo ? null : readCached(target)));
    const [snapshot, setSnapshot] = useState(() => cached?.snapshot ?? null);
    const [state, setState] = useState(() => ({
        status: cached ? 'ok' : 'loading', // loading | ok | error
        source: cached?.source ?? null, // proxy | demo
        stale: cached?.stale ?? false,
        error: cached?.error ?? null,
        lastSuccess: cached?.lastSuccess ?? null,
        nextAt: cached?.nextAt ?? null, // čas serveru (Date.now() + skew)
        skew: cached?.skew ?? 0, // čas serveru − čas klienta (ms)
        fetching: false,
    }));
    // okrsek → čas, kdy ho tenhle prohlížeč poprvé viděl sečtený (null = už při otevření)
    const [arrivals, setArrivals] = useState(() => (demo ? {} : readArrivals(target)));
    const [freshIds, setFreshIds] = useState([]);
    // řetězec zpoždění první odpovědi s aktuálním `generated` (časy serveru);
    // renderedAt doplní efekt po vykreslení. Po reloadu ze sessionStorage null.
    const [latency, setLatency] = useState(null);

    const timerRef = useRef(null);
    const nextAtRef = useRef(cached?.nextAt ?? null);
    // naplánovaný čas dalšího dotazu přežije skrytí záložky (nextAtRef ne)
    const dueAtRef = useRef(cached?.nextAt ?? null);
    const skewRef = useRef(cached?.skew ?? 0);
    const offsetRef = useRef(null); // posun této záložky, jednou za mount
    const nextRefreshAtRef = useRef(undefined);
    const errorsRef = useRef(0);
    const lastAttemptRef = useRef(cached?.lastAttempt ?? 0);
    const phaseRef = useRef(cached?.snapshot.phase ?? 'pre');
    const prevKeysRef = useRef(cached ? new Set(Object.keys(cached.snapshot.okrsky || {})) : null);
    const runRef = useRef(null);
    const inFlightRef = useRef(false);
    // měření návštěvnosti: první dotaz této stránky, naplánovaná pauza před
    // dalším dotazem a jak dlouho byla mezitím záložka skrytá
    const visitRef = useRef(true);
    const lastDelayRef = useRef(cached ? cached.nextAt - (cached.lastAttempt || cached.nextAt) : 0);
    const hiddenMsRef = useRef(0);
    const hiddenAtRef = useRef(null);

    // čas serveru (hodiny klienta opravené o skew)
    const serverNow = useCallback(() => Date.now() + skewRef.current, []);

    const schedule = useCallback((ms) => {
        clearTimeout(timerRef.current);
        // mezi dotazy aspoň 5 s (ne v demu)
        const gap = demoFeed ? 0 : MIN_GAP_MS - (Date.now() - lastAttemptRef.current);
        const wait = clampTimeout(Math.max(ms, gap, 0));
        const at = serverNow() + wait;
        dueAtRef.current = at;
        if (document.hidden) {
            nextAtRef.current = null;
            setState((s) => ({ ...s, nextAt: null }));
            return;
        }
        nextAtRef.current = at;
        timerRef.current = setTimeout(() => runRef.current?.(), wait);
        setState((s) => ({ ...s, nextAt: at }));
    }, [demoFeed, serverNow]);

    const run = useCallback(async () => {
        // Jeden dotaz naráz — jinak by pomalejší starší odpověď (online/
        // návrat do záložky během běžícího dotazu) přepsala novější data
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        clearTimeout(timerRef.current);
        // čas s otevřenou a viditelnou stránkou od minulého dotazu — nejvýš
        // naplánovaná pauza (po návratu ze skryté záložky se nepočítá víc)
        const started = Date.now();
        const visibleMs = lastAttemptRef.current ? started - lastAttemptRef.current - hiddenMsRef.current : 0;
        const viewSeconds = Math.max(0, Math.min(visibleMs, lastDelayRef.current) || 0) / 1000;
        hiddenMsRef.current = 0;
        lastAttemptRef.current = started;
        setState((s) => ({ ...s, fetching: true }));
        let result = null;
        const source = demoFeed ? 'demo' : 'proxy';
        let error = null;
        let stored = null;
        let skewValid = false; // měla odpověď použitelné x-server-now?
        try {
            if (demoFeed) {
                result = await demoFeed.snapshot();
            } else {
                const visit = visitRef.current;
                visitRef.current = false;
                result = await fetchProxy(target, viewHeader(viewSeconds, visit), (header, clientNow) => {
                    // chybí/nesmyslná hlavička → zůstává poslední platný skew (na začátku 0)
                    skewValid = computeSkew(header, clientNow) !== null;
                    const skew = nextSkew(skewRef.current, header, clientNow);
                    skewRef.current = skew;
                    setState((s) => (s.skew === skew ? s : { ...s, skew }));
                });
            }
        } catch (e) {
            error = e;
        }

        if (result) {
            errorsRef.current = 0;
            nextRefreshAtRef.current = result.nextRefreshAt;
            const snap = result.snapshot;
            // Fázi přepočítat lokálně — CDN mohla podržet „pre" i po 14:00
            const phase = demoFeed ? snap.phase : phaseOf({ counted: snap.precincts.counted, official: snap.official }, serverNow());
            phaseRef.current = phase;
            const keys = Object.keys(snap.okrsky || {});
            const prev = prevKeysRef.current;
            const added = prev ? keys.filter((k) => !prev.has(k)) : [];
            prevKeysRef.current = new Set(keys);
            // Časy příchodu jen pro okrsky, které ve snapshotu opravdu jsou;
            // časy z doby před uzavřením místností (testovací data ČSÚ) neplatí
            setArrivals((old) => {
                const now = Date.now();
                const next = {};
                for (const k of keys) {
                    let at = k in old ? old[k] : prev ? now : null;
                    if (!demoFeed && at !== null && at < POLLS_CLOSE) at = null;
                    next[k] = at;
                }
                const same = keys.length === Object.keys(old).length && keys.every((k) => old[k] === next[k]);
                if (same) return old;
                if (!demoFeed) writeArrivals(target, next);
                return next;
            });
            setFreshIds(added);
            stored = {
                snapshot: { ...snap, phase },
                source,
                stale: result.stale,
                error: result.stale ? result.error?.message || 'stale' : null,
                lastSuccess: Date.now(),
                lastAttempt: lastAttemptRef.current,
            };
            setSnapshot(stored.snapshot);
            if (!demoFeed) {
                // jen první odpověď s novým `generated` (viz nextLatency)
                const chain = { generated: snap.generated, refreshedAt: result.refreshedAt, servedAt: result.servedAt, receivedAt: serverNow(), skewValid };
                setLatency((l) => nextLatency(l, chain));
            }
            setState((s) => ({
                ...s,
                status: 'ok',
                source,
                stale: stored.stale,
                error: stored.error,
                lastSuccess: stored.lastSuccess,
                fetching: false,
            }));
        } else {
            errorsRef.current += 1;
            setState((s) => ({
                ...s,
                status: s.lastSuccess ? 'ok' : 'error',
                stale: !!s.lastSuccess,
                error: error?.message || 'Nepodařilo se načíst výsledky',
                fetching: false,
            }));
        }
        inFlightRef.current = false;
        const delay = delayFor({
            phase: phaseRef.current,
            errors: errorsRef.current,
            demo: !!demoFeed,
            nextRefreshAt: nextRefreshAtRef.current,
            now: serverNow(),
            offset: offsetRef.current ?? 0,
        });
        lastDelayRef.current = delay;
        if (stored && !demoFeed) writeCached(target, { ...stored, nextAt: serverNow() + delay, skew: skewRef.current });
        schedule(delay);
    }, [target, demoFeed, schedule, serverNow]);

    useEffect(() => {
        runRef.current = run;
    }, [run]);

    // nový snapshot je vykreslený (React ho commitnul) → konec řetězce zpoždění
    // (timeout 0 jako jinde v hooku: setState mimo tělo efektu)
    useEffect(() => {
        const t = setTimeout(() => setLatency((l) => (l && l.renderedAt === null ? { ...l, renderedAt: serverNow() } : l)), 0);
        return () => clearTimeout(t);
    }, [snapshot, serverNow]);

    useEffect(() => {
        if (idle) return undefined;
        if (offsetRef.current === null) offsetRef.current = pickOffset(Math.random());
        // první načtení hned (po reloadu až po odpočtu), ale mimo tělo
        // efektu (setState v run/schedule)
        timerRef.current = setTimeout(() => {
            const wait = cached && !demoFeed ? cached.nextAt - serverNow() : 0;
            if (wait > 0) schedule(wait);
            else runRef.current?.();
        }, 0);
        if (document.hidden) hiddenAtRef.current = Date.now();
        const onVisible = () => {
            if (document.hidden) {
                hiddenAtRef.current = Date.now();
                clearTimeout(timerRef.current);
                nextAtRef.current = null;
                setState((s) => ({ ...s, nextAt: null }));
                return;
            }
            if (hiddenAtRef.current !== null) hiddenMsRef.current += Date.now() - hiddenAtRef.current;
            hiddenAtRef.current = null;
            // návrat do záložky: když už je na čase, dotaz s náhodným zpožděním
            // (po hromadném návratu se záložky nesešikují), jinak počkat do termínu
            const left = dueAtRef.current === null ? 0 : dueAtRef.current - serverNow();
            schedule(left > 0 ? left : visibilityDelay(Math.random()));
        };
        const onOnline = () => {
            // znovu se zkusit jen, když se zrovna nedaří nebo už je na čase
            const overdue = dueAtRef.current !== null && dueAtRef.current <= serverNow();
            if (!document.hidden && (errorsRef.current > 0 || overdue)) schedule(visibilityDelay(Math.random()));
        };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onOnline);
        return () => {
            clearTimeout(timerRef.current);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', onOnline);
        };
    }, [run, schedule, serverNow, demoFeed, idle, cached]);

    // Ruční obnovení až po vypršení odpočtu do další plánované kontroly —
    // dřív by jen zbytečně zatěžovalo (ČSÚ i CDN data stejně obnovují po
    // minutě). Bez naplánované kontroly (skrytá záložka) nejvýš jednou za 15 s.
    // Vrací false, když je moc brzy.
    const refresh = useCallback(() => {
        const now = Date.now();
        const early = demoFeed
            ? now - lastAttemptRef.current < 1000
            : nextAtRef.current
                ? serverNow() < nextAtRef.current
                : now - lastAttemptRef.current < MANUAL_GAP_MS;
        if (early) return false;
        runRef.current?.();
        return true;
    }, [demoFeed, serverNow]);

    return { snapshot, ...state, arrivals, freshIds, latency, refresh };
}
