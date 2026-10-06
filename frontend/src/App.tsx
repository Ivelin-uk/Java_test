import { useEffect, useState } from 'react'
import './App.css'
import { api } from './api/client'
import { AuthPanel } from './components/AuthPanel'
import { ExamWorkspace } from './workspace/ExamWorkspace'
import type { AuthResponse } from './types/models'

function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(() => {
    try { return JSON.parse(localStorage.getItem('quicktest.auth') ?? 'null') } catch { return null }
  })
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')
  const token = auth?.token
  useEffect(() => {
    if (!token) return
    const handoff = new URLSearchParams(window.location.hash.slice(1)).get('google_handoff')
    if (!handoff) return
    history.replaceState(null, '', window.location.pathname)
    api.googleExchange(handoff).then(next => { setAuth(next); setVerified(true); setError('') }).catch(cause => setError(cause instanceof Error ? cause.message : 'Неуспешно свързване с Google.'))
  }, [token])
  useEffect(() => {
    if (!token) return
    let alive = true
    async function verify() {
      try {
        const user = await api.me(token!)
        if (alive) { setAuth(current => current?.token === token ? { token: token!, user } : current); setVerified(true); setError('') }
      } catch (cause) { if (alive) setError(cause instanceof Error ? cause.message : 'Връзката е прекъсната.') }
    }
    const expired = (event: Event) => {
      if ((event as CustomEvent).detail === token) { setAuth(null); setVerified(false); localStorage.removeItem('quicktest.auth') }
    }
    window.addEventListener('quicktest:session-expired', expired)
    window.addEventListener('focus', verify)
    const timer = window.setInterval(verify, 30000)
    void verify()
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', verify); window.removeEventListener('quicktest:session-expired', expired) }
  }, [token])
  useEffect(() => { if (auth) localStorage.setItem('quicktest.auth', JSON.stringify(auth)) }, [auth])
  function signedIn(next: AuthResponse) { setAuth(next); setVerified(true) }
  async function logout() {
    if (token) { try { await api.logout(token) } catch { /* Clear local credentials even when disconnected. */ } }
    localStorage.removeItem('quicktest.auth'); setAuth(null); setVerified(false)
  }
  async function refreshProfile() { if (token) setAuth({ token, user: await api.me(token) }) }
  if (!auth) return <AuthPanel onAuth={signedIn} />
  if (!verified) return <main className="app-shell"><p role="status">{error || 'Проверка на сесията...'}</p><button onClick={() => void logout()}>Изход</button></main>
  return <>{error && <p className="error" role="alert">{error}</p>}<ExamWorkspace key={auth.token} auth={auth} onAuth={signedIn} logout={logout} refreshProfile={refreshProfile} /></>
}
export default App
