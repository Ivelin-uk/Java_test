import { Check } from 'lucide-react'
import type { TeacherBilling } from './billingTypes'

export function BillingPlanFeatures({ plan, limits }: { plan: TeacherBilling['plan']; limits?: TeacherBilling['limits'] }) {
  const pro = plan === 'pro'
  const features = [
    limits ? `До ${limits.groups} ${limits.groups === 1 ? 'група' : 'групи'}` : pro ? 'Повече групи' : 'Основен брой групи',
    limits ? `До ${limits.activeAssignments} активни възлагания` : pro ? 'Повече активни възлагания' : 'Основен брой активни възлагания',
    limits ? `${limits.aiCredits} ${pro ? 'AI кредита всеки месец' : 'пробни AI кредита общо'}` : pro ? 'AI кредити всеки месец' : 'Пробни AI кредити',
    'Създаване на тестове и ръчна проверка',
    pro ? 'Автоматична AI проверка при предаване' : 'AI генериране и проверка с пробните кредити',
    'Безплатен достъп за учениците',
  ]
  return <ul>{features.map(feature => <li key={feature}><Check size={18} aria-hidden="true" />{feature}</li>)}</ul>
}

export function BillingUsage({ billing }: { billing: TeacherBilling }) {
  const rows: { key: keyof TeacherBilling['limits']; name: string }[] = [
    { key: 'groups', name: 'Групи' },
    { key: 'activeAssignments', name: 'Активни възлагания' },
    { key: 'aiCredits', name: billing.plan === 'pro' ? 'AI кредити този месец' : 'Пробни AI кредити' },
  ]
  return <div className="ws-billing-usage" aria-label="Използване на плана">{rows.map(({ key, name }) => <div className="ws-billing-quota" key={key}>
    <span>{name}</span><strong>{billing.usage[key]} <small>/ {billing.limits[key]}</small></strong>
    <progress max={Math.max(1, billing.limits[key])} value={Math.min(billing.usage[key], Math.max(1, billing.limits[key]))} aria-label={`${name}: ${billing.usage[key]} от ${billing.limits[key]}`} />
  </div>)}</div>
}
