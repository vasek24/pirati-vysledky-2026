// Čerstvost dat a hlavička. `serverNow` = Date.now() + skew (čas serveru).
import { T } from './text.js'
import { formatAge, mmss, pragueTime } from './format.js'
import { closesOf, runoffExpected } from './closing.js'

export const ageSeconds = (generatedMs, serverNow) =>
  Number.isFinite(generatedMs) && Number.isFinite(serverNow) ? Math.max(0, Math.round((serverNow - generatedMs) / 1000)) : null

export const countdown = (nextAt, serverNow) =>
  Number.isFinite(nextAt) && Number.isFinite(serverNow) ? mmss(nextAt - serverNow) : null

// -> { pill, live, fresh }: text štítku, zda pulzuje, řádek „ČSÚ data z … · před … · další kontrola za …“
// Neukončený obvod bez jediného sečteného okrsku 2. kola (ve fázi idle jsou takové všechny neukončené)
// (bez UCAST 2. kola, ale s hlasy 2. kola se už sčítá)
const counted2 = (o) =>
  o.rounds?.[2] ? o.rounds[2].okrskyZprac > 0 : (o.candidates ?? []).some((c) => (c.votes2 ?? 0) > 0)
const awaitsRound2 = (o) => o.state !== 'elected' && o.state !== 'tie' && !counted2(o)
// Server drží snapshot.round = 1, dokud nepřijde první hlas 2. kola, takže po zavření místností
// 2. kola (a před prvními daty) je idle snapshot kola 1: čekání poznáme podle času a očekávaného 2. kola.
const waitingForRound2 = (snapshot, serverNow) =>
  snapshot.phase === 'idle' &&
  (snapshot.obvody ?? []).some(awaitsRound2) &&
  (snapshot.round === 2 || (runoffExpected(snapshot) && Number.isFinite(serverNow) && serverNow >= closesOf(snapshot)[2]))

export function headerModel({ snapshot, serverNow, nextAt }) {
  const phase = snapshot.phase ?? 'counting'
  const waiting = phase === 'waiting'
  const waitingR2 = waitingForRound2(snapshot, serverNow)
  const live = phase === 'counting'
  const pill = waiting ? T.pillWaiting : waitingR2 ? T.pillWaitingR2 : live ? T.pillLive(snapshot.round) : T.pillDone(snapshot.round)
  const parts = []
  const when = pragueTime(snapshot.generatedMs, serverNow)
  if (when) parts.push(T.csuFrom(when))
  const age = formatAge(ageSeconds(snapshot.generatedMs, serverNow))
  if (waiting) parts.push(T.agoWaiting)
  else if (waitingR2) parts.push(T.agoWaitingR2)
  else if (age) parts.push(T.ago(age))
  const left = countdown(nextAt, serverNow)
  if (left) parts.push(T.nextCheck(left))
  return { pill, live, fresh: parts.join(' · ') }
}
