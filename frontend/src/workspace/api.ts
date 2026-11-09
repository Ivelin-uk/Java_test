import { useCallback, useEffect, useState } from 'react'
import type { ExamSession } from './types'
import { useNotifications } from '../notifications'
import type { NotificationTone } from '../notifications'
import { createEventStreamParser } from './eventStream'

const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'
export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function workspaceClient(token: string) {
  function reportUnauthorized() {
    window.dispatchEvent(new CustomEvent('quicktest:session-expired', { detail: token }))
  }
  async function responseError(response: Response, fallback: string) {
    if (response.status === 401) reportUnauthorized()
    let detail = fallback
    let code: string | undefined
    try {
      const problem = JSON.parse(await response.text()) as { detail?: string; code?: string }
      detail = problem.detail ?? detail
      code = problem.code
    } catch { /* Non-JSON proxy response. */ }
    return new ApiError(detail, response.status, code)
  }
  async function call<T>(path: string, method = 'GET', data?: unknown, session?: ExamSession, options?: { keepalive?: boolean }): Promise<T> {
    const response = await fetch(`${base}${path.startsWith('/api/') ? path : `/api/v1${path}`}`, {
      method, keepalive: options?.keepalive ?? false, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(session ? { 'X-Exam-Session': session.token, 'X-Exam-Browser': session.browserId } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
    if (!response.ok) throw await responseError(response, `Неуспешна заявка (${response.status}).`)
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  }
  async function image(id: number, attempt?: number, session?: ExamSession) {
    const response = await fetch(`${base}/api/v1/files/${id}${attempt ? `?attempt=${attempt}` : ''}`, { headers: { Authorization: `Bearer ${token}`, ...(session ? { 'X-Exam-Session': session.token, 'X-Exam-Browser': session.browserId } : {}) } })
    if (!response.ok) throw new Error('Изображението е недостъпно.')
    return response.blob()
  }
  async function attachment(path: string) {
    const response = await fetch(`${base}${path.startsWith('/api/') ? path : `/api/v1${path}`}`, {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (!response.ok) throw await responseError(response, 'Файлът не може да бъде изтеглен.')
    return response.blob()
  }
  async function stream(path: string, signal: AbortSignal, onEvent: (event: string, data: string) => void, onConnected: () => void) {
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const resetTimeout = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => { timedOut = true; controller.abort() }, 45_000)
    }
    try {
      resetTimeout()
      const response = await fetch(`${base}${path.startsWith('/api/') ? path : `/api/v1${path}`}`, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'text/event-stream' },
        cache: 'no-store', signal: controller.signal,
      })
      if (!response.ok) throw await responseError(response, `Връзката с чата е неуспешна (${response.status}).`)
      if (!response.body || !response.headers.get('Content-Type')?.toLowerCase().startsWith('text/event-stream')) {
        throw new Error('Връзката с чата не може да бъде установена.')
      }
      const parser = createEventStreamParser(onEvent)
      const decoder = new TextDecoder()
      reader = response.body.getReader()
      onConnected()
      while (true) {
        const { value, done } = await reader.read()
        if (done) { parser.finish(); return }
        resetTimeout()
        parser.push(decoder.decode(value, { stream: true }))
      }
    } catch (error) {
      if (timedOut && !signal.aborted) throw new Error('Връзката с чата прекъсна. Възстановяване…')
      throw error
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      if (reader) {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      controller.abort()
    }
  }
  return { call, image, attachment, stream, get: <T>(path: string, session?: ExamSession) => call<T>(path, 'GET', undefined, session), post: <T>(path: string, data?: unknown, session?: ExamSession, options?: { keepalive?: boolean }) => call<T>(path, 'POST', data, session, options), put: <T>(path: string, data?: unknown, session?: ExamSession) => call<T>(path, 'PUT', data, session), remove: (path: string) => call<void>(path, 'DELETE') }
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
