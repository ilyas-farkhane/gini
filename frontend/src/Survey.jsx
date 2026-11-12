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

export default function Survey({ inst, config, sess, onReady, onLogout, foot }) {
  const [me, setMe] = useState(null)
  const [ans, setAns] = useState({})
  const [step, setStep] = useState('welcome')
  const [saveState, setSaveState] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [glossOpen, setGlossOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [fCount, setFCount] = useState(1)
  const [fTab, setFTab] = useState(1)
  const gl = useGlossary(inst.glossary)
  const dirty = useRef(false)
  const ansRef = useRef(ans)
  const paneRef = useRef(null)
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
    let nextVal = v
    if (/^I\d+$/.test(k) && nextVal && typeof nextVal === 'object' && nextVal.top3) {
      const others = Object.entries(ansRef.current)
        .filter(([key, val]) => key !== k && /^I\d+$/.test(key) && val && typeof val === 'object' && val.top3).length
      if (others >= 3) {
        nextVal = { ...nextVal, top3: false }
        setErrors(prev => ({
          ...prev,
          [k]: 'You already marked 3 barriers as Top 3. Uncheck one of them first, then you can select this one.',
        }))
        dirty.current = true
        setSaveState('Unsaved changes')
        setAns(p => ({ ...p, [k]: nextVal }))
        return
      }
    }
    dirty.current = true
    setSaveState('Unsaved changes')
    setAns(p => { const n = { ...p }; if (nextVal === undefined) delete n[k]; else n[k] = nextVal; return n })
    setErrors(prev => {
      if (!Object.keys(prev).length) return prev
      const next = { ...prev }
      delete next[k]
      if (/^I\d+/.test(k)) delete next.I1
      return next
    })
  }
  const go = s => {
    setStep(s)
    store.set(STEP_KEY, s)
    setMenuOpen(false)
    requestAnimationFrame(() => {
      if (paneRef.current) paneRef.current.scrollTop = 0
      else window.scrollTo(0, 0)
    })
  }

  useEffect(() => {
    if (!menuOpen) return
    const onKey = e => { if (e.key === 'Escape') setMenuOpen(false) }
    addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [menuOpen])

  useEffect(() => {
    if (!confirmOpen) return
    const onKey = e => { if (e.key === 'Escape') setConfirmOpen(false) }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [confirmOpen])

  if (!sess || !me) return (
    <div className="content-pane">
      <Welcome inst={inst} config={config} onReady={onReady} />
      {foot}
    </div>
  )

  const order = [...mods, 'DEC']
  const idx = order.indexOf(step)
  const progress = sid => {
    const its = itemsOf(sid).filter(q => visible(q, ans) && !['A1', 'A2'].includes(q.id))
    return [its.filter(q => answered(q, ans[q.id])).length, its.length]
  }
  const stepLabel = step === 'DEC' ? 'Declaration and submit' : step === 'done' ? 'Your results profile' : (secs[step]?.title || 'Survey')
  const stepCode = step === 'DEC' ? '✓' : step === 'done' ? '★' : step

  function requestSubmit() {
    if (isSubmitted) return
    setErrors({})
    const local = {}
    if (ans.DEC1 !== true) local.DEC1 = 'Please confirm the respondent declaration.'
    if (Object.keys(local).length) { setErrors(local); return }
    setConfirmOpen(true)
  }

  async function confirmSubmit() {
    if (isSubmitted) return
    setConfirmOpen(false)
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
        <div className="rail-identity">
          <p className="rail-role">{role.name}</p>
          <p className="rail-meta">
            <span>{me.org_code}</span>
            <span aria-hidden="true">·</span>
            <span>{me.respondent_code}</span>
          </p>
          <span className={'status-pill ' + (isSubmitted ? 'submitted' : 'draft')}>
            {isSubmitted ? 'Submitted · locked' : 'Draft · editable'}
          </span>
        </div>
        <button type="button" className="rail-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="rail-scroll">
        {order.map(m => {
          const [d, t] = m === 'DEC' ? [ans.DEC1 ? 1 : 0, 1] : progress(m)
          return (
            <button
              key={m}
              type="button"
              className={'rail-step' + (step === m ? ' on' : '')}
              aria-current={step === m ? 'step' : undefined}
              onClick={() => go(m)}
            >
              <b>{m === 'DEC' ? '✓' : m}</b>
              <span>{m === 'DEC' ? 'Declaration and submit' : secs[m].title}</span>
              <em>{d}/{t}</em>
            </button>
          )
        })}
        {isSubmitted && (
          <button type="button" className={'rail-step' + (step === 'done' ? ' on' : '')} onClick={() => go('done')}>
            <b>★</b><span>Your results profile</span>
          </button>
        )}
      </div>

      <div className="rail-f">
        {!isSubmitted && (
          <button type="button" className="rail-save" disabled={saving} onClick={() => saveDraft()}>
            {saving ? 'Saving…' : 'Save draft'}
          </button>
        )}
        <button type="button" className="rail-gloss" onClick={() => { setMenuOpen(false); setGlossOpen(true) }}>
          Glossary
        </button>
        <p className="rail-save-state" aria-live="polite">
          {isSubmitted ? 'Submitted — no further edits' : (saveState || 'Draft ready to edit')}
        </p>
        <p className="rail-resume">Resume code: <code>{sess.code}</code></p>
        <button type="button" className="rail-logout" onClick={() => onLogout?.()}>
          End session
        </button>
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
      <div className="content-pane" ref={paneRef}>
        <main>
          {!isSubmitted && <p className="draft-banner">Working draft — save anytime to continue later with your resume code. Final submit locks the response permanently.</p>}
          {secs[step] && <Section s={secs[step]} items={itemsOf(step)} ans={ans} setA={setA} inst={inst} errors={errors}
            locked={isSubmitted} fCount={fCount} setFCount={setFCount} fTab={fTab} setFTab={setFTab} />}
          {step === 'DEC' && <Declaration inst={inst} ans={ans} setA={setA} errors={errors} onSubmit={requestSubmit} onSaveDraft={() => saveDraft()} saving={saving} locked={isSubmitted} />}
          {step === 'done' && <Results code={sess.code} inst={inst} />}
          {step !== 'done' && <div className="nav">
            <button className="ghost" disabled={idx <= 0} onClick={() => go(order[idx - 1])}>Back</button>
            <div className="nav-actions">
              {!isSubmitted && <button type="button" className="ghost" disabled={saving} onClick={() => saveDraft()}>{saving ? 'Saving…' : 'Save draft'}</button>}
              {step !== 'DEC' && <button className="primary" onClick={() => go(order[idx + 1])}>Continue</button>}
            </div>
          </div>}
        </main>
        {foot}
      </div>
    </div>
    {glossOpen && <GlossaryPanel glossary={inst.glossary} onClose={() => setGlossOpen(false)} />}
    {confirmOpen && (
      <div className="modal-backdrop" role="presentation" onClick={() => !saving && setConfirmOpen(false)}>
        <div
          className="modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="submit-title"
          aria-describedby="submit-desc"
          onClick={e => e.stopPropagation()}
        >
          <p className="kicker">Final submission</p>
          <h2 id="submit-title">Submit this response as final?</h2>
          <p id="submit-desc" className="note">
            After submission you will not be able to edit your answers. Use <b>Save draft</b> if you still need to make changes.
          </p>
          <div className="modal-actions">
            <button type="button" className="ghost" disabled={saving} onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button type="button" className="primary" disabled={saving} onClick={confirmSubmit}>
              {saving ? 'Submitting…' : 'Submit final response'}
            </button>
          </div>
        </div>
      </div>
    )}
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
    if (id === 'A1' || id === 'A2') return (<div key={id} className="q fixed"><span className="id">{id}</span><span className="qt">{q.text}: <b>{id === 'A1' ? ans.A1 : inst.roles[String(ans.A2)].name}</b></span></div>)
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
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef(null)
  const set = p => setF(x => ({ ...x, ...p }))

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  async function start(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    try { const r = await api.start({ org_code: f.org.trim(), role: +f.role, consent: f.consent }); setIssued(r); setCopied(false) }
    catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  async function resume(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await api.me(f.code.trim()); onReady({ code: f.code.trim().toUpperCase() }) }
    catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(issued.resume_code) } catch { /* ignore */ }
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1800)
  }

  if (issued) return (<main className="solo home"><section className="home-panel">
    <h1>Keep your resume code</h1>
    <p className="lead">Your response starts as an editable draft. Save anytime, then resume from any device with this code. Final submission locks answers permanently.</p>
    <div className={'code-row' + (copied ? ' copied' : '')}>
      <p className="code-big" aria-label="Resume code">{issued.resume_code}</p>
      <button type="button" className={'copy-btn' + (copied ? ' ok' : '')} onClick={copyCode} aria-live="polite">
        <span className="copy-label">{copied ? 'Copied' : 'Copy code'}</span>
      </button>
    </div>
    <p className="note">Your respondent code is {issued.respondent_code}. It links your answers to your organization without your name.</p>
    <button className="primary" onClick={() => onReady({ code: issued.resume_code })}>I have noted it — begin</button>
  </section></main>)

  const cycle = [
    'Complete the survey →',
    'Review and validate findings →',
    'Prioritize improvements →',
    'Assign actions and accountability →',
    'Implement and monitor →',
    'Reassess and learn.',
  ]
  const roleModules = {
    1: 'A, B, H, I, K',
    2: 'A–D, F, I, K',
    3: 'A, E, F, I, K',
    4: 'A, G, H, J',
    5: 'A, G, H, J, and conditional L',
    6: 'A and K',
    7: 'A, selected F, I, and K5–K6',
    8: 'A and I',
  }
  const roleRouting = Object.entries(inst.roles).map(([code, r]) => [
    r.name,
    roleModules[code] || r.modules.join(', '),
  ])

  return (<main className="home">
    <section className="home-cover" aria-label="Survey cover">
      <div className="home-cover-copy">
        <div className="diamonds" aria-hidden="true"><i /><i /><i className="gold" /><i /></div>
        <p className="home-kicker">Institutional Innovation / Research Instrument</p>
        <p className="home-sub">Innovation Implementation</p>
        <h1 className="home-title">Impact Survey</h1>
        <p className="home-lead">GInI-aligned innovation management, outcomes, and evidence</p>
      </div>
    </section>

    <header className="home-head">
      <h2 className="home-doc-title">GInI Innovation Implementation Impact Survey</h2>
      <div className="home-gold-rule" aria-hidden="true" />
    </header>

    <div className="home-grid">
      <section className="home-block">
        <h3 className="home-h">Purpose</h3>
        <p>To determine:</p>
        <ul className="home-diamonds">
          <li>How completely GInI-aligned innovation management has been implemented.</li>
          <li>The extent to which implementation has changed innovation capability and program performance.</li>
          <li>What internal organizational outcomes and, critically, what external stakeholder, societal, market, ecosystem, environmental, and public-value outcomes have followed.</li>
          <li>How credible the estimated contribution of implementation is.</li>
        </ul>
        <aside className="home-callout">
          Aligned for research use with GInI innovation-management concepts and ISO/UNDP PAS 53002:2024 guidance. This is not an official GInI assessment, certification instrument, ISO conformity assessment, or substitute for independent assurance.
        </aside>
      </section>

      <section className="home-block">
        <h3 className="home-h dark">Organizational Value and Use of Survey Results</h3>
        <p>Organizations can use this survey to understand the maturity of their GInI-aligned innovation practices, examine observed results and the evidence supporting them, and identify practical priorities for improvement. The value of participation lies in structured reflection and evidence-informed decision-making; it does not depend on having advanced impact-evaluation capabilities.</p>
      </section>

      <section className="home-block">
        <h3 className="home-h">Why Participate</h3>
        <p>Participation enables organizations to assess how innovation management is embedded in everyday decisions, identify strengths and implementation gaps, recognize internal and external value generated, and prioritize improvements. Organizations at different stages of evidence maturity can participate using their best available records, stakeholder feedback, and informed observations; formal impact studies are not required.</p>
      </section>

      <section className="home-block">
        <h3 className="home-h">What Organizations Can Learn</h3>
        <p>Completing this survey provides an opportunity to examine how GInI-aligned innovation management is being implemented, what results are being observed, and where improvement is needed. It helps organizations distinguish innovation practices and capability from the strength of the evidence available to demonstrate outcomes. The survey is intended to support organizational learning and improvement, not certification or a ranking of participating organizations.</p>
      </section>

      <section className="home-block">
        <h3 className="home-h">Expected Outputs and Takeaways</h3>
        <p>The analysis can identify strengths and gaps in implementation, innovation practices, execution, future-shaping capability, and sustainability integration; distinguish internal organizational outcomes from external stakeholder, societal, environmental, and public-value outcomes; identify barriers, evidence limitations, and areas requiring stronger performance measurement; and indicate which outcome or contribution claims are supported by available evidence. Findings depend on the completeness and quality of the responses and evidence provided.</p>
      </section>

      <section className="home-block">
        <h3 className="home-h">How to Act on the Findings</h3>
        <p>Subject to the commissioning study’s agreed reporting and confidentiality arrangements, results may be used to develop an organizational diagnostic profile, an outcome-and-evidence summary, an evidence-readiness profile, and a prioritized improvement agenda. These are potential uses of the analysis, not a promise that every respondent will receive an individual report, benchmark, formal impact estimate, or certification decision. The study administrator should confirm which organizational feedback outputs will be provided before inviting participation.</p>
      </section>

      <section className="home-block home-span">
        <h3 className="home-h">Suggested Improvement Cycle</h3>
        <ol className="home-cycle">
          {cycle.map((step, i) => (
            <li key={step} className="home-cycle-step">
              <span className="home-cycle-n">{i + 1}</span>
              <span className="home-cycle-t">{step}</span>
            </li>
          ))}
        </ol>
        <p>Organizations should review results with the relevant innovation, strategy, sustainability, and performance owners; validate material findings against available records and stakeholder perspectives; select a small number of priority improvement actions; assign an accountable owner, resources, milestones, and indicators for each action; integrate agreed actions into innovation governance and portfolio reviews; and reassess progress at an appropriate interval. Where evidence is limited, the next action may be to establish proportionate indicators or follow-up arrangements rather than to commission a formal impact study.</p>
      </section>

      <section className="home-block home-span home-block-accent">
        <div className="home-gold-rule short" aria-hidden="true" />
        <h2 className="home-h large">How to Use This Survey</h2>
        <p className="home-important"><b>Important. Answer only the modules assigned to your role. Do not infer or guess. “Don’t Know”, “Not Available”, and “Not Applicable” are valid responses where offered.</b></p>
        <p>Scoring and weighting: Applicable 0–4 responses contribute equally within their assigned domain; indices that average domain means give equal weight to domains, not necessarily to individual questions. Outcome indicators are reported separately and are not automatically weighted or combined.</p>
      </section>

      <section className="home-block">
        <h3 className="home-h dark">Evidence Expectations</h3>
        <p>This survey is designed for organizations at different levels of measurement and evaluation maturity. Formal research studies, statistical analysis, baseline data, comparison groups, and dedicated research specialists are not prerequisites for participation.</p>
        <p>Respondents should provide the best available evidence within their organization. Evidence may include quantitative data, operational records, documented qualitative evidence, stakeholder feedback, evaluations, case evidence, or informed observations, depending on what is available.</p>
        <p>Do not create, estimate, or reconstruct data solely to complete this survey. Where requested information is unavailable, select “Not Available”, “Don’t Know”, or “Not Applicable”, as appropriate. Absence of advanced evaluation evidence does not by itself indicate weak innovation implementation. It indicates the organization’s current evidence and evaluation maturity and is treated separately from innovation capability and implementation performance. Advanced evaluation requirements apply only where the organization has the necessary data, evaluation design, and analytical capability.</p>
      </section>

      <section className="home-block">
        <h3 className="home-h dark">External Impact Requirement</h3>
        <p>The survey distinguishes internal organizational improvement from external value and impact. At organization/program level, respondents must report at least one externally oriented outcome supported by the best available evidence, where the assessed innovation program is intended to create external value. If no external outcome is applicable to the assessed scope, respondents must state why. Internal efficiency or capability improvement alone should not be treated as sufficient evidence of continuing external relevance.</p>
        <p><b>Terminology support:</b> Key research and implementation terms used in this survey are defined in Appendix A — Plain-Language Terminology Glossary. Short explanations are also provided at first use where a term may be unfamiliar to an everyday business reader.</p>
      </section>

      <section className="home-block home-span">
        <h3 className="home-h dark">Role Routing</h3>
        <div className="home-table-wrap">
          <table className="home-table">
            <thead><tr><th scope="col">Role</th><th scope="col">Assigned Modules</th></tr></thead>
            <tbody>{roleRouting.map(([role, mods]) => <tr key={role}><td>{role}</td><td>{mods}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="home-block home-span home-block-accent">
        <div className="home-gold-rule short" aria-hidden="true" />
        <h2 className="home-h large">Participation and Data Protection</h2>
        <p>Participation should be voluntary. Responses should be linked through an organization code rather than a person’s name. The commissioning organization must provide a separate privacy notice describing the data controller, lawful basis, retention period, access controls, contact route, and withdrawal process before deployment.</p>
      </section>
    </div>

    <section className="home-start" id="start-survey" aria-labelledby="start-h">
      <h2 id="start-h" className="home-h large">Begin Participation</h2>
      <p className="home-start-note">Use your organization code from the study administrator to start, or open an existing draft with your resume code.</p>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'new'} className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')}>Start a new response</button>
        <button type="button" role="tab" aria-selected={mode === 'resume'} className={mode === 'resume' ? 'on' : ''} onClick={() => setMode('resume')}>Resume draft</button>
      </div>
      {mode === 'new' ? (<form onSubmit={start} className="card home-form">
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
      </form>) : (<form onSubmit={resume} className="card home-form">
        <p className="note">Open a saved draft to keep editing. Submitted responses open in read-only mode and cannot be updated.</p>
        <label>Resume code<input required value={f.code} onChange={e => set({ code: e.target.value })} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" /></label>
        {err && <p className="errmsg" role="alert">{err}</p>}
        <button className="primary" disabled={busy}>Open draft / response</button>
      </form>)}
    </section>
  </main>)
}
