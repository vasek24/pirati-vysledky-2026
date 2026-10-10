// Výběry z hotového snapshotu pro zobrazení (řazení, pořadí karet, součty dlaždic).
// Stavy, statusy, pořadí ani většinu nepočítá klient — to je ze serveru (spec §3.1).
export const currentRound = (o) => (o.rounds[2] ? 2 : 1)

// Kolo se volí podle kandidatury: v obvodu ve 2. kole ukazujeme 2. kolo jen finalistům
// (mají hlasy 2. kola); kdo do 2. kola nepostoupil, zůstává u čísel 1. kola.
export const roundOf = (o, c) => (currentRound(o) === 2 && c.votes2 != null ? 2 : 1)
export const votesOf = (o, c) => (roundOf(o, c) === 2 ? c.votes2 : c.votes1)
export const pctOf = (o, c) => (roundOf(o, c) === 2 ? c.pct2 : c.pct1) ?? 0

// Kandidatura mimo 2. kolo v obvodu, který už je ve 2. kole
export const isOutOfRunoff = (o, c) => currentRound(o) === 2 && roundOf(o, c) === 1

// Pořadí, které karta/detail ukazuje: finalistovi a v 1. kole pořadí ze serveru; kandidatuře
// mimo 2. kolo pořadí podle hlasů 1. kola (soutěžní pořadí v obvodu; server ho ve 2. kole nedává).
// Jen pro zobrazení — žádný stav ani status z toho klient neodvozuje.
export function rankOf(o, c) {
  if (!isOutOfRunoff(o, c)) return c.rank ?? null
  if (c.votes1 == null) return null
  return 1 + o.candidates.filter((x) => x.votes1 != null && x.votes1 > c.votes1).length
}

export const progressOf = (r) => (r && r.okrskyCelkem ? (100 * r.okrskyZprac) / r.okrskyCelkem : 0)

// Řádky detailu: finalisté 2. kola první (podle hlasů 2. kola), pak ostatní podle hlasů 1. kola;
// při shodě podle čísla na lístku
export const sortRows = (o) =>
  [...o.candidates].sort(
    (a, b) =>
      (roundOf(o, b) - roundOf(o, a)) || (votesOf(o, b) ?? -1) - (votesOf(o, a) ?? -1) || a.no - b.no,
  )

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
