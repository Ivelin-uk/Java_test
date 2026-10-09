import { useEffect, useRef, useState } from 'react'
import { Plus, RotateCw, Ban, Activity, Copy, Mail, UserPlus, Trash2, Users, UserRound, Search } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import type { Assessment, Assignment, Group, Member, Version } from './types'
import { date, label, roles } from './types'
import { Empty, Feedback, SectionHead } from './ui'
import { TestPicker } from './TestPicker'
import { RecipientPicker } from './RecipientPicker'
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog'

const localTime = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
export function AssignmentsPanel({ api, userId }: { api: WorkspaceApi; userId: number }) {
  const assignments = useRemote<Assignment[]>(api, '/assignments', [])
  const tests = useRemote<Assessment[]>(api, '/tests', [])
  const groups = useRemote<Group[]>(api, '/groups', [])
  const action = useAction()
  const section = useRef<HTMLElement>(null)
  const [formError, setFormError] = useState<{ message: string; field?: 'test' } | null>(null)
  useEffect(() => {
    if (action.error || formError) section.current?.querySelector('[role="alert"]')?.scrollIntoView({ block: 'nearest' })
    if (formError?.field === 'test') section.current?.querySelector<HTMLInputElement>('[role="combobox"]')?.focus()
  }, [action.error, formError])
  const [test, setTest] = useState<Assessment | null>(null)
  const [resolved, setResolved] = useState<{ testId: number; versionId: number | null; error: string } | null>(null)
  const version = test && resolved?.testId === test.id ? resolved.versionId : null
  const loadingVersion = !!test && resolved?.testId !== test.id
  useEffect(() => {
    if (!test) return
    let active = true
    api.get<Version[]>(`/tests/${test.id}/versions`).then(versions => {
      if (!active) return
      const latest = versions.reduce<Version | null>((latest, value) => !latest || value.version_number > latest.version_number ? value : latest, null)
      setResolved({ testId: test.id, versionId: latest?.id ?? null, error: latest ? '' : 'Тестът няма запазена версия. Отвори го за редактиране и натисни „Запази теста“.' })
    }).catch(cause => { if (active) setResolved({ testId: test.id, versionId: null, error: cause instanceof Error ? cause.message : 'Тестът не може да се зареди.' }) })
    return () => { active = false }
  }, [api, test])
  const [groupIds, setGroupIds] = useState<number[]>([])
  const [start, setStart] = useState(() => localTime(new Date()))
  const [end, setEnd] = useState(() => localTime(new Date(Date.now() + 3600000)))
  const [attempts, setAttempts] = useState(1)
  const [shuffleQ, setShuffleQ] = useState(false)
  const [shuffleA, setShuffleA] = useState(false)
  const [afterDeadline, setAfterDeadline] = useState(true)
  const [code, setCode] = useState(''), [codeAssignment, setCodeAssignment] = useState<number | null>(null)
  const [monitor, setMonitor] = useState<number | null>(null)
  const [revokingCode, setRevokingCode] = useState<Assignment | null>(null)
  const [deletingAssignment, setDeletingAssignment] = useState<Assignment | null>(null)
  const toggle = (ids: number[], value: number) => ids.includes(value) ? ids.filter(id => id !== value) : [...ids, value]
  async function assign() {
    if (action.busy || loadingVersion || tests.loading || groups.loading) return
    const invalid = (message: string, field?: 'test') => setFormError({ message, field })
    if (!test) return invalid('Изберете тест за възлагане.', 'test')
    if (!version) return invalid(resolved?.error || 'Тестът няма запазена версия.', 'test')
    const startsAt = new Date(start), endsAt = new Date(end)
    if (!Number.isFinite(startsAt.getTime())) return invalid('Попълнете началната дата и час.')
    if (!Number.isFinite(endsAt.getTime())) return invalid('Попълнете крайната дата и час.')
    if (startsAt >= endsAt) return invalid('Крайният срок трябва да е след началото.')
    if (endsAt.getTime() <= Date.now()) return invalid('Крайният срок трябва да е в бъдещето.')
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) return invalid('Броят опити трябва да е цяло число от 1 до 20.')
    if (!groupIds.length) return invalid('Изберете поне една група.')
    setFormError(null)
    await action.run(async () => {
      const value = await api.post<{ id: number; code: string }>('/assignments', { versionId: version, groupIds, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), maxAttempts: attempts, shuffleQuestions: shuffleQ, shuffleOptions: shuffleA, answersAfterDeadline: afterDeadline })
      setCode(value.code); setCodeAssignment(value.id)
      await assignments.reload()
    }, 'Възлагането е създадено.')
  }
  return <section ref={section} className="ws-section"><SectionHead title="Възлагания" /><Feedback error={formError?.message || assignments.error || tests.error || groups.error || action.error || (test && resolved?.testId === test.id ? resolved.error : '')} message={action.message} busy={action.busy || loadingVersion} />
    <form className="ws-assignment-form" aria-label="Възлагане на тест" noValidate onChange={() => setFormError(null)} onSubmit={e => { e.preventDefault(); void assign() }}>
      <fieldset className="ws-editor" disabled={action.busy}>
      <div className="ws-form-grid"><TestPicker tests={tests.data.filter(t => t.status !== 'archived')} selected={test} select={value => { setTest(value ? { ...value } : null); setResolved(null); setFormError(null) }} disabled={action.busy || tests.loading} invalid={formError?.field === 'test'} /><label>Начало<input type="datetime-local" required value={start} onChange={e => setStart(e.target.value)} /></label><label>Краен срок<input type="datetime-local" required value={end} onChange={e => setEnd(e.target.value)} /></label><label>Опити<input type="number" min={1} max={20} value={attempts} onChange={e => setAttempts(Number(e.target.value))} /></label></div>
        <RecipientPicker title="Групи" searchLabel="Търси групи" placeholder="Име или дисциплина" emptyMessage="Няма налични групи." options={groups.data.map(group => ({ id: group.id, name: group.name, detail: group.subject }))} selected={groupIds} toggle={id => setGroupIds(ids => toggle(ids, id))} disabled={action.busy} loading={groups.loading} />
      <div className="ws-actions"><label className="ws-check"><input type="checkbox" checked={shuffleQ} onChange={e => setShuffleQ(e.target.checked)} /> Разбъркай въпросите</label><label className="ws-check"><input type="checkbox" checked={shuffleA} onChange={e => setShuffleA(e.target.checked)} /> Разбъркай опциите</label><label className="ws-check"><input type="checkbox" checked={afterDeadline} onChange={e => setAfterDeadline(e.target.checked)} /> Верни отговори след срока</label></div><button className="primary command-button" disabled={action.busy || loadingVersion || tests.loading || groups.loading}><Plus size={17} /> Възложи</button>
      </fieldset>
    </form>
    {code && <div className="ws-code"><strong>Код за достъп</strong><output>{code}</output><button className="icon-button" title="Копирай кода" onClick={() => void navigator.clipboard.writeText(code)}><Copy size={18} /></button>{codeAssignment && <><button disabled={action.busy} onClick={() => void action.run(() => api.post(`/assignments/${codeAssignment}/code/send`, { code, channel: 'email' }), 'Известията са добавени в опашката.')}><Mail size={17} /> Изпрати по имейл</button></>}</div>}
    <div className="ws-table-wrap"><table className="ws-table" aria-label="Възлагания"><thead><tr><th>Тест</th><th>Начало</th><th>Краен срок</th><th>Възложено на</th><th>Получатели</th><th>Действия</th></tr></thead><tbody>{assignments.data.map(a => <tr key={a.id}><td>{a.title}</td><td>{date(a.starts_at)}</td><td>{date(a.ends_at)}</td><td><AssignmentAudience assignment={a} /></td><td>{a.recipients}</td><td><div className="ws-actions ws-assignment-actions"><button className="icon-button" title="Наблюдение" onClick={() => setMonitor(a.id)}><Activity size={17} /></button><button className="icon-button" title="Нов код" disabled={action.busy} onClick={() => void action.run(async () => { const value = await api.post<{ code: string }>(`/assignments/${a.id}/code/rotate`); setCode(value.code); setCodeAssignment(a.id) })}><RotateCw size={17} /></button><button className="icon-button danger" title="Отмени кода" disabled={action.busy} onClick={() => setRevokingCode(a)}><Ban size={17} /></button>{a.teacher_id === userId && <button className="icon-button danger" title="Изтрий възлагането" aria-label="Изтрий възлагането" disabled={action.busy} onClick={() => setDeletingAssignment(a)}><Trash2 size={17} /></button>}</div></td></tr>)}</tbody></table></div>{!assignments.data.length && <Empty />}{monitor && <Monitoring key={monitor} api={api} assignment={monitor} endsAt={assignments.data.find(item => item.id === monitor)?.ends_at ?? ''} groupAssignment={assignments.data.some(item => item.id === monitor && !!item.recipient_groups?.length)} recipientsChanged={assignments.reload} />}
    {deletingAssignment && <DeleteConfirmationDialog title="Изтриване на възлагане" confirmLabel="Изтрий възлагането" description={<>Да изтрием ли възлагането на <strong>{deletingAssignment.title}</strong>? То ще бъде премахнато и за учениците, заедно с всички свързани опити и резултати. Активните опити ще бъдат прекратени. Самият тест остава в библиотеката. Действието е необратимо.</>} onCancel={() => setDeletingAssignment(null)} onConfirm={async () => {
      const id = deletingAssignment.id
      await api.remove(`/assignments/${id}`)
      assignments.setData(items => items.filter(item => item.id !== id))
      if (codeAssignment === id) { setCode(''); setCodeAssignment(null) }
      if (monitor === id) setMonitor(null)
      await action.run(assignments.reload, 'Възлагането е изтрито.')
    }} />}
    {revokingCode && <DeleteConfirmationDialog title="Отмяна на код за достъп" confirmLabel="Отмени кода" confirmIcon={Ban} description={<>Да отменим ли кода за <strong>{revokingCode.title}</strong>? Учениците няма да могат да започват нови опити с него.</>} onCancel={() => setRevokingCode(null)} onConfirm={async () => {
      await api.remove(`/assignments/${revokingCode.id}/code`)
      if (codeAssignment === revokingCode.id) { setCode(''); setCodeAssignment(null) }
      await assignments.reload()
    }} />}
  </section>
}
function AssignmentAudience({ assignment }: { assignment: Assignment }) {
  const groups = assignment.recipient_groups ?? [], individuals = assignment.individual_recipients ?? []
  return <div className="ws-assignment-audience">
    {!!groups.length && <span><Users size={15} aria-hidden="true" /><span><strong>{groups.length === 1 ? 'Група' : 'Групи'}:</strong> {groups.map(group => group.name).join(', ')}</span></span>}
    {!!individuals.length && <span><UserRound size={15} aria-hidden="true" /><span><strong>Индивидуално:</strong> {individuals.map(student => student.name).join(', ')}</span></span>}
    {!groups.length && !individuals.length && <span>-</span>}
  </div>
}
interface MonitorRow { student_id: number; name: string; email?: string; canceled: boolean; assigned?: boolean; attempt_id: number | null; attempt_number: number | null; status: string | null; max_attempts: number; fullscreen_exempt: boolean; time_multiplier: number; accommodation_reason: string | null }
interface AssignmentMember { student_id: number; name: string; email: string }
function Monitoring({ api, assignment, endsAt, groupAssignment, recipientsChanged }: { api: WorkspaceApi; assignment: number; endsAt: string; groupAssignment: boolean; recipientsChanged: () => Promise<unknown> }) {
  const list = useRemote<MonitorRow[]>(api, `/assignments/${assignment}/monitoring`, [])
  const members = useRemote<AssignmentMember[]>(api, `/assignments/${assignment}/members`, [])
  const action = useAction()
  const shared = useRemote<{ teacher_id: number; name: string }[]>(api, `/assignments/${assignment}/teachers`, [])
  const directory = useRemote<Member[]>(api, '/members', [])
  const [coTeacher, setCoTeacher] = useState(''), [query, setQuery] = useState('')
  const [selected, setSelected] = useState<MonitorRow | null>(null)
  const [reason, setReason] = useState('')
  const [exempt, setExempt] = useState(false)
  const [multiplier, setMultiplier] = useState(1)
  const [max, setMax] = useState(1)
  const [revokingTeacher, setRevokingTeacher] = useState<{ teacher_id: number; name: string } | null>(null)
  const [changingRecipient, setChangingRecipient] = useState<{ row: MonitorRow; remove: boolean } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const rows: MonitorRow[] = [...list.data.map(row => ({ ...row, assigned: true })), ...members.data.filter(member => !list.data.some(row => row.student_id === member.student_id)).map(member => ({
    ...member, assigned: false, canceled: false, attempt_id: null, attempt_number: null, status: null, max_attempts: 1, fullscreen_exempt: false, time_multiplier: 1, accommodation_reason: null,
  }))]
  const search = query.trim().toLocaleLowerCase()
  const visible = rows.filter(row => `${row.name} ${row.email ?? ''}`.toLocaleLowerCase().includes(search))
  const expired = new Date(endsAt).getTime() <= now
  async function refresh() { await list.reload(); await members.reload(); await recipientsChanged() }
  function canAssign(row: MonitorRow) {
    const attempts = list.data.filter(value => value.student_id === row.student_id && value.attempt_id !== null)
    return !expired && members.data.some(member => member.student_id === row.student_id) && !attempts.some(attempt => attempt.status === 'in_progress') && (!row.assigned || row.canceled || attempts.length >= row.max_attempts)
  }
  return <section className="ws-monitor">
    <SectionHead title={`Наблюдение #${assignment}`}><button className="icon-button" title="Обнови" disabled={action.busy} onClick={() => void action.run(refresh)}><RotateCw size={17} /></button></SectionHead>
    <Feedback error={action.error || list.error || members.error || shared.error || directory.error} message={action.message} busy={action.busy || list.loading || members.loading} />
    <div className="ws-actions">{shared.data.map(teacher => <span key={teacher.teacher_id}>{teacher.name}<button className="icon-button danger" title="Отнеми достъпа до възлагането" disabled={action.busy} onClick={() => setRevokingTeacher(teacher)}><Ban size={15} /></button></span>)}</div>
    <form className="ws-inline-form" onSubmit={event => { event.preventDefault(); void action.run(async () => { await api.put(`/assignments/${assignment}/teachers/${coTeacher}`, { shared: true }); await shared.reload() }) }}>
      <label>Сподели с учител<select required value={coTeacher} onChange={event => setCoTeacher(event.target.value)}><option value="">Избери</option>{directory.data.filter(member => member.status === 'active' && roles(member).includes('TEACHER')).map(member => <option key={member.user_id} value={member.user_id}>{member.name}</option>)}</select></label>
      <button disabled={action.busy || !coTeacher}><UserPlus size={17} /> Разреши достъп</button>
    </form>
    <div className="ws-recipient-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Търси член на групата" placeholder="Име или имейл" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="ws-table-wrap"><table className="ws-table" aria-label="Получатели на възлагането">
      <thead><tr><th>Обучаем</th><th>Възлагане</th><th>Опит</th><th>Статус</th><th>Разрешения</th><th>Действия</th></tr></thead>
      <tbody>{visible.map((row, index) => <tr key={`${row.student_id}-${row.attempt_id ?? 'none'}`}>
        <td>{row.name}{row.email && <div className="ws-muted">{row.email}</div>}</td><td>{!row.assigned ? 'Не е възложен' : row.canceled ? 'Премахнат' : 'Възложен'}</td><td>{row.assigned ? `${row.attempt_number ?? 0}/${row.max_attempts}` : '-'}</td><td>{row.status ? label(row.status) : 'Не е започнал'}</td>
        <td><button disabled={!row.assigned || row.canceled || action.busy} onClick={() => { setSelected(row); setExempt(row.fullscreen_exempt); setMultiplier(Number(row.time_multiplier)); setMax(row.max_attempts); setReason(row.accommodation_reason ?? '') }}>Изключение / опити</button></td>
        <td>{groupAssignment && visible.findIndex(value => value.student_id === row.student_id) === index && <div className="ws-actions">
          {row.assigned && !row.canceled && <button className="icon-button danger" title={`Премахни възлагането за ${row.name}`} aria-label={`Премахни възлагането за ${row.name}`} disabled={action.busy} onClick={() => setChangingRecipient({ row, remove: true })}><Trash2 size={17} /></button>}
          {canAssign(row) && <button className="icon-button" title={`${row.assigned ? 'Възложи отново на' : 'Възложи теста на'} ${row.name}`} aria-label={`${row.assigned ? 'Възложи отново на' : 'Възложи теста на'} ${row.name}`} disabled={action.busy} onClick={() => setChangingRecipient({ row, remove: false })}><RotateCw size={17} /></button>}
        </div>}</td>
      </tr>)}</tbody>
    </table></div>
    {!visible.length && !list.loading && !members.loading && <Empty>{search ? 'Няма намерени резултати.' : 'Няма получатели.'}</Empty>}
    {selected && <form className="ws-inline-form" onSubmit={event => { event.preventDefault(); void action.run(async () => { await api.put(`/assignments/${assignment}/recipients/${selected.student_id}/accommodation`, { fullscreenExempt: exempt, timeMultiplier: multiplier, maxAttempts: max, reason }); setSelected(null); await list.reload() }, 'Изключението е запазено и одитирано.') }}>
      <strong>{selected.name}</strong><label className="ws-check"><input type="checkbox" checked={exempt} onChange={event => setExempt(event.target.checked)} /> Без цял екран</label>
      <label>Множител на времето<input type="number" min={1} max={5} step="0.25" value={multiplier} onChange={event => setMultiplier(Number(event.target.value))} /></label>
      <label>Опити<input type="number" min={1} max={Math.max(20, selected.max_attempts)} value={max} onChange={event => setMax(Number(event.target.value))} /></label>
      <label>Причина<input required value={reason} onChange={event => setReason(event.target.value)} /></label><button disabled={action.busy}>Запази</button>
    </form>}
    {changingRecipient && <DeleteConfirmationDialog title={changingRecipient.remove ? 'Премахване на възлагане за ученик' : 'Повторно възлагане на ученик'} confirmLabel={changingRecipient.remove ? 'Премахни възлагането' : 'Възложи теста'} confirmIcon={changingRecipient.remove ? Trash2 : RotateCw} description={changingRecipient.remove
      ? <><strong>{changingRecipient.row.name}</strong> ще загуби достъп до теста. Активният му опит ще бъде прекратен, а историята и публикуваните резултати ще се запазят.</>
      : <>Да възложим ли теста на <strong>{changingRecipient.row.name}</strong>? Ако опитите са изчерпани, ще бъде разрешен още един. Предишните опити и резултати се запазват.</>} onCancel={() => setChangingRecipient(null)} onConfirm={async () => {
        const { row, remove } = changingRecipient
        if (remove) await api.remove(`/assignments/${assignment}/recipients/${row.student_id}`)
        else await api.post(`/assignments/${assignment}/recipients`, { userId: row.student_id })
        if (selected?.student_id === row.student_id) setSelected(null)
        await action.run(refresh, remove ? 'Възлагането за ученика е премахнато.' : 'Тестът е възложен на ученика.')
      }} />}
    {revokingTeacher && <DeleteConfirmationDialog title="Отнемане на достъп" confirmLabel="Отнеми достъпа" confirmIcon={Ban} description={<>Да отнемем ли достъпа на <strong>{revokingTeacher.name}</strong> до това възлагане?</>} onCancel={() => setRevokingTeacher(null)} onConfirm={async () => {
      await api.put(`/assignments/${assignment}/teachers/${revokingTeacher.teacher_id}`, { shared: false })
      await shared.reload()
    }} />}
  </section>
}
