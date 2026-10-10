// Čisté části okraje Workeru (bez importu cloudflare:workers, aby šly testovat):
// TTL v Cache API, hlavička Cache-Control, záložní („last resort") kopie.
// Pravidla: docs/superpowers/specs/2026-10-10-election-night-backup-design.md §3.3.

// nad největším stropem TTL hlavní položky (600 s ve fázi final): selže-li DO
// hned po vypršení hlavní položky, kopie musí ještě existovat
export const LAST_RESORT_TTL = 1200; // s

/**
 * TTL (s) v Cache API a pro CDN: clamp(ceil((nextRefreshAt − now)/1000), 1, cap).
 * Dolní mez je 1 s, ne 0 — při nulovém TTL by každý požadavek každého
 * datacentra během obnovy (1–12 s) šel do Durable Objectu (H2). Neznámé
 * (NaN) nextRefreshAt / now = nejkratší TTL.
 */
export function edgeTtl({ nextRefreshAt, now, stale, phase }) {
    const cap = stale ? 5 : phase === 'final' ? 600 : phase === 'pre' ? 300 : 5;
    const seconds = Math.ceil((nextRefreshAt - now) / 1000);
    if (Number.isNaN(seconds)) return 1;
    return Math.min(cap, Math.max(1, seconds));
}

// max-age=0: prohlížeč neukryje opakovaný dotaz klienta (M1); žádné
// stale-while-revalidate / stale-if-error
export const cacheControlFor = (ttl) => `public, max-age=0, s-maxage=${ttl}`;

const HEADER_WINDOW = 300; // vložená hlavička (meta) je na začátku těla
const STALE_KEY = '"stale":';

/**
 * Přepne `"stale":false` v hlavičce těla na `true`; jinak (už true, chybí)
 * vrací tělo beze změny. Hlavička je vložená meta na začátku, takže se bere
 * jen první výskyt klíče — pozdější `"stale"` ve snapshotu se nedotkne.
 */
export function markStale(body) {
    const at = body.slice(0, HEADER_WINDOW).indexOf(STALE_KEY);
    if (at === -1) return body;
    const valueAt = at + STALE_KEY.length;
    if (!body.startsWith('false', valueAt)) return body;
    return `${body.slice(0, valueAt)}true${body.slice(valueAt + 'false'.length)}`;
}

/**
 * Klíč záložní kopie: samostatná cesta, ne fragment (Cache API fragment
 * ignoruje, takže by přepsal hlavní klíč — C2). `url` = klíč hlavní položky.
 */
export function lastResortRequest(url) {
    const u = new URL(url);
    return new Request(new URL(`/__lastresort${u.pathname}${u.search}`, u.origin));
}

/** Závod `promise` s časovačem: po `ms` odmítne (jako výjimka); časovač se vždy zruší. */
export function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout ${ms} ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
