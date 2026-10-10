// Čisté pomocné funkce plánovače dotazů (useLiveResults). Všechno bere
// `random` (0..1) a `now` jako parametr — testuje se bez hodin i bez Math.random.
//
// Čas serveru: `nextRefreshAt` je absolutní čas serveru, hodiny klienta ale
// můžou jít o minuty jinak. Volající proto předává `now = Date.now() + skew`
// (skew z hlavičky x-server-now, viz computeSkew).

export const MIN_GAP_MS = 5000; // častěji než jednou za 5 s se nedotazujeme
export const MAX_OFFSET_MS = 25_000;
const BACKOFF_CAP_MS = 300_000;
const BACKOFF_BASE_MS = 5000;
const FALLBACK_MS = 60_000;

// Posun jedné záložky za `nextRefreshAt` — rovnoměrně 0–25 s, ať se záložky
// nesešikují do jednoho okamžiku (platí i pro probuzení v 14:00)
export const pickOffset = (random) => random * MAX_OFFSET_MS;

// Za jak dlouho se dotázat znovu po úspěšné odpovědi
export function nextPollDelay({ nextRefreshAt, now, offset, random }) {
    if (!Number.isFinite(nextRefreshAt)) return FALLBACK_MS * (0.85 + random * 0.3);
    // server řekl „za chvíli", ale ještě nic nového — ať nás nesešikuje
    if (nextRefreshAt <= now) return MIN_GAP_MS + random * MIN_GAP_MS;
    return Math.max(MIN_GAP_MS, nextRefreshAt + offset - now);
}

// Po n-té chybě za sebou: full jitter, strop 5 min, nikdy pod 5 s
export const backoffDelay = (n, random) =>
    Math.max(MIN_GAP_MS, random * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** n));

// Opakování po `online` / návratu do záložky
export const visibilityDelay = (random) => random * MIN_GAP_MS;

// Rozdíl serverových a klientských hodin; bez platné hlavičky 0 (bez opravy)
export function computeSkew(serverNowHeader, clientNow) {
    if (serverNowHeader === null || serverNowHeader === undefined || serverNowHeader === '') return 0;
    const serverNow = Number(serverNowHeader);
    return Number.isFinite(serverNow) && serverNow > 0 ? serverNow - clientNow : 0;
}
