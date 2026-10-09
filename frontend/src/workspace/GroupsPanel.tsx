import { useEffect, useId, useRef, useState } from 'react'
import { Plus, UserPlus, Trash2, ArrowLeft, Save, Pencil } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import type { Group, Member } from './types'
import { roles, date, label } from './types'
import { Empty, Feedback, SectionHead } from './ui'
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog'

export function GroupsPanel({ api, teacher }: { api: WorkspaceApi; teacher: boolean }) {
  const groups = useRemote<Group[]>(api, '/groups', [])
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<Group | null>(null)
  const [deleting, setDeleting] = useState<Group | null>(null)
  const [message, setMessage] = useState('')
  const selectedId = selected?.id
  useEffect(() => { if (selectedId) window.scrollTo({ top: 0 }) }, [selectedId])
  if (selected && teacher) return <GroupEditor key={selected.id} api={api} group={selected} back={() => setSelected(null)} saved={async () => {
    const refreshed = await groups.reload()
    setSelected(refreshed.find(group => group.id === selected.id) ?? selected)
  }} />
  if (selected && !teacher) return <GroupSummary api={api} group={selected} back={() => setSelected(null)} />
  return <section className="ws-section"><SectionHead title="Групи">{teacher && <button type="button" className="primary command-button" onClick={() => { setMessage(''); setCreating(true) }}><Plus size={17} /> Създай група</button>}</SectionHead><Feedback error={groups.error} message={message} busy={groups.loading} />
    <div className="ws-table-wrap"><table className="ws-table" aria-label="Групи"><thead><tr><th>Име</th><th>Дисциплина</th><th>Описание</th>{teacher && <th>Действия</th>}</tr></thead><tbody>{groups.data.map(group => <tr key={group.id}><td><button className="ws-text-button" onClick={() => setSelected(group)}>{group.name}</button></td><td>{group.subject}</td><td>{group.description}</td>{teacher && <td><div className="ws-actions"><button className="icon-button" title="Редактирай групата" onClick={() => setSelected(group)}><Pencil size={17} /></button><button className="icon-button danger" title="Изтрий групата" onClick={() => setDeleting(group)}><Trash2 size={17} /></button></div></td>}</tr>)}</tbody></table></div>{!groups.data.length && !groups.loading && <Empty />}
    {deleting && <GroupDeleteDialog api={api} group={deleting} close={() => setDeleting(null)} saved={async () => { await groups.reload(); setMessage('Групата е изтрита.'); setDeleting(null) }} />}
    {creating && <GroupCreateDialog api={api} close={() => setCreating(false)} created={async () => { await groups.reload(); setMessage('Групата е създадена.') }} />}
  </section>
}

function GroupCreateDialog({ api, close, created }: { api: WorkspaceApi; close: () => void; created: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const action = useAction()
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  function dismiss() { ref.current?.close(); close() }
  return <dialog ref={ref} className="delete-dialog ws-group-dialog ws-group-create-dialog" aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!action.busy) dismiss() }}>
    <h2 id={titleId}>Създаване на група</h2>
    <form onSubmit={e => {
      e.preventDefault()
      if (!name.trim()) return
      void action.run(async () => {
        await api.post('/groups', { name: name.trim(), subject, description })
        await created()
        dismiss()
      })
    }}>
      <fieldset className="ws-editor" disabled={action.busy}>
        <div className="ws-form-grid">
          <label>Име<input autoFocus required maxLength={190} value={name} onChange={e => setName(e.target.value)} /></label>
          <label>Дисциплина<input maxLength={190} value={subject} onChange={e => setSubject(e.target.value)} /></label>
        </div>
        <label>Описание<textarea maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} /></label>
      </fieldset>
      <Feedback error={action.error} busy={action.busy} />
      <div className="ws-actions dialog-actions"><button type="button" disabled={action.busy} onClick={dismiss}>Отказ</button><button type="submit" className="primary command-button" disabled={action.busy || !name.trim()}><Plus size={17} /> Създай група</button></div>
    </form>
  </dialog>
}

