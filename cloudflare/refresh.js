// Čistý refresher snapshotu pro Durable Object (bez importu Cloudflare — jde
// testovat s falešnými hodinami, úložištěm a feedem). Drží poslední dobrý
// snapshot, obsluhuje ho okamžitě a na pozadí ho obnovuje přes feed.build():
//
//   build → mergeCandidate (doplní dočasně chybějící okrskové hlasy / souhrny)
//         → validateCandidate (ok | older | rejected) → publikace + persist.
//
// Pravidla: docs/superpowers/specs/2026-10-10-election-night-backup-design.md §3.1–3.2.
// Všechna porovnání `generated` jdou přes parseCsuTime (čas ČSÚ je bez zóny,
// Worker běží v UTC).
import { POLLS_CLOSE } from '../src/councils.js';
import { parseCsuTime } from '../src/volby/format.js';
import { mergeCandidate, snapshotHash, validateCandidate } from '../src/volby/validate.js';

export const REFRESH = Object.freeze({
    SCHEMA: 1,
    POLLS_CLOSE,
    FLOOR_MS: 20_000, // nejkratší odstup mezi obnovami
    RETRY_CAP_MS: 60_000,
    PRE_MS: 5 * 60_000,
    WAITING_MS: 60_000,
    COUNTING_MAX_MS: 60_000,
    GENERATED_SKEW_MS: 120_000, // generated dál než refreshedAt+120 s = nesmysl / skew
    FINAL_MS: 10 * 60_000,
    DEADLINE_MS: 12_000, // celková lhůta jednoho buildu
    SECOND_CLASS_OLD_MS: 120_000,
    SECOND_CLASS_WAIT_MS: 3_000,
    QUARANTINE_COUNT: 3,
    QUARANTINE_SPAN_MS: 120_000,
    OLDER_ERROR_MS: 10 * 60_000,
    INCOMPLETE_ERROR_MS: 5 * 60_000,
    MAX_BYTES: 1_500_000,
});

// Jen relativní (vůči good) regrese smí projít karanténou. Absolutní
// strukturální vady (prázdné strany, generated null, counted mimo rozsah)
// nejsou "skutečné stažení" dat a nepřijmou se nikdy.
const QUARANTINABLE = new Set([
    'parties-fewer', 'precincts-fewer', 'counted-decreased', 'votes-decreased', 'council-parties-fewer',
]);

/** retry(n) = 20 s + random · (min(60 s, 20 s · 2^(n−1)) − 20 s), n ≥ 1 */
export function retryDelay(failures, random) {
    const n = Math.max(1, failures);
    const top = Math.min(REFRESH.RETRY_CAP_MS, REFRESH.FLOOR_MS * 2 ** (n - 1));
    return REFRESH.FLOOR_MS + random() * (top - REFRESH.FLOOR_MS);
}

/**
 * Kdy je snapshot příště splatný. `generatedMs` = parseCsuTime(snapshot.generated).getTime()
 * nebo null. Při `failures > 0` platí zpětný odstup od `now`.
 */
export function computeNextRefreshAt({ phase, refreshedAt, generatedMs, now, failures = 0, random = Math.random, pollsClose = REFRESH.POLLS_CLOSE }) {
    if (failures > 0) return now + retryDelay(failures, random);
    switch (phase) {
        case 'pre':
            return Math.min(refreshedAt + REFRESH.PRE_MS, pollsClose);
        case 'waiting':
            return refreshedAt + REFRESH.WAITING_MS;
        case 'final':
            return refreshedAt + REFRESH.FINAL_MS;
        default: { // counting
            const floor = refreshedAt + REFRESH.FLOOR_MS;
            if (!Number.isFinite(generatedMs) || generatedMs > refreshedAt + REFRESH.GENERATED_SKEW_MS) return floor;
            return Math.min(Math.max(generatedMs + 60_000, floor), refreshedAt + REFRESH.COUNTING_MAX_MS);
        }
    }
}

const genMs = (snapshot) => parseCsuTime(snapshot?.generated)?.getTime() ?? null;
const utf8Bytes = (s) => new TextEncoder().encode(s).length;
const UNAVAILABLE = '{"error":"unavailable"}';

function withDeadline(fn, ms) {
    const ac = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            ac.abort();
            reject(new Error(`build deadline ${ms} ms`));
        }, ms);
    });
    // feed.build nemusí signál respektovat — proto závod s časovačem
    return Promise.race([Promise.resolve().then(() => fn(ac.signal)), timeout]).finally(() => clearTimeout(timer));
}

const sleep = (ms) => {
    let timer;
    const promise = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
    return { promise, cancel: () => clearTimeout(timer) };
};

