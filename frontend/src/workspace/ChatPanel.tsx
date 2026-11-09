import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Check, File, FilePlus2, LoaderCircle, MessageCircle, Paperclip, Plus, RefreshCw, Search, Send, Users, WifiOff, X } from 'lucide-react'
import type { WorkspaceApi } from './api'
import type { ChatMessage } from './types'
import { Feedback } from './ui'
import { useChat } from './useChat'
import type { PendingMessage } from './useChat'
import './chat.css'

const attachmentExtensions = new Set(['pdf', 'png', 'jpg', 'jpeg', 'txt', 'docx', 'pptx'])
const maxAttachmentBytes = 10 * 1024 * 1024
const connectionLabels = { connecting: 'Свързване…', connected: 'Свързан', reconnecting: 'Възстановяване на връзката…', offline: 'Без интернет', unavailable: 'Връзката е прекратена' }
const chatRoleLabels: Record<string, string> = { ADMIN: 'Администратор', TEACHER: 'Учител', STUDENT: 'Ученик' }
const threadCategories = [
  { type: 'group', title: 'Групови разговори', empty: 'Все още няма групови разговори.' },
  { type: 'direct', title: 'Лични разговори', empty: 'Все още няма лични разговори.' },
] as const

export function ChatPanel({ api, userId, onOpenGroups, canCreateGroup = false }: { api: WorkspaceApi; userId: number; onOpenGroups?: () => void; canCreateGroup?: boolean }) {
  const atBottom = useRef(true)
  const isAtBottom = useCallback(() => atBottom.current, [])
  const resetToBottom = useCallback(() => { atBottom.current = true }, [])
  const chat = useChat(api, isAtBottom, resetToBottom)
  const { selected, history, draft, pending, markVisibleRead } = chat
  const [choosing, setChoosing] = useState(false)
  const [query, setQuery] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupQuery, setGroupQuery] = useState('')
  const [newMessages, setNewMessages] = useState(0)
  const log = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const previous = useRef({ conversationId: 0, lastId: 0, messageCount: 0 })
  const olderAnchor = useRef<{ conversationId: number; firstId: number; height: number; top: number } | null>(null)
  const term = query.trim().toLocaleLowerCase('bg-BG')
  const matches = (value: string) => value.toLocaleLowerCase('bg-BG').includes(term)
  const visibleThreads = chat.threads.filter(thread => matches(thread.title))
  const visibleGroups = chat.groups.filter(group => matches(`${group.name} ${group.subject ?? ''}`))
  const visiblePeers = chat.peers.filter(peer => matches(`${peer.name} ${peer.email ?? ''}`))
  const groupTerm = groupQuery.trim().toLocaleLowerCase('bg-BG')
  const suggestedGroups = chat.groups.filter(group => `${group.name} ${group.subject ?? ''}`.toLocaleLowerCase('bg-BG').includes(groupTerm))
  const firstId = history.messages[0]?.id ?? 0
  const lastId = history.messages.at(-1)?.id ?? 0
  const selectedId = selected?.id
  const deliveredKeys = new Set(history.messages.map(message => message.clientMessageId).filter(Boolean))
  const visiblePending = pending.filter(message => !deliveredKeys.has(message.clientMessageId))
  const connectionLabel = connectionLabels[chat.connection]

  useLayoutEffect(() => {
    const element = log.current
    if (!element || selectedId === undefined) { previous.current = { conversationId: 0, lastId: 0, messageCount: 0 }; return }
    const changedConversation = previous.current.conversationId !== selectedId
    const anchor = olderAnchor.current
    if (changedConversation) {
      atBottom.current = true
      olderAnchor.current = null
      setNewMessages(0)
      element.scrollTop = element.scrollHeight
    } else if (anchor?.conversationId === selectedId && anchor.firstId !== firstId) {
      element.scrollTop = anchor.top + element.scrollHeight - anchor.height
      olderAnchor.current = null
    } else if (atBottom.current) {
      element.scrollTop = element.scrollHeight
      setNewMessages(0)
    } else if (lastId > previous.current.lastId) {
      const added = history.messages.filter(message => message.id > previous.current.lastId && message.senderId !== userId).length
      if (added) setNewMessages(value => value + added)
    }
    if (olderAnchor.current?.conversationId === selectedId && !history.loadingOlder) olderAnchor.current = null
    previous.current = { conversationId: selectedId, lastId, messageCount: history.messages.length }
    if (atBottom.current) void markVisibleRead()
  }, [markVisibleRead, firstId, history.loadingOlder, history.messages, lastId, selectedId, userId, visiblePending.length])

  function startNew() {
    chat.selectThread(null)
    setCreatingGroup(false)
    setChoosing(true)
    setQuery('')
  }

  function startGroup() {
    if (!canCreateGroup) return
    chat.selectThread(null)
    setCreatingGroup(true)
    setGroupQuery('')
    void chat.refresh()
  }

  function onScroll() {
    const element = log.current
    if (!element) return
    atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72
    if (atBottom.current) { setNewMessages(0); void chat.markVisibleRead() }
  }

  function jumpToBottom() {
    atBottom.current = true
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    setNewMessages(0)
    void chat.markVisibleRead()
  }

  function chooseFile(next: File | undefined) {
    if (!next || !selected) return
    chat.setError('')
    const extension = next.name.split('.').at(-1)?.toLowerCase() ?? ''
    if (!attachmentExtensions.has(extension)) { chat.setError('Поддържат се PDF, PNG, JPG, TXT, DOCX и PPTX файлове.'); return }
    if (!next.size || next.size > maxAttachmentBytes) { chat.setError(next.size ? 'Файлът трябва да е до 10 MB.' : 'Файлът е празен.'); return }
    chat.updateDraft(selected.id, { file: next })
  }

  async function older() {
    if (!selected || !log.current || history.loadingOlder) return
    olderAnchor.current = { conversationId: selected.id, firstId, height: log.current.scrollHeight, top: log.current.scrollTop }
    atBottom.current = false
    await chat.loadOlder(selected.id)
  }

  async function openConversation(kind: 'groups' | 'direct', id: number) {
    if (await chat.openConversation(kind, id)) { setCreatingGroup(false); setChoosing(false); setQuery('') }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !navigator.onLine) return
    chat.send()
    composer.current?.focus()
  }

  async function download(message: ChatMessage) {
    if (!selected || !message.attachmentName) return
    chat.setError('')
    try {
      const blob = await api.attachment(`/chat/conversations/${selected.id}/messages/${message.id}/attachment`)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = message.attachmentName
      document.body.append(anchor); anchor.click(); anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) { chat.setError(cause instanceof Error ? cause.message : 'Файлът не може да бъде изтеглен.') }
  }

  function pendingMessage(message: PendingMessage) {
    return <article key={message.clientMessageId} className={`chat-message is-own is-pending${message.status === 'failed' ? ' is-failed' : ''}`} aria-label={message.status === 'failed' ? 'Неизпратено съобщение' : 'Изпращане на съобщение'}>
      <div className="chat-message-body">
        <div className="chat-bubble">{message.text && <p>{message.text}</p>}{message.file && <div className="chat-pending-file"><Paperclip size={16} />{message.file.name}</div>}</div>
        {message.status === 'sending' ? <small className="chat-delivery"><LoaderCircle size={12} className="ws-spin" /> Изпращане…</small> : <div className="chat-send-failure" role="alert"><span>{message.error}</span><div><button type="button" aria-label="Повтори изпращането" onClick={() => chat.retry(message)} disabled={chat.connection === 'offline'}><RefreshCw size={13} /> Повтори</button><button type="button" aria-label="Премахни неизпратеното съобщение" onClick={() => chat.discard(message)}><X size={13} /> Премахни</button></div></div>}
      </div>
    </article>
  }

  return <section className="ws-section chat-page" aria-label="Чат">
    <header className="chat-page-head">
      <div className="chat-page-title-icon"><MessageCircle size={23} aria-hidden="true" /></div>
      <div><h2>Чат</h2><p>Лични разговори и чат групи с регистрирани потребители.</p></div>
      <span className={`chat-connection${chat.connection === 'connected' ? ' is-connected' : ''}${chat.connection === 'offline' ? ' is-offline' : ''}`} role="status" aria-live="polite"><span aria-hidden="true" />{connectionLabel}</span>
    </header>
    {chat.error && <div className="chat-error-row"><Feedback error={chat.error} /><button type="button" className="command-button" onClick={() => { void chat.refresh(); if (selected) void chat.syncConversation(selected.id) }}><RefreshCw size={15} /> Опитай отново</button></div>}
    {chat.connection === 'offline' && <p className="chat-offline-note"><WifiOff size={16} /> Няма връзка с интернет. Черновите ти са запазени, докато си в чата.</p>}
    <div className="chat-layout">
      <aside className={`chat-sidebar${selected || creatingGroup ? ' chat-sidebar-collapsed' : ''}`} aria-label="Разговори">
        <div className="chat-sidebar-toolbar"><strong>Съобщения</strong></div>
        {canCreateGroup && <button type="button" className="command-button chat-create-group-button" onClick={startGroup} disabled={chat.opening}><Users size={16} aria-hidden="true" /> Нова чат група</button>}
        <label className="chat-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Търси разговор" placeholder="Търси по име или имейл…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="chat-sidebar-tabs" role="group" aria-label="Изглед на разговорите"><button type="button" aria-pressed={!choosing} onClick={() => { setChoosing(false); setQuery('') }}>Разговори{chat.threads.some(thread => thread.unreadCount > 0) && <span className="chat-tab-dot" />}</button><button type="button" aria-pressed={choosing} onClick={() => { setChoosing(true); setQuery('') }}>Контакти</button></div>
        {chat.loadingIndex && <p className="chat-loading"><LoaderCircle size={18} className="ws-spin" /> Зареждане…</p>}
        {!choosing && <section className="chat-sidebar-section chat-thread-categories" aria-label="Съществуващи разговори">
          {(visibleThreads.length > 0 || !term) && threadCategories.map(category => {
            const categoryThreads = visibleThreads.filter(thread => thread.type === category.type)
            return <section key={category.type} className="chat-sidebar-section" aria-label={category.title}>
              <div className="chat-sidebar-heading"><h3>{category.title}</h3><span>{categoryThreads.length}</span></div>
              <div className="chat-thread-list">{categoryThreads.map(thread => <button key={thread.id} type="button" className={`chat-thread${selectedId === thread.id ? ' is-selected' : ''}`} aria-current={selectedId === thread.id ? 'page' : undefined} onClick={() => { setCreatingGroup(false); chat.selectThread(thread) }}>
                <span className="chat-avatar" aria-hidden="true">{thread.type === 'group' ? <Users size={19} /> : initials(thread.title)}</span>
                <span className="chat-thread-copy"><strong>{thread.title}</strong><small>{thread.lastMessage || (thread.attachmentName ? `Файл: ${thread.attachmentName}` : 'Започни разговор')}</small></span>
                {thread.unreadCount > 0 && <span className="chat-unread" aria-label={`${thread.unreadCount} непрочетени`}>{thread.unreadCount > 99 ? '99+' : thread.unreadCount}</span>}
              </button>)}</div>
              {!chat.loadingIndex && !categoryThreads.length && <p className="chat-sidebar-empty">{term ? 'Няма съвпадения в тази категория.' : category.empty}</p>}
            </section>
          })}
          {!chat.loadingIndex && !visibleThreads.length && term && <p className="chat-sidebar-empty">Няма разговори с това име.</p>}
        </section>}
        {(choosing || term) && <>
          <section className="chat-sidebar-section"><div className="chat-sidebar-heading"><h3>Учебни групи</h3><span>{visibleGroups.length}</span></div>
            {visibleGroups.map(group => <button key={group.id} type="button" className="chat-start-row" disabled={chat.opening} onClick={() => void openConversation('groups', group.id)}><span className="chat-start-icon"><Users size={17} aria-hidden="true" /></span><span><strong>{group.name}</strong><small>{group.subject || 'Групов разговор'}</small></span><Plus size={16} aria-hidden="true" /></button>)}
            {!chat.loadingIndex && !visibleGroups.length && <p className="chat-sidebar-empty">{term ? 'Няма групи с това име.' : 'Нямаш активна група. Създай група или се присъедини с код от учителя.'}</p>}
            {!chat.loadingIndex && !chat.groups.length && onOpenGroups && <button type="button" className="command-button chat-groups-link" onClick={onOpenGroups}><Users size={15} /> Към групите</button>}
          </section>
          <section className="chat-sidebar-section"><div className="chat-sidebar-heading"><h3>Регистрирани потребители</h3><span>{visiblePeers.length}</span></div>
            {visiblePeers.map(peer => <button key={peer.user_id} type="button" className="chat-start-row" disabled={chat.opening} onClick={() => void openConversation('direct', peer.user_id)}><span className="chat-avatar chat-avatar-small" aria-hidden="true">{initials(peer.name)}</span><span><strong>{peer.name}</strong><small>{peer.email || chatRoleLabels[peer.role ?? ''] || 'Лично съобщение'}</small></span><Plus size={16} aria-hidden="true" /></button>)}
            {!chat.loadingIndex && !visiblePeers.length && <p className="chat-sidebar-empty">{term ? 'Няма потребители с това име или имейл.' : 'Все още няма други регистрирани потребители.'}</p>}
          </section>
        </>}
      </aside>
      <section className={`chat-conversation${selected || creatingGroup ? ' has-conversation' : ''}`} aria-label={creatingGroup ? 'Нова чат група' : selected ? `Разговор: ${selected.title}` : 'Избран разговор'}>
        {creatingGroup && canCreateGroup ? <div className="chat-group-picker">
          <header className="chat-conversation-head"><button type="button" className="chat-back-button" aria-label="Откажи групата" disabled={chat.opening} onClick={() => setCreatingGroup(false)}><ArrowLeft size={18} aria-hidden="true" /></button><span className="chat-avatar" aria-hidden="true"><Users size={19} /></span><div><h3>Нова чат група</h3><p>Избери от твоите учебни групи.</p></div></header>
          <div className="chat-group-picker-content">
            <p className="chat-group-picker-hint">Участниците от избраната група се включват автоматично в разговора.</p>
            <label className="chat-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Търси моя група" placeholder="Въведи име или предмет на групата…" value={groupQuery} disabled={chat.opening} onChange={event => setGroupQuery(event.target.value)} autoFocus /></label>
            <div className="chat-group-suggestions" aria-label="Твоите учебни групи" aria-busy={chat.loadingIndex}>
              {chat.loadingIndex && <p className="chat-loading"><LoaderCircle size={18} className="ws-spin" /> Зареждане на групите…</p>}
              {suggestedGroups.map(group => <button key={group.id} type="button" className="chat-start-row" disabled={chat.opening || chat.connection === 'offline' || chat.connection === 'unavailable'} onClick={() => void openConversation('groups', group.id)}><span className="chat-start-icon"><Users size={19} aria-hidden="true" /></span><span><strong>{group.name}</strong><small>{group.subject || 'Учебна група'}</small></span>{chat.opening ? <LoaderCircle size={16} className="ws-spin" aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}</button>)}
              {!chat.loadingIndex && !suggestedGroups.length && <div className="chat-sidebar-placeholder"><Users size={25} /><strong>{groupTerm ? 'Няма намерена група' : 'Все още нямаш учебни групи'}</strong><p>{groupTerm ? 'Опитай с друго име или предмет.' : 'Създай учебна група в „Групи“, за да започнеш разговор с нея.'}</p>{!chat.groups.length && onOpenGroups && <button type="button" className="command-button" onClick={onOpenGroups}>Към групите</button>}</div>}
            </div>
          </div>
          <footer className="chat-group-picker-footer"><button type="button" className="command-button" disabled={chat.opening} onClick={() => setCreatingGroup(false)}>Отказ</button></footer>
        </div> : selected ? <>
          <header className="chat-conversation-head"><button type="button" className="chat-back-button" aria-label="Към разговорите" onClick={() => chat.selectThread(null)}><ArrowLeft size={18} aria-hidden="true" /></button><span className="chat-avatar" aria-hidden="true">{selected.type === 'group' ? <Users size={19} /> : initials(selected.title)}</span><div><h3>{selected.title}</h3><p>{selected.type === 'group' ? 'Групов разговор' : 'Личен разговор'}</p></div><span className={`chat-live-dot${chat.connection === 'connected' ? ' is-connected' : ''}`} title={connectionLabel} /></header>
          <div className="chat-history-wrap">
            <div ref={log} className="chat-messages" role="log" aria-label="История на съобщенията" aria-live="polite" aria-relevant="additions" aria-busy={history.loading} onScroll={onScroll}>
              {history.hasOlder && <button type="button" className="chat-load-older" disabled={history.loadingOlder} onClick={() => void older()}>{history.loadingOlder ? <LoaderCircle size={16} className="ws-spin" /> : <ArrowUp size={16} />} Зареди по-старите</button>}
              {history.loading && <p className="chat-loading"><LoaderCircle size={20} className="ws-spin" /> Зареждане на историята…</p>}
              {history.error && <div className="chat-history-error" role="alert"><p>{history.error}</p><button type="button" className="command-button" onClick={() => void chat.syncConversation(selected.id)}><RefreshCw size={15} /> Зареди отново</button></div>}
              {!history.loading && !history.error && !history.messages.length && !visiblePending.length && <div className="chat-empty"><span><MessageCircle size={24} aria-hidden="true" /></span><strong>Започни разговора</strong><p>Изпрати първото съобщение в „{selected.title}“.</p></div>}
              {history.messages.map((message, index) => <article key={message.id} className={`chat-message${message.senderId === userId ? ' is-own' : ''}`} data-message-id={message.id}>
                {message.senderId !== userId && <span className="chat-message-avatar" aria-hidden="true">{initials(message.senderName)}</span>}
                <div className="chat-message-body">{message.senderId !== userId && <strong className="chat-sender">{message.senderName}</strong>}<div className="chat-bubble">{message.text && <p>{message.text}</p>}{message.attachmentName && <button type="button" className="chat-attachment" onClick={() => void download(message)}><File size={18} aria-hidden="true" /><span><strong>{message.attachmentName}</strong><small>{formatBytes(message.attachmentSize ?? 0)} · изтегли файл</small></span><ArrowDown size={16} aria-hidden="true" /></button>}</div><div className="chat-message-meta"><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>{message.senderId === userId && index === history.messages.length - 1 && <span className="chat-delivery"><Check size={12} /> Изпратено</span>}</div></div>
              </article>)}
              {visiblePending.map(pendingMessage)}
            </div>
            {newMessages > 0 && <button type="button" className="chat-new-messages" onClick={jumpToBottom}><ArrowDown size={15} /> {newMessages === 1 ? 'Ново съобщение' : `${newMessages} нови съобщения`}</button>}
          </div>
          <form className="chat-composer" onSubmit={submit}>
            {draft.file && <div className="chat-file-preview"><FilePlus2 size={17} aria-hidden="true" /><span>{draft.file.name} · {formatBytes(draft.file.size)}</span><button type="button" aria-label="Премахни файла" onClick={() => chat.updateDraft(selected.id, { file: null })}><X size={16} /></button></div>}
            <div className="chat-composer-row"><label className="chat-attach-button" title="Прикачи файл"><Paperclip size={19} aria-hidden="true" /><input type="file" aria-label="Прикачи файл" accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,.pptx" onChange={event => { chooseFile(event.target.files?.[0]); event.target.value = '' }} /></label><textarea ref={composer} aria-label="Съобщение" maxLength={4000} rows={1} placeholder="Напиши съобщение…" value={draft.text} onChange={event => chat.updateDraft(selected.id, { text: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} /><button type="submit" className="primary chat-send-button" aria-label="Изпрати съобщение" disabled={chat.connection === 'offline' || chat.connection === 'unavailable' || (!draft.text.trim() && !draft.file)}><Send size={18} aria-hidden="true" /></button></div>
            <p className="chat-composer-hint">Enter за изпращане · Shift + Enter за нов ред · Файлове до 10 MB</p>
          </form>
        </> : <div className="chat-welcome"><span className="chat-welcome-icon"><MessageCircle size={32} aria-hidden="true" /></span><h3>Започни с едно съобщение</h3><p>Потърси регистриран потребител по име или имейл, или започни разговор с твоя учебна група.</p><button type="button" className="primary command-button" onClick={startNew}><Plus size={17} /> Започни разговор</button>{!chat.loadingIndex && !chat.groups.length && onOpenGroups && <button type="button" className="command-button" onClick={onOpenGroups}><Users size={17} /> Към групите</button>}<p className="chat-welcome-note">Съобщенията се обновяват автоматично. При прекъсване чатът възстановява пропуснатото.</p></div>}
      </section>
    </div>
  </section>
}

function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toLocaleUpperCase('bg-BG')).join('') }
function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('bg-BG', { dateStyle: 'medium', timeStyle: 'short' })
}
function formatBytes(size: number) { return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB` }
