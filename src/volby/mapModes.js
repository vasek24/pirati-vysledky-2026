// Režimy mapy okrsků: co se počítá a jak se to barví
import { activeCouncil, partyMeta } from './council.js';
import { precinctShare, precinctWinner, baselineShare } from './compute.js';
import { sequentialScale, divergingScale, PIRATE_RAMP } from './colors.js';
import { fmtPct, fmtPp } from './format.js';

export const MAP_MODES = [
    { id: 'ours', label: 'Piráti', long: 'Piráti — podíl hlasů' },
    { id: 'winner', label: 'Vítěz', long: 'Vítěz okrsku' },
    { id: 'coalition', label: 'Koalice', long: 'Současná koalice — podíl hlasů' },
    { id: 'swing', label: 'Piráti vs 2022', long: 'Piráti proti předchůdci v KV 2022 (p. b.)' },
    { id: 'party', label: 'Strana', long: 'Podíl vybrané strany' },
    { id: 'turnout', label: 'Účast', long: 'Volební účast' },
];

const SHARE_BREAKS = [5, 10, 15, 20, 25, 30, 35];

// Průběžná škála podle skutečných hodnot: od nejnižšího po nejvyšší podíl mezi
// dosud sečtenými okrsky, 8 stejně širokých stupňů. Dokud je dat málo nebo jsou
// skoro stejná, platí pevná škála. Hodnoty zaokrouhlené na 0,1 p. b.
export function adaptiveBreaks(values, { minCount = 4, minSpread = 2, steps = 8 } = {}) {
    const v = values.filter((x) => Number.isFinite(x));
    if (v.length < minCount) return null;
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    if (hi - lo < minSpread) return null;
    const step = (hi - lo) / steps;
    const breaks = Array.from({ length: steps - 1 }, (_, i) => Math.round((lo + step * (i + 1)) * 10) / 10);
    return breaks.every((b, i) => i === 0 || b > breaks[i - 1]) ? breaks : null;
}
const czNum = (n) => String(n).replace('.', ',');

// Režimy, které dávají smysl: bez Pirátů v zastupitelstvu není „Piráti"
// ani „vs 2022", bez zadané současné koalice není „Koalice"
export function mapModesFor(council) {
    return MAP_MODES.filter((m) => (m.id === 'ours' || m.id === 'swing' ? !!council?.pirates
        : m.id === 'coalition' ? !!council?.coalition : true));
}

export function getMapMode(modeId, { partyId, results2022, okrsky } = {}) {
    const council = activeCouncil();
    const ours = council?.pirates;
    switch (modeId) {
        case 'winner':
            return {
                value: (o) => precinctWinner(o),
                color: (w) => partyMeta(w.id).color,
                opacity: (w) => 0.45 + Math.min(0.45, w.lead / 30),
                format: (w) => `${partyMeta(w.id).short} ${fmtPct(w.pct)}`,
                legend: null,
            };
        case 'coalition': {
            const scale = sequentialScale([30, 35, 40, 45, 50, 55, 60], '#4B5563');
            return {
                value: (o) => precinctShare(o, council.coalition?.lists || []),
                color: scale.color,
                format: fmtPct,
                legend: scale.legend,
            };
        }
        case 'swing': {
            const scale = divergingScale([-6, -3, -1, 1, 3, 6], '#1F2937', '#D9480F');
            const ids = partyMeta(ours).baseline?.ids || null;
            return {
                value: (o, id) => {
                    const now = precinctShare(o, ours);
                    const then = ids ? baselineShare(results2022, ids, id) : null;
                    return now === null || then === null ? null : now - then;
                },
                color: scale.color,
                format: fmtPp,
                legend: scale.legend,
            };
        }
        case 'turnout': {
            const scale = sequentialScale([30, 35, 40, 45, 50, 55, 60], '#0F766E');
            return {
                value: (o) => (o ? o.turnout : null),
                color: scale.color,
                format: fmtPct,
                legend: scale.legend,
            };
        }
        case 'party':
        case 'ours':
        default: {
            const id = modeId === 'party' ? partyId : ours;
            // Piráti mají černou — choropleth pro ně v pirátské žluté škále
            const dyn = okrsky ? adaptiveBreaks(Object.values(okrsky).map((o) => precinctShare(o, id))) : null;
            const breaks = dyn || SHARE_BREAKS;
            const opts = dyn ? { fmt: czNum } : {};
            const scale = partyMeta(id).pirates
                ? sequentialScale(breaks, null, { ramp: PIRATE_RAMP, ...opts })
                : sequentialScale(breaks, partyMeta(id).color, opts);
            return {
                value: (o) => precinctShare(o, id),
                color: scale.color,
                format: fmtPct,
                legend: scale.legend,
            };
        }
    }
}
