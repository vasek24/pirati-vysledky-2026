// Černá hlavička: logo, stav (PŘED SČÍTÁNÍM / ŽIVĚ / OFFLINE), nadpis a jedna věta.
import { POLLS_CLOSE } from '../indexModel.js';

export default function IndexHeader({ townCount, now, online }) {
    const pre = now < POLLS_CLOSE;
    const pill = !online ? ['mi-pill', 'OFFLINE'] : pre ? ['mi-pill', 'PŘED SČÍTÁNÍM'] : ['mi-pill mi-live', 'ŽIVĚ'];
    return (
        <header className="mi-hero">
            <div className="mi-hero-in">
                <div className="mi-hero-top">
                    <img src="/brand/logo-full-white.svg" alt="Česká pirátská strana" height="26" style={{ height: 26, width: 'auto' }} />
                    <span className={pill[0]}>{pill[1]}</span>
                </div>
                <h1 className="mi-h1">Piráti ve městech <span>2026</span></h1>
                <p>
                    {pre
                        ? `Hlasování končí v sobotu ve 14:00. Výsledky ${townCount} měst, kde Piráti kandidují.`
                        : 'Každé město má vlastní čas dat ČSÚ. Obnovujeme jen to, co máte na obrazovce.'}
                </p>
            </div>
        </header>
    );
}
