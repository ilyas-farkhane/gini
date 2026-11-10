async function call(method, url, { body, headers = {} } = {}) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) })
  const ct = r.headers.get('content-type') || ''
  const data = ct.includes('json') ? await r.json() : await r.text()
  if (!r.ok) { const e = new Error(typeof data === 'object' ? (typeof data.detail === 'string' ? data.detail : 'Please review the highlighted items.') : data); e.status = r.status; e.detail = data?.detail; throw e }
  return data
}
const rc = code => ({ 'X-Resume-Code': code })
export const api = {
  instrument: () => call('GET', '/api/instrument'),
  config: () => call('GET', '/api/config'),
  start: body => call('POST', '/api/responses', { body }),
  me: code => call('GET', '/api/responses/me', { headers: rc(code) }),
  save: (code, answers) => call('PUT', '/api/responses/me', { headers: rc(code), body: { answers } }),
  submit: (code, answers, contact) => call('POST', '/api/responses/me/submit', { headers: rc(code), body: { answers, contact } }),
  profile: code => call('GET', '/api/responses/me/profile', { headers: rc(code) }),
}
const au = t => ({ Authorization: 'Bearer ' + t })
export const admin = {
  orgs: t => call('GET', '/api/admin/orgs', { headers: au(t) }),
  saveOrg: (t, body) => call('POST', '/api/admin/orgs', { headers: au(t), body }),
  status: (t, code, status) => call('PATCH', `/api/admin/orgs/${encodeURIComponent(code)}`, { headers: au(t), body: { status } }),
  report: (t, code, drafts) => call('GET', `/api/admin/orgs/${encodeURIComponent(code)}/report?include_drafts=${!!drafts}`, { headers: au(t) }),
  rate: (t, code, body) => call('PUT', `/api/admin/orgs/${encodeURIComponent(code)}/ratings`, { headers: au(t), body }),
  getPrivacy: t => call('GET', '/api/admin/privacy-notice', { headers: au(t) }),
  savePrivacy: (t, privacy_notice) => call('PUT', '/api/admin/privacy-notice', { headers: au(t), body: { privacy_notice } }),
  async download(t, path, filename) {
    const r = await fetch(path, { headers: au(t) })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Download failed')
    const blob = await r.blob(); const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  },
}
export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k) } catch { /* ignore */ } },
}
