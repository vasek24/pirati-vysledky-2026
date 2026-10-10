// Index mesta.dg12.cz (/): hledání, Moje obec, největší města a kraje s líným
// načítáním. Vstupní bod pro src/mesta/main.jsx; data bere z ./councils.js
// (COUNCILS = jen zobrazená města) a z hotových JSON; samotná stránka je
// index/IndexPage.jsx (bere data jako props, jde pustit s vývojovými daty).
import { OVERVIEW_VERSION } from '../volby/overview.js';
import aliases from './aliases.js';
import { ALL_COUNCILS, COUNCILS, REGIONS, SHARDS } from './councils.js';
import EXCLUDED from './excluded.generated.json';
import IndexPage from './index/IndexPage.jsx';

// EXCLUDED = obce mimo přehled pro hledání („Havířov", „Litovel" místo prázdného seznamu).
// HIDDEN = skrytá města (nízká jistota): v hledání jen jako neklikací „ověřujeme"
const HIDDEN = ALL_COUNCILS.filter((c) => !c.shown);

export default function MestaIndex() {
    return <IndexPage councils={COUNCILS} hidden={HIDDEN} shards={SHARDS} regions={REGIONS} excluded={EXCLUDED} aliases={aliases} version={OVERVIEW_VERSION} />;
}
