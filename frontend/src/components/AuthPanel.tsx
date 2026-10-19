import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { api } from '../api/client'
import type { AuthResponse } from '../types/models'
import googleLogo from '../assets/google-g.png'
import { AuthLayout } from './AuthLayout'

export function AuthPanel({ onAuth, googleError = '', clearGoogleError }: { onAuth: (auth: AuthResponse) => void; googleError?: string; clearGoogleError: () => void }) {
  const resetToken = new URLSearchParams(window.location.search).get('token')
  const [mode, setMode] = useState<'login' | 'register' | 'recover' | 'reset'>(() => window.location.pathname === '/reset-password' && resetToken ? 'reset' : 'login')
  const [name, setName] = useState('')
  const [surname, setSurname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [google, setGoogle] = useState<{ enabled: boolean; redirect: string } | null>(null)
  useEffect(() => {
    void api.googleConfig().then(setGoogle).catch(() => {})
  }, [])

  function googleSignIn() {
    if (!google?.enabled) return
    clearGoogleError()
    setError('')
    setBusy(true)
    try {
      const target = new URL(google.redirect)
      if (/^\/results\/[1-9][0-9]{0,17}$/.test(window.location.pathname)) sessionStorage.setItem('examai.resultReturn', window.location.pathname)
      else sessionStorage.removeItem('examai.resultReturn')
      window.location.assign(target.href)
    } catch {
      setError('Неуспешно свързване с Google. Опитайте отново.')
      setBusy(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    clearGoogleError()
    setError('')
    setBusy(true)
    try {
      if (mode === 'recover') { await api.recover(email); setMessage('Ако адресът е регистриран, ще получите линк за възстановяване.'); return }
      if (mode === 'reset') { await api.completePasswordRecovery(resetToken!, password); window.history.replaceState({}, '', '/'); setMode('login'); setMessage('Паролата е сменена. Влезте с новата парола.'); return }
      const auth = mode === 'login' ? await api.login(email, password) : await api.register(`${name.trim()} ${surname.trim()}`.trim(), email, password)
      onAuth(auth)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form className="auth-panel" onSubmit={submit}>
        <header className="auth-heading"><h2>{mode === 'login' ? 'Добре дошли' : mode === 'register' ? 'Създайте профил' : mode === 'recover' ? 'Възстановяване на достъпа' : 'Нова парола'}</h2></header>
        <div className="segmented">
          <button type="button" aria-pressed={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); setMessage('') }}>Вход</button>
          <button type="button" aria-pressed={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); setMessage('') }}>Регистрация</button>
        </div>
        {(mode === 'login' || mode === 'register') && <>
          <button className="google-auth-button" type="button" disabled={busy || !google?.enabled} title={google?.enabled ? undefined : 'Google входът не е конфигуриран.'} onClick={googleSignIn}><img src={googleLogo} width={20} height={20} alt="" /><span>{mode === 'register' ? 'Регистрация с Google' : 'Влез с Google'}</span></button>
          <div className="auth-divider" aria-hidden="true">или с имейл</div>
        </>}
        <div className="auth-fields">
          {mode === 'register' && <div className="auth-name-fields"><label>Име<input required maxLength={60} autoComplete="given-name" value={name} onChange={(event) => setName(event.target.value)} /></label><label>Фамилия<input required maxLength={59} autoComplete="family-name" value={surname} onChange={e => setSurname(e.target.value)} /></label></div>}
          {mode !== 'reset' && <label>Имейл<input type="email" required placeholder="you@example.com" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
          {mode !== 'recover' && <div className="auth-field"><label htmlFor="auth-password">Парола</label><div className="auth-password">
            <input id="auth-password" type={showPassword ? 'text' : 'password'} required minLength={mode === 'register' || mode === 'reset' ? 8 : 1} maxLength={72} autoComplete={mode === 'register' || mode === 'reset' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} />
            <button type="button" aria-label={showPassword ? 'Скрий паролата' : 'Покажи паролата'} title={showPassword ? 'Скрий паролата' : 'Покажи паролата'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </div></div>}
        </div>
        {(error || googleError) && <p className="error" role="alert">{error || googleError}</p>}
        {message && <p className="auth-message" role="status">{message}</p>}
        <button className="primary" type="submit" disabled={busy}>{busy ? <LoaderCircle size={18} className="auth-spinner" /> : null}<span>{busy ? 'Изчакване...' : mode === 'login' ? 'Влез' : mode === 'recover' ? 'Изпрати линк' : mode === 'reset' ? 'Смени паролата' : 'Създай профил'}</span>{!busy && <ArrowRight size={18} />}</button>
        {mode === 'login' && <button className="auth-text-button" type="button" onClick={() => { setMode('recover'); setError(''); setMessage(''); clearGoogleError() }}>Забравена парола</button>}
        {(mode === 'recover' || mode === 'reset') && <button className="auth-text-button" type="button" onClick={() => { setMode('login'); setError(''); setMessage('') }}>Обратно към входа</button>}
      </form>
    </AuthLayout>
  )
}
