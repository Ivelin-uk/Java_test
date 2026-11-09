import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceApi } from './api'
import type { ChatGroup, ChatMessage, ChatMessagePage, ChatPeer, ChatThread } from './types'

type Draft = { text: string; file: File | null }
type SendPayload = { text: string; clientMessageId: string; attachment?: { fileName: string; base64: string } }
export type PendingMessage = { clientMessageId: string; text: string; file: File | null; createdAt: string; status: 'sending' | 'failed'; error?: string; payload?: SendPayload }
type History = { messages: ChatMessage[]; syncedThrough: number; beforeId: number | null; hasOlder: boolean; loaded: boolean; loading: boolean; loadingOlder: boolean; error: string }
export type ChatConnection = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'unavailable'
const emptyDraft: Draft = { text: '', file: null }
const emptyHistory: History = { messages: [], syncedThrough: 0, beforeId: null, hasOlder: false, loaded: false, loading: false, loadingOlder: false, error: '' }

function messageError(cause: unknown, fallback: string) { return cause instanceof Error ? cause.message : fallback }
function errorStatus(cause: unknown) { return typeof cause === 'object' && cause !== null && 'status' in cause ? Number(cause.status) : undefined }
function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const messages = new Map(current.map(message => [message.id, message]))
  incoming.forEach(message => messages.set(message.id, message))
  return [...messages.values()].sort((first, second) => first.id - second.id)
}
function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('Файлът не може да бъде прочетен.'))
    reader.readAsDataURL(file)
  })
}

