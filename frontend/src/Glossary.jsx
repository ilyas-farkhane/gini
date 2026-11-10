// Plain-language help from the survey's Appendix A glossary (Guide §17, §17.1).
import { createContext, useContext, useId, useMemo, useRef, useState } from 'react'

export const GlossaryCtx = createContext({ re: null, defs: {}, seen: null })

const SKIP = new Set(['implementation'])  // appears in nearly every item; defined in the glossary panel

export function useGlossary(glossary) {
  return useMemo(() => {
    const defs = {}
    for (const g of glossary) {
      const base = g.term.replace(/\s*\(.*?\)\s*/g, ' ').trim()
      const variants = g.term.includes('(DK)') ? [] : base.split(' / ').map(s => s.trim())
      for (const v of variants) if (v.length > 2 && !SKIP.has(v.toLowerCase())) defs[v.toLowerCase()] = g
    }
    // Pull "See X" entries through to the term they point at.
    for (const [k, g] of Object.entries(defs)) {
      const m = g.def.match(/^See (.+)\.$/); if (m && defs[m[1].toLowerCase()]) defs[k] = defs[m[1].toLowerCase()]
    }
    const keys = Object.keys(defs).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
    return { defs, re: new RegExp(`\\b(${keys.join('|')})\\b`, 'gi') }
  }, [glossary])
}

// Marks the first use of each glossary term within the current section.
export function Rich({ text }) {
  const { re, defs, seen } = useContext(GlossaryCtx)
  if (!re || !text) return text
  const parts = []; let last = 0
  for (const m of text.matchAll(re)) {
    const key = m[0].toLowerCase(); const g = defs[key]
    if (!g || (seen && seen.has(g.term))) continue
    seen && seen.add(g.term)
    parts.push(text.slice(last, m.index), <Term key={m.index} g={g} label={m[0]} />)
    last = m.index + m[0].length
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}

function Term({ g, label }) {
  const [open, setOpen] = useState(false); const id = useId(); const t = useRef()
  const show = () => { clearTimeout(t.current); setOpen(true) }
  const hide = () => { t.current = setTimeout(() => setOpen(false), 120) }
  return (<span className="term-wrap" onMouseEnter={show} onMouseLeave={hide}>
    <button type="button" className="term" aria-describedby={open ? id : undefined} aria-expanded={open}
      onFocus={show} onBlur={hide} onClick={() => setOpen(o => !o)} onKeyDown={e => e.key === 'Escape' && setOpen(false)}>{label}</button>
    {open && <span role="tooltip" id={id} className="tip"><b>{g.term}</b>{g.def}</span>}
  </span>)
}

export function GlossaryPanel({ glossary, onClose }) {
  const [q, setQ] = useState('')
  const list = glossary.filter(g => (g.term + ' ' + g.def).toLowerCase().includes(q.toLowerCase()))
  return (<div className="drawer" role="dialog" aria-modal="true" aria-label="Plain-language terminology glossary"
    onKeyDown={e => e.key === 'Escape' && onClose()}>
    <div className="drawer-h"><h2>Glossary</h2><button className="ghost" onClick={onClose} autoFocus>Close</button></div>
    <p className="note">Definitions describe how terms are used in this survey. If a term remains unclear for a question, select “Don’t Know” rather than inferring a technical meaning.</p>
    <label>Search terms<input value={q} onChange={e => setQ(e.target.value)} /></label>
    <dl>{list.map(g => <div key={g.term}><dt>{g.term}</dt><dd>{g.def}</dd></div>)}</dl>
  </div>)
}
