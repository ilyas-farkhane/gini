import { useEffect, useState } from 'react'
import { api } from './api.js'
import { adminAuth, surveyAuth } from './auth.js'
import Survey from './Survey.jsx'
import Admin from './Admin.jsx'

const useHash = () => {
  const [h, setH] = useState(location.hash || '#/')
  useEffect(() => {
    const f = () => setH(location.hash || '#/')
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return h
}

export default function App() {
  const [inst, setInst] = useState(null)
  const [config, setConfig] = useState(null)
  const [err, setErr] = useState('')
  const [adminToken, setAdminToken] = useState(() => adminAuth.get())
  const [surveySess, setSurveySess] = useState(() => surveyAuth.get())
  const hash = useHash()
  const isAdmin = hash.startsWith('#/admin')

  useEffect(() => {
    Promise.all([api.instrument(), api.config()])
      .then(([i, c]) => { setInst(i); setConfig(c) })
      .catch(e => setErr(e.message))
  }, [])

  const onAdminLogin = token => {
    adminAuth.set(token)
    setAdminToken(token)
  }
  const onAdminLogout = () => {
    adminAuth.clear()
    setAdminToken('')
  }
  const onSurveyReady = s => {
    surveyAuth.set(s)
    setSurveySess(s)
  }
  const onSurveyLogout = () => {
    surveyAuth.clear()
    setSurveySess(null)
  }

  const foot = (
    <footer className="foot">
      GInI Innovation Implementation Impact Survey · instrument v{inst?.version}
    </footer>
  )

  return (<div className="app">
    <a className="skip" href="#main-content">Skip to content</a>
    <header className="top">
      <div className="logos">
        <img src="/icesco.png" alt="ICESCO" />
        <span className="rule" />
        <img src="/gini.png" alt="Global Innovation Institute" />
      </div>
      {!isAdmin && !surveySess?.code
        ? <p className="top-org">Islamic World Educational, Scientific and Cultural Organization</p>
        : <div className="diamonds" aria-hidden="true"><i /><i /><i className="gold" /><i /></div>}
    </header>
    <div id="main-content" className="shell">
      {err && <div className="content-pane"><main className="solo"><p className="errmsg">Could not reach the survey service: {err}</p></main>{foot}</div>}
      {inst && (isAdmin
        ? <div className="content-pane"><Admin inst={inst} token={adminToken} onLogin={onAdminLogin} onLogout={onAdminLogout} />{foot}</div>
        : <Survey inst={inst} config={config} sess={surveySess} onReady={onSurveyReady} onLogout={onSurveyLogout} foot={foot} />)}
    </div>
  </div>)
}
