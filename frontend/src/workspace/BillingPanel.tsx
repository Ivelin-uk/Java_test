import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, CircleCheck, CircleStop, Clock3, CreditCard, FlaskConical, LoaderCircle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog'
import type { WorkspaceApi } from './api'
import { Feedback, SectionHead } from './ui'
import type { TeacherBilling } from './billingTypes'
import { BillingPlanFeatures, BillingUsage } from './BillingPlanDetails'
import { billingStatusLabels as statusLabels, formattedDate, formattedPrice } from './billingPresentation'
import './billing.css'

type Billing = TeacherBilling
const period = 'month'

function stripeRedirect(value: string, destination: 'checkout' | 'portal') {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Не може да се отвори защитената страница за плащане. Опитай отново.') }
  const host = destination === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com'
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password) {
    throw new Error('Не може да се отвори защитената страница за плащане. Опитай отново.')
  }
  window.location.assign(url.href)
}

export function BillingPanel({ api, checkout }: { api: WorkspaceApi; checkout: string | null }) {
  const [billing, setBilling] = useState<Billing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [confirmation, setConfirmation] = useState<'waiting' | 'delayed' | 'confirmed' | null>(() => checkout === 'success' ? 'waiting' : null)
  const [busy, setBusy] = useState<'checkout' | 'portal' | 'cancel' | null>(null)
  const [cancelRequested, setCancelRequested] = useState(false)
  const actionInFlight = useRef(false)
  const requestKey = useRef<string | null>(null)

  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) { actionInFlight.current = false; setBusy(null) }
    }
    window.addEventListener('pageshow', restored)
    return () => window.removeEventListener('pageshow', restored)
  }, [])

  useEffect(() => {
    let active = true, inFlight = false, complete = false, attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const confirming = checkout === 'success'
    async function load() {
      if (!active || inFlight) return
      inFlight = true
      attempts++
      let confirmed = false
      try {
        const next = await api.get<Billing>('/billing')
        if (!active) return
        setBilling(next)
        setError('')
        confirmed = next.plan === 'pro'
        complete = confirmed
        if (confirming && confirmed) setConfirmation('confirmed')
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Не може да се зареди абонаментът.')
      } finally {
        inFlight = false
        if (active) {
          setLoading(false)
          if (confirming && !confirmed) {
            if (attempts < 12) timer = setTimeout(poll, 2500)
            else { complete = true; setConfirmation('delayed') }
          }
        }
      }
    }
    function poll() { if (!document.hidden && !complete) void load() }
    function visible() {
      if (!document.hidden && confirming && !complete && attempts < 12) {
        clearTimeout(timer)
        void load()
      }
    }
    void load()
    document.addEventListener('visibilitychange', visible)
    return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [api, checkout, refresh])

  function retry() { setError(''); setLoading(true); setConfirmation(checkout === 'success' ? 'waiting' : null); setRefresh(value => value + 1) }

  async function openStripe(destination: 'checkout' | 'portal') {
    if (!billing || actionInFlight.current) return
    if (destination === 'checkout' && (!billing.checkoutAvailable || !billing.prices[period].available || billing.plan === 'pro' || confirmation === 'waiting')) return
    if (destination === 'portal' && !billing.portalAvailable) return
    actionInFlight.current = true
    setBusy(destination)
    setActionError('')
    try {
      if (destination === 'checkout') {
        requestKey.current ??= crypto.randomUUID()
        const result = await api.post<{ url: string }>('/billing/checkout', { period, requestKey: requestKey.current })
        stripeRedirect(result.url, destination)
      } else {
        const result = await api.post<{ url: string }>('/billing/portal')
        stripeRedirect(result.url, destination)
      }
      // Keep the action locked while the browser leaves this page.
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Не може да се отвори страницата за плащане.')
      actionInFlight.current = false
      setBusy(null)
    }
  }

  async function cancelSubscription() {
    if (actionInFlight.current) throw new Error('Изчакай текущото действие да приключи.')
    actionInFlight.current = true
    setBusy('cancel')
    try {
      const result = await api.post<{ cancelAtPeriodEnd: boolean; paidThrough: string | null }>('/billing/cancel')
      if (!result.cancelAtPeriodEnd) throw new Error('Спирането на подновяването не е потвърдено. Опитай отново.')
      setBilling(current => current ? { ...current, cancelAtPeriodEnd: true, cancellationAvailable: false, paidThrough: result.paidThrough } : current)
    } finally {
      actionInFlight.current = false
      setBusy(null)
    }
  }

  const price = billing?.prices[period]
  const amount = price ? formattedPrice(price) : null
  const currentPeriod = billing?.currentPeriod ?? null
  const currentPrice = billing && currentPeriod ? formattedPrice(billing.prices[currentPeriod]) : null
  const paidThrough = formattedDate(billing?.paidThrough ?? null)
  const pending = confirmation === 'waiting'

  return <section className="ws-section ws-billing-page">
    <SectionHead title="Абонамент" description="Pro с месечно подновяване. Участието на учениците е безплатно.">
      <button type="button" className="command-button" onClick={retry} disabled={loading || !!busy}><RefreshCw size={16} aria-hidden="true" />Обнови</button>
    </SectionHead>
    <Feedback error={error} busy={loading} />
    {!billing && error && <button type="button" className="command-button" onClick={retry} disabled={loading}>Опитай отново</button>}
    {checkout === 'canceled' && <div className="ws-billing-notice" role="status"><Clock3 size={20} aria-hidden="true" /><div><strong>Плащането е прекъснато</strong><p>Можеш да избереш план и да опиташ отново.</p></div></div>}
    {confirmation && <div className={`ws-billing-notice ${confirmation === 'confirmed' ? 'ws-billing-confirmed' : ''}`} role="status">
      {confirmation === 'confirmed' ? <CircleCheck size={21} aria-hidden="true" /> : pending ? <LoaderCircle size={21} className="spin" aria-hidden="true" /> : <Clock3 size={21} aria-hidden="true" />}
      <div><strong>{confirmation === 'confirmed' ? 'Pro е активен' : pending ? 'Изчакваме потвърждение от Stripe' : 'Потвърждението се забавя'}</strong><p>{confirmation === 'confirmed' ? 'Потвърденият абонамент и текущите ти лимити са отразени по-долу.' : pending ? 'Страницата ще се обнови автоматично, когато абонаментът бъде потвърден.' : 'Обнови статуса след малко. Ако плащането е завършено, достъпът ще се активира след потвърждението.'}</p></div>
    </div>}
    {billing && <>
      {billing.mode !== 'live' && <div className="ws-billing-notice ws-billing-test" role="status"><FlaskConical size={21} aria-hidden="true" /><div><strong>{billing.mode === 'test' ? 'Тестов режим на плащанията' : 'Плащанията още не са активирани'}</strong><p>{billing.mode === 'test' ? 'Този режим е за пробни плащания в Stripe и не създава реални таксувания.' : 'Можеш да използваш Free. Абонаментът Pro ще бъде достъпен след настройването на Stripe и цените.'}</p></div></div>}
      <section className="ws-billing-current" aria-labelledby="billing-current-title">
        <div className="ws-billing-current-heading"><span className="ws-billing-plan-icon"><CreditCard size={25} aria-hidden="true" /></span><div><span className="ws-billing-eyebrow">Твоят план</span><h3 id="billing-current-title">ExamAI {billing.plan === 'pro' ? 'Pro' : 'Free'}</h3></div><span className={`ws-billing-status ${billing.plan === 'pro' ? 'ws-billing-status-pro' : ''}`}>{billing.cancelAtPeriodEnd ? 'Прекратява се в края на периода' : statusLabels[billing.status] ?? (billing.plan === 'pro' ? 'Активен' : 'Безплатен план')}</span></div>
        <div className="ws-billing-current-footer"><p>{currentPeriod && <><strong>Период:</strong> {currentPeriod === 'month' ? 'месечен' : 'годишен'}{currentPrice ? ` — ${currentPrice}` : ''}. </>}{paidThrough ? <>{billing.cancelAtPeriodEnd ? 'Достъп до Pro до ' : billing.status === 'trialing' ? 'Пробният период е до ' : 'Текущият платен период е до '}<strong><time dateTime={billing.paidThrough ?? undefined}>{paidThrough}</time></strong>.</> : billing.plan === 'free' ? 'Започни с основните възможности и премини към Pro, когато ти потрябва повече.' : 'Статусът на абонамента се потвърждава от Stripe.'}</p>{billing.portalAvailable && <button type="button" className="command-button" onClick={() => void openStripe('portal')} disabled={!!busy}>{busy === 'portal' ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <ArrowUpRight size={16} aria-hidden="true" />}Управлявай / смени плана</button>}</div>
        <BillingUsage billing={billing} />
        {billing.cancellationAvailable && <div className="ws-billing-cancel"><p>Спри следващото подновяване, когато пожелаеш. Запазваш Pro до края на платения период.</p><button type="button" className="command-button" onClick={() => setCancelRequested(true)} disabled={loading || !!busy}><CircleStop size={17} aria-hidden="true" />Спри подновяването</button></div>}
      </section>
      <div className="ws-billing-choose-heading"><div><h3>План за твоето преподаване</h3><p>Абонаментът е за твоя учителски профил и се подновява всеки месец.</p></div></div>
      <Feedback error={actionError} />
      <div className="ws-billing-plans">
        <article className="ws-billing-plan" aria-labelledby="billing-free-title"><div className="ws-billing-plan-title"><h3 id="billing-free-title">Free</h3>{billing.plan === 'free' && <span className="ws-billing-tag">Текущ план</span>}</div><p>За първите ти групи и тестове.</p><div className="ws-billing-price">Безплатно</div><BillingPlanFeatures plan="free" limits={billing.plans?.free ?? (billing.plan === 'free' ? billing.limits : undefined)} /><p className="ws-billing-card-note">{billing.plan === 'free' ? 'Използваш Free без абонамент.' : 'За промяна или прекратяване отвори управлението на абонамента.'}</p></article>
        <article className="ws-billing-plan ws-billing-plan-pro" aria-labelledby="billing-pro-title"><div className="ws-billing-plan-title"><h3 id="billing-pro-title"><Sparkles size={21} aria-hidden="true" />Pro</h3><span className="ws-billing-tag">{billing.plan === 'pro' ? 'Текущ план' : 'Повече възможности'}</span></div><p>За редовно преподаване и повече работа с AI.</p><div className={`ws-billing-price ${!amount ? 'ws-billing-price-unavailable' : ''}`}>{amount ? <>{amount}<small> / месец</small></> : price?.available ? 'Цената се показва в Stripe' : 'Цената още не е зададена'}</div><p>Подновява се автоматично всеки месец. Можеш да спреш подновяването по всяко време.</p><BillingPlanFeatures plan="pro" limits={billing.plans?.pro ?? (billing.plan === 'pro' ? billing.limits : undefined)} />
          {billing.plan === 'pro' ? <p className="ws-billing-card-note"><CircleCheck size={18} aria-hidden="true" />Твоят Pro достъп е активен.</p> : <><button type="button" className="primary command-button ws-billing-subscribe" onClick={() => void openStripe('checkout')} disabled={!!busy || pending || !billing.checkoutAvailable || !price?.available}>{busy === 'checkout' ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}{busy === 'checkout' ? 'Отваряне на Stripe…' : billing.mode === 'test' ? 'Изпробвай Pro в Stripe' : 'Абонирай се за Pro'}</button>{(!billing.checkoutAvailable || !price?.available) && <p className="ws-billing-card-note">Плащанията още не са активирани.</p>}</>}
        </article>
      </div>
      <div className="ws-billing-methods" aria-label="Начини на плащане"><span><CreditCard size={17} aria-hidden="true" />Кредитна / дебитна карта</span><span>Apple Pay</span><span>Google Pay</span></div>
      <p className="ws-billing-security"><ShieldCheck size={18} aria-hidden="true" />В защитената страница на Stripe можеш да въведеш данните на картата си или да платиш с Apple Pay / Google Pay, когато са активирани и се поддържат от устройството и браузъра.</p>
    </>}
    {cancelRequested && billing && <DeleteConfirmationDialog title="Спиране на месечното подновяване" description={paidThrough ? <>Няма да има следващо автоматично начисляване. Pro остава достъпен до {paidThrough}, след което профилът преминава на Free.</> : 'Няма да има следващо автоматично начисляване. Вече платеният достъп остава до края на периода.'} confirmLabel="Потвърди спирането" confirmIcon={CircleStop} successMessage="Месечното подновяване е спряно." successTone="success" onCancel={() => setCancelRequested(false)} onConfirm={cancelSubscription} />}
  </section>
}
