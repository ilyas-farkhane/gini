// Scoring and aggregation — Administration and Scoring Guide §6, §7, §8, §10, §11, §12, §13.
// * DK, NA, Not Available and blanks are excluded from denominators — never scored as zero.
// * Index = domain means, then unweighted mean of domain means, × 25; suppressed below the
//   completeness threshold or when a domain has fewer than the per-domain minimum
//   (a domain answered entirely NA is not applicable and is left out).
// * No overall survey score. E0–E5 levels are categorical, never numbers.
// * Multi-respondent: item medians within role, then equal weight per role.
import { instrument, isInternal, role } from './instrument.js'

const EXTERNAL_CLASSES = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10]) // G.2 codes other than 1 = INTERNAL

export const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const mean = a => a.reduce((s, x) => s + x, 0) / a.length
const round = (x, d = 1) => Math.round((x + Number.EPSILON) * 10 ** d) / 10 ** d
export function median(a) {
  const s = [...a].sort((x, y) => x - y), n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}
// Inclusive quartiles (linear interpolation between order statistics).
function quartiles(a) {
  if (a.length < 2) return [a[0] ?? null, a[0] ?? null]
  const s = [...a].sort((x, y) => x - y)
  const q = p => { const h = (s.length - 1) * p, lo = Math.floor(h); return s[lo] + (h - lo) * ((s[lo + 1] ?? s[lo]) - s[lo]) }
  return [q(0.25), q(0.75)]
}
const isEmpty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ||
  (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)

export function band(score) {
  if (score === null) return null
  const b = instrument().bands.find(([lo, hi]) => score >= lo && score <= hi)
  return (b || instrument().bands.at(-1))[2]
}
export function confidenceBand(score) {
  const b = instrument().confidence_bands.find(([lo, hi]) => score >= lo && score <= hi)
  return (b || instrument().confidence_bands.at(-1))[2]
}

export function indexScore(key, values) {
  const d = instrument().indices[key]
  const allIds = d.domains.flatMap(x => x.items)
  const per = d.per_domain ?? 1
  const doms = d.domains.map(dom => {
    const v = dom.items.map(i => num(values[i])).filter(x => x !== null)
    const ok = v.length >= per
    return { name: dom.name, valid: v.length, total: dom.items.length,
      mean: ok ? round(mean(v), 3) : null, score: ok ? round(mean(v) * 25) : null,
      not_applicable: dom.items.every(i => values[i] === 'NA') }
  })
  const valid = doms.reduce((s, x) => s + x.valid, 0)
  const need = d.min_items ?? Math.ceil(allIds.length * d.min_pct)
  const ok = doms.filter(x => x.mean !== null).map(x => x.mean)
  const short = doms.filter(x => x.mean === null && !x.not_applicable).map(x => x.name)
  const reasons = []
  if (valid < need) reasons.push(`Only ${valid} valid items; minimum ${need}.`)
  if (short.length && doms.length > 1) reasons.push(`Fewer than ${per} valid items in: ${short.join(', ')}.`)
  const meets = !reasons.length && ok.length > 0
  const score = meets ? round(mean(ok) * 25) : null
  const out = { key, name: d.name, valid, total: allIds.length, need, missing: allIds.length - valid,
    coverage: round(valid / allIds.length, 3), score, band: band(score),
    domains: doms.length > 1 ? doms : [],
    excluded_domains: doms.length > 1 ? doms.filter(x => x.mean === null).map(x => x.name) : [],
    suppressed_reason: reasons.join(' ') || (ok.length ? null : 'No valid items.') }
  if (d.item_report) out.items = Object.fromEntries(d.item_report.map(i => [i, values[i] ?? null]))
  return out
}

const SEC_OF = { GIF: 'B', IPM: 'C', IEQ: 'D', FSC: 'K', PSI: 'E' }
export function indicesFor(values, sectionsAllowed = null) {
  return ['GIF', 'IPM', 'IEQ', 'FSC', 'PSI']
    .filter(k => !sectionsAllowed || sectionsAllowed.has(SEC_OF[k]))
    .map(k => indexScore(k, values))
}

