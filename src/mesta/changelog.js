/* global __MESTA_BUILD__ */
// Verze a „Co je nové“ pro build mesta — nahrazuje src/changelog.js Prahy
// (swapModules ve vite.mesta.config.js). Verze se mění s každým buildem
// (git sha + hash datových souborů), takže otevřené záložky si po novém nasazení
// samy nabídnou obnovení (useUpdateCheck porovnává /version.json s APP_VERSION).
// Mimo build (testy, dev) není __MESTA_BUILD__ definované.

const BUILD = typeof __MESTA_BUILD__ === 'undefined' ? 'dev' : __MESTA_BUILD__;

export const APP_VERSION = 'mesta-' + BUILD;

export const CHANGELOG = [
    {
        version: APP_VERSION,
        date: '2026-10-10',
        title: 'Piráti ve městech',
        items: [
            { type: 'new', text: 'Živé výsledky komunálních voleb 2026 ve městech, kde kandidují Piráti' },
            { type: 'new', text: 'Přehled měst podle krajů s vyhledáváním' },
            { type: 'new', text: 'U každého města je vidět, jak tu Piráti kandidují: samostatně, v koalici, nebo na jiné kandidátce' },
        ],
    },
];
