// Index mesta.dg12.cz (/): hledání, Moje obec, největší města a kraje s líným
// načítáním. Vstupní bod pro src/mesta/main.jsx; data bere z ./councils.js
// (COUNCILS = jen zobrazená města) a z hotových JSON; samotná stránka je
// index/IndexPage.jsx (bere data jako props, jde pustit s vývojovými daty).
import { OVERVIEW_VERSION } from '../volby/overview.js';
import aliases from './aliases.js';
import { ALL_COUNCILS, COUNCILS, REGIONS, SHARDS } from './councils.js';
import IndexPage from './index/IndexPage.jsx';

// Obce mimo přehled pro hledání („Havířov", „Litovel" místo prázdného seznamu).
// Soubor vzniká v T1a; bez něj (nebo bez obsahu) hledání jen odpoví „nenašli jsme".
const found = Object.values(import.meta.glob('./excluded.generated.json', { eager: true, import: 'default' }))[0];
const EXCLUDED = Array.isArray(found) ? found : [];
// skrytá města (nízká jistota): v hledání jen jako neklikací „ověřujeme"
const HIDDEN = ALL_COUNCILS.filter((c) => !c.shown);

export default function MestaIndex() {
    return <IndexPage councils={COUNCILS} hidden={HIDDEN} shards={SHARDS} regions={REGIONS} excluded={EXCLUDED} aliases={aliases} version={OVERVIEW_VERSION} />;
}
