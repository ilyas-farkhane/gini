// End-to-end smoke test: node e2e/smoke.cjs [baseUrl] [screenshotDir]
// Expects a running server with organization ICESCO-01 registered and ADMIN_TOKEN=secret.
const { chromium } = require('playwright')
const BASE = process.argv[2] || 'http://localhost:8000'
const SHOTS = process.argv[3] || '.'
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok  ', m) }

async function startAs(page, roleName) {
  await page.goto(BASE + '/#/'); await page.evaluate(() => localStorage.clear()); await page.reload()
  await page.getByPlaceholder('e.g. ICESCO-01').fill('ICESCO-01')
  await page.locator('form select').selectOption({ label: roleName })
  await page.getByRole('checkbox', { name: /privacy notice/ }).check()
  await page.getByRole('button', { name: 'Start survey' }).click()
  const code = (await page.locator('.code-big').textContent()).trim()
  await page.getByRole('button', { name: /begin/ }).click()
  await page.waitForSelector('nav.rail')
  return code
}
const rail = page => page.$$eval('nav.rail > button b', e => e.map(x => x.textContent))

;(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', e => { throw e })

  // Data owner: A, G, H, J (the previous build showed only A)
  let code = await startAs(page, 'Data, Assurance, or Performance Owner')
  assert(JSON.stringify(await rail(page)) === JSON.stringify(['A', 'G', 'H', 'J', '✓']), 'data owner routed to A, G, H, J + declaration')
  assert(await page.locator('#q-A22').count() === 1 && await page.locator('#q-A3').count() === 1, 'section A shows A3–A22')
  await page.locator('#q-A12').getByText('3 High').click()
  await page.locator('#q-A21').getByText('Before-after').click()
  await page.locator('nav.rail button', { hasText: 'Outcomes and Evidence' }).click()
  await page.locator('#q-G1a input').first().fill('Sponsor attendance at governance meetings (%)')
  await page.locator('#q-G1a').getByText('Not Available').first().click()
  await page.locator('#q-G1a').getByRole('radio', { name: /E3 Quantitative/ }).check({ force: true })
  await page.locator('#q-G3h').getByRole('radio', { name: /\+1 Improvement/ }).check({ force: true })
  await page.waitForTimeout(1300)
  assert((await page.locator('.save').textContent()).startsWith('Saved'), 'autosave confirmed')
  await page.screenshot({ path: SHOTS + '/g-section.png', fullPage: false })

  // save-and-return in a fresh context
  const p2 = await b.newPage(); await p2.goto(BASE + '/#/')
  await p2.getByRole('tab', { name: 'Resume with a code' }).click()
  await p2.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(code); await p2.getByRole('button', { name: 'Resume' }).click()
  await p2.waitForSelector('nav.rail'); await p2.locator('nav.rail button', { hasText: 'Outcomes and Evidence' }).click()
  assert(await p2.locator('#q-G1a input').first().inputValue() === 'Sponsor attendance at governance meetings (%)', 'resume restores answers on another device')
  await p2.close()

  // Submit: declaration missing, then external-impact rule, then success
  await page.locator('nav.rail button', { hasText: 'Declaration' }).click()
  await page.getByRole('button', { name: 'Submit my response' }).click()
  assert(await page.locator('#q-DEC1 .errmsg').count() === 1, 'declaration required')
  await page.locator('#q-DEC1 input[type=checkbox]').check()
  await page.getByRole('button', { name: 'Submit my response' }).click()
  await page.waitForSelector('#q-GX.err')
  assert(true, 'external-impact rule enforced (sent back to GX)')
  await page.locator('#q-G2 select').first().selectOption({ label: 'BENEFICIARY/ COMMUNITY' })
  await page.locator('#q-G2 input[aria-label="Outcome/ metric"]').first().fill('Member-state teachers trained')
  await page.waitForTimeout(1000)
  await page.locator('nav.rail button', { hasText: 'Declaration' }).click()
  await page.getByRole('button', { name: 'Submit my response' }).click()
  await page.waitForSelector('text=Your results profile')
  assert(true, 'data owner submitted')

  // Innovation lead: B–D, F with two initiatives, glossary tooltip
  await startAs(page, 'Innovation Lead or Portfolio Owner')
  assert(JSON.stringify(await rail(page)) === JSON.stringify(['A', 'B', 'C', 'D', 'F', 'I', 'K', '✓']), 'innovation lead routing')
  await page.locator('nav.rail button', { hasText: 'Reach, Intensity' }).click()
  assert(await page.locator('#q-B1').count() === 1 && await page.locator('#q-B16').count() === 1 && await page.locator('#q-B5 .id').textContent() === 'B5', 'B1–B16 with original IDs')
  for (const i of [5, 6, 7, 8, 9, 10]) await page.locator(`#q-B${i}`).getByRole('radio', { name: 'Consistently implemented' }).check({ force: true })
  await page.locator('.term').first().focus()
  assert(await page.locator('[role=tooltip]').count() === 1, 'glossary help on focus')
  await page.screenshot({ path: SHOTS + '/b-section.png' })
  await page.locator('nav.rail button', { hasText: 'Linked Initiative' }).click()
  await page.locator('#q-F1 input').first().fill('INIT-01 Digital library')
  await page.locator('#q-F27').getByText('Mixed internal and external').click()
  await page.getByRole('button', { name: '+ Add initiative' }).click()
  await page.locator('#q-F1 input').first().fill('INIT-02 Stopped pilot')
  await page.locator('#q-F17').getByText('Stop', { exact: true }).click()
  await page.waitForTimeout(1000)
  await page.locator('nav.rail button', { hasText: 'Declaration' }).click()
  await page.locator('#q-DEC1 input[type=checkbox]').check()
  await page.getByRole('button', { name: 'Submit my response' }).click()
  await page.waitForSelector('text=Your results profile')
  const gif = await page.locator('.idx', { hasText: '(GIF)' }).locator('.idx-h b').textContent()
  assert(gif === '75.0', 'GIF profile = 75.0 for all-3 answers')
  await page.screenshot({ path: SHOTS + '/profile.png', fullPage: true })

  // Stakeholder: only F3–F12 and K5–K6
  await startAs(page, 'Affected Stakeholder or Delivery Partner')
  await page.locator('nav.rail button', { hasText: 'Future Shaping' }).click()
  assert(await page.locator('fieldset.q').count() === 2, 'stakeholder sees K5–K6 only')
  await page.locator('nav.rail button', { hasText: 'Linked Initiative' }).click()
  assert(await page.locator('#q-F1').count() === 0 && await page.locator('#q-F12').count() === 1, 'stakeholder sees F3–F12 only')

  // Evaluator: L gate
  await startAs(page, 'Independent Evaluator or Analytics Lead')
  await page.locator('nav.rail button', { hasText: 'Advanced Impact' }).click()
  assert(await page.locator('#q-L1').count() === 0, 'L1–L15 hidden before gate')
  await page.locator('#q-L0a').getByText('No', { exact: true }).click()
  assert(await page.locator('#q-L0b').count() === 1 && await page.locator('#q-L1').count() === 0, 'L0b shown when not feasible')
  await page.locator('#q-L0a').getByText('Yes', { exact: true }).click()
  assert(await page.locator('#q-L15').count() === 1, 'L1–L15 shown when feasible')

  // Admin dashboard
  await page.goto(BASE + '/#/admin'); await page.evaluate(() => sessionStorage.clear()); await page.reload()
  await page.locator('input[type=password]').fill('secret'); await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: 'Dashboard' }).click()
  await page.waitForSelector('text=interpretation dashboard')
  assert(await page.locator('.panel').count() >= 14, 'dashboard panels rendered')
  assert(await page.locator('text=single-/limited-informant').count() >= 1, 'limited-informant label')
  assert(await page.locator('.init').count() === 2, 'two initiatives listed for CCS rating')
  await page.screenshot({ path: SHOTS + '/admin.png', fullPage: true })

  // Mobile layout
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(BASE + '/#/')
  await page.evaluate(() => localStorage.clear()); await page.reload()
  const sw = await page.evaluate(() => document.documentElement.scrollWidth)
  assert(sw <= 392, 'no horizontal scroll at phone width (' + sw + ')')
  await page.screenshot({ path: SHOTS + '/mobile.png', fullPage: false })
  await b.close(); console.log('ALL PASSED')
})().catch(e => { console.error(e); process.exit(1) })