export function createRefresher({
    now,
    random,
    storage,
    feed,
    kind,
    phaseOf,
    firstClass,
    base,
    log,
    pollsClose = POLLS_CLOSE,
    waitUntil,
}) {
    // good = { snapshot (objekt), str (JSON řetězec), meta } | null
    let good = null;
    let nextRefreshAt = 0; // v paměti; po older/nekompletním pokusu odlišné od meta.nextRefreshAt
    let stale = false;
    let complete = true;
    let failures = 0;
    let quarantine = null;
    let olderSince = null;
    let olderLoggedAt = null;
    let incompleteSince = null;
    let incompleteLoggedAt = null;
    let sizeLogged = false;
    let loadPromise = null;
    let refreshPromise = null;

    const emit = (level, event, data) => log(event, { level, ...data });

    // ---- rehydrate (single-flight) ------------------------------------------
    function load() {
        loadPromise ||= (async () => {
            let snapshotStr;
            let meta;
            try {
                [snapshotStr, meta] = await Promise.all([storage.get('snapshot'), storage.get('meta')]);
            } catch (error) {
                emit('error', 'rehydrate-failed', { error: String(error?.message || error) });
                return;
            }
            if (snapshotStr === undefined && meta === undefined) return;
            if (!meta || typeof snapshotStr !== 'string' || meta.schema !== REFRESH.SCHEMA || meta.base !== base
                || !Number.isFinite(meta.refreshedAt) || !Number.isFinite(meta.nextRefreshAt)) {
                emit('warn', 'rehydrate-discarded', { reason: !meta ? 'no-meta' : meta.schema !== REFRESH.SCHEMA ? 'schema' : meta.base !== base ? 'base' : 'invalid' });
                return;
            }
            let snapshot;
            try {
                snapshot = JSON.parse(snapshotStr);
            } catch {
                emit('warn', 'rehydrate-discarded', { reason: 'corrupt' });
                return;
            }
            if (!snapshot || typeof snapshot !== 'object' || snapshotStr.length < 3) {
                emit('warn', 'rehydrate-discarded', { reason: 'corrupt' });
                return;
            }
            good = { snapshot, str: snapshotStr, meta };
            nextRefreshAt = meta.nextRefreshAt;
            failures = meta.failures || 0;
            stale = failures > 0;
            quarantine = meta.quarantine || null;
            emit('info', 'rehydrated', { refreshedAt: meta.refreshedAt });
        })();
        return loadPromise;
    }

    // ---- publikace -------------------------------------------------------------
    async function install(snapshot, isComplete, t) {
        const generatedMs = genMs(snapshot);
        let next = computeNextRefreshAt({
            phase: phaseOf(snapshot, t), refreshedAt: t, generatedMs, now: t, failures: 0, random, pollsClose,
        });
        if (!isComplete) next = Math.min(next, t + REFRESH.FLOOR_MS);
        const meta = {
            refreshedAt: t, generatedMs, nextRefreshAt: next, failures: 0, quarantine: null, base, schema: REFRESH.SCHEMA,
        };
        const str = JSON.stringify(snapshot);
        good = { snapshot, str, meta };
        nextRefreshAt = next;
        stale = false;
        complete = isComplete;
        failures = 0;
        quarantine = null;
        olderSince = null;
        if (isComplete) incompleteSince = null;

        if (utf8Bytes(str) > REFRESH.MAX_BYTES) {
            if (!sizeLogged) {
                sizeLogged = true;
                emit('warn', 'size-guard', { bytes: utf8Bytes(str), max: REFRESH.MAX_BYTES });
            }
            return;
        }
        try {
            await storage.put({ snapshot: str, meta });
        } catch (error) {
            emit('error', 'persist-failed', { error: String(error?.message || error) });
        }
    }

    function fail(t, event, data, { invalidate = false } = {}) {
        failures += 1;
        stale = true;
        nextRefreshAt = computeNextRefreshAt({ phase: 'counting', refreshedAt: t, generatedMs: null, now: t, failures, random });
        if (invalidate) feed.invalidate();
        emit('warn', event, { failures, ...data });
    }

    // ---- jedna obnova -------------------------------------------------------------
    async function refreshOnce() {
        let candidate;
        try {
            candidate = await withDeadline((signal) => feed.build({ signal }), REFRESH.DEADLINE_MS);
        } catch (error) {
            fail(now(), 'build-failed', { error: String(error?.message || error) });
            return;
        }
        const t = now();
        const prev = good;
        const ctx = prev ? { now: t, pollsClose, goodRefreshedAt: prev.meta.refreshedAt, base, goodBase: prev.meta.base } : undefined;
        const { merged, complete: isComplete } = mergeCandidate(candidate, prev?.snapshot ?? null, kind, ctx);

        // Nekompletní (po sloučení chybí data, která good měl): neinstaluje se,
        // není stale, nepočítá se do karantény, další pokus za 20 s.
        if (!isComplete && prev) {
            incompleteSince ??= t;
            nextRefreshAt = t + REFRESH.FLOOR_MS;
            emit('info', 'incomplete', { fetchId: candidate.fetchId });
            if (t - incompleteSince >= REFRESH.INCOMPLETE_ERROR_MS && (incompleteLoggedAt === null || t - incompleteLoggedAt >= REFRESH.INCOMPLETE_ERROR_MS)) {
                incompleteLoggedAt = t;
                emit('error', 'incomplete-persistent', { sinceMs: t - incompleteSince });
            }
            return;
        }
        incompleteSince = null;
        incompleteLoggedAt = null;

        const verdict = validateCandidate(merged, prev?.snapshot ?? null, ctx);

        if (verdict.outcome === 'older') {
            // zpožděná replika ČSÚ: good zůstává, bez stale a bez zpětného odstupu
            olderSince ??= t;
            nextRefreshAt = t + REFRESH.FLOOR_MS;
            emit('info', 'older', { generated: merged.generated, good: prev.snapshot.generated });
            if (t - olderSince >= REFRESH.OLDER_ERROR_MS && (olderLoggedAt === null || t - olderLoggedAt >= REFRESH.OLDER_ERROR_MS)) {
                olderLoggedAt = t;
                emit('error', 'older-persistent', { sinceMs: t - olderSince });
            }
            return;
        }
        olderSince = null;
        olderLoggedAt = null;

        if (verdict.outcome === 'rejected') {
            const { reason } = verdict;
            const fetchId = candidate.fetchId ?? null;
            if (quarantine && quarantine.reason === reason) {
                if (fetchId !== null && fetchId !== quarantine.lastFetchId) {
                    quarantine = { ...quarantine, count: quarantine.count + 1, lastFetchId: fetchId };
                }
            } else {
                quarantine = { reason, count: 1, firstAt: t, lastFetchId: fetchId };
            }
            if (QUARANTINABLE.has(reason) && prev
                && quarantine.count >= REFRESH.QUARANTINE_COUNT && t - quarantine.firstAt >= REFRESH.QUARANTINE_SPAN_MS) {
                emit('warn', 'quarantine-accepted', { reason, count: quarantine.count, spanMs: t - quarantine.firstAt });
                await install(merged, true, t);
                return;
            }
            fail(t, 'rejected', { reason, quarantineCount: quarantine.count }, { invalidate: true });
            return;
        }

        if (kind === 'overview' && prev && allCopiedFrom(merged, prev.snapshot)
            && snapshotHash(merged) === snapshotHash(prev.snapshot)) {
            emit('info', 'overview-all-lagging', { councils: Object.keys(merged.councils).length });
        }
        await install(merged, isComplete, t);
    }

    // mergeOverview kopíruje souhrny z good stejnou referencí
    function allCopiedFrom(merged, goodSnapshot) {
        const entries = Object.entries(merged.councils || {});
        return entries.length > 0 && entries.every(([z, c]) => goodSnapshot.councils?.[z] === c);
    }

    function startRefresh() {
        if (!refreshPromise) {
            refreshPromise = refreshOnce()
                .catch((error) => {
                    // nečekaná chyba (např. TypeError z validace) = selhání, ne pád požadavku
                    fail(now(), 'refresh-error', { error: String(error?.message || error) });
                })
                .finally(() => {
                    refreshPromise = null;
                });
            waitUntil?.(refreshPromise);
        }
        return refreshPromise;
    }

    // ---- odpověď ----------------------------------------------------------------
    function respond() {
        if (!good) {
            return {
                status: 503,
                body: UNAVAILABLE,
                meta: { refreshedAt: null, nextRefreshAt, servedAt: now(), stale: true, complete: false, refreshing: !!refreshPromise },
            };
        }
        const meta = {
            refreshedAt: good.meta.refreshedAt,
            nextRefreshAt,
            servedAt: now(),
            stale,
            complete,
            refreshing: !!refreshPromise,
        };
        const body = `{"refreshedAt":${meta.refreshedAt},"nextRefreshAt":${meta.nextRefreshAt},"servedAt":${meta.servedAt},`
            + `"stale":${meta.stale},"complete":${meta.complete},"refreshing":${meta.refreshing},${good.str.slice(1)}`;
        return { status: 200, body, meta };
    }

    async function get() {
        await load();
        const t = now();
        if (!good) {
            // studený start: čeká se na obnovu (12 s lhůta); po neúspěchu 503
            // a v okně zpětného odstupu se build neopakuje na každý požadavek
            if (refreshPromise || t >= nextRefreshAt) await startRefresh();
            return respond();
        }
        if (!refreshPromise && t >= nextRefreshAt) startRefresh();
        if (!firstClass && refreshPromise && t - good.meta.refreshedAt > REFRESH.SECOND_CLASS_OLD_MS) {
            const wait = sleep(REFRESH.SECOND_CLASS_WAIT_MS);
            await Promise.race([refreshPromise, wait.promise]);
            wait.cancel();
        }
        return respond();
    }

    return { get };
}
