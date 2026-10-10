// Řetězec zpoždění „ČSÚ → náš server → prohlížeč → vykresleno“ pro hlavičku.
// Čisté funkce; vše v sekundách, celá čísla, nikdy záporné. Chybějící nebo
// nesmyslný vstup (starší Worker bez `refreshedAt`/`servedAt`) = null, ať se
// nikdy neukáže NaN ani záporný čas. Časy `refreshedAt`/`servedAt`/`receivedAt`/
// `renderedAt` jsou epoch ms v čase serveru (klient opravený o skew).
import { parseCsuTime } from '../volby/format.js';

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// Krok delší než 10 min nedává smysl (jiný refresh, špatné hodiny) → raději nic
export const MAX_STEP_SECONDS = 600;
// rozdíl ms → celé sekundy ≥ 0; null, když některý konec chybí nebo je krok nad stropem
const seconds = (from, to) => {
    if (from === null || to === null) return null;
    const s = Math.max(0, Math.round((to - from) / 1000));
    return s > MAX_STEP_SECONDS ? null : s;
};

const pragueTime = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

// HH:MM:SS v pražském čase (ne podle pásma prohlížeče); '–' bez platného času
export function fmtPragueTime(ms) {
    const t = finite(ms);
    return t === null ? '–' : pragueTime.format(t);
}

// generated = pražský čas bez zóny (vždy přes parseCsuTime)
// skewValid === false: odpověď neměla použitelné `x-server-now`, hodiny klienta
// jsou neověřené → krok „do prohlížeče“ se neukazuje (server část zůstává)
export function latencyChain({ generated, refreshedAt, servedAt, receivedAt, renderedAt, skewValid } = {}) {
    const parsed = typeof generated === 'string' ? parseCsuTime(generated) : null;
    const g = parsed ? finite(parsed.getTime()) : null;
    const refreshed = finite(refreshedAt);
    const served = finite(servedAt);
    const received = finite(receivedAt);
    const rendered = finite(renderedAt);
    const csuToServer = seconds(g, refreshed); // generated po refreshedAt → 0
    // do prohlížeče: od načtení serverem po příchod odpovědi (včetně čekání na
    // další dotaz); bez `receivedAt` aspoň do chvíle, kdy ji server vydal
    const clientOk = skewValid !== false;
    const serverToClient = clientOk ? seconds(refreshed, received ?? served) : null;
    const receiveToRender = clientOk ? seconds(received, rendered) : null;
    const total = csuToServer === null || serverToClient === null || receiveToRender === null
        ? null
        : csuToServer + serverToClient + receiveToRender;
    return { csuToServer, serverToClient, receiveToRender, total };
}

const known = (label) => typeof label === 'string' && label !== '' && label !== '–';
const sec = (n) => (Number.isFinite(n) && n >= 0 ? ` (+${Math.round(n)} s)` : '');

// Jedna řádka pro hlavičku; null, když jsou známé míň než dva kroky.
// Štítky jsou už zformátované časy (HH:MM:SS).
export function formatLatencyLine(chain, { generatedLabel, refreshedLabel, renderedLabel } = {}) {
    if (!chain || typeof chain !== 'object') return null;
    const steps = [];
    if (known(generatedLabel)) steps.push(`ČSÚ vygenerovalo ${generatedLabel}`);
    if (known(refreshedLabel)) steps.push(`náš server načetl ${refreshedLabel}${known(generatedLabel) ? sec(chain.csuToServer) : ''}`);
    if (known(renderedLabel)) {
        const { serverToClient: a, receiveToRender: b } = chain;
        steps.push(`váš prohlížeč zobrazil ${renderedLabel}${known(refreshedLabel) && Number.isFinite(a) && Number.isFinite(b) ? sec(a + b) : ''}`);
    }
    if (steps.length < 2) return null;
    const line = steps.join(' → ');
    return Number.isFinite(chain.total) && chain.total >= 0 ? `${line} · celkem ${Math.round(chain.total)} s` : line;
}

// Řetězec se zaznamená jen při PRVNÍM spatření nového `generated`: server po
// každém úspěšném načtení přepíše `refreshedAt`, i když ČSÚ data nezměnilo
// (při sčítání +60 s, ve fázi final +15 min), takže pozdější odpovědi se stejným
// `generated` by řetězec jen zkreslily. Bez `generated` se nic nemění.
// TODO (Phase 2, cloudflare/refresh.js): server-side `firstSeenAt` (kdy server
// dostal tuhle verzi poprvé) by udělal řetězec přesný i při čerstvém načtení
// stránky — teď první odpověď po otevření stránky vidí data, která mohou být
// už starší.
export function nextLatency(prev, { generated, refreshedAt, servedAt, receivedAt, skewValid }) {
    if (typeof generated !== 'string' || generated === '') return prev;
    if (prev && prev.generated === generated) return prev;
    return { generated, refreshedAt, servedAt, receivedAt, skewValid, renderedAt: null };
}

// Řádek ukazovat jen při sčítání s čerstvými daty z nového serveru
export function latencyVisible({ demo, phase, stale, latency } = {}) {
    if (demo || stale || !latency) return false;
    if (phase === 'pre' || phase === 'final') return false;
    return finite(latency.refreshedAt) !== null;
}
