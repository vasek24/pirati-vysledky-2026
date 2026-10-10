// Zavření volebních místností aktuálního kola: kdy a za jak dlouho (hlavička před koncem
// hlasování, stejná věta jako na praha.dg12.cz). Čas je pevný, stejně jako POLLS_CLOSE_R1/R2
// ve workeru; kdyby se 2. kolo posunulo (env override ve workeru), upraví se tady.
export const POLLS_CLOSE = {
  1: Date.parse('2026-10-10T14:00:00+02:00'),
  2: Date.parse('2026-10-17T14:00:00+02:00'),
}
// Obě kola končí v sobotu ve 14:00 (text „v sobotu … ve 14:00“ je v T.closesBefore)
export const CLOSE_DATE = { 1: '10. 10.', 2: '17. 10.' }

const roundKey = (round) => (round === 2 ? 2 : 1)

// „43 min“, „1 h 5 min“, „6 d 22 h“ (nikdy „0 min“)
export function remaining(ms) {
  const min = Math.floor(ms / 60000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return `${h} h ${m} min`
  return `${Math.max(1, m)} min`
}

// null = místnosti už zavřené (nebo neznámý čas), jinak { date, left }
export function closingModel(round, serverNow) {
  if (!Number.isFinite(serverNow)) return null
  const k = roundKey(round)
  const ms = POLLS_CLOSE[k] - serverNow
  return ms > 0 ? { date: CLOSE_DATE[k], left: remaining(ms) } : null
}
