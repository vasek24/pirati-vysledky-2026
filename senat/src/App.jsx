import { useState } from 'react'
import { T } from './text.js'
import { connectionNotice } from './state.js'
import { defaultObvod } from './view.js'
import { useNow, useSnapshot } from './useSnapshot.js'
import Banner from './components/Banner.jsx'
import Board from './components/Board.jsx'
import Footer from './components/Footer.jsx'
import Header from './components/Header.jsx'

function scrollToDetail() {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  document.getElementById('h-det')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}

export default function App() {
  const state = useSnapshot()
  const now = useNow(1000)
  const [picked, setPicked] = useState(null)
  const { snapshot } = state
  const notice = connectionNotice(state)
  const selected = snapshot?.obvody.some((o) => o.n === picked) ? picked : snapshot ? defaultObvod(snapshot) : null
  const onSelect = (n, scroll) => {
    setPicked(n)
    if (scroll) scrollToDetail()
  }
  return (
    <>
      <Header snapshot={snapshot} serverNow={now + state.skew} nextAt={state.nextAt} />
      <Banner notice={notice} />
      <main className="snt-wrap">
        {snapshot ? (
          <Board snapshot={snapshot} selected={selected} onSelect={onSelect} />
        ) : (
          <p className="snt-empty" role="status">{notice === 'error' ? T.loadFailed : T.loading}</p>
        )}
      </main>
      <Footer />
    </>
  )
}
