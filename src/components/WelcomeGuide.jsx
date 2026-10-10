// Krátký průvodce při první návštěvě (jednou na prohlížeč). Hlavně: stránka
// se obnovuje sama a ruční obnovení nic nezrychlí, jen zatěžuje server.
// Mountuje se v main.jsx; dokud je průvodce na řadě, UpdateManager
// neotevírá „Co je nové" (dvě okna přes sebe).
import React, { useCallback, useState } from 'react';
import { POLLS_CLOSE } from '../councils';
import { useDialog } from '../hooks/useDialog';
import { GUIDE_KEY, guidePending } from '../utils/welcomeGuide';

function Step({ icon, title, children }) {
    return (
        <li className="flex gap-3">
            <span className="shrink-0 w-9 h-9 rounded-full bg-black text-[#FEC900] flex items-center justify-center" aria-hidden="true">{icon}</span>
            <div className="min-w-0">
                <div className="text-sm font-bold text-neutral-900">{title}</div>
                <p className="mt-0.5 text-sm text-neutral-600 leading-snug">{children}</p>
            </div>
        </li>
    );
}

const iconProps = { className: 'w-5 h-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

export default function WelcomeGuide() {
    const [open, setOpen] = useState(guidePending);
    const [before] = useState(() => Date.now() < POLLS_CLOSE);
    const close = useCallback(() => {
        setOpen(false);
        try {
            localStorage.setItem(GUIDE_KEY, '1');
        } catch {
            /* ignore */
        }
    }, []);
    const ref = useDialog(open, close);
    if (!open) return null;

    return (
        // na telefonu panel zespodu, na větší obrazovce okno uprostřed
        <div className="fixed inset-0 z-[3500] bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={close}>
            <div
                ref={ref}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby="welcome-title"
                className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90dvh] overflow-y-auto overscroll-contain outline-none"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-4 bg-black text-white rounded-t-2xl">
                    <h2 id="welcome-title" className="font-display text-3xl leading-none tracking-wide">
                        Jak to tu <span className="text-[#FEC900]">funguje</span>
                    </h2>
                    <p className="mt-1 text-xs text-white/60">Živé výsledky komunálních voleb 2026 v Praze z ČSÚ přes náš server.</p>
                </div>
                <ul className="p-4 space-y-4">
                    <Step
                        title="Stránka se obnovuje sama"
                        icon={(
                            <svg {...iconProps}>
                                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        )}
                    >
                        Během sčítání sama kontroluje nová data (ČSÚ je zveřejňuje zhruba jednou za minutu) a ukáže je — kdy to bude, vidíš nahoře u odpočtu.{' '}
                        <b className="text-neutral-900">Ručně ji neobnovuj</b>: rychleji to nebude (ČSÚ data mění zhruba jednou za minutu) a zbytečně to zatěžuje server.
                    </Step>
                    {before ? (
                        <Step
                            title="Výsledky v sobotu po 14:00"
                            icon={(
                                <svg {...iconProps}>
                                    <circle cx="12" cy="12" r="9" />
                                    <path d="M12 7v5l3 2" />
                                </svg>
                            )}
                        >
                            Do té doby tu jsou kandidátky a výsledky z roku 2022. Stačí nechat stránku otevřenou — první okrsky naskočí samy.
                        </Step>
                    ) : (
                        <Step
                            title="Výsledky přibývají po okrscích"
                            icon={(
                                <svg {...iconProps}>
                                    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
                                </svg>
                            )}
                        >
                            Čísla se mění, jak okrskové komise posílají sečtené hlasy. První okrsky nemusí být pro celou MČ typické.
                        </Step>
                    )}
                    <Step title="Mandáty jsou do vyhlášení odhad" icon={<span className="font-display text-2xl leading-none">≈</span>}>
                        Počítáme je podle zákona z průběžně sečtených okrsků. Oficiální čísla vyhlásí ČSÚ po sečtení všeho.
                    </Step>
                </ul>
                <div className="px-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <button
                        onClick={close}
                        className="w-full min-h-11 py-2.5 rounded-xl bg-black text-white text-sm font-semibold hover:bg-neutral-800 transition-colors"
                    >
                        Rozumím
                    </button>
                </div>
            </div>
        </div>
    );
}
