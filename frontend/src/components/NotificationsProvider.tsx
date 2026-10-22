import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleCheck, Trash2, X } from 'lucide-react'
import { NotificationsContext } from '../notifications'
import type { NotificationTone } from '../notifications'
import './notifications.css'

interface Notice { id: number; message: string; tone: NotificationTone }

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([])
  const sequence = useRef(0)
  const notify = useCallback((message: string, tone: NotificationTone = 'success') => {
    if (!message.trim()) return
    const notice = { id: ++sequence.current, message, tone }
    setNotices(current => [...current.filter(item => item.message !== message || item.tone !== tone).slice(-2), notice])
  }, [])
  const dismiss = useCallback((id: number) => setNotices(current => current.filter(notice => notice.id !== id)), [])
  return <NotificationsContext.Provider value={notify}>
    {children}
    {createPortal(<ul className="app-notifications" aria-label="Известия">{notices.map(notice => <Notification key={notice.id} notice={notice} dismiss={dismiss} />)}</ul>, document.body)}
  </NotificationsContext.Provider>
}

function Notification({ notice, dismiss }: { notice: Notice; dismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false)
  useEffect(() => {
    if (hovered || focused) return
    const timer = window.setTimeout(() => dismiss(notice.id), 6000)
    return () => window.clearTimeout(timer)
  }, [notice.id, dismiss, hovered, focused])
  const Icon = notice.tone === 'danger' ? Trash2 : CircleCheck
  return <li className={`app-notification app-notification-${notice.tone}`} role="status" aria-atomic="true" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <Icon size={21} aria-hidden="true" />
    <span>{notice.message}</span>
    <button type="button" aria-label="Затвори известието" title="Затвори известието" onClick={() => dismiss(notice.id)}><X size={17} aria-hidden="true" /></button>
  </li>
}
