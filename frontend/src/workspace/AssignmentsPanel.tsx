import { useEffect, useState } from 'react'
import { Plus, RotateCw, Ban, Activity, Copy, Mail, UserPlus } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import type { Assessment, Assignment, Group, Member, Version } from './types'
import { date, label, roles } from './types'
import { Empty, Feedback, SectionHead } from './ui'
import { TestPicker } from './TestPicker'
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog'

const localTime = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
export function AssignmentsPanel({ api }: { api: WorkspaceApi }) {
  const assignments = useRemote<Assignment[]>(api, '/assignments', [])
  const tests = useRemote<Assessment[]>(api, '/tests', [])
  const groups = useRemote<Group[]>(api, '/groups', [])
  const members = useRemote<Member[]>(api, '/members', [])
  const action = useAction()
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
  const [studentIds, setStudentIds] = useState<number[]>([])
  const [start, setStart] = useState(() => localTime(new Date()))
  const [end, setEnd] = useState(() => localTime(new Date(Date.now() + 3600000)))
  const [attempts, setAttempts] = useState(1)
  const [shuffleQ, setShuffleQ] = useState(false)
  const [shuffleA, setShuffleA] = useState(false)
  const [afterDeadline, setAfterDeadline] = useState(true)
  const [code, setCode] = useState(''), [codeAssignment, setCodeAssignment] = useState<number | null>(null)
  const [monitor, setMonitor] = useState<number | null>(null)
  const [revokingCode, setRevokingCode] = useState<Assignment | null>(null)
  const toggle = (ids: number[], value: number) => ids.includes(value) ? ids.filter(id => id !== value) : [...ids, value]
  return <section className="ws-section"><SectionHead title="Възлагания" /><Feedback error={assignments.error || tests.error || groups.error || members.error || action.error || (test && resolved?.testId === test.id ? resolved.error : '')} message={action.message} busy={action.busy || loadingVersion} />
    <form className="ws-assignment-form" onSubmit={e => { e.preventDefault(); if (!test || !version || loadingVersion) return; void action.run(async () => { const value = await api.post<{ id: number; code: string }>('/assignments', { versionId: version, groupIds, studentIds, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), maxAttempts: attempts, shuffleQuestions: shuffleQ, shuffleOptions: shuffleA, answersAfterDeadline: afterDeadline }); setCode(value.code); setCodeAssignment(value.id); await assignments.reload() }, 'Възлагането е създадено.') }}>
      <div className="ws-form-grid"><TestPicker tests={tests.data.filter(t => t.status !== 'archived')} selected={test} select={value => { setTest(value ? { ...value } : null); setResolved(null) }} disabled={action.busy || tests.loading} /><label>Начало<input type="datetime-local" required value={start} onChange={e => setStart(e.target.value)} /></label><label>Краен срок<input type="datetime-local" required value={end} onChange={e => setEnd(e.target.value)} /></label><label>Опити<input type="number" min={1} max={20} value={attempts} onChange={e => setAttempts(Number(e.target.value))} /></label></div>
      <div className="ws-recipient-columns"><fieldset><legend>Групи</legend>{groups.data.map(g => <label className="ws-check" key={g.id}><input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => setGroupIds(toggle(groupIds, g.id))} />{g.name}</label>)}</fieldset><fieldset><legend>Индивидуални получатели</legend>{members.data.filter(m => m.status === 'active' && roles(m).includes('STUDENT')).map(m => <label className="ws-check" key={m.user_id}><input type="checkbox" checked={studentIds.includes(m.user_id)} onChange={() => setStudentIds(toggle(studentIds, m.user_id))} />{m.name}</label>)}</fieldset></div>
      <div className="ws-actions"><label className="ws-check"><input type="checkbox" checked={shuffleQ} onChange={e => setShuffleQ(e.target.checked)} /> Разбъркай въпросите</label><label className="ws-check"><input type="checkbox" checked={shuffleA} onChange={e => setShuffleA(e.target.checked)} /> Разбъркай опциите</label><label className="ws-check"><input type="checkbox" checked={afterDeadline} onChange={e => setAfterDeadline(e.target.checked)} /> Верни отговори след срока</label></div><button className="primary command-button" disabled={action.busy || loadingVersion || !version || !groupIds.length && !studentIds.length}><Plus size={17} /> Възложи</button>
    </form>
    {code && <div className="ws-code"><strong>Код за достъп</strong><output>{code}</output><button className="icon-button" title="Копирай кода" onClick={() => void navigator.clipboard.writeText(code)}><Copy size={18} /></button>{codeAssignment && <><button disabled={action.busy} onClick={() => void action.run(() => api.post(`/assignments/${codeAssignment}/code/send`, { code, channel: 'email' }), 'Известията са добавени в опашката.')}><Mail size={17} /> Изпрати по имейл</button></>}</div>}
    <div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Тест</th><th>Начало</th><th>Краен срок</th><th>Получатели</th><th>Действия</th></tr></thead><tbody>{assignments.data.map(a => <tr key={a.id}><td>{a.title}</td><td>{date(a.starts_at)}</td><td>{date(a.ends_at)}</td><td>{a.recipients}</td><td><div className="ws-actions"><button className="icon-button" title="Наблюдение" onClick={() => setMonitor(a.id)}><Activity size={17} /></button><button className="icon-button" title="Нов код" onClick={() => void action.run(async () => { const value = await api.post<{ code: string }>(`/assignments/${a.id}/code/rotate`); setCode(value.code); setCodeAssignment(a.id) })}><RotateCw size={17} /></button><button className="icon-button danger" title="Отмени кода" disabled={action.busy} onClick={() => setRevokingCode(a)}><Ban size={17} /></button></div></td></tr>)}</tbody></table></div>{!assignments.data.length && <Empty />}{monitor && <Monitoring api={api} assignment={monitor} />}
    {revokingCode && <DeleteConfirmationDialog title="Отмяна на код за достъп" confirmLabel="Отмени кода" confirmIcon={Ban} description={<>Да отменим ли кода за <strong>{revokingCode.title}</strong>? Учениците няма да могат да започват нови опити с него.</>} onCancel={() => setRevokingCode(null)} onConfirm={async () => {
      await api.remove(`/assignments/${revokingCode.id}/code`)
      if (codeAssignment === revokingCode.id) { setCode(''); setCodeAssignment(null) }
      await assignments.reload()
    }} />}
  </section>
}
interface MonitorRow { student_id: number; name: string; attempt_id: number | null; attempt_number: number | null; status: string | null; max_attempts: number; fullscreen_exempt: boolean; time_multiplier: number; accommodation_reason: string | null }
function Monitoring({ api, assignment }: { api: WorkspaceApi; assignment: number }) {
  const list = useRemote<MonitorRow[]>(api, `/assignments/${assignment}/monitoring`, [])
  const action = useAction()
  const shared = useRemote<{ teacher_id: number; name: string }[]>(api, `/assignments/${assignment}/teachers`, [])
  const directory = useRemote<Member[]>(api, '/members', [])
  const [coTeacher, setCoTeacher] = useState(''), [extraStudent, setExtraStudent] = useState('')
  const [selected, setSelected] = useState<MonitorRow | null>(null)
  const [reason, setReason] = useState('')
  const [exempt, setExempt] = useState(false)
  const [multiplier, setMultiplier] = useState(1)
  const [max, setMax] = useState(1)
  const [revokingTeacher, setRevokingTeacher] = useState<{ teacher_id: number; name: string } | null>(null)
  return <section className="ws-monitor"><SectionHead title={`Наблюдение #${assignment}`}><button className="icon-button" title="Обнови" onClick={() => void action.run(list.reload)}><RotateCw size={17} /></button></SectionHead><Feedback error={action.error || list.error || shared.error} /><div className="ws-actions">{shared.data.map(t => <span key={t.teacher_id}>{t.name}<button className="icon-button danger" title="Отнеми достъпа до възлагането" disabled={action.busy} onClick={() => setRevokingTeacher(t)}><Ban size={15} /></button></span>)}</div><form className="ws-inline-form" onSubmit={e => { e.preventDefault(); void action.run(async () => { await api.put(`/assignments/${assignment}/teachers/${coTeacher}`, { shared: true }); await shared.reload() }) }}><label>Сподели с учител<select required value={coTeacher} onChange={e => setCoTeacher(e.target.value)}><option value="">Избери</option>{directory.data.filter(m => m.status === 'active' && roles(m).includes('TEACHER')).map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></label><button disabled={action.busy || !coTeacher}><UserPlus size={17} /> Разреши достъп</button></form><form className="ws-inline-form" onSubmit={e => { e.preventDefault(); void action.run(async () => { await api.post(`/assignments/${assignment}/recipients`, { userId: Number(extraStudent) }); setExtraStudent(''); await list.reload() }, 'Получателят е добавен изрично.') }}><label>Нов получател<select required value={extraStudent} onChange={e => setExtraStudent(e.target.value)}><option value="">Избери обучаем</option>{directory.data.filter(m => m.status === 'active' && roles(m).includes('STUDENT') && !list.data.some(row => row.student_id === m.user_id)).map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></label><button disabled={action.busy || !extraStudent}><UserPlus size={17} /> Добави получател</button></form><div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Обучаем</th><th>Опит</th><th>Статус</th><th>Разрешения</th></tr></thead><tbody>{list.data.map((m, i) => <tr key={`${m.student_id}-${i}`}><td>{m.name}</td><td>{m.attempt_number ?? '-'}</td><td>{m.status ? label(m.status) : 'Не е започнал'}</td><td><button onClick={() => { setSelected(m); setExempt(m.fullscreen_exempt); setMultiplier(Number(m.time_multiplier)); setMax(m.max_attempts); setReason(m.accommodation_reason ?? '') }}>Изключение / опити</button></td></tr>)}</tbody></table></div>{selected && <form className="ws-inline-form" onSubmit={e => { e.preventDefault(); void action.run(async () => { await api.put(`/assignments/${assignment}/recipients/${selected.student_id}/accommodation`, { fullscreenExempt: exempt, timeMultiplier: multiplier, maxAttempts: max, reason }); setSelected(null); await list.reload() }, 'Изключението е запазено и одитирано.') }}><strong>{selected.name}</strong><label className="ws-check"><input type="checkbox" checked={exempt} onChange={e => setExempt(e.target.checked)} /> Без цял екран</label><label>Множител на времето<input type="number" min={1} max={5} step="0.25" value={multiplier} onChange={e => setMultiplier(Number(e.target.value))} /></label><label>Опити<input type="number" min={1} max={20} value={max} onChange={e => setMax(Number(e.target.value))} /></label><label>Причина<input required value={reason} onChange={e => setReason(e.target.value)} /></label><button disabled={action.busy}>Запази</button></form>}
    {revokingTeacher && <DeleteConfirmationDialog title="Отнемане на достъп" confirmLabel="Отнеми достъпа" confirmIcon={Ban} description={<>Да отнемем ли достъпа на <strong>{revokingTeacher.name}</strong> до това възлагане?</>} onCancel={() => setRevokingTeacher(null)} onConfirm={async () => {
      await api.put(`/assignments/${assignment}/teachers/${revokingTeacher.teacher_id}`, { shared: false })
      await shared.reload()
    }} />}
  </section>
}
