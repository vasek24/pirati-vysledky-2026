import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { councilBySlug } from './councils.js'
import UpdateManager from './components/UpdateManager.jsx'
import WelcomeGuide from './components/WelcomeGuide.jsx'
import ReloadOnStale from './components/ReloadOnStale.jsx'

// Každá stránka (a mapa uvnitř stránky zastupitelstva) je zvlášť — přehled
// tak na telefonu nestahuje MapLibre a Leaflet, které nepoužívá
const Landing = lazy(() => import('./pages/Landing.jsx'))
const CouncilApp = lazy(() => import('./pages/CouncilApp.jsx'))

// Mini-router: /<slug> = výsledky zastupitelstva (viz src/councils.js),
// cokoli jiného = přehled. Na Vercelu má každý slug rewrite ve vercel.json.
const slug = window.location.pathname.replace(/^\/+|\/+$/g, '')
const council = councilBySlug(slug)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ReloadOnStale>
      <Suspense fallback={<div className="h-dvh bg-black" />}>
        {council ? <CouncilApp council={council} /> : <Landing />}
      </Suspense>
    </ReloadOnStale>
    <UpdateManager />
    <WelcomeGuide />
  </StrictMode>,
)
