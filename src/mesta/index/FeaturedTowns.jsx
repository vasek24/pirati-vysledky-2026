// „Největší města": 12 největších zobrazených měst, stejné řádky jako všude,
// shardy top-1/top-2 jsou připojené napevno (řádky nic nesledují).
import TownRow from './TownRow.jsx';

export default function FeaturedTowns({ councils, views, onOpen }) {
    return (
        <section className="mi-sec" aria-labelledby="mi-feat-h">
            <h2 className="mi-sec-h" id="mi-feat-h">Největší města <small>{councils.length}</small></h2>
            <div className="mi-list mi-g2" aria-live="off">
                {councils.map((c) => <TownRow key={c.zastup} council={c} view={views.get(c.zastup)} onOpen={onOpen} />)}
            </div>
        </section>
    );
}
