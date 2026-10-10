// „Moje obec": zastup posledního otevřeného města v localStorage (jen
// pohodlí — bez úložiště, v anonymním okně i při chybě funguje stránka stejně).
import { useCallback, useMemo, useState } from 'react';

export const MINE_KEY = 'mesta.mojeObec';

function read() {
    try {
        return localStorage.getItem(MINE_KEY);
    } catch {
        return null;
    }
}

function write(zastup) {
    try {
        if (zastup === null) localStorage.removeItem(MINE_KEY);
        else localStorage.setItem(MINE_KEY, String(zastup));
    } catch {
        /* bez úložiště platí jen pro tuhle návštěvu */
    }
}

export function useMyTown(councils) {
    const [zastup, setZastup] = useState(read);
    // zobrazené město s tímhle kódem; skryté nebo neznámé = žádná Moje obec
    const mine = useMemo(() => councils.find((c) => String(c.zastup) === zastup) ?? null, [councils, zastup]);
    const set = useCallback((council) => {
        write(council.zastup);
        setZastup(String(council.zastup));
    }, []);
    const forget = useCallback(() => {
        write(null);
        setZastup(null);
    }, []);
    // První otevřené město se zapamatuje samo. Jen zápis do úložiště, žádný stav:
    // sekce „Moje obec" se objeví až při příštím otevření indexu, ne nad právě
    // čteným seznamem (nic se nepohne). Vrací true, když se uložilo.
    const rememberIfEmpty = useCallback((council) => {
        const had = read();
        if (had !== null && councils.some((c) => String(c.zastup) === had)) return false;
        write(council.zastup);
        return true;
    }, [councils]);
    return { mine, set, forget, rememberIfEmpty };
}