function GroupEditor({ api, group, back, saved }: { api: WorkspaceApi; group: Group; back: () => void; saved: () => Promise<void> }) {
  const formId = useId()
  const action = useAction()
  const [editing, setEditing] = useState(group)
  return <section className="ws-section" aria-label="Редактиране на група">
    <SectionHead title={group.name}>
      <button className="icon-button" title="Към групите" disabled={action.busy} onClick={back}><ArrowLeft size={18} /></button>
      <button form={formId} type="submit" className="primary command-button" disabled={action.busy || !editing.name.trim()}><Save size={17} /> Запази</button>
    </SectionHead>
    <Feedback error={action.error} message={action.message} busy={action.busy} />
    <form id={formId} className="ws-group-settings" aria-label="Данни за групата" onSubmit={e => {
      e.preventDefault()
      void action.run(async () => {
        await api.put(`/groups/${group.id}`, { name: editing.name.trim(), subject: editing.subject, description: editing.description })
        await saved()
      }, 'Групата е обновена.')
    }}>
      <h3>Данни за групата</h3>
      <fieldset className="ws-editor" disabled={action.busy}>
        <div className="ws-form-grid">
          {([['name', 'Име', 190], ['subject', 'Дисциплина', 190]] as const).map(([key, title, max]) => <label key={key}>{title}<input required={key === 'name'} maxLength={max} value={editing[key]} onChange={e => setEditing({ ...editing, [key]: e.target.value })} /></label>)}
        </div>
        <label>Описание<textarea maxLength={4000} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label>
      </fieldset>
    </form>
    <GroupMembers api={api} group={group} />
  </section>
}

function GroupDeleteDialog({ api, group, close, saved }: { api: WorkspaceApi; group: Group; close: () => void; saved: () => Promise<void> }) {
  return <DeleteConfirmationDialog title="Изтриване на група" description={<>Да изтрием ли групата <strong>{group.name}</strong>? Възложените тестове и резултатите на учениците ще се запазят.</>} onCancel={close} onConfirm={async () => {
    await api.remove(`/groups/${group.id}`)
    await saved()
  }} />
}

function GroupMembers({ api, group }: { api: WorkspaceApi; group: Group }) {
  const members = useRemote<(Member & { active: boolean })[]>(api, `/groups/${group.id}/members`, [])
  const directory = useRemote<Member[]>(api, '/members', [])
  const action = useAction()
  const [user, setUser] = useState<Member | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [message, setMessage] = useState('')
  const participants = members.data.filter(member => member.active)
  const available = directory.data.filter(m => m.status === 'active' && roles(m).includes('STUDENT') && !roles(m).includes('TEACHER') && !participants.some(member => member.user_id === m.user_id))
  return <section className="ws-section ws-group-members" aria-label="Участници в групата">
    <h3>Ученици</h3>
    <Feedback error={members.error || directory.error || action.error} message={message || action.message} busy={action.busy || members.loading || directory.loading} />
    <form className="ws-inline-form" onSubmit={e => {
      e.preventDefault()
      if (!user) return
      setMessage('')
      void action.run(async () => {
        await api.post(`/groups/${group.id}/members`, { userId: user.user_id })
        setUser(null)
        await members.reload()
      }, 'Ученикът е добавен в групата.')
    }}>
      <UserPicker users={available} selected={user} select={setUser} disabled={action.busy || directory.loading || members.loading} />
      <button className="primary command-button" disabled={!user || action.busy || directory.loading || members.loading}><UserPlus size={17} /> Добави</button>
    </form>
    <div className="ws-table-wrap"><table className="ws-table" aria-label="Участници в групата">
      <thead><tr><th>Име</th><th>Имейл</th><th>Действие</th></tr></thead>
      <tbody>{participants.map(m => <tr key={m.user_id}>
        <td>{m.name}</td><td>{m.email}</td>
        <td><button className="icon-button danger" title="Премахни от групата" disabled={action.busy} onClick={() => setRemoving(m)}><Trash2 size={17} /></button></td>
      </tr>)}</tbody>
    </table></div>
    {!participants.length && !members.loading && !members.error && <Empty>Няма участници в групата.</Empty>}
    {removing && <DeleteConfirmationDialog title="Премахване на ученик от група" confirmLabel="Премахни" description={<>Да премахнем ли <strong>{removing.name}</strong> ({removing.email}) от групата <strong>{group.name}</strong>? Профилът и резултатите на ученика ще се запазят.</>} onCancel={() => setRemoving(null)} onConfirm={async () => {
      await api.remove(`/groups/${group.id}/members/${removing.user_id}`)
      await members.reload()
      setMessage('Ученикът е премахнат от групата.')
    }} />}
  </section>
}

