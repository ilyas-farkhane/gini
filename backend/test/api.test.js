// Run: DATABASE_URL=mysql://user:pass@127.0.0.1:3306/gini_test npm test
// The test database is emptied first — never point this at production.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createApp } from '../src/app.js'
import { createPool, migrate } from '../src/db.js'
import { instrument, routedItems, varName } from '../src/instrument.js'
import { indexScore } from '../src/scoring.js'

const ADM = { Authorization: 'Bearer secret' }
let pool, server, base

before(async () => {
  pool = createPool(process.env.DATABASE_URL)
  for (const t of ['organizations', 'responses', 'contacts', 'analyst_ratings']) await pool.query(`DROP TABLE IF EXISTS ${t}`)
  await migrate(pool)
  server = createApp({ pool, adminToken: 'secret', requireRegisteredOrg: true }).listen(0)
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => { server.close(); await pool.end() })

async function call(method, path, { body, headers = {} } = {}) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) })
  const ct = r.headers.get('content-type') || ''
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() }
}

describe('instrument fidelity', () => {
  test('all sections and item counts', () => {
    const s = Object.fromEntries(instrument().sections.map(x => [x.id, x]))
    const count = (sec, re) => s[sec].items.filter(q => re.test(q.id)).length
    assert.equal(count('A', /^A\d+$/), 22)
    assert.equal(count('B', /^B\d+$/), 16)
    assert.equal(count('C', /^C\d+$/), 27)
    assert.equal(count('D', /^D\d+$/), 12)
    assert.equal(count('E', /^E\d+$/), 28)
    assert.equal(count('F', /^F\d+$/), 31)
    assert.equal(count('G', /^G1[a-n]$/), 14)
    assert.equal(count('G', /^G3[a-j]$/), 10)
    assert.equal(count('H', /^H\d+$/), 13)
    assert.equal(count('I', /^I\d+$/), 13)
    assert.equal(count('J', /^J\d+$/), 17)
    assert.equal(count('K', /^K\d+$/), 16)
    assert.equal(count('L', /^L\d+[ab]?$/), 17)
    assert.equal(instrument().declaration.length, 4)
    assert.ok(instrument().glossary.length >= 80)
  })
  test('item wording verbatim (previously abridged items)', () => {
    const t = Object.fromEntries(instrument().sections.flatMap(s => s.items.map(q => [q.id, q.text])))
    assert.ok(t.C27.endsWith('not only internal efficiency or capability gains.'))
    assert.ok(t.K6.endsWith('and their distributional effects.'))
    assert.ok(t.K9.endsWith('including experiments for emerging opportunities.'))
    assert.ok(t.K10.endsWith('consistent with the preferred future.'))
    assert.ok(t.E17.startsWith('Internal and external communication'))
    assert.ok(t.B6.startsWith('Role-appropriate training, coaching, tools, and implementation support'))
  })
  test('role routing', () => {
    const exec = routedItems(1)
    assert.ok(['B5', 'H1', 'I1', 'K1'].every(i => exec.has(i)) && !exec.has('C1'))
    const data = routedItems(4)
    assert.ok(['G1a', 'H1', 'J17'].every(i => data.has(i)) && !data.has('I1'))
    const st = routedItems(7)
    assert.ok(st.has('F3') && st.has('F12') && !st.has('F1') && !st.has('F13'))
    assert.ok(st.has('K5') && st.has('K6') && !st.has('K1'))
    assert.ok(routedItems(5).has('L0a') && !routedItems(4).has('L0a'))
  })
  test('stable variable names', () => {
    assert.deepEqual(['C7', 'E24', 'G3a', 'K11', 'G1X'].map(varName), ['C07', 'E24', 'G3a', 'K11', 'G1X'])
  })
})

