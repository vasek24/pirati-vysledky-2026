// Čisté lepidlo mezi Durable Objectem a feedy (bez importu cloudflare:workers,
// aby šlo testovat): fáze pro refresher, logger, stavba feedu podle klíče.
import { COUNCILS, KV_BASE_URL, POLLS_CLOSE, councilByZastup } from '../src/councils.js';
import { createKvFeed, phaseOf } from '../src/volby/feed.js';
import { createOverviewFeed } from '../src/volby/overview.js';
import { USER_AGENT } from '../api/_http.js';

/**
 * Adapter na vstřikovanou `phaseOf(snapshot|null, nowMs)` refresheru:
 * feed.js `phaseOf({ counted, official }, now)` bere jen počty. Bez snapshotu
 * (studený start) = jako nic nesečteno: pre před uzavřením místností, jinak waiting.
 */
export function phaseOfSnapshot(snapshot, nowMs) {
    if (!snapshot) return nowMs < POLLS_CLOSE ? 'pre' : 'waiting';
    return phaseOf({ counted: snapshot.precincts?.counted ?? 0, official: !!snapshot.official }, nowMs);
}

/** log(event, data) refresheru → jeden kompaktní JSON řádek, úroveň podle data.level. */
export function makeLog(sink = console) {
    return (event, data = {}) => {
        const { level, ...rest } = data;
        const method = level === 'error' || level === 'warn' ? level : 'info';
        let line;
        try {
            line = JSON.stringify({ event, level: method, ...rest });
        } catch {
            line = JSON.stringify({ event, level: method, unserializable: true });
        }
        sink[method](line);
    };
}

export const feedKind = (key) => (key === 'prehled' ? 'overview' : 'council');

/**
 * Feed pro klíč (kód zastupitelstva nebo 'prehled'), stejné volby jako
 * api/volby.js a api/prehled.js. Zdroj dat jen z env (CSU_BASE), nikdy z požadavku.
 * `extra` (např. fetchImpl) jen pro testy.
 */
export function buildFeed(key, env, extra = {}) {
    const baseUrl = env.CSU_BASE || KV_BASE_URL;
    const common = { conditional: true, minIntervalMs: 20e3, baseUrl, headers: { 'User-Agent': USER_AGENT }, ...extra };
    if (key === 'prehled') return createOverviewFeed({ councils: COUNCILS, concurrency: 8, ...common });
    const council = councilByZastup(key);
    if (!council) throw new Error(`unknown feed key: ${key}`);
    return createKvFeed({ council, ...common });
}