function UserPicker({ users, selected, select, disabled }: { users: Member[]; selected: Member | null; select: (user: Member | null) => void; disabled: boolean }) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const results = users.filter(user => `${user.name} ${user.email}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  function choose(user: Member) { select(user); setQuery(''); setOpen(false); setIndex(0) }
  return <div className="ws-user-picker" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}>
    <label htmlFor={id}>Ученик</label>
    <input id={id} role="combobox" autoComplete="off" aria-expanded={open} aria-controls={`${id}-results`} aria-autocomplete="list" aria-activedescendant={open && results[index] ? `${id}-option-${results[index].user_id}` : undefined} disabled={disabled} placeholder="Търси по име или имейл" value={selected ? `${selected.name} · ${selected.email}` : query}
      onFocus={() => setOpen(true)} onChange={e => { select(null); setQuery(e.target.value); setIndex(0); setOpen(true) }}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); const next = Math.max(0, Math.min(results.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1))); setIndex(next); document.getElementById(`${id}-option-${results[next]?.user_id}`)?.scrollIntoView({ block: 'nearest' }) }
        else if (e.key === 'Enter' && open) { e.preventDefault(); if (results[index]) choose(results[index]) }
      }} />
    {open && !disabled && <div className="ws-user-options" id={`${id}-results`} role="listbox" aria-label="Регистрирани ученици">
      {results.map((user, i) => <button type="button" role="option" aria-selected={i === index} id={`${id}-option-${user.user_id}`} key={user.user_id} onMouseDown={e => e.preventDefault()} onClick={() => choose(user)}><strong>{user.name}</strong><span>{user.email}</span><small>{roles(user).includes('TEACHER') ? 'Учител' : 'Ученик'}</small></button>)}
      {!results.length && <p>Няма намерени ученици.</p>}
    </div>}
  </div>
}

type GroupSummaryData = { group: Group; teachers: { name: string }[]; assignments: { assignment_id: number; student_id: number; student_name: string; title: string; ends_at: string; attempts: { id: number; attempt_number: number; status: string; grade: string | null; outcome: string | null }[] }[] }
function GroupSummary({ api, group, embedded = false, back }: { api: WorkspaceApi; group: Group; embedded?: boolean; back?: () => void }) {
  const data = useRemote<GroupSummaryData | null>(api, `/groups/${group.id}/summary`, null)
  return <section className={embedded ? 'ws-group-report' : 'ws-section'}><SectionHead title={embedded ? 'Възлагания и резултати' : group.name}>{back && <button className="icon-button" title="Към групите" onClick={back}><ArrowLeft size={17} /></button>}</SectionHead><p className="ws-muted">Обобщена оценка: последният публикуван, неанулиран опит по пореден номер.</p><Feedback error={data.error} busy={data.loading} /><p>{group.subject}</p><p>{group.description}</p><p>{data.data?.teachers.map(t => t.name).join(' · ')}</p><div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Тест</th><th>Обучаем</th><th>Срок</th><th>Обобщена оценка</th><th>Всички опити</th></tr></thead><tbody>{data.data?.assignments.map(a => <tr key={`${a.assignment_id}-${a.student_id}`}><td>{a.title}</td><td>{a.student_name}</td><td>{date(a.ends_at)}</td><td>{a.attempts.find(x => x.status === 'finalized')?.grade ?? '-'}</td><td>{a.attempts.length ? a.attempts.map(x => <div key={x.id}>#{x.attempt_number} · {label(x.status)}{x.grade ? ` · ${x.grade} · ${label(x.outcome ?? '')}` : ''}</div>) : 'Не е започнал'}</td></tr>)}</tbody></table></div></section>
}
