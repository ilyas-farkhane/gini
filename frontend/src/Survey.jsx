import { useEffect, useMemo, useRef, useState } from 'react'
import { api, store } from './api.js'
import { Field, answered } from './fields.jsx'
import { GlossaryCtx, GlossaryPanel, useGlossary, Rich } from './Glossary.jsx'
import { Results } from './Results.jsx'

const STEP_KEY = 'gini-session:step'
const keyFor = (id, n) => (n > 1 ? `${id}#${n}` : id)

function visible(q, ans) {
  const c = q.show_if
  if (!c) return true
  const v = ans[c.item]
  if (c.in) return c.in.includes(v)
  if (c.not_in) return v !== undefined && !c.not_in.includes(v)
  return true
}

export default function Survey({ inst, config, sess, onReady, onLogout }) {
  const [me, setMe] = useState(null)
  const [ans, setAns] = useState({})
  const [step, setStep] = useState('welcome')
  const [saveState, setSaveState] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [glossOpen, setGlossOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [fCount, setFCount] = useState(1)
  const [fTab, setFTab] = useState(1)
  const gl = useGlossary(inst.glossary)
  const dirty = useRef(false)
  const ansRef = useRef(ans)
  ansRef.current = ans

  const secs = useMemo(() => Object.fromEntries(inst.sections.map(s => [s.id, s])), [inst])
  const role = me ? inst.roles[String(me.role)] : null
  const mods = role ? role.modules : []
  const itemsOf = sid => {
    const only = role?.only?.[sid]
    return secs[sid].items.filter(q => !only || only.includes(q.id))
  }

  // resume an existing session
  useEffect(() => {
    if (!sess?.code) { setMe(null); setAns({}); setStep('welcome'); return }
    api.me(sess.code).then(r => {
      setMe(r); setAns(r.answers || {})
      const n = Math.max(1, ...Object.keys(r.answers || {}).filter(k => k.includes('#')).map(k => +k.split('#')[1]))
      setFCount(n)
      setStep(r.status === 'submitted' ? 'done' : (store.get(STEP_KEY) || 'A'))
    }).catch(() => { onLogout?.() })
  }, [sess?.code])

  const isSubmitted = me?.status === 'submitted'

  async function saveDraft({ silent = false } = {}) {
    if (!sess?.code || isSubmitted) return false
    if (!silent) setSaving(true)
    setSaveState(silent ? 'Saving draft…' : 'Saving draft…')
    try {
      await api.save(sess.code, ansRef.current)
      dirty.current = false
      const when = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      setSaveState(`Draft saved ${when}`)
      setMe(m => m ? { ...m, status: 'draft', updated_at: new Date().toISOString() } : m)
      return true
    } catch (e) {
      setSaveState('Draft not saved — ' + e.message)
      return false
    } finally {
      if (!silent) setSaving(false)
    }
  }

  // autosave draft while editing (Guide §17); submitted answers never update
  useEffect(() => {
    if (!me || isSubmitted || !dirty.current) return
    const t = setTimeout(() => { saveDraft({ silent: true }) }, 900)
    return () => clearTimeout(t)
  }, [ans, me?.status])

  const setA = (k, v) => {
    if (isSubmitted) return
    dirty.current = true
    setSaveState('Unsaved changes')
    setAns(p => { const n = { ...p }; if (v === undefined) delete n[k]; else n[k] = v; return n })
  }
  const go = s => { setStep(s); store.set(STEP_KEY, s); setMenuOpen(false); window.scrollTo(0, 0) }

  useEffect(() => {
    if (!menuOpen) return
    const onKey = e => { if (e.key === 'Escape') setMenuOpen(false) }
    addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [menuOpen])

  if (!sess || !me) return <Welcome inst={inst} config={config} onReady={onReady} />

  const order = [...mods, 'DEC']
  const idx = order.indexOf(step)
  const progress = sid => {
    const its = itemsOf(sid).filter(q => visible(q, ans) && !['A1', 'A2'].includes(q.id))
    return [its.filter(q => answered(q, ans[q.id])).length, its.length]
  }
  const stepLabel = step === 'DEC' ? 'Declaration and submit' : step === 'done' ? 'Your results profile' : (secs[step]?.title || 'Survey')
  const stepCode = step === 'DEC' ? '✓' : step === 'done' ? '★' : step

  async function submit() {
    if (isSubmitted) return
    setErrors({})
    const local = {}
    if (ans.DEC1 !== true) local.DEC1 = 'Please confirm the respondent declaration.'
    if (Object.keys(local).length) { setErrors(local); return }
    const ok = window.confirm('Submit this response as final?\n\nAfter submission you will not be able to edit your answers. Use Save draft if you still need to make changes.')
    if (!ok) return
    setSaving(true)
    try {
      await api.submit(sess.code, ans, ans.DEC3 === 1 ? ans._contact : undefined)
      dirty.current = false
      setMe({ ...me, status: 'submitted' })
      setSaveState('Submitted — locked')
      go('done')
    } catch (e) {
      const errs = Object.fromEntries((e.detail?.errors || []).map(x => [x.item, x.message]))
      if (!Object.keys(errs).length) errs.DEC1 = e.message
      setErrors(errs)
      const first = Object.keys(errs)[0]
      const sec = first === 'DEC1' ? 'DEC' : first[0] === 'G' ? 'G' : first[0]
      go(order.includes(sec) ? sec : 'DEC')
      setTimeout(() => document.getElementById('q-' + first)?.scrollIntoView({ block: 'center' }), 50)
    } finally {
      setSaving(false)
    }
  }

  const rail = (
    <nav id="survey-menu" className={'rail' + (menuOpen ? ' open' : '')} aria-label="Survey modules">
      <div className="rail-head">
        <p className="rail-t">{role.name}<br /><span>Organization {me.org_code} · Respondent {me.respondent_code}</span></p>
        <button type="button" className="rail-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p className={'status-pill ' + (isSubmitted ? 'submitted' : 'draft')}>{isSubmitted ? 'Submitted · locked' : 'Draft · editable'}</p>
      <div className="rail-scroll">
        {order.map(m => {
          const [d, t] = m === 'DEC' ? [ans.DEC1 ? 1 : 0, 1] : progress(m)
          return (<button key={m} className={step === m ? 'on' : ''} aria-current={step === m ? 'step' : undefined} onClick={() => go(m)}>
            <b>{m === 'DEC' ? '✓' : m}</b><span>{m === 'DEC' ? 'Declaration and submit' : secs[m].title}</span><em>{d}/{t}</em></button>)
        })}
        {isSubmitted && <button className={step === 'done' ? 'on' : ''} onClick={() => go('done')}><b>★</b><span>Your results profile</span></button>}
      </div>
      <div className="rail-f">
        {!isSubmitted && <button type="button" className="rail-save" disabled={saving} onClick={() => saveDraft()}>
          <b>⬇</b><span>{saving ? 'Saving…' : 'Save draft'}</span>
        </button>}
        <button type="button" onClick={() => { setMenuOpen(false); setGlossOpen(true) }}><b>?</b><span>Glossary</span></button>
        <button type="button" onClick={() => onLogout?.()}><b>×</b><span>Log out</span></button>
        <p className="save" aria-live="polite">{isSubmitted ? 'Submitted — no further edits' : (saveState || 'Draft ready to edit')}</p>
        <p className="resume">Resume code: <code>{sess.code}</code></p>
      </div>
    </nav>
  )

  return (<GlossaryCtx.Provider value={{ ...gl, seen: new Set() }}>
    <div className={'body' + (menuOpen ? ' menu-open' : '')}>
      <div className="mobile-bar">
        <button type="button" className={'menu-btn' + (menuOpen ? ' open' : '')} aria-expanded={menuOpen} aria-controls="survey-menu" onClick={() => setMenuOpen(o => !o)}>
          <span className="menu-icon" aria-hidden="true"><i /><i /><i /></span>
          <span className="sr">{menuOpen ? 'Close menu' : 'Open menu'}</span>
        </button>
        <div className="mobile-bar-meta">
          <strong>{stepCode}</strong>
          <span>{stepLabel}</span>
        </div>
        {!isSubmitted && <button type="button" className="ghost sm mobile-save" disabled={saving} onClick={() => saveDraft()}>{saving ? '…' : 'Save'}</button>}
        <button type="button" className="ghost sm mobile-gloss" onClick={() => setGlossOpen(true)} aria-label="Glossary">?</button>
      </div>
      {menuOpen && <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
      {rail}
      <main>
        {!isSubmitted && <p className="draft-banner">Working draft — save anytime to continue later with your resume code. Final submit locks the response permanently.</p>}
        {secs[step] && <Section s={secs[step]} items={itemsOf(step)} ans={ans} setA={setA} inst={inst} errors={errors}
          locked={isSubmitted} fCount={fCount} setFCount={setFCount} fTab={fTab} setFTab={setFTab} />}
        {step === 'DEC' && <Declaration inst={inst} ans={ans} setA={setA} errors={errors} onSubmit={submit} onSaveDraft={() => saveDraft()} saving={saving} locked={isSubmitted} />}
        {step === 'done' && <Results code={sess.code} inst={inst} />}
        {step !== 'done' && <div className="nav">
          <button className="ghost" disabled={idx <= 0} onClick={() => go(order[idx - 1])}>Back</button>
          <div className="nav-actions">
            {!isSubmitted && <button type="button" className="ghost" disabled={saving} onClick={() => saveDraft()}>{saving ? 'Saving…' : 'Save draft'}</button>}
            {step !== 'DEC' && <button className="primary" onClick={() => go(order[idx + 1])}>Continue</button>}
          </div>
        </div>}
      </main>
    </div>
    {glossOpen && <GlossaryPanel glossary={inst.glossary} onClose={() => setGlossOpen(false)} />}
  </GlossaryCtx.Provider>)
}

function Section({ s, items, ans, setA, inst, errors, locked, fCount, setFCount, fTab, setFTab }) {
  const rep = s.repeatable === 'initiative'
  const n = rep ? fTab : 1
  const byId = Object.fromEntries(items.map(q => [q.id, q]))
  const groups = s.groups ? s.groups.map(g => ({ ...g, items: g.items.filter(i => byId[i]) })).filter(g => g.items.length)
    : [{ items: items.map(q => q.id) }]
  const render = id => {
    const q = byId[id]
    if (!visible(q, ans)) return null
    if (id === 'A1' || id === 'A2') return (<div key={id} className="q fixed"><span className="id">{id}</span>{q.text}: <b>{id === 'A1' ? ans.A1 : inst.roles[String(ans.A2)].name}</b></div>)
    const k = keyFor(id, n)
    return <Field key={k} q={q} value={ans[k]} onChange={v => setA(k, v)} scales={inst.scales} error={errors[id]} />
  }
  const hasScale = items.some(q => q.type === 'scale')
  return (<section aria-labelledby="sec-h">
    <p className="kicker">Section {s.id}{s.conditional ? ' · Conditional' : ''}</p>
    <h2 id="sec-h">{s.title}</h2>
    {s.intro && <p className="note"><Rich text={s.intro} /></p>}
    {locked && <p className="banner">This response has been submitted and can no longer be changed.</p>}
    {s.show_evidence_scale && <EvidenceTable inst={inst} />}
    {hasScale && <div className="legend" aria-label="Practice maturity scale">
      {inst.scales.scale.map(([c, l]) => <span key={c}><b>{c}</b> {l}</span>)}</div>}
    {rep && <div className="tabs" role="tablist" aria-label="Initiative records">
      {Array.from({ length: fCount }, (_, i) => i + 1).map(i => (<button key={i} role="tab" aria-selected={fTab === i} className={fTab === i ? 'on' : ''} onClick={() => setFTab(i)}>
        Initiative {i}{ans[keyFor('F1', i)] && typeof ans[keyFor('F1', i)] === 'string' ? ` · ${ans[keyFor('F1', i)].slice(0, 18)}` : ''}</button>))}
      {fCount < 10 && !locked && <button className="add" onClick={() => { setFCount(fCount + 1); setFTab(fCount + 1) }}>+ Add initiative</button>}
    </div>}
    <fieldset className="lock" disabled={locked}>
      {groups.map((g, i) => (<div key={i} className="grp">
        {g.title && <h3>{g.title}</h3>}
        {g.note && <p className="note"><Rich text={g.note} /></p>}
        {g.items.map(render)}
      </div>))}
    </fieldset>
  </section>)
}

function EvidenceTable({ inst }) {
  return (<details className="evid"><summary>A.3 Evidence Strength Classification (E0–E5)</summary>
    <table><thead><tr><th>Level</th><th>Evidence type</th><th>Interpretation</th></tr></thead>
      <tbody>{inst.evidence_levels.map(([l, t, d]) => <tr key={l}><th scope="row">{l}</th><td>{t}</td><td>{d}</td></tr>)}</tbody></table>
    <p className="muted">Evidence levels describe the strength of support for a claim, not performance, and are never used as numerical weights.</p>
  </details>)
}

function Declaration({ inst, ans, setA, errors, onSubmit, onSaveDraft, saving, locked }) {
  return (<section aria-labelledby="dec-h">
    <p className="kicker">Final step</p>
    <h2 id="dec-h">Respondent Declaration</h2>
    {!locked && <p className="note">You can <b>Save draft</b> and come back later to edit. <b>Submit</b> is final: after that, answers cannot be updated.</p>}
    <fieldset className="lock" disabled={locked}>
      {inst.declaration.filter(q => q.id !== 'DEC4').map(q => <Field key={q.id} q={q} value={ans[q.id]} onChange={v => setA(q.id, v)} scales={inst.scales} error={errors[q.id]} />)}
      {ans.DEC3 === 1 && <label className="contact">Contact detail for clarification (stored separately from your answers)
        <input value={ans._contact || ''} onChange={e => setA('_contact', e.target.value)} placeholder="Email or phone" /></label>}
      <p className="muted">Completion date is recorded automatically on submission.</p>
    </fieldset>
    {Object.entries(errors).filter(([k]) => !k.startsWith('DEC')).map(([k, m]) => <p key={k} className="errmsg" role="alert">{k}: {m}</p>)}
    <div className="principle"><h3>Analytical Interpretation Principle</h3>
      <p>Implementation/ capability, evidence maturity, external-impact performance, and impact-claim confidence are treated as distinct constructs. Missing advanced evidence does not automatically reduce an organization’s innovation implementation or capability score. Internal efficiency gains are not used as a substitute for external impact where the program is intended to create value beyond the organization. The strength of any outcome or impact claim is constrained by the evidence level and evaluation design actually available.</p></div>
    {!locked && <div className="dec-actions">
      <button type="button" className="ghost" disabled={saving} onClick={onSaveDraft}>{saving ? 'Saving…' : 'Save draft (keep editing later)'}</button>
      <button type="button" className="primary" disabled={saving} onClick={onSubmit}>Submit final response</button>
    </div>}
    {locked && <p className="banner">This response has been submitted and can no longer be changed.</p>}
  </section>)
}

function Welcome({ inst, config, onReady }) {
  const [mode, setMode] = useState('new')
  const [f, setF] = useState({ org: '', role: '', consent: false, code: '' })
  const [err, setErr] = useState('')
  const [issued, setIssued] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = p => setF(x => ({ ...x, ...p }))

  async function start(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    try { const r = await api.start({ org_code: f.org.trim(), role: +f.role, consent: f.consent }); setIssued(r) }
    catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  async function resume(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await api.me(f.code.trim()); onReady({ code: f.code.trim().toUpperCase() }) }
    catch (x) { setErr(x.message) } finally { setBusy(false) }
  }

  if (issued) return (<main className="solo"><section className="hero">
    <h1>Keep your resume code</h1>
    <p className="lead">Your response starts as an editable draft. Save anytime, then resume from any device with this code. Final submission locks answers permanently.</p>
    <p className="code-big" aria-label="Resume code">{issued.resume_code}</p>
    <button className="ghost" onClick={() => navigator.clipboard?.writeText(issued.resume_code)}>Copy code</button>
    <p className="note">Your respondent code is {issued.respondent_code}. It links your answers to your organization without your name.</p>
    <button className="primary" onClick={() => onReady({ code: issued.resume_code })}>I have noted it — begin</button>
  </section></main>)

  const roleRows = Object.entries(inst.roles).filter(([c]) => c !== '8')
  return (<main className="solo"><section className="hero">
    <p className="kicker">Institutional Innovation / Research Instrument</p>
    <h1>Innovation Implementation Impact Survey</h1>
    <p className="lead">GInI-aligned innovation management, outcomes and evidence.</p>
    <div className="cols">
      <div><h3>Purpose</h3><p>To determine:</p><ul>
        <li>how completely GInI-aligned innovation management has been implemented;</li>
        <li>the extent to which implementation has changed innovation capability and program performance;</li>
        <li>what internal organizational outcomes and, critically, what external stakeholder, societal, market, ecosystem, environmental, and public-value outcomes have followed; and</li>
        <li>how credible the estimated contribution of implementation is.</li></ul></div>
      <div><h3>How to use this survey</h3>
        <p><b>Answer only the modules assigned to your role. Do not infer or guess.</b> “Don’t Know”, “Not Available”, and “Not Applicable” are valid responses where offered.</p>
        <p>Provide the best available evidence. Do not create, estimate, or reconstruct data solely to complete this survey. Formal research studies, baseline data, and comparison groups are not prerequisites for participation.</p></div>
    </div>
    <p className="note disclaimer">{inst.disclaimer}</p>
    <details className="evid"><summary>Role routing</summary><table><thead><tr><th>Role</th><th>Assigned modules</th></tr></thead>
      <tbody>{roleRows.map(([c, r]) => <tr key={c}><td>{r.name}</td><td>{r.modules.map(m => r.only?.[m] ? `${m} (${r.only[m][0]}–${r.only[m].at(-1)})` : m).join(', ')}</td></tr>)}</tbody></table></details>

    <div className="tabs" role="tablist">
      <button role="tab" aria-selected={mode === 'new'} className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')}>Start a new response</button>
      <button role="tab" aria-selected={mode === 'resume'} className={mode === 'resume' ? 'on' : ''} onClick={() => setMode('resume')}>Resume draft</button>
    </div>
    {mode === 'new' ? (<form onSubmit={start} className="card">
      <label>A1 · Organization code supplied by the study administrator
        <input required value={f.org} onChange={e => set({ org: e.target.value })} placeholder="e.g. ICESCO-01" autoComplete="off" /></label>
      <label>A2 · Your primary role, as listed in Role Routing
        <select required value={f.role} onChange={e => set({ role: e.target.value })}><option value="">Choose a role</option>
          {Object.entries(inst.roles).map(([c, r]) => <option key={c} value={c}>{r.name}</option>)}</select></label>
      <details className="notice" open><summary>Privacy notice and participation</summary>
        <div className="md">{(config.privacy_notice || 'The study administrator has not yet published a privacy notice.').split('\n').map((l, i) => <p key={i}>{l.replace(/^#+\s*|\*\*/g, '')}</p>)}</div></details>
      <label className="chk"><input type="checkbox" checked={f.consent} onChange={e => set({ consent: e.target.checked })} required />
        I have read the privacy notice. I take part voluntarily and agree to my answers being processed for this study.</label>
      {err && <p className="errmsg" role="alert">{err}</p>}
      <button className="primary" disabled={busy || !f.consent || !f.org.trim() || !f.role}>Start survey</button>
    </form>) : (<form onSubmit={resume} className="card">
      <p className="note">Open a saved draft to keep editing. Submitted responses open in read-only mode and cannot be updated.</p>
      <label>Resume code<input required value={f.code} onChange={e => set({ code: e.target.value })} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" /></label>
      {err && <p className="errmsg" role="alert">{err}</p>}
      <button className="primary" disabled={busy}>Open draft / response</button>
    </form>)}
  </section></main>)
}
