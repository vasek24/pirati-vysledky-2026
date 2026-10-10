// Okrskové výsledky, podle kterých se počítá průběžná škála mapy — mapa je nastaví,
// legenda (jiná komponenta) je čte, ať obě ukazují stejné hranice.
import { useSyncExternalStore } from 'react';

let source = null;
const listeners = new Set();

export function setScaleSource(okrsky) {
    if (okrsky === source) return;
    source = okrsky;
    listeners.forEach((l) => l());
}

const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};

export const useScaleSource = () => useSyncExternalStore(subscribe, () => source, () => null);
