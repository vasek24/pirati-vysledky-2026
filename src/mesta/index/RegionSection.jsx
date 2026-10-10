// Kraj jako disclosure (APG accordion): h3 > button[aria-expanded]; druhý řádek
// hlavičky má pevnou výšku a nese postup i chybu načítání (žádný banner).
export default function RegionSection({ region, expanded, header, onToggle, children }) {
    const id = region.kraj;
    return (
        <section className="mi-region" id={`kraj-${id}`}>
            <h3 className="mi-rh">
                <button type="button" id={`kh-${id}`} aria-expanded={expanded} aria-controls={`kl-${id}`} onClick={() => onToggle(id)}>
                    <span className="mi-rh-name">{region.name}</span>
                    <span className={`mi-rh-sub${header.error ? ' mi-err' : ''}`}>{header.text}</span>
                    <span className="mi-chev" aria-hidden="true" />
                </button>
            </h3>
            <div className="mi-list mi-rl mi-g2" id={`kl-${id}`} hidden={!expanded} aria-live="off">
                {expanded ? children : null}
            </div>
        </section>
    );
}
