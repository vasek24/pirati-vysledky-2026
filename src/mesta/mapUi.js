// Drobnosti mapy okrsků pro produkt „mesta“ — používají je záplaty pražských
// komponent (src/mesta/patches.js: ResultsMap, Precincts), proto žádné JSX ani DOM.

// Sečtený okrsek, jehož hlasy po kandidátkách se ještě dotahují (okrskový soubor ČSÚ
// ještě nedorazil): není to „čeká na sečtení“ a mapa to nesmí tvrdit. Účast (turnout)
// se kreslí i bez hlasů, takže tam nic nečeká.
export const PENDING_FILL = '#FCD34D';
export const isPending = (okrsek, modeId) => !!okrsek && !okrsek.votes && modeId !== 'turnout';

// Režim „Piráti“ u města, kde Piráti kandidují ve společné kandidátce: podíl patří celé
// kandidátce, ne samotným Pirátům, tak se to musí jmenovat.
const isJoint = (meta) => (meta?.members?.length || 0) > 1;

/** Popisek tlačítka režimu „ours“: „Piráti“ u samostatné kandidátky, „S Piráty“ u koalice. */
export function oursButtonLabel(meta, fallback = 'Piráti') {
    return isJoint(meta) ? 'S Piráty' : fallback;
}

/** Dlouhý popis režimu „ours“: u koalice jméno kandidátky. */
export function oursLongLabel(meta, fallback) {
    return isJoint(meta) ? `${meta.short} — podíl hlasů` : fallback;
}
