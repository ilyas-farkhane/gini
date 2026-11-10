// Study-administrator console: organization codes, closing/freezing, the Guide §13
// interpretation dashboard, analyst CCS/GICS ratings (§10), and exports (§17, Appendix A).
import { useEffect, useMemo, useState } from 'react'
import { admin } from './api.js'
import { IndexBar } from './Results.jsx'

export default function Admin({ inst, token, onLogin, onLogout }) {
  const [draft, setDraft] = useState(token || '')
  const [orgs, setOrgs] = useState(null)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = (t = token) => {
    if (!t) { setOrgs(null); return Promise.resolve() }
    setBusy(true)
    return admin.orgs(t).then(o => { setOrgs(o); setErr('') }).catch(e => { setErr(e.message); setOrgs(null); onLogout?.() }).finally(() => setBusy(false))
  }

  useEffect(() => { if (token) load(token); else { setOrgs(null); setSel(null); setDraft('') } }, [token])

  const signIn = async e => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const o = await admin.orgs(draft.trim())
      onLogin(draft.trim())
      setOrgs(o)
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }

  if (!token) return (<main className="solo"><form className="card login-card" onSubmit={signIn}>
    <p className="kicker">Restricted access</p>
    <h2>Administrator login</h2>
    <p className="note">This console is not linked from the public survey. Enter the administrator token configured on the server.</p>
    <label>Administrator token<input type="password" value={draft} onChange={e => setDraft(e.target.value)} autoComplete="current-password" required /></label>
    {err && <p className="errmsg" role="alert">{err}</p>}
    <button className="primary" disabled={busy || !draft.trim()}>{busy ? 'Signing in…' : 'Log in'}</button>
  </form></main>)

  if (!orgs) return (<main className="solo"><p className="muted">{busy ? 'Signing in…' : 'Loading organizations…'}</p>{err && <p className="errmsg" role="alert">{err}</p>}</main>)

  return (<main className="wide">
    <div className="admin-bar">
      <p className="muted">Signed in as administrator</p>
      <button type="button" className="ghost sm" onClick={() => { setSel(null); onLogout() }}>Log out</button>
    </div>
    {sel ? <Report token={token} code={sel} inst={inst} onBack={() => { setSel(null); load() }} />
      : <Orgs token={token} orgs={orgs} reload={load} open={setSel} />}
  </main>)
}

function Orgs({ token, orgs, reload, open }) {
  const blank = { code: '', name: '', unit_type: 'Whole organization', sector: '', geography: '', reporting_period: '', boundary: '', intended_external_beneficiaries: '', external_value_in_scope: true }
  const [f, setF] = useState(blank); const [err, setErr] = useState('')
  const save = async e => { e.preventDefault(); try { await admin.saveOrg(token, f); setF(blank); reload() } catch (x) { setErr(x.message) } }
  const inp = (k, label, long) => <label>{label}{long ? <textarea rows={2} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /> : <input value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} required={k === 'code'} />}</label>
  return (<section>
    <h2>Organizations</h2>
    <p className="note">Define each unit before administration (Guide §4): the same organization code, reporting period, and boundary apply to every respondent. Close an organization before the evidence-reconciliation meeting, then freeze the dataset.</p>
    <table className="tbl"><thead><tr><th>Code</th><th>Name</th><th>Period</th><th>Status</th><th>Submitted</th><th>Drafts</th><th /></tr></thead>
      <tbody>{orgs.map(o => (<tr key={o.code}><td><b>{o.code}</b></td><td>{o.name}</td><td>{o.reporting_period}</td><td>{o.status}</td><td>{o.submitted}</td><td>{o.drafts}</td>
        <td><button className="ghost sm" onClick={() => open(o.code)}>Dashboard</button>{' '}
          <button className="ghost sm" onClick={() => admin.status(token, o.code, o.status === 'open' ? 'closed' : 'open').then(reload)}>{o.status === 'open' ? 'Close' : 'Reopen'}</button></td></tr>))}
        {orgs.length === 0 && <tr><td colSpan={7} className="muted">No organization codes yet.</td></tr>}</tbody></table>
    <Exports token={token} />
    <form className="card" onSubmit={save}><h3>Register or update an organization code</h3>
      <div className="grid">{inp('code', 'Organization code')}{inp('name', 'Name (optional)')}
        <label>Unit of analysis<select value={f.unit_type} onChange={e => setF({ ...f, unit_type: e.target.value })}>
          {['Whole organization', 'Business unit', 'Agency-ministry', 'Program-portfolio', 'Other'].map(x => <option key={x}>{x}</option>)}</select></label>
        {inp('sector', 'Sector')}{inp('geography', 'Geography')}{inp('reporting_period', 'Reporting period')}</div>
      {inp('boundary', 'Organizational and value-chain boundary', true)}
      {inp('intended_external_beneficiaries', 'Intended external beneficiaries, customers, citizens, communities, partners…', true)}
      <label className="chk"><input type="checkbox" checked={f.external_value_in_scope} onChange={e => setF({ ...f, external_value_in_scope: e.target.checked })} /> External value is within the program’s scope</label>
      {err && <p className="errmsg">{err}</p>}
      <button className="primary">Save organization</button></form>
  </section>)
}

