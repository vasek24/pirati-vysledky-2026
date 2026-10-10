// Přepínače seznamu (Kraje · Velikost · A–Z) a filtr „Jen sečtené" s rezervovaným
// pruhem pro nově sečtená města (obnovení dat řádky nikdy neposune).
import { newlyCountedText } from '../indexModel.js';

const VIEWS = [['kraje', 'Kraje'], ['velikost', 'Velikost'], ['az', 'A–Z']];

export default function ListControls({ view, onView, onlyDone, onToggleDone, bar, onShowNew }) {
    return (
        <>
            <div className="mi-chips" role="group" aria-label="Zobrazení seznamu">
                {VIEWS.map(([id, label]) => (
                    <button key={id} type="button" className="mi-chip" aria-pressed={view === id} onClick={() => onView(id)}>{label}</button>
                ))}
                <button type="button" className="mi-chip mi-tog" aria-pressed={onlyDone} onClick={onToggleDone}>Jen sečtené</button>
            </div>
            {onlyDone && (
                <div className="mi-newbar">
                    {bar.fresh > 0
                        ? <button type="button" onClick={onShowNew}>{newlyCountedText(bar.fresh)}</button>
                        : bar.text}
                </div>
            )}
        </>
    );
}
