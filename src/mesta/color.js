// Barvy kandidátek produktu „mesta“: bílá a světle šedá na bílém podkladu mizí
// (spike: Ostrava, kandidátka 13 = #FFFFFF). Čisté funkce, bez závislostí.

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
// Podíl 0–1, nad kterým je barva „téměř bílá“ (spec 4.4)
export const NEAR_WHITE = 0.92;

// Svítivost (Rec. 709 váhy) z hodnot sRGB bez linearizace, 0–1; null pro neplatný zápis
export function luminance(color) {
    if (typeof color !== 'string' || !HEX.test(color)) return null;
    let h = color.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isNearWhite(color) {
    const l = luminance(color);
    return l !== null && l > NEAR_WHITE;
}
