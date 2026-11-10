// Field renderers for every response type in the instrument. Values are stored as codes;
// DK / NA / Not Available stay distinct values and are never forced (Guide §17).
import { useId } from 'react'
import { Rich } from './Glossary.jsx'

const empty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
const isMissing = v => v && typeof v === 'object' && !Array.isArray(v) && 'm' in v

export function answered(q, v) {
  if (empty(v)) return false
  if (q.type === 'group') return Object.values(v || {}).some(x => !empty(x) && x !== false)
  if (q.type === 'repeat') return (v || []).some(r => r && Object.values(r).some(x => !empty(x)))
  if (q.type === 'daterange') return !!(v.from || v.to)
  if (q.type === 'single_text') return !empty(v.code)
  return true
}

function ClearBtn({ show, onClear }) {
  return (
    <button
      type="button"
      className="clear"
      hidden={!show}
      tabIndex={show ? 0 : -1}
      onClick={onClear}
    >
      Clear
    </button>
  )
}

function Choice({ name, options, value, onChange, compact, label }) {
  const id = useId()
  const signed = options.some(([c]) => typeof c === 'number' && c < 0)
  return (<div className={'choice' + (compact ? ' compact' : '')} role="radiogroup" aria-label={label}>
    {options.map(([code, text]) => {
      const special = typeof code === 'string' && !/^E\d$/.test(code)
      const short = special ? code : typeof code === 'number' && signed ? (code > 0 ? '+' + code : String(code).replace('-', '−')) : code
      return (<label key={code} className={(value === code ? 'sel ' : '') + (special ? 'alt' : '')} title={compact ? text : undefined}>
        <input type="radio" className="sr" name={name + id} checked={value === code} onChange={() => onChange(code)}
          aria-label={compact ? text : undefined} />
        <span aria-hidden={compact || undefined}>{compact ? short : text}</span>
      </label>)
    })}
    <ClearBtn show={!empty(value)} onClear={() => onChange(undefined)} />
  </div>)
}

function Multi({ options, value = [], onChange, label }) {
  const toggle = c => onChange(value.includes(c) ? value.filter(x => x !== c) : [...value, c])
  return (<div className="choice" role="group" aria-label={label}>
    {options.map(([c, t]) => (<label key={c} className={value.includes(c) ? 'sel' : ''}>
      <input type="checkbox" className="sr" checked={value.includes(c)} onChange={() => toggle(c)} /><span>{t}</span></label>))}
    <ClearBtn show={value.length > 0} onClear={() => onChange([])} />
  </div>)
}

/** Prefer a multi-line textarea for descriptions / explanations / long free text. */
export function isLongText(type, label = '', key = '') {
  if (type === 'textarea') return true
  if (type && type !== 'text') return false
  return /explain|description|rationale|mechanism|limits|outcome statement|evidence\/ explanation/i.test(`${key} ${label}`)
}

function TextWithMissing({ value, onChange, long, missing = [], label }) {
  const m = isMissing(value) ? value.m : null
  const has = !empty(value) || !!m
  const Tag = long ? 'textarea' : 'input'
  return (<div className="txt">
    <Tag aria-label={label} value={m ? '' : (value || '')} disabled={!!m} rows={long ? 4 : undefined}
      onChange={e => onChange(e.target.value)} placeholder={m || !long ? '' : 'Write freely; use evidence identifiers and avoid personal or confidential details'} />
    <div className="miss" role="group" aria-label={missing.length ? 'Or record that the answer is missing' : undefined}>
      {missing.map(([c, t]) => (<label key={c} className={m === c ? 'sel' : ''}>
        <input type="checkbox" className="sr" checked={m === c} onChange={() => onChange(m === c ? '' : { m: c })} />{t}</label>))}
      <ClearBtn show={has} onClear={() => onChange('')} />
    </div>
  </div>)
}

function SelectField({ label, options, value, onChange }) {
  return (
    <div className="select-row">
      <select aria-label={label} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : +e.target.value)}>
        <option value="">Select</option>
        {options.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
      </select>
      <ClearBtn show={!empty(value)} onClear={() => onChange(undefined)} />
    </div>
  )
}

