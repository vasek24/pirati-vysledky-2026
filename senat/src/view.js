// Výběry z hotového snapshotu pro zobrazení (řazení, pořadí karet, součty dlaždic).
// Stavy, statusy, pořadí ani většinu nepočítá klient — to je ze serveru (spec §3.1).
export const currentRound = (o) => (o.rounds[2] ? 2 : 1)
export const votesOf = (o, c) => (currentRound(o) === 2 ? c.votes2 : c.votes1)
export const pctOf = (o, c) => (currentRound(o) === 2 ? c.pct2 : c.pct1) ?? 0

export const progressOf = (r) => (r && r.okrskyCelkem ? (100 * r.okrskyZprac) / r.okrskyCelkem : 0)

// Řádky detailu: podle hlasů v aktuálním kole, při shodě podle čísla na lístku
export const sortRows = (o) =>
  [...o.candidates].sort((a, b) => (votesOf(o, b) ?? -1) - (votesOf(o, a) ?? -1) || a.no - b.no)

// Karty: kandidatury Pirátů (pirate = ticket|endorsed) podle čísla obvodu, pak čísla na lístku
export const pirateCards = (snapshot) =>
  snapshot.obvody.flatMap((o) =>
    o.candidates.filter((c) => c.pirate === 'ticket' || c.pirate === 'endorsed').map((c) => ({ o, c })),
  )

// První obvod s kandidaturou Pirátů (výchozí detail), jinak první obvod
export const defaultObvod = (snapshot) => (snapshot.obvody.find((o) => o.hasPirate) ?? snapshot.obvody[0])?.n ?? null

// Dlaždice Pirátů ze serverového součtu (součet = total)
export function pirateTally(summary) {
  const s = summary.pirates.byStatus
  return {
    total: summary.pirates.total,
    elected: s.elected,
    advancing: s.advancing,
    top: s.leading + s.second + s.runoffLeading,
    behind: s.behind + s.runoffBehind,
    out: s.notAdvancing + s.runoffLost + s.runoffTie,
    waiting: s.waiting,
  }
}
