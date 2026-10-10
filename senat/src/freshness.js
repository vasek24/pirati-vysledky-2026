// Čerstvost dat a hlavička. `serverNow` = Date.now() + skew (čas serveru).
import { T } from './text.js'
import { formatAge, mmss, pragueTime } from './format.js'

export const ageSeconds = (generatedMs, serverNow) =>
  Number.isFinite(generatedMs) && Number.isFinite(serverNow) ? Math.max(0, Math.round((serverNow - generatedMs) / 1000)) : null

export const countdown = (nextAt, serverNow) =>
  Number.isFinite(nextAt) && Number.isFinite(serverNow) ? mmss(nextAt - serverNow) : null

// -> { pill, live, fresh }: text štítku, zda pulzuje, řádek „ČSÚ data z … · před … · další kontrola za …“
export function headerModel({ snapshot, serverNow, nextAt }) {
  const phase = snapshot.phase ?? 'counting'
  const waiting = phase === 'waiting'
  const live = phase === 'counting'
  const pill = waiting ? T.pillWaiting : live ? T.pillLive(snapshot.round) : T.pillDone(snapshot.round)
  const parts = []
  const when = pragueTime(snapshot.generatedMs, serverNow)
  if (when) parts.push(T.csuFrom(when))
  const age = formatAge(ageSeconds(snapshot.generatedMs, serverNow))
  if (waiting) parts.push(T.agoWaiting)
  else if (age) parts.push(T.ago(age))
  const left = countdown(nextAt, serverNow)
  if (left) parts.push(T.nextCheck(left))
  return { pill, live, fresh: parts.join(' · ') }
}