function Exports({ token, org }) {
  const [err, setErr] = useState('')
  const dl = (path, name) => admin.download(token, path, name).catch(e => setErr(e.message))
  const q = org ? `?org=${encodeURIComponent(org)}` : ''
  return (<div className="exports"><b>Exports</b>
    <button className="ghost sm" onClick={() => dl('/api/admin/export/long.csv' + q, `gini-responses${org ? '-' + org : ''}.csv`)}>Responses (codes + labels, CSV)</button>
    <button className="ghost sm" onClick={() => dl('/api/admin/export/codebook.csv', 'gini-codebook.csv')}>Codebook</button>
    {org && <button className="ghost sm" onClick={() => dl('/api/admin/export/snapshot.json' + q, `gini-frozen-${org}-${new Date().toISOString().slice(0, 10)}.json`)}>Freeze dataset (JSON)</button>}
    {!org && <button className="ghost sm" onClick={() => dl('/api/admin/export/contacts.csv', 'gini-contacts.csv')}>Contact list (separate)</button>}
    {err && <span className="errmsg">{err}</span>}</div>)
}

function Report({ token, code, inst, onBack }) {
  const [r, setR] = useState(null); const [drafts, setDrafts] = useState(false); const [err, setErr] = useState('')
  const load = () => admin.report(token, code, drafts).then(setR).catch(e => setErr(e.message))
  useEffect(() => { load() }, [drafts])
  const items = useMemo(() => Object.fromEntries(inst.sections.flatMap(s => s.items.map(q => [q.id, q]))), [inst])
  if (err) return <p className="errmsg">{err}</p>
  if (!r) return <p className="muted">Loading…</p>
  const ix = k => r.indices_combined.find(x => x.key === k)
  const opt = (id, c) => items[id]?.options?.find(o => String(o[0]) === String(c))?.[1] ?? c
  const dist = (id, d) => Object.entries(d || {}).map(([c, n]) => `${opt(id, c)} (${n})`).join(' · ') || '–'
  const txt = v => v == null ? '–' : typeof v === 'object' ? (v.m ? `[${v.m}]` : Object.entries(v).filter(([, x]) => x !== '' && x != null).map(([k, x]) => `${k}: ${typeof x === 'object' ? (x.m || JSON.stringify(x)) : x}`).join(' · ')) : String(v)
  const list = arr => arr?.length ? <ul className="ans">{arr.map((x, i) => <li key={i}><em>{x.role || x.respondent}</em> {txt(x.value ?? x.text)}</li>)}</ul> : <p className="muted">No entries.</p>
  const cov = r.coverage

  return (<section className="dash">
    <button className="ghost sm" onClick={onBack}>← Organizations</button>
    <h2>{code} — interpretation dashboard</h2>
    <p className="note">{r.org.name} · {r.org.unit_type} · {r.org.reporting_period} · status <b>{r.org.status}</b> · instrument v{r.instrument_version}. Results are reported as a chain of linked findings, not a single organizational score.</p>
    <label className="chk"><input type="checkbox" checked={drafts} onChange={e => setDrafts(e.target.checked)} /> Include unsubmitted drafts</label>
    <Exports token={token} org={code} />

    <Panel title="Coverage and quality gates">
      <p><b>{cov.respondents}</b> respondents · {cov.internal_perspectives} internal perspectives · <b>{cov.label}</b>{cov.limited_informant && ' — contribution-confidence interpretation capped at “plausible”'}</p>
      <p className="muted">{Object.entries(cov.by_role).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
      <ul className="gates">{Object.entries(r.quality_gates).map(([g, ok]) => <li key={g} className={ok ? 'ok' : 'no'}>{ok ? '✓' : '✗'} {g}</li>)}</ul>
      <p className="muted">Gates not computable from survey data (Evidence retrievability, Implementation by unit and wave, Evaluation design, Futures rigor, Attribution, Language, Terminology) require reviewer sign-off.</p>
    </Panel>

    <Panel title="1 · Implementation">
      <IndexBar r={ix('GIF')} />
      <dl className="kv long">{Object.entries(r.implementation).map(([k, v]) => <div key={k}><dt>{k} {items[k].text}</dt><dd>{list(v)}</dd></div>)}</dl>
    </Panel>
    <Panel title="2 · Innovation practices"><IndexBar r={ix('IPM')} /><IndexBar r={ix('IEQ')} /></Panel>
    <Panel title="3 · Future shaping">
      <IndexBar r={ix('FSC')} />
      <p><b>K13 horizon:</b> {dist('K13', r.future.K13)}</p><p><b>K14 methods:</b> {dist('K14', r.future.K14)}</p>
      <p><b>K15 decision changed</b></p>{list(r.future.K15)}<p><b>K16 evidence</b></p>{list(r.future.K16)}
    </Panel>
    <Panel title="4 · Sustainability integration"><IndexBar r={ix('PSI')} /></Panel>

    <Panel title="Scores by role (equal role weight in combined results)">
      <table className="tbl"><thead><tr><th>Role</th>{['GIF', 'IPM', 'IEQ', 'FSC', 'PSI'].map(k => <th key={k}>{k}</th>)}</tr></thead>
        <tbody>{Object.entries(r.indices_by_role).map(([role, xs]) => <tr key={role}><td>{role}</td>{['GIF', 'IPM', 'IEQ', 'FSC', 'PSI'].map(k => { const x = xs.find(y => y.key === k); return <td key={k}>{x ? (x.score ?? '–') : ''}</td> })}</tr>)}</tbody></table>
      <h4>Disagreement flags (role medians differ ≥2 or range ≥3)</h4>
      {r.disagreements.length ? <table className="tbl"><thead><tr><th>Item</th><th>Median</th><th>IQR</th><th>Role medians</th></tr></thead>
        <tbody>{r.disagreements.map(i => { const s = r.item_stats[i]; return <tr key={i}><td title={items[i]?.text}><b>{i}</b></td><td>{s.median}</td><td>{s.q1}–{s.q3}</td><td>{Object.entries(s.role_medians).map(([k, v]) => `${k}: ${v}`).join(' · ')}</td></tr> })}</tbody></table>
        : <p className="muted">None.</p>}
      <p className="muted">Review flagged items against evidence; report unresolved disagreement as a finding.</p>
    </Panel>

    <Panel title="5 · Program outcomes (G1 — indicator level, never averaged)">
      <table className="tbl"><thead><tr><th>Family</th><th>Records</th></tr></thead><tbody>
        {Object.entries(r.program_outcomes).map(([k, v]) => <tr key={k}><td><b>{k}</b> {items[k]?.text}</td><td>{list(v)}</td></tr>)}</tbody></table>
    </Panel>
    <Panel title="6 · Wider outcomes (G2 register and G3 direction)">
      <h4>External outcomes ({r.outcome_register.external.length})</h4><Rows rows={r.outcome_register.external} classes={inst.external_classes} />
      <h4>Internal outcomes ({r.outcome_register.internal.length})</h4><Rows rows={r.outcome_register.internal} classes={inst.external_classes} />
      <h4>Outcome direction profile</h4>
      <table className="tbl"><thead><tr><th>Domain</th><th>n</th><th>Median change (−2 to +2)</th><th>Evidence levels</th></tr></thead>
        <tbody>{Object.entries(r.outcome_direction).map(([k, v]) => <tr key={k}><td><b>{k}</b> {items[k].text}</td><td>{v.n}</td><td>{v.median ?? '–'}</td><td>{Object.entries(v.levels).map(([l, n]) => `${l}×${n}`).join(' ')}</td></tr>)}</tbody></table>
      <p className="muted">No overall outcome result is produced unless at least three material domains are predeclared.</p>
    </Panel>

    <Panel title="7 · Initiative contribution confidence (CCS)">
      {r.initiatives.length === 0 && <p className="muted">No initiative records.</p>}
      {r.initiatives.map(i => <Initiative key={i.ref} i={i} inst={inst} items={items} opt={opt}
        save={(ratings, note) => admin.rate(token, code, { kind: 'CCS', ref: i.ref, ratings, note }).then(load)} />)}
    </Panel>
    <Panel title="8 · Impact estimates (Section L) and GInI Impact Confidence (GICS)">
      <p><b>L0a applicability:</b> {dist('L0a', r.evaluation_gate.L0a)} · <b>L0b reason:</b> {dist('L0b', r.evaluation_gate.L0b)} · <b>L14 claim level:</b> {dist('L14', r.evaluation_gate.L14)}</p>
      <p><b>L12 effect estimates</b></p>{list(r.evaluation_gate.L12)}
      <Rubric kind="GICS" crit={inst.gics} existing={r.gics[0]} inst={inst}
        save={(ratings, note) => admin.rate(token, code, { kind: 'GICS', ref: 'program', ratings, note }).then(load)} />
    </Panel>
    <Panel title="9 · Context and alternative explanations (H)">
      <table className="tbl"><tbody>{Object.entries(r.context).map(([k, v]) => <tr key={k}><td><b>{k}</b> {items[k].text}</td><td>median {v.median} (n={v.n})</td></tr>)}</tbody></table>
    </Panel>
    <Panel title="10 · Evidence availability (J) — not collapsed into maturity">
      {[['Core J1–J12', 1, 12], ['Advanced J13–J15', 13, 15], ['External J16–J17', 16, 17]].map(([t, a, b]) => (<div key={t}><h4>{t}</h4>
        <table className="tbl"><tbody>{Array.from({ length: b - a + 1 }, (_, n) => `J${a + n}`).map(j => <tr key={j}><td><b>{j}</b> {items[j].text}</td>
          <td>{Object.entries(r.evidence_availability[j] || {}).map(([c, n]) => `${items[j].fields[0].options.find(o => String(o[0]) === c)?.[1] ?? c} (${n})`).join(' · ') || '–'}</td></tr>)}</tbody></table></div>))}
    </Panel>
    <Panel title="11 · Equity and adverse effects">
      {r.adverse.F10.length ? <ul className="ans">{r.adverse.F10.map(x => <li key={x.ref}><em>{x.ref}</em> {txt(x.text)}</li>)}</ul> : <p className="muted">No F10 entries.</p>}
      <p><b>G3g overall adverse or unintended effects:</b> {r.adverse.G3g ? `median ${r.adverse.G3g.median} (n=${r.adverse.G3g.n})` : '–'}</p>
    </Panel>
    <Panel title="12 · Action">
      <p><b>Top three barriers:</b> {r.top3_barriers.map(k => `${k} ${items[k].text}`).join(' · ') || '–'}</p>
      <table className="tbl"><thead><tr><th>Barrier</th><th>Severity</th><th>Controllability</th><th>Top 3 votes</th></tr></thead>
        <tbody>{Object.entries(r.barriers).map(([k, v]) => <tr key={k}><td><b>{k}</b> {items[k].text}</td><td>{v.severity ?? '–'}</td><td>{v.controllability ?? '–'}</td><td>{v.top3}</td></tr>)}</tbody></table>
      <p><b>90-day improvement commitments</b></p>{list(r.actions)}{list(r.action_owners)}
    </Panel>
    <Panel title="13 · Evidence and evaluation readiness (A13–A22)">
      <table className="tbl"><tbody>{Object.entries(r.readiness).map(([k, d]) => <tr key={k}><td><b>{k}</b> {items[k].text}</td><td>{dist(k, d)}</td></tr>)}</tbody></table>
    </Panel>
    <Panel title="14 · External relevance and impact">
      <p className={r.external_profile.satisfied ? 'okline' : 'errmsg'}>{r.external_profile.satisfied ? '✓ External-impact requirement met (external outcome reported, rationale documented, or external value out of scope).' : '✗ No externally oriented outcome and no rationale documented.'}</p>
      <p><b>F27 orientation:</b> {dist('F27', r.external_profile.orientation)}</p>
      <p><b>F28 categories:</b> {dist('F28', r.external_profile.categories)}</p>
      {r.external_profile.rationale.length > 0 && <><p><b>Non-applicability rationale (GX)</b></p>{list(r.external_profile.rationale)}</>}
    </Panel>
  </section>)
}

const Panel = ({ title, children }) => <div className="panel"><h3>{title}</h3>{children}</div>

function Rows({ rows, classes }) {
  if (!rows.length) return <p className="muted">None.</p>
  return (<table className="tbl"><thead><tr><th>Class</th><th>Outcome/ metric</th><th>Population</th><th>Baseline</th><th>Current</th><th>Verification</th><th>Level</th></tr></thead>
    <tbody>{rows.map((x, i) => <tr key={i}><td>{classes[(x.class || 0) - 1] || '–'}</td><td>{x.metric}</td><td>{x.population}</td>
      <td>{x.baseline?.m || x.baseline || '–'}</td><td>{x.current?.m || x.current || '–'}</td><td>{['None', 'Internal', 'External'][(x.verification || 0) - 1] || '–'}</td><td>{x.level || '–'}</td></tr>)}</tbody></table>)
}

function Initiative({ i, inst, items, opt, save }) {
  const f = i.fields
  return (<div className="init">
    <h4>{i.ref} · {typeof f.F1 === 'string' ? f.F1 : 'Untitled initiative'} <span className="muted">({i.role})</span></h4>
    <p className="muted">Decision: {opt('F17', f.F17) ?? '–'} · Design: {opt('F14', f.F14) ?? '–'} · Strength: {f.F13?.strength ? items.F13.fields[0].options.find(o => o[0] === f.F13.strength)?.[1] : '–'} · Orientation: {opt('F27', f.F27) ?? '–'} · External evidence level: {f.F30?.level || '–'}</p>
    {f.F6 && <p><b>Mechanism:</b> {typeof f.F6 === 'string' ? f.F6 : f.F6.m}</p>}
    {f.F11 && <p><b>Alternative explanations:</b> {typeof f.F11 === 'string' ? f.F11 : f.F11.m}</p>}
    <Rubric kind="CCS" crit={inst.ccs} existing={i.ccs_ratings ? { ratings: i.ccs_ratings, gics: i.ccs, note: i.ccs_note, interpretation: i.ccs_interpretation } : null} save={save} />
  </div>)
}

function Rubric({ kind, crit, existing, save }) {
  const [v, setV] = useState(existing?.ratings || crit.map(() => null)); const [note, setNote] = useState(existing?.note || '')
  const [open, setOpen] = useState(false)
  return (<div className="rubric">
    <p>{kind} {existing?.gics != null ? <><b>{existing.gics}</b> — {existing.interpretation}</> : <span className="muted">not yet rated</span>}
      {' '}<button className="ghost sm" onClick={() => setOpen(!open)}>{open ? 'Hide rubric' : 'Rate after evidence review'}</button></p>
    {open && <>
      <table className="tbl rub"><thead><tr><th>Criterion</th><th>0</th><th>2</th><th>4</th><th>Rating</th></tr></thead>
        <tbody>{crit.map(([name, a, b, c], n) => <tr key={name}><td><b>{name}</b></td><td>{a}</td><td>{b}</td><td>{c}</td>
          <td><select aria-label={name} value={v[n] ?? ''} onChange={e => setV(v.map((x, j) => j === n ? (e.target.value === '' ? null : +e.target.value) : x))}>
            <option value="">–</option>{[0, 1, 2, 3, 4].map(x => <option key={x}>{x}</option>)}</select></td></tr>)}</tbody></table>
      <p className="muted">Use 1 or 3 when evidence falls between anchors. The score is confidence in a claim, not the size of impact, and cannot permit stronger language than the evaluation design.</p>
      <label>Note<textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
      <button className="primary sm" onClick={() => save(v, note).then(() => setOpen(false))}>Save {kind}</button></>}
  </div>)
}