/** {1: {F1: …}, 2: {…}} from 'F1' / 'F1#2' keys. */
export function fInstances(answers) {
  const inst = {}
  for (const [k, v] of Object.entries(answers)) {
    const m = /^(F\d+)(?:#(\d+))?$/.exec(k)
    if (!m) continue
    const n = Number(m[2] || 1)
    ;(inst[n] ||= {})[m[1]] = v
  }
  return Object.fromEntries(Object.entries(inst).sort(([a], [b]) => a - b))
}

/** Survey "External Impact Requirement" / Guide §12.1. */
export function externalCheck(resp) {
  const a = resp.answers
  const r = role(resp.role)
  const modules = new Set(r.modules)
  const applies = (modules.has('F') || modules.has('G')) && r.internal !== false
  const fi = fInstances(a)
  const extF = Object.entries(fi).filter(([, f]) => num(f.F27) !== null && f.F27 >= 3).map(([n]) => Number(n))
  const extG = (a.G2 || []).map((row, i) => [row, i]).filter(([row]) => EXTERNAL_CLASSES.has(num(row?.class))).map(([, i]) => i)
  const rationaleF = Object.values(fi).some(f => typeof f.F29 === 'string' && f.F29.trim())
  const rationaleG = typeof a.GX === 'string' && a.GX.trim() !== ''
  const satisfied = extF.length > 0 || extG.length > 0 || rationaleG || (modules.has('F') && !modules.has('G') && rationaleF)
  return { applies, satisfied: satisfied || !applies, external_initiatives: extF, external_g2_rows: extG,
    rationale_given: rationaleG || rationaleF }
}

export function respondentProfile(resp) {
  const r = role(resp.role)
  const a = resp.answers
  const vals = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, num(v)]))
  const readiness = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`A${i + 13}`, a[`A${i + 13}`] ?? null]))
  return { role: r.name, indices: indicesFor(vals, new Set(r.modules)), readiness, external: externalCheck(resp) }
}

const rubricScore = ratings => {
  const v = (ratings || []).filter(x => num(x) !== null)
  return v.length ? round(mean(v) * 25) : null
}

