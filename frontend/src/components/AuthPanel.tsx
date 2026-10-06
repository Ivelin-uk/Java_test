import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../api/client'
import type { AuthResponse } from '../types/models'
import heroImage from '../assets/hero.png'

export function AuthPanel({ onAuth }: { onAuth: (auth: AuthResponse) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('Demo Creator')
  const [email, setEmail] = useState('demo@quicktest.local')
  const [password, setPassword] = useState('password123')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const auth = mode === 'login' ? await api.login(email, password) : await api.register(name, email, password)
      onAuth(auth)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-copy">
        <img src={heroImage} alt="" className="auth-image" />
        <h1>QuickTest</h1>
      </section>
      <form className="panel auth-panel" onSubmit={submit}>
        <div className="segmented">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Вход</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Регистрация</button>
        </div>
        {mode === 'register' && <label>Име<input required maxLength={120} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>}
        <label>Имейл<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Парола<input type="password" required minLength={mode === 'register' ? 8 : 1} maxLength={72} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Изчакване...' : mode === 'login' ? 'Влез' : 'Създай профил'}</button>
      </form>
    </main>
  )
}
