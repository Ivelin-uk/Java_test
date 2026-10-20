import { useEffect, useId, useRef, useState } from 'react'
import { Plus, UserPlus, Trash2, ArrowLeft, Save, Pencil, Copy, RefreshCw } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import type { Group, Member } from './types'
import { roles } from './types'
import { Empty, Feedback, SectionHead } from './ui'
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog'
import { RecipientPicker } from './RecipientPicker'
import { LearnerPanel } from './StudentPanel'

export function GroupsPanel({ api, teacher, selected, setSelected, begin }: { api: WorkspaceApi; teacher: boolean; selected: Group | null; setSelected: (group: Group | null) => void; begin: (assignment: number, attempt?: number) => void }) {
  const groups = useRemote<Group[]>(api, '/groups', [])
  const refresh = useAction()
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<Group | null>(null)
  const [message, setMessage] = useState('')
  const selectedId = selected?.id
  const query = search.trim().normalize('NFC').toLocaleLowerCase('bg-BG')
  const filtered = groups.data.filter(group => group.name.normalize('NFC').toLocaleLowerCase('bg-BG').includes(query))
  useEffect(() => { if (selectedId) window.scrollTo({ top: 0 }) }, [selectedId])
  function backToGroups() { setSelected(null); void refresh.run(groups.reload) }
  if (selected && teacher) return <GroupEditor key={selected.id} api={api} group={selected} back={backToGroups} saved={async code => {
    if (code) setSelected({ ...selected, join_code: code })
    const refreshed = await groups.reload()
    setSelected(refreshed.find(group => group.id === selected.id) ?? (code ? { ...selected, join_code: code } : selected))
  }} />
  if (selected && !teacher) return <GroupTests api={api} group={selected} back={backToGroups} begin={begin} />
  return <section className="ws-section"><SectionHead title="Групи">{teacher && <button type="button" className="primary command-button" onClick={() => { setMessage(''); setCreating(true) }}><Plus size={17} /> Създай група</button>}</SectionHead><Feedback error={groups.error || refresh.error} message={message} busy={groups.loading || refresh.busy} />
    {!teacher && <JoinGroupForm api={api} joined={async result => { await groups.reload(); setMessage(result.alreadyMember ? `Вече си в групата „${result.name}“.` : `Присъедини се към групата „${result.name}“.`) }} />}
    <div className="ws-group-search"><label>Търси група<input type="search" placeholder="Име на група" value={search} onChange={event => setSearch(event.target.value)} /></label>{!groups.loading && <span className="ws-muted" role="status">{filtered.length} от {groups.data.length} групи</span>}</div>
    <div className="ws-table-wrap"><table className="ws-table" aria-label="Групи"><thead><tr><th>Име</th><th>Учител</th><th>Дисциплина</th><th>Описание</th><th>Участници</th>{teacher && <><th>Код за присъединяване</th><th>Действия</th></>}</tr></thead><tbody>{filtered.map(group => <tr key={group.id}><td><button className="ws-text-button" onClick={() => setSelected(group)}>{group.name}</button></td><td>{group.teacher_name ?? '—'}</td><td>{group.subject}</td><td>{group.description}</td><td>{group.participant_count ?? '—'}</td>{teacher && <><td><GroupCode code={group.join_code} /></td><td><div className="ws-actions"><button className="icon-button" title="Редактирай групата" onClick={() => setSelected(group)}><Pencil size={17} /></button><button className="icon-button danger" title="Изтрий групата" onClick={() => setDeleting(group)}><Trash2 size={17} /></button></div></td></>}</tr>)}</tbody></table></div>{!filtered.length && !groups.loading && <Empty>{groups.data.length ? 'Няма групи с това име.' : 'Няма записи.'}</Empty>}
    {deleting && <GroupDeleteDialog api={api} group={deleting} close={() => setDeleting(null)} saved={async () => { await groups.reload(); setMessage('Групата е изтрита.'); setDeleting(null) }} />}
    {creating && <GroupCreateDialog api={api} close={() => setCreating(false)} created={async () => { await groups.reload(); setMessage('Групата е създадена. Кодът за присъединяване е в таблицата.') }} />}
  </section>
}

function GroupCode({ code }: { code?: string }) {
  const action = useAction()
  return <div><div className="ws-group-code"><output aria-label="Код за присъединяване">{code ?? '—'}</output>{code && <button type="button" className="icon-button" aria-label="Копирай кода за групата" title="Копирай кода за групата" disabled={action.busy} onClick={() => void action.run(() => navigator.clipboard.writeText(code), 'Кодът е копиран.')}><Copy size={17} /></button>}</div><Feedback error={action.error} message={action.message} /></div>
}

