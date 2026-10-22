import { useCallback, useEffect, useState } from 'react'
import type { ExamSession } from './types'
import { useNotifications } from '../notifications'
import type { NotificationTone } from '../notifications'

const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'
export function workspaceClient(token: string) {
  async function call<T>(path: string, method = 'GET', data?: unknown, session?: ExamSession): Promise<T> {
    const response = await fetch(`${base}${path.startsWith('/api/') ? path : `/api/v1${path}`}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(session ? { 'X-Exam-Session': session.token, 'X-Exam-Browser': session.browserId } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
    const text = await response.text()
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new CustomEvent('quicktest:session-expired', { detail: token }))
      let detail = `Неуспешна заявка (${response.status}).`
      try { detail = (JSON.parse(text) as { detail: string }).detail ?? detail } catch { /* Non-JSON proxy response. */ }
      throw new Error(detail)
    }
    return (text ? JSON.parse(text) : undefined) as T
  }
  async function image(id: number, attempt?: number, session?: ExamSession) {
    const response = await fetch(`${base}/api/v1/files/${id}${attempt ? `?attempt=${attempt}` : ''}`, { headers: { Authorization: `Bearer ${token}`, ...(session ? { 'X-Exam-Session': session.token, 'X-Exam-Browser': session.browserId } : {}) } })
    if (!response.ok) throw new Error('Изображението е недостъпно.')
    return response.blob()
  }
  return { call, image, get: <T>(path: string, session?: ExamSession) => call<T>(path, 'GET', undefined, session), post: <T>(path: string, data?: unknown, session?: ExamSession) => call<T>(path, 'POST', data, session), put: <T>(path: string, data?: unknown, session?: ExamSession) => call<T>(path, 'PUT', data, session), remove: (path: string) => call<void>(path, 'DELETE') }
}
export type WorkspaceApi = ReturnType<typeof workspaceClient>
export function useRemote<T>(api: WorkspaceApi, path: string, initial: T) {
  const [data, setData] = useState<T>(initial)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => { const next = await api.get<T>(path); setData(next); setError(''); return next }, [api, path])
  useEffect(() => {
    let active = true
    api.get<T>(path).then(value => { if (active) { setData(value); setError('') } }).catch(cause => { if (active) setError(String(cause.message)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, path])
  return { data, setData, error, loading, reload }
}
export function useAction() {
  const notify = useNotifications()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function clearFeedback() { if (!busy) setError('') }
  async function run<T>(work: () => Promise<T>, success = '', tone: NotificationTone = 'success') {
    if (busy) return
    setBusy(true); setError('')
    try { const result = await work(); if (success) notify(success, tone); return result }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Неуспешно действие.') }
    finally { setBusy(false) }
  }
  return { busy, error, run, clearFeedback }
}
