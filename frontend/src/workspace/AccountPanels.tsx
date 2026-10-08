import { useState } from 'react'
import { Shield, Mail, Check, KeyRound, Send } from 'lucide-react'
import type { AuthResponse } from '../types/models'
import { api as authApi } from '../api/client'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import type { Mail as MailItem } from './types'
import { date, label } from './types'
import { Feedback, SectionHead } from './ui'

export function WorkspaceProfile({ api, auth, onAuth }: { api: WorkspaceApi; auth: AuthResponse; onAuth: (next: AuthResponse) => void }) {
  const address = useRemote<{ email: string; verified_at: string | null } | null>(api, '/profile/notification-email', null)
  const mailbox = useRemote<MailItem[]>(api, '/profile/mailbox', [])
  const action = useAction()
  const [email, setEmail] = useState(auth.user.email)
  const google = useRemote<{ enabled: boolean } | null>(api, '/api/auth/google/config', null)
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [verification, setVerification] = useState(() => window.location.pathname.startsWith('/verify-email') ? new URLSearchParams(window.location.search).get('token') ?? '' : '')
  const identities = useRemote<{ provider: string; linked_at: string }[]>(api, '/profile/identities', [])
  return <section className="ws-section"><SectionHead title="Моят профил" /><Feedback error={action.error || address.error} message={action.message} busy={action.busy} /><h3><Mail size={17} /> Имейл за известия</h3>{address.data && <p>{address.data.email} · {address.data.verified_at ? 'Потвърден' : 'Непотвърден'}</p>}
    <form className="ws-inline-form" onSubmit={e => { e.preventDefault(); void action.run(async () => { await api.post('/profile/notification-email', { email, password }); await mailbox.reload() }, 'Изпратено е потвърждение до новия адрес.') }}><label>Нов адрес<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Текуща парола<input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><button disabled={action.busy}><Send size={17} /> Потвърди адреса</button></form>
    {verification && <button onClick={() => void action.run(async () => { await api.post('/profile/notification-email/verify', { token: verification }); await address.reload(); setVerification(''); history.replaceState(null, '', '/') }, 'Имейлът е потвърден.')}><Check size={17} /> Потвърди адреса от линка</button>}
    <h3><KeyRound size={17} /> Нова парола</h3><form className="ws-inline-form" onSubmit={e => { e.preventDefault(); void action.run(async () => { const next = await authApi.changePassword(auth.token, password, newPassword); setPassword(''); setNewPassword(''); onAuth(next) }) }}><label>Текуща парола<input type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label><label>Нова парола<input type="password" required minLength={8} maxLength={72} value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label><button disabled={action.busy}><KeyRound size={17} /> Смени и прекрати старите сесии</button></form>
    <button onClick={() => void action.run(async () => { await authApi.logoutAll(auth.token); window.dispatchEvent(new CustomEvent('quicktest:session-expired', { detail: auth.token })) })}><Shield size={17} /> Изход от всички сесии</button><h3>Свързан Google профил</h3>{identities.data.map(i => <p key={i.provider}>{i.provider} · {date(i.linked_at)}</p>)}<form className="ws-inline-form" onSubmit={e => { e.preventDefault(); void action.run(async () => { const result = await api.post<{ url: string }>('/profile/google/link', { password }); window.location.assign(result.url) }) }}><label>Парола за повторно удостоверяване<input type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label><button disabled={action.busy || !google.data?.enabled}>Свържи Google акаунт{google.data && !google.data.enabled ? ' (не е конфигуриран)' : ''}</button></form>
    {!mailbox.error && <><h3><Shield size={17} /> Локална тестова пощенска кутия</h3><div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Дата</th><th>До</th><th>Вид</th><th>Статус</th><th>Действие</th></tr></thead><tbody>{mailbox.data.map(item => { const payload = JSON.parse(item.payload_json) as { token?: string; test?: string; grade?: string; outcome?: string }; return <tr key={item.id}><td>{date(item.created_at)}</td><td>{item.recipient_email}</td><td>{item.notification_type === 'notification_email' ? 'Потвърждение' : item.notification_type === 'final_result' ? `${payload.test} · оценка ${payload.grade}` : item.notification_type}</td><td>{label(item.status)}</td><td>{item.notification_type === 'notification_email' && payload.token && <button title="Потвърди имейла" className="command-button" onClick={() => void action.run(async () => { await api.post('/profile/notification-email/verify', { token: payload.token }); await address.reload() }, 'Имейлът е потвърден.')}><Check size={16} /> Потвърди</button>}</td></tr> })}</tbody></table></div></>}
  </section>
}
