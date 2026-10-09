import { useState } from 'react'
import { ArrowLeft, Save, Send, Ban } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import type { Attempt, ExamAnswer, Question, Review, ReviewQuestion } from './types'
import { date, label } from './types'
import { Empty, Feedback, SectionHead } from './ui'
import { WorkspaceImage } from './WorkspaceImage'
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog'

export function GradingPanel({ api }: { api: WorkspaceApi }) {
  const queue = useRemote<Attempt[]>(api, '/grading', [])
  const [selected, setSelected] = useState<number | null>(null)
  if (selected) return <ReviewPanel api={api} id={selected} back={() => { setSelected(null); void queue.reload() }} />
  return <section className="ws-section"><SectionHead title="Проверка на опити" /><Feedback error={queue.error} busy={queue.loading} /><div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Обучаем</th><th>Тест</th><th>Опит</th><th>Статус</th><th>Предаден</th></tr></thead><tbody>{queue.data.map(a => <tr key={a.id}><td><button className="ws-text-button" onClick={() => setSelected(a.id)}>{a.student_name}</button></td><td>{a.title}</td><td>{a.attempt_number}</td><td>{label(a.status)}</td><td>{date(a.submitted_at)}</td></tr>)}</tbody></table></div>{!queue.data.length && !queue.loading && <Empty>Няма опити за проверка.</Empty>}</section>
}
function ReviewPanel({ api, id, back }: { api: WorkspaceApi; id: number; back: () => void }) {
  const review = useRemote<Review | null>(api, `/attempts/${id}/review`, null)
  const action = useAction()
  const [reason, setReason] = useState('')
  const [grade, setGrade] = useState('')
  const [outcome, setOutcome] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [key, setKey] = useState(() => crypto.randomUUID())
  if (!review.data) return <Feedback error={review.error} busy={review.loading} />
  const value = review.data
  const points = value.questions.reduce((sum, q) => sum + Number(q.final_points ?? 0), 0)
  const max = value.questions.reduce((sum, q) => sum + Number(q.maximum_points), 0)
  const pending = value.questions.filter(q => !q.reviewed || q.final_points === null).length
  const correction = value.attempt.status === 'finalized'
  return <section className="ws-section"><SectionHead title={`Опит #${id} · ${value.student.name}`}><button className="icon-button danger" title="Анулирай опита с причина" disabled={action.busy || value.attempt.status === 'voided'} onClick={() => setVoiding(true)}><Ban size={17} /></button><button className="icon-button" title="Към проверките" onClick={back}><ArrowLeft size={18} /></button></SectionHead><Feedback error={action.error || review.error} message={action.message} busy={action.busy} /><p>{label(value.attempt.status)} · {points} / {max} точки · {pending} непроверени отговора</p>
    {value.questions.map(q => <QuestionReview key={`${q.id}-${q.final_points}-${q.reviewed}`} api={api} attempt={id} question={q} refresh={review.reload} />)}
    <section className="ws-publication"><h3>{correction ? 'Нова резултатна ревизия' : 'Окончателен резултат'}</h3><div className="ws-form-grid"><label>Коригирана оценка<input value={grade} maxLength={40} onChange={e => setGrade(e.target.value)} /></label><label>Коригиран изход<select value={outcome} onChange={e => setOutcome(e.target.value)}><option value="">По прага на теста</option><option value="passed">Успешен</option><option value="failed">Неуспешен</option></select></label><label>Причина за корекция<input value={reason} onChange={e => setReason(e.target.value)} /></label></div><button className="primary command-button" disabled={pending > 0 || action.busy || value.attempt.status === 'voided'} onClick={() => setConfirm(true)}><Send size={17} /> {correction ? 'Публикувай корекция' : 'Потвърди оценката и изпрати резултата'}</button></section>
    <h3>История на резултатите</h3>{!value.revisions.length ? <Empty>Резултатът още не е публикуван.</Empty> : <table className="ws-table"><thead><tr><th>Ревизия</th><th>Точки</th><th>Оценка</th><th>Изход</th><th>Автор / дата</th><th>Причина</th></tr></thead><tbody>{value.revisions.map(r => <tr key={r.id}><td>{r.revision_number}</td><td>{r.points}/{r.maximum_points}</td><td>{r.grade}</td><td>{label(r.outcome)}</td><td>#{r.author_id} · {date(r.published_at ?? null)}</td><td>{r.reason || '-'}</td></tr>)}</tbody></table>}
    <details><summary>Журнал на изпитните събития ({value.events.length})</summary><table className="ws-table"><thead><tr><th>Събитие</th><th>Въпрос</th><th>Сървърно време</th></tr></thead><tbody>{value.events.map((e, i) => <tr key={i}><td>{e.event_type}</td><td>{e.question_id ?? '-'}</td><td>{date(e.received_at)}</td></tr>)}</tbody></table></details>
    {voiding && <VoidAttemptDialog api={api} id={id} student={value.student.name} close={() => setVoiding(false)} saved={review.reload} />}
    {confirm && <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="publish-result"><h2 id="publish-result">Публикуване на резултат</h2><p>{value.student.name} · {points}/{max} точки</p><p>Известието ще бъде адресирано до потвърдения имейл за известия на обучаемия.</p><Feedback error={action.error} /><div className="ws-actions"><button disabled={action.busy} onClick={() => setConfirm(false)}>Отказ</button><button className="primary" disabled={action.busy} onClick={() => void action.run(async () => { await api.post(`/attempts/${id}/${correction ? 'result-revisions' : 'finalize'}`, { idempotencyKey: key, reason, gradeOverride: grade, outcomeOverride: outcome }); setKey(crypto.randomUUID()); setConfirm(false); await review.reload() }, 'Резултатът е публикуван; известието е в опашката.')}><Send size={17} /> Потвърди</button></div></section></div>}
  </section>
}
function VoidAttemptDialog({ api, id, student, close, saved }: { api: WorkspaceApi; id: number; student: string; close: () => void; saved: () => Promise<unknown> }) {
  const [reason, setReason] = useState('')
  return <DeleteConfirmationDialog title="Анулиране на опит" confirmLabel="Анулирай опита" confirmIcon={Ban} confirmDisabled={!reason.trim()} description={<>Да анулираме ли опит #{id} на <strong>{student}</strong>? Резултатът от този опит няма да участва в обобщената оценка.</>} onCancel={close} onConfirm={async () => {
    await api.post(`/attempts/${id}/void`, { reason: reason.trim() })
    await saved()
  }}><label>Причина за анулиране<textarea required value={reason} onChange={event => setReason(event.target.value)} /></label></DeleteConfirmationDialog>
}
function QuestionReview({ api, attempt, question: row, refresh }: { api: WorkspaceApi; attempt: number; question: ReviewQuestion; refresh: () => Promise<unknown> }) {
  const snapshot = JSON.parse(row.definition_json) as { question: Question; options: { id: string; text: string; correct: boolean }[] }
  const submitted = row.answer_json ? JSON.parse(row.answer_json) as ExamAnswer : null
  const draft = row.draft_json ? JSON.parse(row.draft_json) as ExamAnswer : null
  const action = useAction()
  const [points, setPoints] = useState(row.final_points === null ? '' : String(row.final_points))
  const [comment, setComment] = useState(row.teacher_comment ?? '')
  const [reason, setReason] = useState(row.override_reason ?? '')
  return <article className="ws-question"><h3>{snapshot.question.text}</h3><WorkspaceImage api={api} id={snapshot.question.imageId} /><p>{label(row.status)} · {row.maximum_points} максимални точки · Автоматични: {row.automatic_points ?? 'ръчна проверка'}</p><div className="ws-review-choices">{snapshot.options.map(o => <div key={o.id} className={o.correct ? 'good' : ''}>{submitted?.optionIds.includes(o.id) ? 'Избран · ' : ''}{o.text}{o.correct ? ' · верен' : ''}</div>)}</div>{submitted?.text && <pre className="ws-student-text">{submitted.text}</pre>}{!submitted && <p>Няма окончателен отговор.</p>}{draft && <details><summary>Запазена чернова</summary><pre className="ws-student-text">{draft.text || snapshot.options.filter(o => draft.optionIds.includes(o.id)).map(o => o.text).join('\n')}</pre></details>}<p>Критерии: {snapshot.question.criteria || snapshot.question.acceptedAnswers.join(', ') || '-'}</p><p>Отворен: {date(row.opened_at)} · Срок: {date(row.deadline_at)} · Затворен: {date(row.closed_at)}</p>
    <form className="ws-form-grid" onSubmit={e => { e.preventDefault(); void action.run(async () => { await api.call(`/attempts/${attempt}/grading`, 'PATCH', { questionId: row.id, points: Number(points), comment, reason }); await refresh() }, 'Проверката е запазена.') }}><label>Финални точки<input type="number" required min={0} max={row.maximum_points} step="0.0001" value={points} onChange={e => setPoints(e.target.value)} /></label><label>Коментар<input value={comment} onChange={e => setComment(e.target.value)} /></label><label>Причина за корекция<input value={reason} onChange={e => setReason(e.target.value)} /></label><button className="command-button" disabled={action.busy}><Save size={17} /> Запази проверката</button></form><Feedback error={action.error} message={action.message} />
  </article>
}
