// Lightweight client-side session helpers for admin token and survey resume code.
const ADMIN_KEY = 'gini-admin-token'
const SURVEY_KEY = 'gini-session'

const read = (k, parse = false) => {
  try {
    const v = localStorage.getItem(k)
    if (v == null) return parse ? null : ''
    return parse ? JSON.parse(v) : v
  } catch { return parse ? null : '' }
}
const write = (k, v) => { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)) } catch { /* */ } }
const remove = k => { try { localStorage.removeItem(k) } catch { /* */ } }

export const adminAuth = {
  get: () => read(ADMIN_KEY) || (() => { try { return sessionStorage.getItem(ADMIN_KEY) || '' } catch { return '' } })(),
  set: t => { write(ADMIN_KEY, t); try { sessionStorage.setItem(ADMIN_KEY, t) } catch { /* */ } },
  clear: () => { remove(ADMIN_KEY); try { sessionStorage.removeItem(ADMIN_KEY) } catch { /* */ } },
}

export const surveyAuth = {
  get: () => read(SURVEY_KEY, true),
  set: s => write(SURVEY_KEY, s),
  clear: () => { remove(SURVEY_KEY); remove(SURVEY_KEY + ':step') },
}
