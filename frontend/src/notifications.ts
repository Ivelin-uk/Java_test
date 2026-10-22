import { createContext, useContext } from 'react'

export type NotificationTone = 'success' | 'danger'
export const NotificationsContext = createContext<((message: string, tone?: NotificationTone) => void) | null>(null)

export function useNotifications() {
  const notify = useContext(NotificationsContext)
  if (!notify) throw new Error('NotificationsProvider is missing.')
  return notify
}
