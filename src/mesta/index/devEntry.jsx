// Vstup vývojové stránky (není v produkčním buildu): index nad vývojovými daty a
// zfalšovaným /api/kraj (devHarness.jsx). Spuštění bez zásahu do vite.config.js:
//   1. .cache/mesta-dev/index.html (ignorovaná složka) s <div id="root"> a
//      <script type="module" src="/src/mesta/index/devEntry.jsx">,
//   2. jednorázový config mimo repozitář: defineConfig({ root: '<repo>', plugins: [react(), tailwindcss()] }),
//   3. npx vite -c <ten config> → /.cache/mesta-dev/index.html?dev=1&at=15:45
// ?dev=1 panel (stavy dat, počítadlo dotazů, CLS), ?at=HH:MM hodiny stránky, ?nostrict bez StrictMode.
import '../../index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import aliases from '../aliases.js';
import { DevPanel, installMockApi } from './devHarness.jsx';
import { FIXTURE_COUNCILS, FIXTURE_EXCLUDED, FIXTURE_HIDDEN, FIXTURE_REGIONS, FIXTURE_SHARDS } from './devFixture.jsx';
import IndexPage from './IndexPage.jsx';

installMockApi();
const dev = new URLSearchParams(window.location.search).has('dev');
const strict = !new URLSearchParams(window.location.search).has('nostrict');
const app = (
    <>
        <IndexPage councils={FIXTURE_COUNCILS} hidden={FIXTURE_HIDDEN} shards={FIXTURE_SHARDS} regions={FIXTURE_REGIONS} excluded={FIXTURE_EXCLUDED} aliases={aliases} version={1} />
        {dev && <DevPanel />}
    </>
);
createRoot(document.getElementById('root')).render(strict ? <StrictMode>{app}</StrictMode> : app);
