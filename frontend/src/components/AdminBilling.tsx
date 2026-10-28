import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Pencil, RefreshCw, Save, Search, X } from 'lucide-react'
import { api } from '../api/client'
import { useNotifications } from '../notifications'
import { TableContainer } from '../workspace/ui'
import type { AdminTeacherPlan, TeacherPayment } from '../workspace/billingTypes'
import type { User } from '../types/models'

type Plan = 'auto' | 'free' | 'pro'
type Edit = { user: User; action: 'plan' | 'reset'; plan: Plan; period: string; key: string }
const currentMonth = () => new Date().toISOString().slice(0, 7)
const money = (amount: number, currency: string) => new Intl.NumberFormat('bg-BG', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100)

export function AdminBilling({ users, plans, token, busy, loading, onBusy, onChanged }: {
  users: User[]; plans: AdminTeacherPlan[]; token: string; busy: boolean; loading: boolean
  onBusy: (value: boolean) => void; onChanged: (plan: AdminTeacherPlan) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subscription, setSubscription] = useState<'all' | 'pro' | 'free'>('all')
  const [month, setMonth] = useState(currentMonth)
  const [payments, setPayments] = useState<TeacherPayment[]>([])
  const [paymentError, setPaymentError] = useState('')
  const [editing, setEditing] = useState<Edit | null>(null)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const notify = useNotifications()
  const filtered = users.filter(user => {
    const plan = plans.find(item => item.userId === user.id)
    return user.role === 'TEACHER'
      && user.name.toLocaleLowerCase().includes(name.trim().toLocaleLowerCase())
      && user.email.toLowerCase().includes(email.trim().toLowerCase())
      && (subscription === 'all' || plan?.plan === subscription)
  })
  const filteredIds = new Set(filtered.map(user => user.id))
  const filteredPayments = payments.filter(payment => filteredIds.has(payment.userId))
  const dialogOpen = editing !== null

  useEffect(() => {
    let active = true
    api.teacherPayments(token, month).then(rows => {
      if (active) { setPayments(rows); setPaymentError('') }
    }).catch(cause => {
      if (active) setPaymentError(cause instanceof Error ? cause.message : 'Историята на плащанията не се зареди.')
    })
    return () => { active = false }
  }, [token, month])

  useEffect(() => {
    if (!dialogOpen) return
    const element = dialog.current
    element?.showModal()
    element?.querySelector<HTMLElement>('[data-initial-focus]')?.focus()
    return () => element?.close()
  }, [dialogOpen])

  function open(user: User, action: Edit['action'] = 'reset') {
    setError('')
    const plan = plans.find(item => item.userId === user.id)
    setEditing({ user, action, plan: plan?.manualPlan ?? 'auto', period: plan?.plan === 'pro' ? currentMonth() : 'trial', key: crypto.randomUUID() })
  }
  function close() { if (!inFlight.current) { setEditing(null); setError('') } }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!editing || inFlight.current) return
    inFlight.current = true; onBusy(true); setError('')
    try {
      const result = editing.action === 'plan' ? await api.changeTeacherPlan(token, editing.user.id, editing.plan, editing.key) : await api.resetTeacherAi(token, editing.user.id, editing.period, editing.key)
      onChanged(result)
      notify(editing.action === 'plan' ? 'Планът е обновен.' : `AI кредитите за ${editing.period === 'trial' ? 'пробния период' : editing.period} са нулирани. Запазени са текущите задачи и историята.`)
      setEditing(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Промяната не е записана. Опитай отново.') }
    finally { inFlight.current = false; onBusy(false) }
  }
  const selected = plans.find(plan => plan.userId === editing?.user.id)

  return <>
    <p className="muted">Използвани ресурси, лимити и плащания за всеки учител. Можеш да възстановиш AI кредитите за избран период или да зададеш Free/Pro достъп.</p>
    <div className="filter-bar">
      <label className="search-field"><Search size={17} aria-hidden="true" /><input aria-label="Филтър по име" placeholder="Търси по име" value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="search-field"><Search size={17} aria-hidden="true" /><input aria-label="Филтър по имейл" placeholder="Търси по имейл" value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Абонамент<select aria-label="Филтър по абонамент" value={subscription} onChange={event => setSubscription(event.target.value as typeof subscription)}><option value="all">Всички планове</option><option value="pro">Pro</option><option value="free">Free</option></select></label>
      {(name || email || subscription !== 'all') && <button type="button" onClick={() => { setName(''); setEmail(''); setSubscription('all') }}>Изчисти филтрите</button>}
    </div>
    <TableContainer label="Абонаменти на учителите — таблица"><table className="ws-table data-table admin-billing-table" aria-label="Абонаменти на учителите"><thead><tr><th>Учител</th><th>План</th><th>Групи</th><th>Активни възлагания</th><th>AI кредити</th><th>Плащане в Stripe</th><th>Действия</th></tr></thead><tbody>
      {filtered.map(user => {
        const plan = plans.find(item => item.userId === user.id)
        const period = plan?.period === 'month' ? 'Месечен' : plan?.period === 'year' ? 'Годишен' : null
        const price = plan?.amountMinor != null && plan.currency ? money(plan.amountMinor, plan.currency) : null
        return <tr key={user.id}><td><div><strong>{user.name}</strong><small>{user.email}</small></div></td>
          <td><div><strong className={plan?.plan === 'pro' ? 'good' : ''}>{plan?.plan === 'pro' ? 'Pro' : 'Free'}</strong><small>{plan?.manualPlan ? 'Зададен от администратор' : 'Автоматичен'}</small></div></td>
          <td>{plan?.usage && plan.limits ? `${plan.usage.groups} / ${plan.limits.groups}` : '—'}</td>
          <td>{plan?.usage && plan.limits ? `${plan.usage.activeAssignments} / ${plan.limits.activeAssignments}` : '—'}</td>
          <td>{plan?.usage && plan.limits ? <div><strong>{plan.usage.aiCredits} / {plan.limits.aiCredits}</strong><small>{plan.plan === 'pro' ? 'Този календарен месец' : 'Пробни, общо за профила'}</small>{!!plan.reservedAiCredits && <small>{plan.reservedAiCredits} в текущи задачи</small>}</div> : '—'}</td>
          <td><div><span>{period ? `${period}${price ? ` — ${price} / ${plan?.period === 'month' ? 'месец' : 'година'}` : ''}` : 'Без абонамент'}</span><small>{plan?.cancelAtPeriodEnd ? 'Прекратява се в края на периода' : plan?.status === 'free' || !plan?.status ? '—' : plan.status}</small>{plan?.paidThrough && <small>Платен до {new Date(plan.paidThrough).toLocaleDateString('bg-BG')}</small>}</div></td>
          <td><div className="admin-billing-actions"><button className="command-button" aria-label={`Смени плана на ${user.email}`} disabled={busy || !plan} onClick={() => open(user, 'plan')}><Pencil size={16} />Смени плана</button><button className="command-button" aria-label={`Нулирай AI кредитите на ${user.email}`} disabled={busy || !plan} onClick={() => open(user)}><RefreshCw size={16} />Нулирай AI</button></div></td>
        </tr>
      })}
      {!loading && !filtered.length && <tr><td colSpan={7} className="empty-cell">Няма учители според текущите филтри.</td></tr>}
    </tbody></table></TableContainer>
    <p className="muted admin-billing-note">Нулирането възстановява използваните AI кредити на избрания учител и период. Групите, възлаганията, текущите AI задачи и историята се запазват.</p>

    <div className="filter-bar"><h3>История на плащанията</h3><label>Месец на плащането<input aria-label="Месец на плащането" type="month" value={month} onChange={event => setMonth(event.target.value)} /></label></div>
    {paymentError && <p className="error" role="alert">{paymentError}</p>}
    <TableContainer label="История на плащанията — таблица"><table className="ws-table data-table" aria-label="История на плащанията"><thead><tr><th>Дата</th><th>Учител</th><th>Статус</th><th>Сума</th><th>Период на абонамента</th><th>Фактура</th></tr></thead><tbody>
      {filteredPayments.map(payment => {
        const user = users.find(item => item.id === payment.userId)
        return <tr key={payment.invoiceId}><td>{new Date(payment.paymentAt).toLocaleString('bg-BG')}</td><td><div>{user?.name ?? `Профил ${payment.userId}`}<small>{user?.email}</small></div></td><td>{payment.status === 'paid' ? 'Платено' : 'Неуспешно'}</td><td>{money(payment.status === 'paid' ? payment.amountPaid : payment.amountDue, payment.currency)}</td><td>{payment.periodStart && payment.periodEnd ? `${new Date(payment.periodStart).toLocaleDateString('bg-BG')} – ${new Date(payment.periodEnd).toLocaleDateString('bg-BG')}` : '—'}</td><td>{payment.invoiceId}</td></tr>
      })}
      {!paymentError && !filteredPayments.length && <tr><td colSpan={6} className="empty-cell">{month ? 'Няма записани плащания за този месец.' : 'Няма записани плащания.'}</td></tr>}
    </tbody></table></TableContainer>

    {editing && <dialog ref={dialog} className="delete-dialog admin-dialog" aria-label={editing.action === 'plan' ? 'Смяна на план' : 'Нулиране на AI кредити'} onCancel={event => { event.preventDefault(); close() }}>
      <div className="dialog-heading"><h2>{editing.action === 'plan' ? 'Смяна на план' : 'Нулиране на AI кредити'}</h2><button className="icon-button" type="button" aria-label="Затвори" disabled={busy} onClick={close}><X size={20} /></button></div>
      <form className="user-form" onSubmit={save}>
        <p><strong>{editing.user.name}</strong><br />{editing.user.email}</p>
        {editing.action === 'plan' ? <><label>Нов план<select data-initial-focus aria-label="Нов план" disabled={busy} value={editing.plan} onChange={event => setEditing({ ...editing, plan: event.target.value as Plan, key: crypto.randomUUID() })}><option value="auto">Автоматичен — според Stripe</option><option value="free">Free — административен достъп</option><option value="pro">Pro — административен достъп</option></select></label><p className="muted">Free/Pro се прилага веднага до следваща административна промяна. „Автоматичен“ възстановява плана според плащанията в Stripe.</p><p className="warning-text">Това променя достъпа в приложението. Съществуващият Stripe абонамент продължава да се таксува, докато подновяването не бъде спряно от профила на учителя.</p></> : <>
        <label>Период<select data-initial-focus aria-label="Период за нулиране на AI кредити" disabled={busy} value={editing.period === 'trial' ? 'trial' : 'month'} onChange={event => setEditing({ ...editing, period: event.target.value === 'trial' ? 'trial' : currentMonth(), key: crypto.randomUUID() })}><option value="month">Календарен месец</option><option value="trial">Пробен период</option></select></label>
        {editing.period !== 'trial' && <label>Месец<input type="month" required disabled={busy} value={editing.period} onChange={event => setEditing({ ...editing, period: event.target.value, key: crypto.randomUUID() })} />{editing.period === currentMonth() && !!selected?.reservedAiCredits && <small>{selected.reservedAiCredits} текущи AI операции няма да бъдат променени.</small>}</label>}
        <p>Да възстановим ли използваните кредити за избрания период? Историята на AI операциите се запазва.</p></>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" disabled={busy} onClick={close}>Отказ</button><button data-initial-focus type="submit" className="primary command-button" disabled={busy || (editing.action === 'plan' ? editing.plan === (selected?.manualPlan ?? 'auto') : editing.period !== 'trial' && !editing.period)}><Save size={17} />{busy ? 'Запазване…' : editing.action === 'plan' ? 'Запази плана' : 'Нулирай кредитите'}</button></div>
      </form>
    </dialog>}
  </>
}