export function useChat(api: WorkspaceApi, isAtBottom: () => boolean, resetToBottom: () => void) {
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [groups, setGroups] = useState<ChatGroup[]>([])
  const [peers, setPeers] = useState<ChatPeer[]>([])
  const [loadingIndex, setLoadingIndex] = useState(true)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState<ChatConnection>(navigator.onLine ? 'connecting' : 'offline')
  const [selected, setSelected] = useState<ChatThread | null>(null)
  const [opening, setOpening] = useState(false)
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [pendingByThread, setPendingByThread] = useState<Record<number, PendingMessage[]>>({})
  const [historyByThread, setHistoryByThread] = useState<Record<number, History>>({})
  const draftsRef = useRef<Record<number, Draft>>({})
  const mounted = useRef(true)
  const selectedRef = useRef<number | null>(null)
  const histories = useRef(new Map<number, History>())
  const initialLoads = useRef(new Map<number, Promise<void>>())
  const synchronizations = useRef(new Map<number, Promise<void>>())
  const syncAgain = useRef(new Set<number>())
  const inflightSends = useRef(new Set<string>())
  const readThrough = useRef(new Map<number, number>())
  const reading = useRef(new Set<number>())
  const indexRequest = useRef<Promise<void> | null>(null)
  const indexAgain = useRef(false)
  const openRequest = useRef(0)
  const knownThreadIds = useRef(new Set<number>())
  const deniedConversations = useRef(new Set<number>())

  const forgetConversation = useCallback((id: number) => {
    deniedConversations.current.add(id)
    histories.current.delete(id)
    readThrough.current.delete(id)
    if (!mounted.current) return
    setHistoryByThread(current => { const next = { ...current }; delete next[id]; return next })
    const nextDrafts = { ...draftsRef.current }; delete nextDrafts[id]; draftsRef.current = nextDrafts
    setDrafts(current => { const next = { ...current }; delete next[id]; return next })
    setPendingByThread(current => { const next = { ...current }; delete next[id]; return next })
    if (selectedRef.current === id) { selectedRef.current = null; setSelected(null) }
  }, [])

  const updateHistory = useCallback((id: number, update: (history: History) => History) => {
    if (deniedConversations.current.has(id)) return
    const next = update(histories.current.get(id) ?? { ...emptyHistory })
    histories.current.set(id, next)
    if (mounted.current) setHistoryByThread(current => ({ ...current, [id]: next }))
  }, [])

  const reconcilePending = useCallback((id: number, messages: ChatMessage[]) => {
    const delivered = new Set(messages.map(message => message.clientMessageId).filter(Boolean))
    if (!delivered.size || !mounted.current) return
    setPendingByThread(current => ({ ...current, [id]: (current[id] ?? []).filter(message => !delivered.has(message.clientMessageId)) }))
  }, [])

  const refreshIndex = useCallback((): Promise<void> => {
    if (indexRequest.current) { indexAgain.current = true; return indexRequest.current }
    const request = (async () => {
      do {
        indexAgain.current = false
        try {
          const [nextThreads, nextGroups, nextPeers] = await Promise.all([
            api.get<ChatThread[]>('/chat/threads'), api.get<ChatGroup[]>('/chat/groups'), api.get<ChatPeer[]>('/chat/peers'),
          ])
          if (!mounted.current) return
          const nextIds = new Set(nextThreads.map(thread => thread.id))
          let removedSelected = false
          for (const id of knownThreadIds.current) {
            if (!nextIds.has(id)) {
              removedSelected ||= selectedRef.current === id
              forgetConversation(id)
            }
          }
          knownThreadIds.current = nextIds
          setThreads(nextThreads); setGroups(nextGroups); setPeers(nextPeers)
          setError(removedSelected ? 'Разговорът вече не е достъпен. Избери друга активна група или участник.' : '')
          setSelected(current => current ? nextThreads.find(thread => thread.id === current.id) ?? current : null)
        } catch (cause) {
          if (mounted.current) setError(messageError(cause, 'Разговорите не могат да бъдат заредени.'))
        } finally {
          if (mounted.current) setLoadingIndex(false)
        }
      } while (indexAgain.current && mounted.current)
    })().finally(() => { indexRequest.current = null })
    indexRequest.current = request
    return request
  }, [api, forgetConversation])

  const loadInitial = useCallback((id: number): Promise<void> => {
    const running = initialLoads.current.get(id)
    if (running) return running
    if (histories.current.get(id)?.loaded) return Promise.resolve()
    updateHistory(id, current => ({ ...current, loading: true, error: '' }))
    const request = api.get<ChatMessagePage>(`/chat/conversations/${id}/messages`).then(page => {
      updateHistory(id, current => ({ ...current, messages: mergeMessages(current.messages, page.messages), syncedThrough: page.afterId ?? page.messages.at(-1)?.id ?? 0, beforeId: page.beforeId, hasOlder: page.hasMore, loaded: true, error: '' }))
      reconcilePending(id, page.messages)
    }).catch(cause => {
      updateHistory(id, current => ({ ...current, error: messageError(cause, 'Съобщенията не могат да бъдат заредени.') }))
      throw cause
    }).finally(() => {
      updateHistory(id, current => ({ ...current, loading: false }))
      initialLoads.current.delete(id)
    })
    initialLoads.current.set(id, request)
    return request
  }, [api, reconcilePending, updateHistory])

  const syncConversation = useCallback((id: number): Promise<void> => {
    const running = synchronizations.current.get(id)
    if (running) { syncAgain.current.add(id); return running }
    const request = (async () => {
      await loadInitial(id)
      do {
        syncAgain.current.delete(id)
        let cursor = histories.current.get(id)?.syncedThrough ?? 0
        let more = true
        while (more && mounted.current) {
          const page = await api.get<ChatMessagePage>(`/chat/conversations/${id}/messages?afterId=${cursor}`)
          const nextCursor = page.afterId ?? page.messages.at(-1)?.id ?? cursor
          updateHistory(id, current => ({ ...current, messages: mergeMessages(current.messages, page.messages), syncedThrough: nextCursor, error: '' }))
          reconcilePending(id, page.messages)
          more = page.hasMore && nextCursor > cursor
          cursor = nextCursor
        }
      } while (syncAgain.current.has(id) && mounted.current)
    })().catch(cause => {
      if (errorStatus(cause) === 403 || errorStatus(cause) === 404) {
        forgetConversation(id)
        if (mounted.current) setError('Разговорът вече не е достъпен. Обнови списъка с разговори.')
        return
      }
      updateHistory(id, current => ({ ...current, error: messageError(cause, 'Чатът не може да се обнови.') }))
    }).finally(() => { synchronizations.current.delete(id) })
    synchronizations.current.set(id, request)
    return request
  }, [api, forgetConversation, loadInitial, reconcilePending, updateHistory])

  const markVisibleRead = useCallback(async () => {
    const id = selectedRef.current
    if (id === null || document.visibilityState !== 'visible' || !isAtBottom() || reading.current.has(id)) return
    const history = histories.current.get(id)
    const lastId = history?.messages.findLast(message => message.id <= history.syncedThrough)?.id ?? 0
    if (!lastId || lastId <= (readThrough.current.get(id) ?? 0)) return
    reading.current.add(id)
    try {
      await api.post(`/chat/conversations/${id}/read`, { messageId: lastId })
      readThrough.current.set(id, lastId)
      await refreshIndex()
    } catch { /* Retry on the next synchronization or visible scroll. */ }
    finally { reading.current.delete(id) }
  }, [api, isAtBottom, refreshIndex])

  const selectThread = useCallback((thread: ChatThread | null) => {
    openRequest.current++
    selectedRef.current = thread?.id ?? null
    resetToBottom()
    setSelected(thread)
    setError('')
    if (thread) { deniedConversations.current.delete(thread.id); void syncConversation(thread.id) }
  }, [resetToBottom, syncConversation])

  const openConversation = useCallback(async (kind: 'groups' | 'direct', id: number) => {
    const requestId = ++openRequest.current
    setOpening(true); setError('')
    try {
      const thread = await api.post<ChatThread>(`/chat/${kind}/${id}`)
      if (!mounted.current || requestId !== openRequest.current) return false
      selectThread(thread)
      await refreshIndex()
      return true
    } catch (cause) {
      if (mounted.current && requestId === openRequest.current) setError(messageError(cause, 'Разговорът не може да бъде отворен.'))
      return false
    } finally { if (mounted.current) setOpening(false) }
  }, [api, refreshIndex, selectThread])

  const loadOlder = useCallback(async (id: number) => {
    const history = histories.current.get(id)
    if (!history?.hasOlder || history.beforeId === null || history.loadingOlder) return
    updateHistory(id, current => ({ ...current, loadingOlder: true, error: '' }))
    try {
      const page = await api.get<ChatMessagePage>(`/chat/conversations/${id}/messages?beforeId=${history.beforeId}`)
      updateHistory(id, current => ({ ...current, messages: mergeMessages(current.messages, page.messages), beforeId: page.beforeId, hasOlder: page.hasMore }))
      reconcilePending(id, page.messages)
    } catch (cause) {
      updateHistory(id, current => ({ ...current, error: messageError(cause, 'По-старите съобщения не могат да бъдат заредени.') }))
    } finally { updateHistory(id, current => ({ ...current, loadingOlder: false })) }
  }, [api, reconcilePending, updateHistory])

  const updateDraft = useCallback((id: number, update: Partial<Draft>) => {
    const next = { ...draftsRef.current, [id]: { ...(draftsRef.current[id] ?? emptyDraft), ...update } }
    draftsRef.current = next
    setDrafts(next)
  }, [])

  const sendPending = useCallback(async (id: number, message: PendingMessage) => {
    const key = `${id}:${message.clientMessageId}`
    if (inflightSends.current.has(key)) return
    inflightSends.current.add(key)
    setPendingByThread(current => ({ ...current, [id]: (current[id] ?? []).map(item => item.clientMessageId === message.clientMessageId ? { ...item, status: 'sending', error: undefined } : item) }))
    try {
      const payload: SendPayload = message.payload ?? {
        text: message.text, clientMessageId: message.clientMessageId,
        ...(message.file ? { attachment: { fileName: message.file.name, base64: await fileAsBase64(message.file) } } : {}),
      }
      message.payload = payload
      const saved = await api.post<ChatMessage>(`/chat/conversations/${id}/messages`, payload)
      updateHistory(id, current => ({ ...current, messages: mergeMessages(current.messages, [saved]) }))
      if (!mounted.current) return
      setPendingByThread(current => ({ ...current, [id]: (current[id] ?? []).filter(item => item.clientMessageId !== message.clientMessageId) }))
      await refreshIndex()
      await syncConversation(id)
      await markVisibleRead()
    } catch (cause) {
      if (!mounted.current) return
      setPendingByThread(current => ({ ...current, [id]: (current[id] ?? []).map(item => item.clientMessageId === message.clientMessageId ? { ...item, payload: message.payload, status: 'failed', error: messageError(cause, 'Съобщението не беше изпратено.') } : item) }))
    } finally { inflightSends.current.delete(key) }
  }, [api, markVisibleRead, refreshIndex, syncConversation, updateHistory])

  function send() {
    const id = selectedRef.current
    if (id === null) return
    const draft = draftsRef.current[id] ?? emptyDraft
    if (!draft.text.trim() && !draft.file) return
    const message: PendingMessage = { clientMessageId: crypto.randomUUID(), text: draft.text.trim(), file: draft.file, createdAt: new Date().toISOString(), status: 'sending' }
    resetToBottom()
    updateDraft(id, { text: '', file: null })
    setPendingByThread(current => ({ ...current, [id]: [...(current[id] ?? []), message] }))
    void sendPending(id, message)
  }

  useEffect(() => {
    mounted.current = true
    let stopped = false
    let denied = false
    let attempts = 0
    let currentAttempt: AbortController | null = null
    let wake: (() => void) | undefined
    let eventTimer: number | undefined
    let lastReconcile = 0
    const syncVisible = () => {
      if (stopped || denied || !navigator.onLine || document.visibilityState !== 'visible') return
      lastReconcile = Date.now()
      void refreshIndex()
      const id = selectedRef.current
      if (id !== null) void syncConversation(id).then(() => { if (!stopped) void markVisibleRead() })
    }
    const queueSync = () => {
      if (eventTimer !== undefined) return
      eventTimer = window.setTimeout(() => { eventTimer = undefined; syncVisible() }, 80)
    }
    const wait = (milliseconds: number) => new Promise<void>(resolve => {
      const finish = () => { window.clearTimeout(timer); if (wake === finish) wake = undefined; resolve() }
      const timer = window.setTimeout(finish, milliseconds)
      wake = finish
    })
    async function connect() {
      while (!stopped && !denied) {
        if (!navigator.onLine) { setConnection('offline'); await wait(30_000); continue }
        setConnection(attempts ? 'reconnecting' : 'connecting')
        currentAttempt = new AbortController()
        try {
          const { ticket } = await api.post<{ ticket: string }>('/chat/realtime-ticket')
          if (stopped) break
          await api.stream(`/chat/events?ticket=${encodeURIComponent(ticket)}`, currentAttempt.signal,
            event => { if (event === 'changed' || event === 'message') queueSync() },
            () => { if (!stopped) { attempts = 0; setConnection('connected'); syncVisible() } })
        } catch (cause) {
          if (stopped) break
          if (errorStatus(cause) === 401 || errorStatus(cause) === 403) {
            denied = true; setConnection('unavailable'); setError(messageError(cause, 'Достъпът до чата е прекратен.')); break
          }
        } finally { currentAttempt?.abort(); currentAttempt = null }
        if (stopped) break
        attempts++
        setConnection(navigator.onLine ? 'reconnecting' : 'offline')
        await wait(Math.min(30_000, 1000 * 2 ** Math.min(attempts - 1, 5)) + Math.random() * 500)
      }
    }
    const visibility = () => { if (document.visibilityState === 'visible') { syncVisible(); wake?.() } }
    const online = () => { currentAttempt?.abort(); wake?.(); syncVisible() }
    const offline = () => { currentAttempt?.abort(); setConnection('offline'); wake?.() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    const interval = window.setInterval(() => { if (Date.now() - lastReconcile > 5000 && (!currentAttempt || Date.now() - lastReconcile > 30_000)) syncVisible() }, 5000)
    void refreshIndex()
    void connect()
    return () => {
      stopped = true; mounted.current = false; currentAttempt?.abort(); wake?.()
      window.clearTimeout(eventTimer); window.clearInterval(interval)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [api, markVisibleRead, refreshIndex, syncConversation])

  const id = selected?.id
  return {
    threads, groups, peers, loadingIndex, error, setError, connection, selected, opening,
    history: id === undefined ? emptyHistory : historyByThread[id] ?? emptyHistory,
    draft: id === undefined ? emptyDraft : drafts[id] ?? emptyDraft,
    pending: id === undefined ? [] : pendingByThread[id] ?? [],
    selectThread, openConversation, refresh: refreshIndex, syncConversation, loadOlder, updateDraft, send,
    retry: (message: PendingMessage) => { if (id !== undefined) void sendPending(id, message) },
    discard: (message: PendingMessage) => { if (id !== undefined) setPendingByThread(current => ({ ...current, [id]: (current[id] ?? []).filter(item => item.clientMessageId !== message.clientMessageId) })) },
    markVisibleRead,
  }
}
