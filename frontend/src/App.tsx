import { useEffect, useState } from 'react'
import './App.css'
import { api } from './api/client'
import { AuthPanel } from './components/AuthPanel'
import { RoleSelectionPanel } from './components/RoleSelectionPanel'
import { ExamWorkspace } from './workspace/ExamWorkspace'
import type { AuthResponse } from './types/models'

function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(() => {
    try { return JSON.parse(localStorage.getItem('quicktest.auth') ?? 'null') } catch { return null }
  })
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')
  const [googleError, setGoogleError] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('google_error') ?? '')
  const [googlePending, setGooglePending] = useState(() => Boolean(new URLSearchParams(window.location.hash.slice(1)).get('google_handoff')))
  const token = auth?.token
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const handoff = fragment.get('google_handoff'), failure = fragment.get('google_error')
    if (!handoff && !failure) return
    const resultReturn = sessionStorage.getItem('examai.resultReturn')
    sessionStorage.removeItem('examai.resultReturn')
    // Clear the one-use handoff before React can run this effect again.
    history.replaceState(null, '', resultReturn && /^\/results\/[1-9][0-9]{0,17}$/.test(resultReturn) ? resultReturn : window.location.pathname + window.location.search)
    if (handoff) {
      void api.googleExchange(handoff).then(next => { setAuth(next); setVerified(true); setError(''); setGoogleError('') })
        .catch(cause => setGoogleError(cause instanceof Error ? cause.message : 'Неуспешен вход с Google.'))
        .finally(() => setGooglePending(false))
    }
  }, [])
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
  function signedIn(next: AuthResponse) { setAuth(next); setVerified(true); setError(''); setGoogleError('') }
  async function logout() {
    if (token) { try { await api.logout(token) } catch { /* Clear local credentials even when disconnected. */ } }
    localStorage.removeItem('quicktest.auth'); setAuth(null); setVerified(false); setGoogleError('')
  }
  async function refreshProfile() { if (token) setAuth({ token, user: await api.me(token) }) }
  if (googlePending) return <main className="app-shell"><p role="status">Влизане с Google...</p></main>
  if (!auth) return <AuthPanel onAuth={signedIn} googleError={googleError} />
  if (!verified) return <main className="app-shell"><p role="status">{error || 'Проверка на сесията...'}</p><button onClick={() => void logout()}>Изход</button></main>
  if (auth.user.roleSelectionRequired) return <RoleSelectionPanel auth={auth} onAuth={signedIn} logout={logout} />
  return <>{(error || googleError) && <p className="error" role="alert">{error || googleError}</p>}<ExamWorkspace key={auth.token} auth={auth} onAuth={signedIn} logout={logout} refreshProfile={refreshProfile} /></>
}
export default App
