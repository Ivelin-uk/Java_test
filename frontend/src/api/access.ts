import type { User } from '../types/models'

export const roleLabels = { ADMIN: 'Администратор', TEACHER: 'Учител', STUDENT: 'Ученик / студент' }
export function hasPermission(user: User, key: string) { return user.allowedMethods.includes(key) }
export function canAccess(user: User, key: string) {
  return hasPermission(user, key) && (user.role === 'STUDENT' || !user.subscriptionMethods.includes(key) || user.subscription.active)
}
export function subscriptionLabel(user: User) {
  if (user.role === 'STUDENT') return 'Безплатен достъп'
  if (user.subscription.active) return 'Платен абонамент'
  return user.subscription.paid ? 'Изтекъл абонамент' : 'Няма платен абонамент'
}
export function formatDate(value: string | null) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString('bg-BG') : 'Не е зададена'
}