function Sub({ f, value, onChange, scales }) {
  const t = f.type
  if (['change', 'context', 'rating04', 'level'].includes(t))
    return <Choice name={f.key} options={scales[t]} value={value} onChange={onChange} compact label={f.label} />
  if (t === 'single') return f.options.length > 6
    ? <SelectField label={f.label} options={f.options} value={value} onChange={onChange} />
    : <Choice name={f.key} options={f.options} value={value} onChange={onChange} label={f.label} />
  if (t === 'check') return <label className="chk"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} /> {f.label}</label>
  return <TextWithMissing value={value} onChange={onChange} long={isLongText(t, f.label, f.key)} missing={f.missing} label={f.label} />
}

function Group({ q, value = {}, onChange, scales }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  return (<div className="group">{q.fields.map(f => (<div key={f.key} className={'gf gf-' + f.type}>
    {f.type !== 'check' && <span className="gl">{f.label}</span>}
    <Sub f={f} value={value[f.key]} onChange={v => set(f.key, v)} scales={scales} />
  </div>))}</div>)
}

function Repeat({ q, value, onChange, scales }) {
  const rows = value && value.length ? value : Array.from({ length: q.min_rows || 1 }, () => ({}))
  const setRow = (i, r) => onChange(rows.map((x, j) => (j === i ? r : x)))
  return (<div className="repeat">
    {rows.map((r, i) => (<div key={i} className="rrow">
      <div className="rrow-h"><b>{i + 1}.</b>{rows.length > (q.min_rows || 0) && <button type="button" className="clear" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove row</button>}</div>
      <Group q={q} value={r || {}} onChange={v => setRow(i, v)} scales={scales} />
    </div>))}
    <button type="button" className="ghost sm" onClick={() => onChange([...rows, {}])}>+ Add row</button>
  </div>)
}

export function Field({ q, value, onChange, scales, error }) {
  const done = answered(q, value)
  const label = q.text
  let control
  switch (q.type) {
    case 'scale': control = <Choice name={q.id} options={scales.scale} value={value} onChange={onChange} compact label={label} />; break
    case 'single': control = q.options.length > 6
      ? <SelectField label={label} options={q.options} value={value} onChange={onChange} />
      : <Choice name={q.id} options={q.options} value={value} onChange={onChange} label={label} />; break
    case 'multi': control = <Multi options={q.options} value={value} onChange={onChange} label={label} />; break
    case 'single_text': control = (<div className="q-stack">
      <Choice name={q.id} options={q.options} value={value?.code} onChange={c => onChange(c === undefined ? undefined : { ...value, code: c })} label={label} />
      {q.detail_when.includes(value?.code) && <TextWithMissing long label={q.detail_label} value={value?.detail} onChange={d => onChange({ ...value, detail: d })} />}
    </div>); break
    case 'daterange': control = (<div className="dr">
      <label>From<input type="date" value={value?.from || ''} onChange={e => onChange({ ...value, from: e.target.value })} /></label>
      <label>To<input type="date" value={value?.to || ''} onChange={e => onChange({ ...value, to: e.target.value })} /></label>
      <ClearBtn show={!!(value?.from || value?.to)} onClear={() => onChange(undefined)} />
    </div>); break
    case 'date': control = (<div className="select-row">
      <input type="date" aria-label={label} value={value || ''} onChange={e => onChange(e.target.value || undefined)} />
      <ClearBtn show={!empty(value)} onClear={() => onChange(undefined)} />
    </div>); break
    case 'check': control = <label className="chk"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} /> {q.label}</label>; break
    case 'group': control = <Group q={q} value={value} onChange={onChange} scales={scales} />; break
    case 'repeat': control = <Repeat q={q} value={value} onChange={onChange} scales={scales} />; break
    default: control = <TextWithMissing value={value} onChange={onChange} long={isLongText(q.type, q.text, q.id)} missing={q.missing} label={label} />
  }
  return (
    <div id={'q-' + q.id} className={'q q-' + q.type + (done ? ' done' : '') + (error ? ' err' : '')} role="group" aria-labelledby={'ql-' + q.id}>
      <div className="q-head" id={'ql-' + q.id}>
        <span className="id">{q.id}</span>
        <span className="qt"><Rich text={q.text} /></span>
      </div>
      {q.hint && <p className="hint"><Rich text={q.hint} /></p>}
      <div className="q-body">{control}</div>
      {error && <p className="errmsg" role="alert">{error}</p>}
    </div>
  )
}
