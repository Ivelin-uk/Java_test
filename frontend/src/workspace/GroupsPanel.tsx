import { useEffect, useId, useRef, useState } from 'react'
import { Plus, UserPlus, Trash2, FileUp, ArrowLeft, Save, Pencil } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import type { Group, Member } from './types'
import { roles, date, label } from './types'
import { Empty, Feedback, SectionHead } from './ui'

export function GroupsPanel({ api, teacher }: { api: WorkspaceApi; teacher: boolean }) {
  const groups = useRemote<Group[]>(api, '/groups', [])
  const action = useAction()
  const [description, setDescription] = useState(''), [year, setYear] = useState('2026/2027'), [classLabel, setClassLabel] = useState('')
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [selected, setSelected] = useState<Group | null>(null)
  const [dialog, setDialog] = useState<{ group: Group; mode: 'edit' | 'delete' } | null>(null)
  const [message, setMessage] = useState('')
  if (selected && !teacher) return <GroupSummary api={api} group={selected} back={() => setSelected(null)} />
  if (selected && teacher) return <GroupMembers api={api} group={selected} back={() => { setSelected(null); void action.run(() => groups.reload()) }} />
  return <section className="ws-section"><SectionHead title="Групи" /><Feedback error={groups.error || action.error} message={message || action.message} busy={groups.loading || action.busy} />
    {teacher && <form className="ws-inline-form" onSubmit={e => { e.preventDefault(); setMessage(''); void action.run(async () => { await api.post('/groups', { name, subject, description, schoolYear: year, classLabel }); setName(''); await groups.reload() }, 'Групата е създадена.') }}><label>Име<input required maxLength={190} value={name} onChange={e => setName(e.target.value)} /></label><label>Дисциплина<input maxLength={190} value={subject} onChange={e => setSubject(e.target.value)} /></label><label>Учебна година<input maxLength={40} value={year} onChange={e => setYear(e.target.value)} /></label><label>Клас / курс<input maxLength={80} value={classLabel} onChange={e => setClassLabel(e.target.value)} /></label><label>Описание<input maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} /></label><button className="primary command-button" disabled={action.busy}><Plus size={17} /> Създай група</button></form>}
    <div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Група</th><th>Дисциплина</th><th>Учебна година</th><th>Клас / курс</th>{teacher && <th>Действия</th>}</tr></thead><tbody>{groups.data.map(group => <tr key={group.id}><td>{<button className="ws-text-button" onClick={() => setSelected(group)}>{group.name}</button>}</td><td>{group.subject}</td><td>{group.school_year}</td><td>{group.class_label}</td>{teacher && <td><div className="ws-actions"><button className="icon-button" title="Редактирай групата" onClick={() => setDialog({ group, mode: 'edit' })}><Pencil size={17} /></button><button className="icon-button danger" title="Изтрий групата" onClick={() => setDialog({ group, mode: 'delete' })}><Trash2 size={17} /></button></div></td>}</tr>)}</tbody></table></div>{!groups.data.length && !groups.loading && <Empty />}
    {dialog && <GroupDialog api={api} group={dialog.group} mode={dialog.mode} close={() => setDialog(null)} saved={async () => { await groups.reload(); setMessage(dialog.mode === 'delete' ? 'Групата е изтрита.' : 'Групата е обновена.'); setDialog(null) }} />}
  </section>
}
function GroupDialog({ api, group, mode, close, saved }: { api: WorkspaceApi; group: Group; mode: 'edit' | 'delete'; close: () => void; saved: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null)
  const action = useAction()
  const [editing, setEditing] = useState(group)
  const deleting = mode === 'delete'
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="delete-dialog ws-group-dialog" aria-labelledby="group-dialog-title" aria-describedby={deleting ? 'group-delete-description' : undefined} onCancel={e => { e.preventDefault(); if (!action.busy) close() }}>
    <h2 id="group-dialog-title">{deleting ? 'Изтриване на група' : 'Редактиране на група'}</h2>
    <form onSubmit={e => { e.preventDefault(); void action.run(async () => {
      if (deleting) await api.remove(`/groups/${group.id}`)
      else await api.put(`/groups/${group.id}`, { profile: { name: editing.name, subject: editing.subject, description: editing.description, schoolYear: editing.school_year, classLabel: editing.class_label }, status: editing.status })
      await saved()
    }) }}>
      {deleting ? <><p><strong>{group.name}</strong></p><p id="group-delete-description">Да изтрием ли групата? Възложените тестове и резултатите на учениците ще се запазят.</p></> : <fieldset className="ws-editor" disabled={action.busy}>
        {([['name', 'Име', 190], ['subject', 'Дисциплина', 190], ['school_year', 'Учебна година', 40], ['class_label', 'Клас / курс', 80]] as const).map(([key, title, max]) => <label key={key}>{title}<input autoFocus={key === 'name'} required={key === 'name'} maxLength={max} value={editing[key]} onChange={e => setEditing({ ...editing, [key]: e.target.value })} /></label>)}
        <label>Описание<textarea maxLength={4000} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label>
        <label>Статус<select value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value })}><option value="active">Активна</option><option value="archived">Архивирана</option></select></label>
      </fieldset>}
      <Feedback error={action.error} busy={action.busy} />
      <div className="ws-actions dialog-actions"><button type="button" autoFocus={deleting} disabled={action.busy} onClick={close}>Отказ</button><button type="submit" className={deleting ? 'danger command-button' : 'primary command-button'} disabled={action.busy || !deleting && !editing.name.trim()}>{deleting ? <Trash2 size={17} /> : <Save size={17} />}{deleting ? 'Изтрий' : 'Запази'}</button></div>
    </form>
  </dialog>
}
function GroupMembers({ api, group, back }: { api: WorkspaceApi; group: Group; back: () => void }) {
  const members = useRemote<(Member & { active: boolean })[]>(api, `/groups/${group.id}/members`, [])
  const directory = useRemote<Member[]>(api, '/members', [])
  const action = useAction()
  const teachers = useRemote<{ user_id: number; name: string }[]>(api, `/groups/${group.id}/teachers`, [])
  const [editing, setEditing] = useState(group)
  const [user, setUser] = useState<Member | null>(null)
  const [csv, setCsv] = useState('email\n')
  const [preview, setPreview] = useState<{ row: number; email: string; status: string; user_id?: number }[]>([])
  const [importReport, setImportReport] = useState<string[]>([])
  return <section className="ws-section ws-group-members"><SectionHead title={group.name}><button className="icon-button" title="Към групите" onClick={back}><ArrowLeft size={18} /></button></SectionHead><Feedback error={members.error || directory.error || teachers.error || action.error} message={action.message} busy={action.busy} />
    <form className="ws-inline-form" onSubmit={e => { e.preventDefault(); if (!user) return; void action.run(async () => { await api.post(`/groups/${group.id}/members`, { userId: user.user_id }); setUser(null); await members.reload() }, 'Ученикът е добавен в групата.') }}>
      <UserPicker users={directory.data.filter(m => m.status === 'active' && roles(m).includes('STUDENT') && !roles(m).includes('TEACHER') && !members.data.some(member => member.active && member.user_id === m.user_id))} selected={user} select={setUser} disabled={action.busy || directory.loading || members.loading || teachers.loading} />
      <button className="primary command-button" disabled={!user || action.busy}><UserPlus size={17} /> Добави</button>
    </form>
    <div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Име</th><th>Имейл</th><th>Статус</th><th>Действие</th></tr></thead><tbody>{members.data.map(m => <tr key={m.user_id}><td>{m.name}</td><td>{m.email}</td><td>{m.active ? 'В групата' : 'Премахнат'}</td><td>{m.active && <button className="icon-button danger" title="Премахни от групата" onClick={() => void action.run(async () => { await api.remove(`/groups/${group.id}/members/${m.user_id}`); await members.reload() })}><Trash2 size={17} /></button>}</td></tr>)}</tbody></table></div>
    <h3>Учител на групата</h3><p>{teachers.data.map(t => t.name).join(' · ')}</p>
    <h3>Данни за групата</h3><form onSubmit={e => { e.preventDefault(); void action.run(() => api.put(`/groups/${group.id}`, { profile: { name: editing.name, subject: editing.subject, description: editing.description, schoolYear: editing.school_year, classLabel: editing.class_label }, status: editing.status }), 'Групата е обновена.') }}><div className="ws-form-grid">{([['name', 'Име'], ['subject', 'Дисциплина'], ['school_year', 'Учебна година'], ['class_label', 'Клас / курс'], ['description', 'Описание']] as const).map(([key, title]) => <label key={key}>{title}<input value={editing[key]} onChange={e => setEditing({ ...editing, [key]: e.target.value })} /></label>)}<label>Статус<select value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value })}><option value="active">Активна</option><option value="archived">Архивирана</option></select></label></div><button disabled={action.busy}><Save size={17} /> Запази</button></form>
    <GroupSummary api={api} group={editing} embedded />
    <h3>CSV импорт</h3><label>CSV с колона email<textarea value={csv} onChange={e => setCsv(e.target.value)} /></label><div className="ws-actions"><label className="ws-file"><FileUp size={17} /> Файл<input type="file" accept=".csv,text/csv" onChange={e => { const file = e.target.files?.[0]; if (file && file.size <= 200000) void file.text().then(setCsv) }} /></label><button onClick={() => void action.run(async () => setPreview(await api.post(`/groups/${group.id}/csv/preview`, { csv })))}>Преглед</button>{preview.length > 0 && <button disabled={action.busy} onClick={() => void action.run(async () => { const report: string[] = []; for (const row of preview) { if (row.status !== 'member') continue; try { if (row.user_id) await api.post(`/groups/${group.id}/members`, { userId: row.user_id }); } catch (cause) { report.push(`${row.email}: ${cause instanceof Error ? cause.message : 'Грешка'}`) } } setImportReport(report); setPreview([]); await members.reload() }, 'Импортът е обработен.')}>Потвърди валидните редове</button>}</div>
    {preview.length > 0 && <table className="ws-table"><thead><tr><th>Ред</th><th>Имейл</th><th>Статус</th></tr></thead><tbody>{preview.map(row => <tr key={row.row}><td>{row.row}</td><td>{row.email}</td><td>{{ invalid: 'Невалиден', duplicate: 'Дублиран', member: 'Регистриран обучаем', unregistered: 'Няма регистриран профил' }[row.status]}</td></tr>)}</tbody></table>}{importReport.length > 0 && <label>Отчет за импорта<textarea readOnly value={importReport.join('\n')} /></label>}
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
  return <section className={embedded ? 'ws-group-report' : 'ws-section'}><SectionHead title={embedded ? 'Възлагания и резултати' : group.name}>{back && <button className="icon-button" title="Към групите" onClick={back}><ArrowLeft size={17} /></button>}</SectionHead><p className="ws-muted">Обобщена оценка: последният публикуван, неанулиран опит по пореден номер.</p><Feedback error={data.error} busy={data.loading} /><p>{group.subject} · {group.school_year} · {group.class_label}</p><p>{group.description}</p><p>{data.data?.teachers.map(t => t.name).join(' · ')}</p><div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Тест</th><th>Обучаем</th><th>Срок</th><th>Обобщена оценка</th><th>Всички опити</th></tr></thead><tbody>{data.data?.assignments.map(a => <tr key={`${a.assignment_id}-${a.student_id}`}><td>{a.title}</td><td>{a.student_name}</td><td>{date(a.ends_at)}</td><td>{a.attempts.find(x => x.status === 'finalized')?.grade ?? '-'}</td><td>{a.attempts.length ? a.attempts.map(x => <div key={x.id}>#{x.attempt_number} · {label(x.status)}{x.grade ? ` · ${x.grade} · ${label(x.outcome ?? '')}` : ''}</div>) : 'Не е започнал'}</td></tr>)}</tbody></table></div></section>
}
