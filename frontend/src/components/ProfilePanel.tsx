import { useState } from 'react'
import type { FormEvent } from 'react'
import { KeyRound, CheckCircle2 } from 'lucide-react'
import { api } from '../api/client'
import { roleLabels, formatDate, subscriptionLabel } from '../api/access'
import type { AuthResponse } from '../types/models'

export function ProfilePanel({ auth, onAuth }: { auth: AuthResponse; onAuth: (auth: AuthResponse) => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (password !== confirmation) { setError('Паролите не съвпадат.'); return }
    setBusy(true)
    try {
      onAuth(await api.changePassword(auth.token, currentPassword, password))
      setCurrentPassword(''); setPassword(''); setConfirmation(''); setSuccess(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Неуспешна смяна на парола.') }
    finally { setBusy(false) }
  }

  return <section className="profile-layout">
    {!auth.user.passwordChangeRequired && <div>
      <h2>Данни за профила</h2>
      <dl className="profile-details">
        <dt>Име</dt><dd>{auth.user.name}</dd>
        <dt>Имейл</dt><dd>{auth.user.email}</dd>
        <dt>Роля</dt><dd>{roleLabels[auth.user.role]}</dd>
        <dt>Статус</dt><dd>Активен</dd>
        <dt>Абонамент</dt><dd className={auth.user.subscription.active ? 'good' : ''}>{subscriptionLabel(auth.user)}</dd>
        <dt>Валиден до</dt><dd>{formatDate(auth.user.subscription.paidUntil)}</dd>
        <dt>Плащане</dt><dd>{auth.user.subscription.paidAt ? new Date(auth.user.subscription.paidAt).toLocaleString('bg-BG') : 'Не е отчетено'}</dd>
      </dl>
    </div>}
    <form className="password-form" onSubmit={submit}>
      <h2>{auth.user.passwordChangeRequired ? 'Сменете временната парола' : 'Смяна на парола'}</h2>
      <label>{auth.user.passwordChangeRequired ? 'Временна парола' : 'Текуща парола'}<input type="password" required autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
      <label>Нова парола<input type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label>Повторете новата парола<input type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      {success && <p className="good command-button" role="status"><CheckCircle2 size={17} /> Паролата е сменена.</p>}
      <button className="primary command-button" disabled={busy}><KeyRound size={17} /> {busy ? 'Запазване...' : 'Смени паролата'}</button>
    </form>
  </section>
}
