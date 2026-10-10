// Jeden řádek města — všude stejný (72 px, jediný cíl klepnutí): jméno a % Pirátů,
// druh kandidátky + její název a „průběžně" / mandáty (jen vyhlášené), postup
// sečtení a vlastní čas ČSÚ města. Hodnoty počítá rowView (indexModel.js).
import { memo } from 'react';
import { useRowRef } from './useRowVisibility.js';

const STATE_CLASS = { loading: 'mi-is-skel', error: 'mi-is-err', done: 'mi-is-fin' };

function TownRow({ council, view, watchShard = null, onOpen }) {
    const ref = useRowRef(watchShard);
    const cls = ['mi-row', STATE_CLASS[view.state], view.stale && 'mi-is-stale'].filter(Boolean).join(' ');
    return (
        <a ref={ref} className={cls} href={`/${council.slug}`} onClick={onOpen ? () => onOpen(council) : undefined}>
            <span className="mi-r-name">{council.name}</span>
            <span className="mi-r-val"><span className="mi-sr">Piráti: </span><b>{view.val}</b></span>
            <span className="mi-r-meta">
                {view.badge && <i className={`mi-badge mi-b-${view.badgeKind}`}>{view.badge}</i>}
                <span className="mi-r-list">{view.listName}</span>
            </span>
            <span className="mi-r-seats">{view.seats}</span>
            <span className="mi-r-prog">
                <span className="mi-bar" aria-hidden="true"><i style={{ width: `${(view.bar * 100).toFixed(1)}%` }} /></span>
                <span className="mi-r-txt">{view.txt}</span>
            </span>
            <span className="mi-r-time"><span>{view.timeLabel}</span></span>
        </a>
    );
}

// překreslí se jen při změně toho, co řádek ukazuje (viewKey), ne při každém snapshotu shardů
export default memo(TownRow, (a, b) => a.council === b.council && a.view.viewKey === b.view.viewKey && a.watchShard === b.watchShard && a.onOpen === b.onOpen);
