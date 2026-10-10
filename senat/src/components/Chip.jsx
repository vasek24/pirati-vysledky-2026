import { REL } from '../text.js'
import { outlookView } from '../outlook.js'

// Čip stavu: plná výplň = oficiální stav ČSÚ, čárkovaně = předběžně (outlook ze serveru)
export function Chip({ o, c }) {
  const w = outlookView(o, c)
  return <span className={`snt-chip snt-${w.cls}`}>{w.chip}</span>
}

// Jedna věta, proč je kandidatura tam, kde je (prázdná = nic nezobrazit)
export function Why({ o, c, style }) {
  const { why } = outlookView(o, c)
  return why ? <div className="snt-why" style={style}>{why}</div> : null
}

export function Relation({ pirate }) {
  return pirate ? <span className={`snt-rel snt-${pirate}`}>{REL[pirate]}</span> : null
}