describe('scoring rules (Guide §7)', () => {
  test('DK/NA excluded, never zero; ≥5 of 6 threshold', () => {
    const v = { B5: 4, B6: 4, B7: 4, B8: 4, B9: 'DK', B10: 'NA' }
    let r = indexScore('GIF', v)
    assert.equal(r.score, null); assert.equal(r.valid, 4)
    v.B9 = 2
    r = indexScore('GIF', v)
    assert.equal(r.score, Math.round(((4 * 4 + 2) / 5) * 25 * 10) / 10)
    assert.equal(r.band, 'Embedded and improving')
  })
  test('IPM: equal domain weights', () => {
    const v = Object.fromEntries(Array.from({ length: 27 }, (_, i) => [`C${i + 1}`, i >= 21 ? 0 : 4]))
    const r = indexScore('IPM', v)
    assert.equal(r.score, 87.5) // item-weighted mean would be 77.8
    assert.deepEqual(Object.keys(r.items), ['C25', 'C26', 'C27'])
  })
  test('≥2 items per domain; all-NA domain excluded', () => {
    const v = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`K${i + 1}`, 3]))
    v.K4 = v.K5 = 'DK'
    let r = indexScore('FSC', v)
    assert.equal(r.score, null); assert.match(r.suppressed_reason, /Alternative/)
    v.K4 = 3
    assert.equal(indexScore('FSC', v).score, 75)
    const w = Object.fromEntries(Array.from({ length: 27 }, (_, i) => [`C${i + 1}`, 2]))
    w.C18 = w.C19 = 'NA'
    r = indexScore('IPM', w)
    assert.equal(r.score, 50); assert.deepEqual(r.excluded_domains, ['Engagement'])
  })
})

