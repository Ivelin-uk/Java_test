import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, CreditCard, KeyRound, Link, Mail, Send } from 'lucide-react'
import type { AuthResponse } from '../types/models'
import { api as authApi } from '../api/client'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import { Feedback, SectionHead } from './ui'
import type { TeacherBilling } from './billingTypes'

export function WorkspaceProfile({ api, auth, onAuth, onChangePlan }: { api: WorkspaceApi; auth: AuthResponse; onAuth: (next: AuthResponse) => void; onChangePlan: () => void }) {
  const address = useRemote<{ email: string; verified_at: string | null } | null>(api, '/profile/notification-email', null)
  const google = useRemote<{ enabled: boolean; redirect?: string }>(api, '/api/auth/google/config', { enabled: false })
  const identities = useRemote<{ provider: string; linked_at: string }[]>(api, '/profile/identities', [])
  const googleAction = useAction()
  const linking = useRef(false)
  const [googlePassword, setGooglePassword] = useState('')
  const googleLinked = identities.data.some(identity => identity.provider === 'google')
  const emailAction = useAction()
  const [email, setEmail] = useState<string | null>(null)
  const [emailPassword, setEmailPassword] = useState('')
  const action = useAction()
  const busy = action.busy || emailAction.busy || googleAction.busy
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [formError, setFormError] = useState('')
  const [billing, setBilling] = useState<TeacherBilling | null>(null)
  const [billingLoading, setBillingLoading] = useState(auth.user.role === 'TEACHER')
  const [billingError, setBillingError] = useState('')
  useEffect(() => {
    if (auth.user.role !== 'TEACHER') return
    let active = true
    api.get<TeacherBilling>('/billing')
      .then(value => { if (active) { setBilling(value); setBillingError('') } })
      .catch(cause => { if (active) setBillingError(cause instanceof Error ? cause.message : 'Планът не може да се зареди.') })
      .finally(() => { if (active) setBillingLoading(false) })
    return () => { active = false }
  }, [api, auth.user.role])
  const currentPeriod = billing?.currentPeriod ?? null
  const currentPrice = billing && currentPeriod ? billing.prices[currentPeriod] : null
  const priceText = currentPrice?.amountMinor !== undefined && currentPrice.currency
    ? new Intl.NumberFormat('bg-BG', { style: 'currency', currency: currentPrice.currency.toUpperCase() }).format(currentPrice.amountMinor / 100)
    : ''
  return <section className="ws-section" aria-label="Моят профил">
    <SectionHead title="Моят профил" description="Управлявай имейла за известия, паролата и свързания Google акаунт." />
    {auth.user.role === 'TEACHER' && <section className="ws-profile-form" aria-label="План и плащане">
      <h3><CreditCard size={17} aria-hidden="true" /> План и плащане</h3>
      <Feedback error={billingError} busy={billingLoading} />
      {billing && <>
        <p><strong>Избран план:</strong> ExamAI {billing.plan === 'pro' ? 'Pro' : 'Free'}{billing.cancelAtPeriodEnd ? ' — прекратява се в края на периода' : ''}</p>
        <p><strong>Период:</strong> {currentPeriod ? `${currentPeriod === 'month' ? 'Месечен' : 'Годишен'}${priceText ? ` — ${priceText} / ${currentPeriod === 'month' ? 'месец' : 'година'}` : ''}` : 'Безплатен план'}</p>
        <p><strong>Валиден до:</strong> {billing.paidThrough ? new Date(billing.paidThrough).toLocaleDateString('bg-BG') : 'Няма активен платен период'}</p>
      </>}
      <button type="button" className="primary command-button" onClick={onChangePlan}><CreditCard size={17} aria-hidden="true" />Планове и плащане</button>
    </section>}
    <div className="ws-profile-settings">
    <form className="ws-profile-form" aria-label="Смяна на имейл за известия" onSubmit={event => {
      event.preventDefault()
      if (busy || !event.currentTarget.reportValidity()) return
      void emailAction.run(async () => {
        await api.post('/profile/notification-email', { email: (email ?? address.data?.email ?? auth.user.email).trim(), password: emailPassword })
        setEmailPassword('')
      }, 'Изпратено е потвърждение до новия адрес.')
    }}>
      <h3><Mail size={17} aria-hidden="true" /> Имейл за известия</h3>
      {address.data && <p className="ws-muted">{address.data.email} · {address.data.verified_at ? 'Потвърден' : 'Непотвърден'}</p>}
      <fieldset className="ws-editor" disabled={busy}>
        <label>Нов адрес<input type="email" required maxLength={190} autoComplete="email" value={email ?? address.data?.email ?? auth.user.email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Текуща парола<input type="password" required autoComplete="current-password" value={emailPassword} onChange={event => setEmailPassword(event.target.value)} /></label>
        <button type="submit" className="primary command-button" disabled={busy || address.loading}><Send size={17} aria-hidden="true" /> Потвърди адреса</button>
      </fieldset>
      <Feedback error={emailAction.error || address.error} busy={emailAction.busy || address.loading} />
    </form>
    <form className="ws-profile-form" aria-label="Смяна на парола" onChange={() => setFormError('')} onSubmit={event => {
      event.preventDefault()
      if (busy || !event.currentTarget.reportValidity()) return
      if (newPassword !== confirmation) { setFormError('Паролите не съвпадат.'); return }
      setFormError('')
      void action.run(async () => {
        const next = await authApi.changePassword(auth.token, password, newPassword)
        setPassword(''); setNewPassword(''); setConfirmation('')
        onAuth(next)
      }, 'Паролата е сменена.')
    }}>
      <h3><KeyRound size={17} aria-hidden="true" /> Смяна на парола</h3>
      <fieldset className="ws-editor" disabled={busy}>
        <label>Текуща парола<input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label>Нова парола<input type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label>
        <label>Повторете новата парола<input type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        <button type="submit" className="primary command-button" title="Смени паролата и прекрати старите сесии" disabled={busy}><KeyRound size={17} aria-hidden="true" /> Смени паролата</button>
      </fieldset>
      <Feedback error={formError || action.error} busy={action.busy} />
    </form>
    <section className="ws-profile-form" aria-label="Вход с Google">
      <h3><Link size={17} aria-hidden="true" /> Вход с Google</h3>
      <Feedback error={identities.error || google.error || googleAction.error} busy={identities.loading || google.loading || googleAction.busy} />
      {googleLinked ? <p className="good" role="status">Google е свързан с профила ви. Можете да влизате с „Влез с Google“.</p> : !identities.loading && !google.loading && !identities.error && !google.error && (google.data.enabled ? <form className="ws-editor" aria-label="Свързване с Google" onSubmit={event => {
        event.preventDefault()
        if (busy || linking.current || !event.currentTarget.reportValidity()) return
        linking.current = true
        void googleAction.run(async () => {
          const result = await api.post<{ url: string }>('/profile/google/link', { password: googlePassword })
          const target = new URL(result.url), expected = new URL(google.data.redirect!)
          if (target.origin !== expected.origin || target.pathname !== expected.pathname) throw new Error('Невалиден адрес за Google вход.')
          setGooglePassword('')
          sessionStorage.removeItem('examai.resultReturn')
          window.location.assign(target.href)
        }).finally(() => { linking.current = false })
      }}>
        <p className="ws-muted">Потвърдете с паролата си за ExamAI и изберете Google профила, с който искате да влизате. Ако нямате парола за ExamAI, задайте я чрез „Забравена парола“ на екрана за вход.</p>
        <fieldset className="ws-editor" disabled={busy}>
          <label>Парола за ExamAI<input type="password" required maxLength={72} autoComplete="current-password" value={googlePassword} onChange={event => setGooglePassword(event.target.value)} /></label>
          <button type="submit" className="primary command-button" disabled={busy || !googlePassword || !google.data.redirect}><Link size={17} aria-hidden="true" /> Свържи Google</button>
        </fieldset>
      </form> : <p className="ws-muted">Google входът не е конфигуриран.</p>)}
    </section>
    </div>
  </section>
}

export function NotificationEmailVerification({ api, back }: { api: WorkspaceApi; back: () => void }) {
  const action = useAction()
  const [confirmed, setConfirmed] = useState(false)
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  return <section className="ws-section" aria-label="Потвърждение на имейл">
    <SectionHead title="Потвърждение на имейл"><button type="button" className="icon-button" title="Към профила" aria-label="Към профила" disabled={action.busy} onClick={back}><ArrowLeft size={18} /></button></SectionHead>
    <Feedback error={action.error || (!token && !confirmed ? 'Липсва линк за потвърждение на имейла.' : '')} busy={action.busy} />
    {!confirmed && token && <div className="ws-actions"><button type="button" className="primary command-button" disabled={action.busy} onClick={() => void action.run(async () => {
      await api.post('/profile/notification-email/verify', { token })
      setConfirmed(true)
      history.replaceState(history.state, '', window.location.pathname)
    }, 'Имейлът е потвърден.')}><Check size={17} /> Потвърди имейла</button></div>}
  </section>
}
