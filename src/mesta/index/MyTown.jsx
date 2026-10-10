// „Moje obec": město, které člověk otevřel naposledy z indexu, nad „největšími
// městy"; Změnit (hledání v režimu „vyberte svou obec") a Zapomenout.
import TownRow from './TownRow.jsx';

export default function MyTown({ council, view, onChange, onForget }) {
    return (
        <section className="mi-sec mi-mine" aria-labelledby="mi-mine-h">
            <h2 className="mi-sec-h" id="mi-mine-h">Moje obec</h2>
            <div className="mi-list" aria-live="off">
                <TownRow council={council} view={view} />
            </div>
            <div className="mi-mine-act">
                <button type="button" className="mi-lnk" onClick={onChange}>Změnit</button>
                <button type="button" className="mi-lnk" onClick={onForget}>Zapomenout</button>
            </div>
        </section>
    );
}
