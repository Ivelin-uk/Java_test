import { useEffect, useState } from 'react'
import { ArrowUpRight, BookOpen, Check, CreditCard, RefreshCw, Sparkles } from 'lucide-react'
import type { WorkspaceApi } from './api'
import type { TeacherBilling } from './billingTypes'
import { BillingPlanFeatures, BillingUsage } from './BillingPlanDetails'
import { billingStatusLabels, formattedDate, formattedPrice } from './billingPresentation'
import { Feedback } from './ui'
import './billing.css'

export function ProfilePlan({ api, onChangePlan }: { api: WorkspaceApi; onChangePlan: () => void }) {
  const [result, setResult] = useState<{ api: WorkspaceApi; refresh: number; billing: TeacherBilling | null; error: string } | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    api.get<TeacherBilling>('/billing')
      .then(billing => { if (active) setResult({ api, refresh, billing, error: '' }) })
      .catch(cause => { if (active) setResult({ api, refresh, billing: null, error: cause instanceof Error ? cause.message : 'Планът не може да се зареди.' }) })
    return () => { active = false }
  }, [api, refresh])

  const current = result?.api === api && result.refresh === refresh ? result : null
  const billing = current?.billing ?? null, error = current?.error ?? '', loading = !current
  const paidThrough = formattedDate(billing?.paidThrough ?? null)
  const currentPeriod = billing?.currentPeriod
  const currentPrice = billing && currentPeriod ? formattedPrice(billing.prices[currentPeriod]) : null
  return <section className="ws-profile-plan" aria-label="План и плащане">
    <div className="ws-billing-choose-heading"><div><h3><CreditCard size={20} aria-hidden="true" /> План и възможности</h3><p>Виж какво включва твоят план и какво получаваш с Pro.</p></div></div>
    <Feedback error={error} busy={loading} />
    {error && <button type="button" className="command-button" onClick={() => setRefresh(value => value + 1)} disabled={loading}><RefreshCw size={16} aria-hidden="true" />Опитай отново</button>}
    {billing && <>
      <div className="ws-billing-current">
        <div className="ws-billing-current-heading"><span className="ws-billing-plan-icon"><CreditCard size={25} aria-hidden="true" /></span><div><span className="ws-billing-eyebrow">Твоят текущ план</span><h3>ExamAI {billing.plan === 'pro' ? 'Pro' : 'Free'}</h3></div><span className={`ws-billing-status ${billing.plan === 'pro' ? 'ws-billing-status-pro' : ''}`}>{billing.cancelAtPeriodEnd && billing.plan === 'pro' ? 'Прекратява се в края на периода' : billingStatusLabels[billing.status] ?? (billing.plan === 'pro' ? 'Активен' : 'Безплатен план')}</span></div>
        <div className="ws-billing-current-footer"><p>
          {currentPeriod && <><strong>Период:</strong> {currentPeriod === 'month' ? 'Месечен' : 'Годишен'}{currentPrice ? ` — ${currentPrice}` : ''}. </>}
          {billing.plan === 'pro' && paidThrough ? <>{billing.cancelAtPeriodEnd ? 'Достъп до Pro до ' : billing.status === 'trialing' ? 'Пробният период е до ' : 'Текущият платен период е до '}<strong><time dateTime={billing.paidThrough!}>{paidThrough}</time></strong>.</> : billing.plan === 'free' ? 'Безплатен план без месечна такса. Използваните възможности и лимитите ти са показани по-долу.' : 'Използваш разширените възможности на Pro.'}
        </p></div>
        <BillingUsage billing={billing} />
        <p className="ws-billing-credit-note">{billing.plan === 'pro' ? 'AI кредитите се обновяват всеки календарен месец и не се пренасят.' : 'Пробните AI кредити са еднократни за профила.'} Едно AI генериране или една AI проверка на предаден тест използва един кредит. Ръчната проверка не използва AI кредити.</p>
      </div>
      <div className="ws-billing-plans" aria-label="Сравнение на Free и Pro">
        <article className="ws-billing-plan" aria-labelledby="profile-free-title">
          <div className="ws-billing-plan-title"><h3 id="profile-free-title">Free</h3>{billing.plan === 'free' && <span className="ws-billing-tag">Текущ план</span>}</div>
          <p>За първите ти групи и тестове.</p>
          <div className="ws-billing-price">Безплатно</div>
          <BillingPlanFeatures plan="free" limits={billing.plans?.free ?? (billing.plan === 'free' ? billing.limits : undefined)} />
          <p className="ws-billing-card-note">Автоматичната AI проверка при предаване е включена в Pro.</p>
        </article>
        <article className="ws-billing-plan ws-billing-plan-pro" aria-labelledby="profile-pro-title">
          <div className="ws-billing-plan-title"><h3 id="profile-pro-title"><Sparkles size={21} aria-hidden="true" />Pro</h3><span className="ws-billing-tag">{billing.plan === 'pro' ? 'Текущ план' : 'Повече възможности'}</span></div>
          <p>Повече групи и активни възлагания, месечни AI кредити и автоматична AI проверка.</p>
          <div className="ws-profile-plan-prices">{(['month', 'year'] as const).map(period => {
            const price = billing.prices[period], amount = formattedPrice(price)
            return amount ? <p key={period}><strong>{amount}</strong> / {period === 'month' ? 'месец' : 'година'}</p> : null
          })}{!formattedPrice(billing.prices.month) && !formattedPrice(billing.prices.year) && <p>{billing.prices.month.available || billing.prices.year.available ? 'Цената се показва при избор на период.' : 'Цената още не е зададена.'}</p>}</div>
          <BillingPlanFeatures plan="pro" limits={billing.plans?.pro ?? (billing.plan === 'pro' ? billing.limits : undefined)} />
          <button type="button" className="primary command-button ws-billing-subscribe" onClick={onChangePlan}><ArrowUpRight size={18} aria-hidden="true" />{billing.plan === 'pro' ? 'Управлявай абонамента' : 'Виж Pro и избери период'}</button>
          {billing.plan === 'free' && !billing.checkoutAvailable && <p className="ws-billing-card-note">Плащането за Pro в момента не е достъпно.</p>}
        </article>
      </div>
    </>}
    <button type="button" className="command-button ws-profile-plan-link" onClick={onChangePlan}><CreditCard size={17} aria-hidden="true" />Планове и плащане</button>
  </section>
}

export function StudentPlan() {
  return <section className="ws-profile-form ws-profile-student-plan" aria-label="Твоят план">
    <h3><BookOpen size={20} aria-hidden="true" /> Безплатен ученически достъп</h3>
    <p className="ws-muted">Участието ти в ExamAI е безплатно.</p>
    <ul>{['Присъединяване към групи с код от учител', 'Решаване на възложени тестове', 'Преглед на резултати и обратна връзка след проверка'].map(feature => <li key={feature}><Check size={18} aria-hidden="true" />{feature}</li>)}</ul>
    <p className="ws-muted">Платеният план Pro е за учители и добавя повече групи, възлагания и AI възможности.</p>
  </section>
}
