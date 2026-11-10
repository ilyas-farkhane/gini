// GInI Innovation Implementation Impact Survey — Express API (Guide §5, §15, §17, Appendix A).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { rowToOrg, rowToRating, rowToResponse } from './db.js'
import { aggregate, externalCheck, respondentProfile } from './scoring.js'
import { baseId, instrument, items, optionLabel, role, routedItems, scaleOptions, varName } from './instrument.js'

const MAX_F_INSTANCES = 10
const now = () => new Date()
const hashToken = t => crypto.createHash('sha256').update(String(t).trim().toUpperCase()).digest('hex')
const isEmpty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ||
  (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)

class HttpError extends Error {
  constructor(status, detail) { super(typeof detail === 'string' ? detail : 'error'); this.status = status; this.detail = detail }
}
const fail = (status, detail) => { throw new HttpError(status, detail) }
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max
const optStr = (v, max) => v === undefined || v === null || (typeof v === 'string' && v.length <= max)

export function createApp({ pool, adminToken = process.env.ADMIN_TOKEN || '',
  requireRegisteredOrg = (process.env.REQUIRE_REGISTERED_ORG ?? 'true').toLowerCase() !== 'false',
  consentVersion = process.env.CONSENT_VERSION || '1',
  noticeFile = process.env.PRIVACY_NOTICE_FILE || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../privacy_notice.md'),
  staticDir = process.env.STATIC_DIR } = {}) {
  if (staticDir) staticDir = path.resolve(staticDir)
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', true)
  app.use(express.json({ limit: '2mb' }))
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next() })

  const q = async (sql, params = []) => (await pool.query(sql, params))[0]
  const getOrg = async code => rowToOrg((await q('SELECT * FROM organizations WHERE code = ?', [code]))[0])
  const fileNotice = () => (fs.existsSync(noticeFile) ? fs.readFileSync(noticeFile, 'utf8') : '')
  const getPrivacyNotice = async () => {
    const row = (await q('SELECT value FROM settings WHERE `key` = ?', ['privacy_notice']))[0]
    return row?.value != null ? String(row.value) : fileNotice()
  }

  // ---------------------------------------------------------------- public
  app.get('/api/instrument', (req, res) => res.json(instrument()))
  app.get('/api/config', wrap(async (req, res) => {
    res.json({
      privacy_notice: await getPrivacyNotice(),
      consent_version: consentVersion,
      require_registered_org: requireRegisteredOrg,
    })
  }))

  app.post('/api/responses', wrap(async (req, res) => {
    const { org_code, role: roleCode, consent } = req.body || {}
    if (!str(org_code, 1, 40) || !Number.isInteger(roleCode) || typeof consent !== 'boolean') fail(422, 'Invalid request.')
    if (!consent) fail(400, 'Consent is required before participation.')
    try { role(roleCode) } catch { fail(400, 'Unknown role.') }
    const code = org_code.trim().toUpperCase()
    const o = await getOrg(code)
    if (requireRegisteredOrg && !o) fail(404, 'Organization code not recognised. Check the code supplied by your study administrator.')
    if (o && o.status === 'closed') fail(409, "This organization's survey is closed.")
    if (!o) await q('INSERT INTO organizations (code, status, created_at) VALUES (?, \'open\', ?)', [code, now()])
    const token = Array.from({ length: 4 }, () => crypto.randomBytes(2).toString('hex').toUpperCase()).join('-')
    const rcode = 'R' + crypto.randomBytes(4).toString('hex').toUpperCase()
    await q(`INSERT INTO responses (code, token_hash, org_code, role, consent_version, consent_at, answers, status,
             instrument_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [rcode, hashToken(token), code, roleCode, consentVersion, now(), JSON.stringify({ A1: code, A2: roleCode }),
        instrument().version, now(), now()])
    res.json({ respondent_code: rcode, resume_code: token })
  }))

  const current = wrap(async (req, res, next) => {
    const tok = req.get('X-Resume-Code')
    if (!tok) fail(422, 'Resume code missing.')
    const r = rowToResponse((await q('SELECT * FROM responses WHERE token_hash = ?', [hashToken(tok)]))[0])
    if (!r) fail(404, 'Resume code not recognised.')
    req.resp = r
    req.org = (await getOrg(r.org_code)) || {}
    next()
  })
  const publicView = r => ({ respondent_code: r.code, org_code: r.org_code, role: r.role, answers: r.answers || {},
    status: r.status, updated_at: r.updated_at, submitted_at: r.submitted_at })

  app.get('/api/responses/me', current, (req, res) => res.json(publicView(req.resp)))

  /** Keep only routed item IDs (and F instances 2..10); A1/A2 are fixed at start; drop empty register rows. */
  function clean(roleCode, answers) {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) fail(422, 'answers must be an object.')
    const allowed = routedItems(roleCode)
    const out = {}
    for (let [k, v] of Object.entries(answers)) {
      const b = baseId(k)
      if (!allowed.has(b) || b === 'A1' || b === 'A2') continue
      if (k.includes('#')) {
        const n = k.split('#')[1]
        if (!(b.startsWith('F') && /^\d+$/.test(n) && Number(n) >= 2 && Number(n) <= MAX_F_INSTANCES)) continue
      }
      if (Array.isArray(v) && items()[b].type === 'repeat')
        v = v.filter(row => row && typeof row === 'object' && Object.values(row).some(x => !isEmpty(x)))
      if (isEmpty(v)) continue
      out[k] = v
    }
    return out
  }
  const guard = (r, o) => {
    if (r.status === 'submitted') fail(409, 'This response has already been submitted.')
    if (o.status === 'closed') fail(409, 'The survey for this organization is closed.')
  }

  app.put('/api/responses/me', current, wrap(async (req, res) => {
    const r = req.resp
    guard(r, req.org)
    const a = { ...clean(r.role, req.body?.answers), A1: r.org_code, A2: r.role }
    await q('UPDATE responses SET answers = ?, updated_at = ? WHERE code = ?', [JSON.stringify(a), now(), r.code])
    res.json({ saved_at: now() })
  }))

  function validate(r) {
    const a = r.answers, errs = []
    if (a.DEC1 !== true) errs.push({ item: 'DEC1', message: 'Please confirm the respondent declaration.' })
    const rng = a.A10 || {}
    if (rng.from && rng.to && rng.from > rng.to) errs.push({ item: 'A10', message: 'Reporting period: the start date is after the end date.' })
    const tops = Object.entries(a).filter(([k, v]) => /^I\d+$/.test(k) && v && typeof v === 'object' && v.top3)
    if (tops.length > 3) errs.push({ item: 'I1', message: 'Mark at most three barriers as Top 3.' })
    const ext = externalCheck(r)
    if (ext.applies && !ext.satisfied)
      errs.push({ item: role(r.role).modules.includes('G') ? 'GX' : 'F29',
        message: 'Report at least one externally oriented outcome (F27 / G.2 classification), or explain why external impact is not applicable to the assessed scope.' })
    return errs
  }

  app.post('/api/responses/me/submit', current, wrap(async (req, res) => {
    let r = req.resp
    guard(r, req.org)
    const contact = req.body?.contact
    if (!optStr(contact, 200)) fail(422, 'Invalid contact.')
    const a = { ...clean(r.role, req.body?.answers), A1: r.org_code, A2: r.role, DEC4: now().toISOString().slice(0, 10) }
    r = { ...r, answers: a }
    const errs = validate(r)
    if (errs.length) fail(422, { errors: errs })
    await q("UPDATE responses SET answers = ?, status = 'submitted', submitted_at = ?, updated_at = ? WHERE code = ?",
      [JSON.stringify(a), now(), now(), r.code])
    if (a.DEC3 === 1 && contact && contact.trim())
      await q('INSERT INTO contacts (respondent_code, contact, created_at) VALUES (?, ?, ?)', [r.code, contact.trim(), now()])
    res.json({ status: 'submitted' })
  }))

  app.get('/api/responses/me/profile', current, (req, res) => res.json(respondentProfile(req.resp)))

  // ---------------------------------------------------------------- admin
  const admin = (req, res, next) => {
    if (!adminToken) return next(new HttpError(503, 'ADMIN_TOKEN is not configured on the server.'))
    const given = Buffer.from((req.get('Authorization') || '').replace(/^Bearer /, '').trim())
    const want = Buffer.from(adminToken)
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return next(new HttpError(401, 'Invalid administrator token.'))
    next()
  }
  const ORG_FIELDS = ['name', 'unit_type', 'sector', 'geography', 'reporting_period', 'boundary', 'intended_external_beneficiaries']

  app.get('/api/admin/privacy-notice', admin, wrap(async (req, res) => {
    res.json({ privacy_notice: await getPrivacyNotice(), updated_at: (await q('SELECT updated_at FROM settings WHERE `key` = ?', ['privacy_notice']))[0]?.updated_at || null })
  }))

  app.put('/api/admin/privacy-notice', admin, wrap(async (req, res) => {
    const text = req.body?.privacy_notice
    if (typeof text !== 'string' || text.length > 100000) fail(422, 'Invalid privacy notice.')
    await q(
      'INSERT INTO settings (`key`, value, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)',
      ['privacy_notice', text, now()],
    )
    res.json({ privacy_notice: text, saved_at: now() })
  }))

  app.get('/api/admin/orgs', admin, wrap(async (req, res) => {
    const rows = (await q('SELECT * FROM organizations ORDER BY code')).map(rowToOrg)
    const counts = await q("SELECT org_code, SUM(status = 'draft') AS drafts, SUM(status = 'submitted') AS submitted FROM responses GROUP BY org_code")
    const by = Object.fromEntries(counts.map(c => [c.org_code, c]))
    res.json(rows.map(o => ({ ...o, drafts: Number(by[o.code]?.drafts || 0), submitted: Number(by[o.code]?.submitted || 0) })))
  }))

  app.post('/api/admin/orgs', admin, wrap(async (req, res) => {
    const b = req.body || {}
    if (!str(b.code, 1, 40) || !ORG_FIELDS.every(f => optStr(b[f], 5000))) fail(422, 'Invalid organization.')
    const code = b.code.trim().toUpperCase()
    const vals = ORG_FIELDS.map(f => b[f] ?? null)
    const ext = b.external_value_in_scope === false ? 0 : 1
    if (await getOrg(code))
      await q(`UPDATE organizations SET ${ORG_FIELDS.map(f => `${f} = ?`).join(', ')}, external_value_in_scope = ? WHERE code = ?`, [...vals, ext, code])
    else
      await q(`INSERT INTO organizations (code, ${ORG_FIELDS.join(', ')}, external_value_in_scope, status, created_at)
               VALUES (?, ${ORG_FIELDS.map(() => '?').join(', ')}, ?, 'open', ?)`, [code, ...vals, ext, now()])
    res.json({ code })
  }))

  app.patch('/api/admin/orgs/:code', admin, wrap(async (req, res) => {
    const status = req.body?.status
    if (!['open', 'closed'].includes(status)) fail(422, 'status must be open or closed.')
    if (!(await getOrg(req.params.code))) fail(404, 'Unknown organization.')
    await q('UPDATE organizations SET status = ?, closed_at = ? WHERE code = ?', [status, status === 'closed' ? now() : null, req.params.code])
    res.json({ code: req.params.code, status })
  }))

  const responsesOf = async (org, drafts) =>
    (await q(`SELECT * FROM responses WHERE org_code = ? ${drafts ? '' : "AND status = 'submitted'"} ORDER BY created_at`, [org])).map(rowToResponse)

  app.get('/api/admin/orgs/:code/report', admin, wrap(async (req, res) => {
    const o = await getOrg(req.params.code)
    if (!o) fail(404, 'Unknown organization.')
    const rs = await responsesOf(o.code, req.query.include_drafts === 'true')
    const rt = (await q('SELECT * FROM analyst_ratings WHERE org_code = ?', [o.code])).map(rowToRating)
    res.json(aggregate(o, rs, rt))
  }))

  app.put('/api/admin/orgs/:code/ratings', admin, wrap(async (req, res) => {
    const { kind, ref, ratings, note } = req.body || {}
    if (!['CCS', 'GICS'].includes(kind) || !str(ref, 1, 60) || !Array.isArray(ratings) || !optStr(note, 5000)) fail(422, 'Invalid rating.')
    const n = instrument()[kind === 'CCS' ? 'ccs' : 'gics'].length
    if (ratings.length !== n || ratings.some(x => x !== null && !(Number.isInteger(x) && x >= 0 && x <= 4)))
      fail(400, `${kind} needs ${n} ratings between 0 and 4.`)
    await q(`INSERT INTO analyst_ratings (org_code, kind, ref, ratings, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE ratings = VALUES(ratings), note = VALUES(note), updated_at = VALUES(updated_at)`,
      [req.params.code, kind, ref, JSON.stringify(ratings), note ?? null, now()])
    res.json({ ok: true })
  }))

  // ---------------------------------------------------------------- exports (Guide §17, Appendix A)
  const codeOf = v => (v && typeof v === 'object' && !Array.isArray(v) && 'm' in v ? v.m : v)
  function labelFor(item, key, value) {
    const field = key && item.fields ? item.fields.find(f => f.key === key) || {} : item
    const t = field.type
    if (['scale', 'change', 'context', 'rating04', 'level'].includes(t)) return optionLabel(scaleOptions(t), value)
    if (['single', 'multi', 'single_text'].includes(t)) return optionLabel(field.options, value)
    if (value && typeof value === 'object' && 'm' in value) return optionLabel(field.missing || [], value.m)
    return null
  }
  /** Yield [subfield, row, code, label] for one stored answer. */
  function* flatten(id, value) {
    const item = items()[baseId(id)]
    switch (item.type) {
      case 'repeat':
        for (const [n, row] of (value || []).entries())
          for (const f of item.fields) { const v = row?.[f.key]; if (!isEmpty(v)) yield [f.key, n + 1, codeOf(v), labelFor(item, f.key, v)] }
        break
      case 'group':
        for (const f of item.fields) { const v = value?.[f.key]; if (!isEmpty(v)) yield [f.key, null, codeOf(v), labelFor(item, f.key, v)] }
        break
      case 'multi':
        for (const v of value || []) yield [null, null, v, labelFor(item, null, v)]
        break
      case 'single_text':
        yield [null, null, value.code, labelFor(item, null, value.code)]
        if (value.detail) yield ['detail', null, codeOf(value.detail), null]
        break
      case 'daterange':
        yield ['from', null, value.from ?? null, null]
        yield ['to', null, value.to ?? null, null]
        break
      default:
        yield [null, null, codeOf(value), labelFor(item, null, value)]
    }
  }
  const cell = v => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = (header, rows) => [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'
  const sendCsv = (res, body) => res.type('text/csv; charset=utf-8').send('﻿' + body)

  app.get('/api/admin/export/long.csv', admin, wrap(async (req, res) => {
    const where = [], params = []
    if (req.query.org) { where.push('org_code = ?'); params.push(req.query.org) }
    if (req.query.include_drafts !== 'true') where.push("status = 'submitted'")
    const rs = (await q(`SELECT * FROM responses ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY org_code, created_at`, params)).map(rowToResponse)
    const rows = []
    for (const r of rs) for (const [k, v] of Object.entries(r.answers)) {
      const b = baseId(k)
      if (!items()[b]) continue
      const inst = k.includes('#') ? Number(k.split('#')[1]) : (b.startsWith('F') ? 1 : null)
      for (const [sub, rown, code, label] of flatten(k, v))
        rows.push([r.org_code, r.code, r.role, role(r.role).name, r.status, r.instrument_version, items()[b].section,
          b, varName(b), inst, rown, sub, code, label])
    }
    sendCsv(res, csv(['org_code', 'respondent_code', 'role_code', 'role', 'status', 'instrument_version', 'section',
      'item_id', 'variable', 'initiative', 'row', 'subfield', 'value_code', 'value_label'], rows))
  }))

  app.get('/api/admin/export/codebook.csv', admin, (req, res) => {
    const rows = []
    for (const [id, item] of Object.entries(items())) {
      for (const f of item.fields || [null]) {
        const src = f || item
        const codes = [...(src.options || scaleOptions(src.type) || []), ...(src.missing || [])]
        rows.push([instrument().version, item.section, id, varName(id), f ? f.key : '', item.text, f ? f.label : '',
          f ? f.type : item.type, codes.map(([c, l]) => `${c}=${l}`).join('; ')])
      }
    }
    sendCsv(res, csv(['instrument_version', 'section', 'item_id', 'variable', 'subfield', 'item_text', 'subfield_label', 'type', 'codes'], rows))
  })

  const stable = v => Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object' && !(v instanceof Date) ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',')}}`
    : JSON.stringify(v)

  /** Dated, frozen dataset for analysis (Guide §5 step 14). Organization must be closed first. */
  app.get('/api/admin/export/snapshot.json', admin, wrap(async (req, res) => {
    const o = await getOrg(String(req.query.org || ''))
    if (!o) fail(404, 'Unknown organization.')
    if (o.status !== 'closed') fail(409, 'Close the organization before freezing a dataset.')
    const data = (await responsesOf(o.code, true)).map(({ token_hash, ...r }) => r)
    const body = stable(JSON.parse(JSON.stringify(data)))
    res.json({ org: o, frozen_at: now().toISOString(), instrument_version: instrument().version,
      sha256: crypto.createHash('sha256').update(body).digest('hex'), responses: data })
  }))

  app.get('/api/admin/export/contacts.csv', admin, wrap(async (req, res) => {
    const rows = (await q('SELECT respondent_code, contact, created_at FROM contacts ORDER BY created_at')).map(x => [x.respondent_code, x.contact, x.created_at?.toISOString?.() ?? x.created_at])
    sendCsv(res, csv(['respondent_code', 'contact', 'created_at'], rows))
  }))

  app.use('/api', (req, res) => res.status(404).json({ detail: 'Not found' }))

  // ---------------------------------------------------------------- static frontend (production)
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }))
    app.get('*', (req, res) => res.sendFile(path.join(staticDir, 'index.html')))
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ detail: err.detail })
    if (err.type === 'entity.parse.failed') return res.status(400).json({ detail: 'Malformed JSON.' })
    if (err.type === 'entity.too.large') return res.status(413).json({ detail: 'Request too large.' })
    console.error(err)
    res.status(500).json({ detail: 'Internal server error.' })
  })
  return app
}
