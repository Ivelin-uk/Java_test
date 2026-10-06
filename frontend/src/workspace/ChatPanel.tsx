import { useEffect, useRef, useState } from 'react'
import { Send, Plus, Flag, Ban } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useAction, useRemote, chatSocketUrl } from './api'
import type { Conversation, Message, Member, Group } from './types'
import { date } from './types'
import { Empty, Feedback, SectionHead } from './ui'

export function ChatPanel({ api, teacher, admin, initial }:  { api: WorkspaceApi; teacher: boolean; admin: boolean; initial?: number | null }) {
  const conversations = useRemote<Conversation[]>(api, '/conversations', [])
  const directory = useRemote<Member[]>(api, '/directory', [])
  const groups = useRemote<Group[]>(api, '/groups', [])
  const action = useAction()
  const [selected, setSelected] = useState<number | null>(initial ?? null)
  const [messages, setMessages] = useState<Message[]>([])
  const messagesRef = useRef<Message[]>([])
  const [body, setBody] = useState('')
  const [user, setUser] = useState('')
  const [group, setGroup] = useState('')
  const [error, setError] = useState('')
  function select(id: number) { messagesRef.current = []; setMessages([]); setError(''); setSelected(id) }
  useEffect(() => {
    if (!selected) return
    let active = true
    let socket: WebSocket | undefined
    api.post<{ ticket: string }>(`/conversations/${selected}/ticket`).then(value => {
      if (!active) return
      socket = new WebSocket(chatSocketUrl())
      socket.onopen = () => socket?.send(JSON.stringify({ ticket: value.ticket }))
      socket.onmessage = event => {
        const value = JSON.parse(event.data) as { messages?: Message[] }
        if (!active || !value.messages) return
        const existing = new Set(messagesRef.current.map(m => m.id))
        messagesRef.current = [...messagesRef.current, ...value.messages.filter(m => !existing.has(m.id))].sort((a, b) => a.id - b.id)
        setMessages(messagesRef.current)
      }
    }).catch(() => { /* Authenticated HTTP polling remains available. */ })
    async function poll() {
      try {
        const value = await api.get<Message[]>(`/conversations/${selected}/messages?after=${messagesRef.current.at(-1)?.id ?? 0}`)
        if (active) { const existing = new Set(messagesRef.current.map(m => m.id)); messagesRef.current = [...messagesRef.current, ...value.filter(m => !existing.has(m.id))]; setMessages(messagesRef.current); setError('') }
      } catch (cause) { if (active) { setError(cause instanceof Error ? cause.message : 'Чатът е недостъпен.'); messagesRef.current = []; setMessages([]) } }
    }
    void poll(); const timer = window.setInterval(() => void poll(), 2000)
    return () => { active = false; window.clearInterval(timer); socket?.close() }
  }, [api, selected])
  return <section className="ws-section"><SectionHead title="Чат" /><Feedback error={action.error || conversations.error || error} busy={action.busy} /><div className="ws-inline-form"><label>Събеседник<select value={user} onChange={e => { setUser(e.target.value); setGroup('') }}><option value="">Избери</option>{directory.data.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></label>{teacher && <label>Група<select value={group} onChange={e => { setGroup(e.target.value); setUser('') }}><option value="">Избери</option>{groups.data.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}<button disabled={action.busy || !user && !group} onClick={() => void action.run(async () => { const value = await api.post<Conversation>('/conversations', { userId: user ? Number(user) : null, groupId: group ? Number(group) : null }); await conversations.reload(); select(value.id) })}><Plus size={17} /> Разговор</button></div>
    <div className="ws-chat"><aside>{conversations.data.map(c => <button key={c.id} className={selected === c.id ? 'ws-conversation active' : 'ws-conversation'} onClick={() => select(c.id)}><strong>{c.title}</strong>{c.unread > 0 && <span>{c.unread}</span>}</button>)}{!conversations.data.length && <Empty>Няма разговори.</Empty>}</aside><section><div className="ws-messages" aria-live="polite">{messages.map(m => <article key={m.id}><header><strong>{m.sender_name}</strong><time>{date(m.created_at)}</time></header><p>{m.body}</p><div className="ws-actions"><button className="icon-button" title="Сигнал за съобщение" onClick={() => { const reason = window.prompt("Причина за сигнал"); if (reason) void action.run(() => api.post(`/conversations/messages/${m.id}/report`, { reason }), "Сигналът е записан.") }}><Flag size={15} /></button><button className="icon-button" title="Блокирай подателя" onClick={() => { if (window.confirm("Блокиране на този подател?")) void action.run(async () => { await api.put(`/conversations/blocks/${m.sender_id}`, { blocked: true }); select(selected!) }) }}><Ban size={15} /></button></div></article>)}{!selected && <Empty>Изберете разговор.</Empty>}</div>{selected && <form className="ws-chat-compose" onSubmit={e => { e.preventDefault(); void action.run(async () => { await api.post(`/conversations/${selected}/messages`, { body }); setBody('') }) }}><label>Съобщение<textarea maxLength={4000} value={body} onChange={e => setBody(e.target.value)} /></label><button className="icon-button primary" title="Изпрати" aria-label="Изпрати" disabled={action.busy || !body.trim() || !!error}><Send size={18} /></button></form>}</section></div>
    {admin && <Moderation api={api} />}
  </section>
}

function Moderation({ api }: { api: WorkspaceApi }) {
  const reports = useRemote<{ id: number; body: string; reason: string; status: string }[]>(api, '/conversations/reports', [])
  const action = useAction()
  return <><h3>Модерация</h3><Feedback error={reports.error || action.error} /><div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Съобщение</th><th>Сигнал</th><th>Статус</th><th>Действие</th></tr></thead><tbody>{reports.data.map(r => <tr key={r.id}><td>{r.body}</td><td>{r.reason}</td><td>{r.status === 'open' ? 'Чака решение' : 'Обработен'}</td><td>{r.status === 'open' && <button onClick={() => { const resolution = window.prompt('Решение за скриване на съобщението'); if (resolution) void action.run(async () => { await api.put(`/conversations/reports/${r.id}`, { resolution, hide: true }); await reports.reload() }) }}>Скрий с причина</button>}</td></tr>)}</tbody></table></div></>
}