describe('API flow', () => {
  const start = async (roleCode, org = 'ICESCO-01') => {
    const r = await call('POST', '/api/responses', { body: { org_code: org, role: roleCode, consent: true } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return { 'X-Resume-Code': r.body.resume_code }
  }

  test('admin requires token', async () => {
    assert.equal((await call('GET', '/api/admin/orgs')).status, 401)
  })

  test('full study cycle', async () => {
    assert.equal((await call('POST', '/api/responses', { body: { org_code: 'ICESCO-01', role: 1, consent: true } })).status, 404)
    assert.equal((await call('POST', '/api/admin/orgs', { headers: ADM, body: { code: 'icesco-01', unit_type: 'Whole organization', reporting_period: '2025', boundary: 'HQ' } })).status, 200)
    assert.equal((await call('POST', '/api/responses', { body: { org_code: 'ICESCO-01', role: 1, consent: false } })).status, 400)

    // Innovation lead with two initiatives
    const h = await start(2)
    const ans = {}
    for (let i = 1; i <= 27; i++) ans[`C${i}`] = 3
    for (let i = 5; i <= 10; i++) ans[`B${i}`] = 2
    for (let i = 1; i <= 12; i++) ans[`D${i}`] = 4
    Object.assign(ans, { F1: 'INIT-1', F27: 1, F17: 5, 'F1#2': 'INIT-2', 'F27#2': 4, E1: 3, G1a: { measure: 'x' } })
    assert.equal((await call('PUT', '/api/responses/me', { headers: h, body: { answers: ans } })).status, 200)
    const saved = (await call('GET', '/api/responses/me', { headers: h })).body.answers
    assert.ok(!('E1' in saved) && !('G1a' in saved), 'items outside the role are dropped')
    assert.equal(saved['F1#2'], 'INIT-2')

    let r = await call('POST', '/api/responses/me/submit', { headers: h, body: { answers: saved } })
    assert.equal(r.status, 422); assert.equal(r.body.detail.errors[0].item, 'DEC1')
    Object.assign(saved, { DEC1: true, DEC3: 1 })
    assert.equal((await call('POST', '/api/responses/me/submit', { headers: h, body: { answers: saved, contact: 'x@y.org' } })).status, 200)
    assert.equal((await call('PUT', '/api/responses/me', { headers: h, body: { answers: saved } })).status, 409)
    const prof = (await call('GET', '/api/responses/me/profile', { headers: h })).body
    assert.deepEqual(prof.indices.map(x => x.key).sort(), ['FSC', 'GIF', 'IEQ', 'IPM'])

    // Data owner: G without external outcome must explain; empty register rows dropped
    const h2 = await start(4)
    const a2 = { G2: [{ class: 1, metric: 'Cycle time' }, {}, {}], DEC1: true }
    r = await call('POST', '/api/responses/me/submit', { headers: h2, body: { answers: a2 } })
    assert.equal(r.status, 422); assert.equal(r.body.detail.errors[0].item, 'GX')
    a2.G2.push({ class: 4, metric: 'Beneficiaries reached', level: 'E3' })
    assert.equal((await call('POST', '/api/responses/me/submit', { headers: h2, body: { answers: a2 } })).status, 200)

    const h3 = await start(1)
    const a3 = { DEC1: true, I1: { severity: 3, top3: true } }
    for (let i = 5; i <= 10; i++) a3[`B${i}`] = 0
    assert.equal((await call('POST', '/api/responses/me/submit', { headers: h3, body: { answers: a3 } })).status, 200)

    let rep = (await call('GET', '/api/admin/orgs/ICESCO-01/report', { headers: ADM })).body
    assert.equal(rep.coverage.respondents, 3); assert.equal(rep.coverage.internal_perspectives, 3)
    assert.equal(rep.indices_combined.find(x => x.key === 'GIF').score, 25) // role medians 2 and 0, equal weight
    assert.ok(rep.disagreements.includes('B5'))
    assert.equal(rep.external_profile.external_outcomes, 1)
    assert.equal(rep.outcome_register.internal.length, 1)
    assert.equal(rep.top3_barriers[0], 'I1')

    const ref = rep.initiatives[0].ref
    assert.equal((await call('PUT', '/api/admin/orgs/ICESCO-01/ratings', { headers: ADM, body: { kind: 'CCS', ref, ratings: [2, 2, 2, 2, 2, 2] } })).status, 200)
    assert.equal((await call('PUT', '/api/admin/orgs/ICESCO-01/ratings', { headers: ADM, body: { kind: 'CCS', ref, ratings: [3, 3, 3, 3, 3, 3] } })).status, 200)
    rep = (await call('GET', '/api/admin/orgs/ICESCO-01/report', { headers: ADM })).body
    assert.equal(rep.initiatives[0].ccs, 75)

    const orgs = (await call('GET', '/api/admin/orgs', { headers: ADM })).body
    assert.equal(orgs[0].submitted, 3)

    const long = (await call('GET', '/api/admin/export/long.csv', { headers: ADM })).body
    assert.ok(long.includes(',C07,') && long.includes('Consistently implemented') && long.includes('INIT-2'))
    assert.ok(!long.includes('x@y.org'), 'contact kept separate')
    assert.ok((await call('GET', '/api/admin/export/contacts.csv', { headers: ADM })).body.includes('x@y.org'))
    assert.ok((await call('GET', '/api/admin/export/codebook.csv', { headers: ADM })).body.includes('C07'))

    assert.equal((await call('GET', '/api/admin/export/snapshot.json?org=ICESCO-01', { headers: ADM })).status, 409)
    await call('PATCH', '/api/admin/orgs/ICESCO-01', { headers: ADM, body: { status: 'closed' } })
    const snap = (await call('GET', '/api/admin/export/snapshot.json?org=ICESCO-01', { headers: ADM })).body
    assert.equal(snap.responses.length, 3); assert.equal(snap.sha256.length, 64)
    assert.ok(!('token_hash' in snap.responses[0]))
    assert.equal((await call('POST', '/api/responses', { body: { org_code: 'ICESCO-01', role: 1, consent: true } })).status, 409)
  })
})