interface GroupJoinResult { id: number; name: string; alreadyMember: boolean }
function JoinGroupForm({ api, joined }: { api: WorkspaceApi; joined: (result: GroupJoinResult) => Promise<void> }) {
  const [code, setCode] = useState('')
  const action = useAction(), submitting = useRef(false)
  return <section className="ws-section ws-group-join" aria-label="Присъединяване към група"><h3>Присъедини се с код</h3><p className="ws-muted">Въведи кода, който ти е дал учителят.</p><form className="ws-inline-form" onSubmit={event => {
    event.preventDefault()
    if (!code.trim() || submitting.current) return
    submitting.current = true
    void action.run(async () => {
      const result = await api.post<GroupJoinResult>('/groups/join', { code: code.trim() })
      await joined(result)
      setCode('')
    }).finally(() => { submitting.current = false })
  }}><label>Код за група<input required maxLength={8} autoCapitalize="characters" autoComplete="off" spellCheck={false} value={code} disabled={action.busy} placeholder="Например ABCD2345" onChange={event => setCode(event.target.value.toUpperCase())} /></label><button type="submit" className="primary command-button" disabled={action.busy || !code.trim()}><UserPlus size={17} /> Присъедини се</button></form><Feedback error={action.error} busy={action.busy} /></section>
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

function GroupEditor({ api, group, back, saved }: { api: WorkspaceApi; group: Group; back: () => void; saved: (code?: string) => Promise<void> }) {
  const formId = useId()
  const action = useAction()
  const [editing, setEditing] = useState(group)
  const code = group.join_code
  const rotating = useRef(false)
  async function rotateCode() {
    if (!code || rotating.current) return
    rotating.current = true
    try {
      await action.run(async () => {
        const result = await api.post<{ code: string }>(`/groups/${group.id}/code/rotate`, { currentCode: code })
        await saved(result.code)
      }, 'Кодът е променен. Старият код вече не е валиден.')
    } finally { rotating.current = false }
  }
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
    <section className="ws-section" aria-label="Код за присъединяване към групата"><h3>Код за присъединяване</h3><div className="ws-actions"><GroupCode key={code} code={code} /><button type="button" className="command-button" disabled={action.busy || !code} onClick={() => void rotateCode()}><RefreshCw size={17} /> Нов код</button></div><p className="ws-muted">Споделете кода с учениците. „Нов код“ заменя стария код за присъединяване. Учениците, които вече са в групата, остават в нея.</p></section>
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
  const [userIds, setUserIds] = useState<number[]>([])
  const [pickerVersion, setPickerVersion] = useState(0)
  const adding = useRef(false)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [message, setMessage] = useState('')
  const participants = members.data.filter(member => member.active)
  const available = directory.data.filter(m => m.status === 'active' && roles(m).includes('STUDENT') && !roles(m).includes('TEACHER') && !participants.some(member => member.user_id === m.user_id))
  const selected = userIds.filter(id => available.some(member => member.user_id === id))
  const disabled = action.busy || directory.loading || members.loading || !!directory.error || !!members.error
  return <section className="ws-section ws-group-members" aria-label="Участници в групата">
    <h3>Ученици</h3>
    <Feedback error={members.error || directory.error || action.error} message={message || action.message} busy={action.busy || members.loading || directory.loading} />
    <form className="ws-inline-form ws-group-add-members" aria-label="Добавяне на ученици" onSubmit={e => {
      e.preventDefault()
      if (!selected.length || disabled || adding.current) return
      adding.current = true
      setMessage('')
      void action.run(async () => {
        const added: number[] = []
        try {
          for (const userId of selected) {
            await api.post(`/groups/${group.id}/members`, { userId })
            added.push(userId)
            setUserIds(ids => ids.filter(id => id !== userId))
          }
          setPickerVersion(version => version + 1)
        } finally {
          if (added.length) {
            setMessage(added.length === 1 ? 'Ученикът е добавен в групата.' : `Добавени ученици: ${added.length}.`)
            await members.reload()
          }
        }
      }).finally(() => { adding.current = false })
    }}>
      <RecipientPicker key={pickerVersion} title="Ученици" searchLabel="Търси ученици" placeholder="Търси по име или имейл" emptyMessage="Няма налични ученици." options={available.map(member => ({ id: member.user_id, name: member.name, detail: member.email }))} selected={selected} toggle={id => setUserIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])} disabled={disabled} loading={directory.loading || members.loading} keepOpenOnSelect />
      <button type="submit" className="primary command-button" disabled={!selected.length || disabled}><UserPlus size={17} /> Добави</button>
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

function GroupTests({ api, group, back, begin }: { api: WorkspaceApi; group: Group; back: () => void; begin: (assignment: number, attempt?: number) => void }) {
  return <section className="ws-section" aria-label="Тестове на групата"><SectionHead title={group.name}><button className="icon-button" title="Към групите" onClick={back}><ArrowLeft size={17} /></button></SectionHead><p className="ws-muted">Учител: {group.teacher_name ?? '—'}</p>{group.subject && <p>{group.subject}</p>}{group.description && <p>{group.description}</p>}<LearnerPanel key={group.id} api={api} begin={begin} groupId={group.id} /></section>
}
