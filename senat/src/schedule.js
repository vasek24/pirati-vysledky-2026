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
const MAX_DELAY_MS = 900_000; // ani rozumné `nextRefreshAt` nečekáme déle než 15 min
const PAST_TOLERANCE_MS = 3_600_000;
const MAX_SKEW_MS = 86_400_000;
export const MAX_TIMEOUT_MS = 2_147_483_647; // víc setTimeout neunese (přetečení = spuštění hned)

// Posun jedné záložky za `nextRefreshAt` — rovnoměrně 0–25 s, ať se záložky
// nesešikují do jednoho okamžiku (platí i pro probuzení v 14:00)
export const pickOffset = (random) => random * MAX_OFFSET_MS;

// Za jak dlouho se dotázat znovu po úspěšné odpovědi. `nextRefreshAt` mimo
// [now − 1 h, now + 15 min] (rok 2100, sekundy místo ms…) je vadný údaj →
// jako by chyběl; výsledek je vždy 5 s – 15 min.
export function nextPollDelay({ nextRefreshAt, now, offset, random }) {
    const usable = Number.isFinite(nextRefreshAt) && nextRefreshAt >= now - PAST_TOLERANCE_MS && nextRefreshAt <= now + MAX_DELAY_MS;
    if (!usable) return FALLBACK_MS * (0.85 + random * 0.3);
    // server řekl „za chvíli", ale ještě nic nového — ať nás nesešikuje
    if (nextRefreshAt <= now) return MIN_GAP_MS + random * MIN_GAP_MS;
    return Math.min(MAX_DELAY_MS, Math.max(MIN_GAP_MS, nextRefreshAt + offset - now));
}

// Hodnota pro setTimeout: nikdy nad 2^31−1 ms (přetečení by spustilo hned)
export const clampTimeout = (ms) => (Number.isNaN(ms) ? MIN_GAP_MS : Math.min(MAX_TIMEOUT_MS, Math.max(0, ms)));

// Po n-té chybě za sebou: full jitter, strop 5 min, nikdy pod 5 s
export const backoffDelay = (n, random) =>
    Math.max(MIN_GAP_MS, random * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** n));

// Opakování po `online` / návratu do záložky
export const visibilityDelay = (random) => random * MIN_GAP_MS;

// Rozdíl serverových a klientských hodin; null = bez aktualizace (chybějící
// nebo nesmyslná hlavička: prázdná, NaN, 0, v sekundách místo ms, o víc než den)
export function computeSkew(serverNowHeader, clientNow) {
    if (serverNowHeader === null || serverNowHeader === undefined || serverNowHeader === '') return null;
    const serverNow = Number(serverNowHeader);
    if (!Number.isFinite(serverNow) || serverNow < 1e12) return null;
    const skew = serverNow - clientNow;
    return Math.abs(skew) > MAX_SKEW_MS ? null : skew;
}

// Poslední platný skew se drží, dokud nepřijde další platná hlavička
export const nextSkew = (prev, serverNowHeader, clientNow) => computeSkew(serverNowHeader, clientNow) ?? prev;
