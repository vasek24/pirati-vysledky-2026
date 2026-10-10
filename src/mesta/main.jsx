import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { councilBySlug } from './councils.js'
import UpdateManager from '../components/UpdateManager.jsx'
import WelcomeGuide from '../components/WelcomeGuide.jsx'

// Vstup produktu „mesta“ (vite.mesta.config.js přepíše v index.html /src/main.jsx
// na tento soubor). Jako src/main.jsx Prahy, jen s mestským rozcestníkem místo
// Landing a se zastupitelstvy z ./councils.js. Mimo vite.mesta.config.js se
// nepoužívá — spoléhá na swapModules (councils/changelog) a mestaPatches.
const MestaIndex = lazy(() => import('./MestaIndex.jsx'))
const CouncilApp = lazy(() => import('../pages/CouncilApp.jsx'))

// Mini-router: /<slug> = výsledky zastupitelstva, cokoli jiného = přehled měst.
const slug = window.location.pathname.replace(/^\/+|\/+$/g, '')
const council = councilBySlug(slug)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={<div className="h-dvh bg-black" />}>
      {council ? <CouncilApp council={council} /> : <MestaIndex />}
    </Suspense>
    <UpdateManager />
    <WelcomeGuide />
  </StrictMode>,
)
