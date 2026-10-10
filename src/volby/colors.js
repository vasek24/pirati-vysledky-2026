// Barevné škály pro mapu okrsků
function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function rgbToHex(rgb) {
    return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

export function mix(a, b, t) {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    return rgbToHex(ca.map((v, i) => v + (cb[i] - v) * t));
}

// Sekvenční škála: světlá → barva strany. breaks = horní meze tříd
// kromě poslední (např. [5, 10, 15] → <5, 5–10, 10–15, 15+).
// Pirátská škála: od světle žluté přes pirátskou žlutou do černé
export const PIRATE_RAMP = ['#FFF8DB', '#FFEFAD', '#FEE070', '#FEC900', '#D9A800', '#9C7900', '#4D3C00', '#000000'];

export function sequentialScale(breaks, color, { unit = '%', ramp = null, fmt = (n) => n } = {}) {
    const n = breaks.length + 1;
    const colors = ramp
        ? Array.from({ length: n }, (_, i) => ramp[Math.round((i * (ramp.length - 1)) / (n - 1))])
        : Array.from({ length: n }, (_, i) => mix('#F2F2F0', color, 0.12 + (0.88 * i) / (n - 1)));
    const classOf = (v) => {
        let i = 0;
        while (i < breaks.length && v >= breaks[i]) i++;
        return i;
    };
    const legend = colors.map((c, i) => ({
        color: c,
        label: i === 0
            ? `< ${fmt(breaks[0])} ${unit}`
            : i === n - 1
                ? `${fmt(breaks[n - 2])}+ ${unit}`
                : `${fmt(breaks[i - 1])}–${fmt(breaks[i])} ${unit}`,
    })).reverse();
    return { color: (v) => colors[classOf(v)], legend };
}

// Divergentní škála pro změnu v p. b. (záporné oranžově, kladné barvou strany)
export function divergingScale(breaks, posColor, negColor = '#D9480F') {
    // breaks symetrické kolem nuly, např. [-6, -3, -1, 1, 3, 6]
    const n = breaks.length + 1;
    const mid = Math.floor(n / 2);
    const colors = Array.from({ length: n }, (_, i) => {
        if (i === mid) return '#F1F1EF';
        const t = Math.abs(i - mid) / mid;
        return mix('#F1F1EF', i < mid ? negColor : posColor, 0.25 + 0.75 * t);
    });
    const classOf = (v) => {
        let i = 0;
        while (i < breaks.length && v >= breaks[i]) i++;
        return i;
    };
    const fmt = (v) => `${v > 0 ? '+' : ''}${v}`;
    const legend = colors.map((c, i) => ({
        color: c,
        label: i === 0
            ? `< ${fmt(breaks[0])} p. b.`
            : i === n - 1
                ? `> ${fmt(breaks[n - 2])} p. b.`
                : `${fmt(breaks[i - 1])} až ${fmt(breaks[i])}`,
    })).reverse();
    return { color: (v) => colors[classOf(v)], legend };
}

export const UNCOUNTED_FILL = '#D4D4D0';

// Čitelná barva textu na pozadí dané barvy (žlutá → černý text)
export function textOn(hex) {
    if (!hex || hex.length < 7) return '#FFFFFF';
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.6 ? '#000000' : '#FFFFFF';
}
