import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../api/client'
import type { AuthResponse } from '../types/models'

export function AuthPanel({ onAuth }: { onAuth: (auth: AuthResponse) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('Demo Creator')
  const [email, setEmail] = useState('demo@quicktest.local')
  const [password, setPassword] = useState('password123')
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      const auth = mode === 'login' ? await api.login(email, password) : await api.register(name, email, password)
      onAuth(auth)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-copy">
        <span className="eyebrow">QuickTest MVP</span>
        <h1>Създай, публикувай и оцени тест за минути.</h1>
        <p>Spring Boot backend, React frontend, AI-assisted draft generation and public participant flow.</p>
      </section>
      <form className="panel auth-panel" onSubmit={submit}>
        <div className="segmented">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Вход</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Регистрация</button>
        </div>
        {mode === 'register' && <label>Име<input value={name} onChange={(event) => setName(event.target.value)} /></label>}
        <label>Имейл<input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Парола<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">{mode === 'login' ? 'Влез' : 'Създай профил'}</button>
      </form>
    </main>
  )
}
