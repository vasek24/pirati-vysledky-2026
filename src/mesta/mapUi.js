// Drobnosti mapy okrsků pro produkt „mesta“ — používají je záplaty pražských
// komponent (src/mesta/patches.js: ResultsMap, Precincts), proto žádné JSX ani DOM.

// Sečtený okrsek, jehož hlasy po kandidátkách se ještě dotahují (okrskový soubor ČSÚ
// ještě nedorazil): není to „čeká na sečtení“ a mapa to nesmí tvrdit. Účast (turnout)
// se kreslí i bez hlasů, takže tam nic nečeká.
// Modrošedá (ne žlutá: pirátská škála je žlutá → černá) s jantarovým čárkovaným okrajem v ResultsMap.
export const PENDING_FILL = '#8FA6BF';
export const isPending = (okrsek, modeId) => !!okrsek && !okrsek.votes && modeId !== 'turnout';
// Legenda „sečteno, hlasy se dotahují“ jen když takový okrsek vůbec je
export const hasPending = (snapshot, modeId) => Object.values(snapshot?.okrsky || {}).some((o) => isPending(o, modeId));

// Hlavička: pruh jedné buňky na okrsek je nečitelný u velkých měst (Brno 353) → jeden ukazatel postupu
export const STRIP_MAX_CELLS = 120;

/**
 * Věta pod ovládáním mapy o městských částech, které se z mapy vynechaly (okrsky 2026 se nekryjí
 * s hranicemi 2025). `droppedDistricts` = pole z okrsky.geojson; bez něj prázdný řetězec.
 */
export function mapNoteText(droppedDistricts) {
    if (!Array.isArray(droppedDistricts) || !droppedDistricts.length) return '';
    const names = droppedDistricts.map((d) => d.name);
    const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` a ${names.length - 3} další` : '');
    return `Okrsky v ${names.length > 1 ? 'částech' : 'části'} ${shown} se letos změnily — na mapě nejsou, ve výsledcích ano.`;
}

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
