import type { BillingPrice } from './billingTypes'

export const billingStatusLabels: Record<string, string> = {
  free: 'Безплатен план', active: 'Активен', trialing: 'Пробен период',
  past_due: 'Неуспешно подновяване', unpaid: 'Очаква плащане',
  incomplete: 'Незавършено плащане', incomplete_expired: 'Изтекло плащане',
  canceled: 'Прекратен', paused: 'На пауза', inactive: 'Без активен абонамент',
}

export function formattedPrice(price: BillingPrice): string | null {
  if (price.amountMinor === undefined || !Number.isFinite(price.amountMinor) || price.amountMinor < 0 || !price.currency) return null
  try {
    const formatter = new Intl.NumberFormat('bg-BG', { style: 'currency', currency: price.currency.toUpperCase() })
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
    return formatter.format(price.amountMinor / 10 ** digits)
  } catch { return null }
}

export function formattedDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat('bg-BG', { dateStyle: 'long' }).format(date)
}
