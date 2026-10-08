import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../api/client'
import type { AuthResponse } from '../types/models'
import heroImage from '../assets/hero.png'
import { ThemeToggle } from './ThemeToggle'

export function AuthPanel({ onAuth }: { onAuth: (auth: AuthResponse) => void }) {
  const resetToken = new URLSearchParams(window.location.search).get('token')
  const [mode, setMode] = useState<'login' | 'register' | 'recover' | 'reset'>(() => window.location.pathname === '/reset-password' && resetToken ? 'reset' : 'login')
  const [name, setName] = useState('Demo Creator')
  const [role, setRole] = useState<'STUDENT' | 'TEACHER'>('STUDENT')
  const [surname, setSurname] = useState('')
  const [email, setEmail] = useState('demo@quicktest.local')
  const [password, setPassword] = useState('password123')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [google, setGoogle] = useState<{ enabled: boolean; redirect: string } | null>(null)
  useEffect(() => {
    void api.googleConfig().then(setGoogle).catch(() => {})
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const handoff = fragment.get('google_handoff'), failure = fragment.get('google_error')
    if (handoff || failure) window.history.replaceState({}, '', window.location.pathname + window.location.search)
    if (handoff) void api.googleExchange(handoff).then(onAuth).catch(cause => setError(cause.message))
    if (failure) queueMicrotask(() => setError(failure))
  }, [onAuth])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'recover') { await api.recover(email); setMessage('Ако адресът е регистриран, ще получите линк за възстановяване.'); return }
      if (mode === 'reset') { await api.completePasswordRecovery(resetToken!, password); window.history.replaceState({}, '', '/'); setMode('login'); setMessage('Паролата е сменена. Влезте с новата парола.'); return }
      const auth = mode === 'login' ? await api.login(email, password) : await api.register(`${name.trim()} ${surname.trim()}`.trim(), email, password, role)
      onAuth(auth)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-layout">
      <div className="auth-theme-bar"><ThemeToggle /></div>
      <section className="auth-copy">
        <img src={heroImage} alt="" className="auth-image" />
        <h1>ExamAI</h1>
      </section>
      <form className="panel auth-panel" onSubmit={submit}>
        <div className="segmented">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Вход</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Регистрация</button>
        </div>
        {mode === 'register' && <><label>Име<input required maxLength={60} autoComplete="given-name" value={name} onChange={(event) => setName(event.target.value)} /></label><label>Фамилия<input required maxLength={59} autoComplete="family-name" value={surname} onChange={e => setSurname(e.target.value)} /></label></>}
        {mode === 'register' && <label>Роля<select aria-label="Роля" value={role} onChange={event => setRole(event.target.value as 'STUDENT' | 'TEACHER')}><option value="STUDENT">Ученик / студент</option><option value="TEACHER">Учител</option></select></label>}
        {mode !== 'reset' && <label>Имейл<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
        {mode !== 'recover' && <label>Парола<input type="password" required minLength={mode === 'register' || mode === 'reset' ? 8 : 1} maxLength={72} autoComplete={mode === 'register' || mode === 'reset' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
        {error && <p className="error">{error}</p>}
        {message && <p role="status">{message}</p>}
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Изчакване...' : mode === 'login' ? 'Влез' : mode === 'recover' ? 'Изпрати линк' : mode === 'reset' ? 'Смени паролата' : 'Създай профил'}</button>
        {mode === 'login' && <><button type="button" disabled={busy || !google?.enabled} onClick={() => { if (google) window.location.assign(google.redirect) }}>Влез с Google{google && !google.enabled ? ' (не е конфигуриран)' : ''}</button><button type="button" onClick={() => setMode('recover')}>Забравена парола</button></>}
      </form>
    </main>
  )
}
