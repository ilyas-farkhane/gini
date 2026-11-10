import { useEffect, useState } from 'react'
import { api } from './api.js'

export function IndexBar({ r, extra }) {
  const domainsFirst = r.key === 'FSC'  // Guide §8.1: report the four FSC domains before any overall value
  const doms = r.domains?.length > 0 && (<ul className="doms">{r.domains.map(d => (<li key={d.name}>
    <span>{d.name}</span><i><u style={{ width: (d.score ?? 0) + '%' }} /></i>
    <em>{d.score === null ? (d.not_applicable ? 'NA' : '–') : d.score.toFixed(1)}</em></li>))}</ul>)
  return (<div className="idx">
    <div className="idx-h"><h3>{r.name} ({r.key})</h3>
      {r.score !== null ? <p><b>{r.score.toFixed(1)}</b> · {r.band}</p> : <p className="muted">Not reported</p>}</div>
    {domainsFirst && doms}
    {r.score !== null && <div className="track" role="img" aria-label={`${r.score.toFixed(1)} of 100`}><div style={{ width: r.score + '%' }} /></div>}
    <p className="muted">{r.valid} of {r.total} items valid (minimum {r.need}); {r.missing} DK, NA, Not Available or blank — excluded, never scored as zero.
      {r.suppressed_reason && <> Suppressed: {r.suppressed_reason}</>}</p>
    {!domainsFirst && doms}
    {r.items && <p className="muted">Item-level (diagnostic): {Object.entries(r.items).map(([k, v]) => `${k} = ${v ?? '–'}`).join(' · ')}</p>}
    {extra}
  </div>)
}

export function Results({ code, inst }) {
  const [p, setP] = useState(null); const [err, setErr] = useState('')
  useEffect(() => { api.profile(code).then(setP).catch(e => setErr(e.message)) }, [code])
  if (err) return <p className="errmsg">{err}</p>
  if (!p) return <p className="muted">Loading…</p>
  const lab = (id, v) => { const q = inst.sections[0].items.find(x => x.id === id); return q?.options?.find(o => o[0] === (v?.code ?? v))?.[1] ?? '–' }
  return (<section>
    <p className="kicker">Thank you — your response is submitted</p>
    <h2>Your results profile</h2>
    <p className="note">Descriptive research indices from your perspective only. No overall survey score is calculated. Implementation, practice maturity, evidence readiness, and external impact are reported separately. Scores are not validated norms, not a GInI assessment, certification, or PAS 53002 conformity result, and survey answers alone cannot demonstrate causal impact. Organizational results combine all role perspectives and are produced by the study administrator.</p>
    {p.indices.length === 0 && <p>Your role has no scored practice modules; your evidence and outcome records feed the organizational analysis.</p>}
    {p.indices.map(r => <IndexBar key={r.key} r={r} />)}
    <div className="idx"><h3>Evidence and evaluation readiness (A13–A22)</h3>
      <p className="muted">Reported on its own; never folded into an index.</p>
      <dl className="kv">{['A13', 'A14', 'A15', 'A16', 'A17', 'A19', 'A20', 'A21'].map(id => <div key={id}><dt>{id}</dt><dd>{lab(id, p.readiness[id])}</dd></div>)}</dl></div>
    {p.external.applies && <div className="idx"><h3>External impact requirement</h3>
      <p>{p.external.external_initiatives.length + p.external.external_g2_rows.length > 0
        ? 'At least one externally oriented outcome was recorded.' : 'No external outcome recorded; a rationale for non-applicability was given.'}</p></div>}
    <p className="muted">Keep your resume code to view this profile again.</p>
  </section>)
}
