import { T } from '../text.js'

export default function Guide() {
  return (
    <div className="snt-guide">
      <p style={{ margin: 0 }}><b>{T.guide1Head}</b>{T.guide1Body}</p>
      <p style={{ margin: 0 }}><b>{T.guide2Head}</b>{T.guide2Body}</p>
      <p style={{ margin: 0 }}><b>{T.guide3Head}</b>{T.guide3Body}</p>
    </div>
  )
}
