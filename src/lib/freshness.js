// Čisté pomocné funkce pro zobrazení čerstvosti dat v hlavičce. `now` je vždy
// čas opravený o rozdíl hodin klienta a serveru (Date.now() + skew).
import { parseCsuTime } from '../volby/format.js';

// Stáří dat ČSÚ v celých sekundách (generated = pražský čas bez zóny);
// nikdy záporné, bez platného času 0 (volající si čas hlídá sám)
export function ageSeconds(nowCorrected, generated) {
    const d = parseCsuTime(generated);
    if (!d) return 0;
    return Math.max(0, Math.floor((nowCorrected - d.getTime()) / 1000));
}

export function formatAge(seconds) {
    const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    if (s < 60) return `před ${s} s`;
    if (s < 3600) return `před ${Math.floor(s / 60)} min`;
    return `před ${Math.floor(s / 3600)} h`;
}

// „M:SS" do další kontroly; null = žádná naplánovaná (skrytá záložka)
export function nextCheckLabel(nextAt, nowCorrected) {
    if (!Number.isFinite(nextAt)) return null;
    const sec = Math.max(0, Math.ceil((nextAt - nowCorrected) / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// live | pre | final | stale | offline. Bez snapshotu po uzavření místností
// je to „live" (studený start po 14:00), ne „před volbami".
export function liveState({ snapshot, now, pollsClose, online }) {
    if (online === false) return 'offline';
    if (snapshot?.stale) return 'stale';
    const phase = snapshot?.phase;
    if (phase === 'final') return 'final';
    if (phase === 'counting' || phase === 'waiting') return 'live';
    return now >= pollsClose ? 'live' : 'pre';
}