/** Organization report for the §13 dashboard, with §11 multi-respondent rules. */
export function aggregate(org, responses, ratings) {
  const inst = instrument()
  const scoredIds = [...new Set(Object.values(inst.indices).flatMap(d => d.domains.flatMap(x => x.items)))]
    .sort((x, y) => x[0].localeCompare(y[0]) || Number(x.slice(1)) - Number(y.slice(1)))
  const byRole = new Map()
  for (const r of responses) { if (!byRole.has(r.role)) byRole.set(r.role, []); byRole.get(r.role).push(r) }
  const internalRoles = [...byRole.keys()].filter(isInternal)
  const limited = internalRoles.length < 3

  const itemStats = {}, roleItem = new Map()
  for (const id of scoredIds) {
    const perRole = new Map(); const all = []
    for (const [rc, rs] of byRole) {
      const v = rs.map(x => num(x.answers[id])).filter(x => x !== null)
      if (!v.length) continue
      perRole.set(rc, median(v))
      if (!roleItem.has(rc)) roleItem.set(rc, {})
      roleItem.get(rc)[id] = median(v)
      all.push(...v)
    }
    if (!all.length) continue
    const [q1, q3] = quartiles(all)
    const rm = [...perRole.values()]
    const flag = (rm.length > 1 && Math.max(...rm) - Math.min(...rm) >= 2) || Math.max(...all) - Math.min(...all) >= 3
    itemStats[id] = { n: all.length, median: median(all), q1, q3,
      role_medians: Object.fromEntries([...perRole].map(([rc, m]) => [role(rc).name, m])),
      combined: round(mean(rm), 3), flag }
  }
  const combined = Object.fromEntries(Object.entries(itemStats).map(([i, s]) => [i, s.combined]))
  const indicesCombined = indicesFor(combined)
  const indicesByRole = Object.fromEntries([...roleItem].map(([rc, v]) => [role(rc).name, indicesFor(v).filter(x => x.valid > 0)]))

  const collect = id => responses.filter(r => !isEmpty(r.answers[id]))
    .map(r => ({ respondent: r.code, role: role(r.role).name, value: r.answers[id] }))
  const dist = id => {
    const c = {}
    for (const r of responses) {
      const v = r.answers[id]
      for (const x of Array.isArray(v) ? v : [v]) {
        if (x === undefined || x === null || x === '') continue
        const k = String(typeof x === 'object' ? x.code : x)
        c[k] = (c[k] || 0) + 1
      }
    }
    return c
  }
  const sub = (r, id) => r.answers[id] || {}

  const ea = {}
  for (let i = 1; i <= 17; i++) {
    const c = {}
    for (const r of responses) { const v = sub(r, `J${i}`).avail; if (v !== undefined && v !== null) c[String(v)] = (c[String(v)] || 0) + 1 }
    if (Object.keys(c).length) ea[`J${i}`] = c
  }

  const odp = {}
  for (const g of 'abcdefghij') {
    const id = `G3${g}`
    const v = responses.map(r => num(sub(r, id).change)).filter(x => x !== null)
    const lv = {}
    for (const r of responses) { const l = sub(r, id).level; if (l) lv[l] = (lv[l] || 0) + 1 }
    if (v.length || Object.keys(lv).length) odp[id] = { n: v.length, median: v.length ? median(v) : null, levels: lv }
  }

  const ctx = {}
  for (let i = 1; i <= 13; i++) {
    const v = responses.map(r => num(sub(r, `H${i}`).influence)).filter(x => x !== null)
    if (v.length) ctx[`H${i}`] = { n: v.length, median: median(v) }
  }

  const barriers = {}
  for (let i = 1; i <= 11; i++) {
    const rows = responses.map(r => sub(r, `I${i}`))
    const sev = rows.map(x => num(x.severity)).filter(x => x !== null)
    const con = rows.map(x => num(x.control)).filter(x => x !== null)
    const top = rows.filter(x => x.top3).length
    if (sev.length || con.length || top) barriers[`I${i}`] = { severity: sev.length ? median(sev) : null, controllability: con.length ? median(con) : null, top3: top }
  }
  const top3 = Object.keys(barriers).sort((a, b) => (barriers[b].top3 - barriers[a].top3) || ((barriers[b].severity || 0) - (barriers[a].severity || 0))).slice(0, 3)

  const ratingMap = new Map(ratings.map(x => [`${x.kind}|${x.ref}`, x]))
  const initiatives = []
  for (const r of responses) {
    for (const [n, f] of Object.entries(fInstances(r.answers))) {
      const ref = `${r.code}#${n}`
      const rt = ratingMap.get(`CCS|${ref}`)
      const ccs = rt ? rubricScore(rt.ratings) : null
      let interp = null
      if (ccs !== null) {
        interp = confidenceBand(ccs)
        if (limited && ccs >= 60) interp = confidenceBand(50) + ' (capped: single-/limited-informant result)'
      }
      initiatives.push({ ref, role: role(r.role).name, fields: f, ccs, ccs_interpretation: interp,
        ccs_ratings: rt ? rt.ratings : null, ccs_note: rt ? rt.note : null })
    }
  }
  const gics = ratings.filter(x => x.kind === 'GICS').map(x => {
    const s = rubricScore(x.ratings)
    return { ref: x.ref, ratings: x.ratings, note: x.note, gics: s, interpretation: s !== null ? confidenceBand(s) : null }
  })

  const extRows = [], intRows = []
  for (const r of responses) {
    for (const row of r.answers.G2 || []) {
      if (!row || !Object.values(row).some(v => v !== null && v !== '')) continue
      ;(EXTERNAL_CLASSES.has(num(row.class)) ? extRows : intRows).push({ respondent: r.code, ...row })
    }
  }
  const orientation = {}, categories = {}
  for (const i of initiatives) {
    if (i.fields.F27 !== undefined && i.fields.F27 !== null) orientation[String(i.fields.F27)] = (orientation[String(i.fields.F27)] || 0) + 1
    for (const c of i.fields.F28 || []) categories[String(c)] = (categories[String(c)] || 0) + 1
  }
  const rationale = collect('GX')
  let extOk = extRows.length > 0 || initiatives.some(i => num(i.fields.F27) !== null && i.fields.F27 >= 3) || rationale.length > 0
  if (org.external_value_in_scope === false || org.external_value_in_scope === 0) extOk = true

  const disagreements = Object.keys(itemStats).filter(i => itemStats[i].flag)
  const gates = {
    Boundary: ['unit_type', 'reporting_period', 'boundary'].every(k => org[k]),
    Coverage: !limited && indicesCombined.filter(x => x.valid > 0).every(x => x.score !== null),
    Balance: initiatives.some(i => [4, 5].includes(num(i.fields.F17))),
    'External relevance': extOk,
    Privacy: true,
    Reproducibility: org.status === 'closed',
  }
  const pick = (ids, fn) => Object.fromEntries(ids.map(k => [k, fn(k)]))

  return {
    org, instrument_version: inst.version,
    coverage: { respondents: responses.length,
      by_role: Object.fromEntries([...byRole].map(([rc, v]) => [role(rc).name, v.length])),
      internal_perspectives: internalRoles.length, limited_informant: limited,
      label: limited ? 'single-/limited-informant' : 'multi-informant' },
    indices_combined: indicesCombined, indices_by_role: indicesByRole,
    item_stats: itemStats, disagreements,
    implementation: pick(['B1', 'B2', 'B3', 'B4', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16'], collect),
    future: { K13: dist('K13'), K14: dist('K14'), K15: collect('K15'), K16: collect('K16') },
    program_outcomes: { ...pick([...'abcdefghijklmn'].map(x => `G1${x}`), collect), G1X: collect('G1X') },
    outcome_register: { internal: intRows, external: extRows },
    outcome_direction: odp, context: ctx,
    barriers, top3_barriers: top3, actions: collect('I12'), action_owners: collect('I13'),
    evidence_availability: ea,
    readiness: pick(Array.from({ length: 10 }, (_, i) => `A${i + 13}`), dist),
    initiatives, gics,
    evaluation_gate: { L0a: dist('L0a'), L0b: dist('L0b'), L12: collect('L12'), L14: dist('L14') },
    external_profile: { orientation, categories, external_outcomes: extRows.length, rationale, satisfied: extOk },
    adverse: { F10: initiatives.filter(i => i.fields.F10).map(i => ({ ref: i.ref, text: i.fields.F10 })), G3g: odp.G3g ?? null },
    quality_gates: gates,
  }
}
