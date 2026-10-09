import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Save, Check, Ban, Sparkles, PencilLine, RefreshCw, LoaderCircle, CircleCheck, Clock3 } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import type { Attempt, ExamAnswer, Question, Review, ReviewQuestion } from './types'
import { date, label } from './types'
import { Empty, Feedback, SectionHead } from './ui'
import { WorkspaceImage } from './WorkspaceImage'
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog'

export function GradingPanel({ api }: { api: WorkspaceApi }) {
  const queue = useRemote<Attempt[]>(api, '/grading', [])
  const { setData: setQueueData } = queue
  const [selected, setSelected] = useState<number | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const refresh = useAction()
  useEffect(() => {
    if (selected !== null) return
    let active = true, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const data = await api.get<Attempt[]>('/grading')
        if (active) { setQueueData(data); setPollError('') }
      } catch (cause) { if (active) setPollError(cause instanceof Error ? cause.message : 'Неуспешно обновяване.') }
      if (active) timer = setTimeout(() => void poll(), 2000)
    }
    timer = setTimeout(() => void poll(), 2000)
    return () => { active = false; clearTimeout(timer) }
  }, [api, selected, setQueueData])
  if (selected) return <ReviewPanel api={api} id={selected} back={() => { setSelected(null); void refresh.run(queue.reload) }} />
  return <section className="ws-section"><SectionHead title="Проверка на опити"><button className="icon-button" title="Обнови проверките" disabled={refresh.busy} onClick={() => void refresh.run(async () => { await queue.reload(); setPollError('') })}><RefreshCw size={18} /></button></SectionHead><Feedback error={refresh.error || (pollError ?? queue.error)} busy={queue.loading} /><div className="ws-table-wrap"><table className="ws-table" aria-label="Проверка на опити"><thead><tr><th>Обучаем</th><th>Тест</th><th>Опит</th><th>Статус</th><th>Предаден</th><th>Проверка</th></tr></thead><tbody>{queue.data.map(a => <GradingRow key={a.id} api={api} attempt={a} open={() => setSelected(a.id)} update={job => queue.setData(rows => rows.map(row => row.id === a.id ? { ...row, ai_status: job.status, ai_attempts: job.attempts, ai_error: job.error_message } : row))} />)}</tbody></table></div>{!queue.data.length && !queue.loading && <Empty>Няма опити за проверка.</Empty>}</section>
}

interface GradingJob { status: string; attempts: number; error_message: string | null }
function GradingRow({ api, attempt: a, open, update }: { api: WorkspaceApi; attempt: Attempt; open: () => void; update: (job: GradingJob) => void }) {
  const action = useAction()
  const submitting = useRef(false)
  const requestKey = useRef(crypto.randomUUID())
  const processing = a.ai_status === 'queued' || a.ai_status === 'running'
  const pending = a.status === 'pending_review', finalized = a.status === 'finalized'
  const failed = a.ai_status === 'failed', canRetry = failed && (a.ai_attempts ?? 0) < 3
  const Icon = processing ? LoaderCircle : finalized ? CircleCheck : Clock3
  async function runAi() {
    if (submitting.current) return
    submitting.current = true
    try {
      await action.run(async () => {
        const job = await api.post<GradingJob>(`/attempts/${a.id}/ai-grading${failed ? '/retry' : ''}`, { requestKey: requestKey.current })
        update(job)
        requestKey.current = crypto.randomUUID()
      })
    } finally { submitting.current = false }
  }
  return <tr className={pending ? 'ws-attempt-pending' : finalized ? 'ws-attempt-finalized' : ''}>
    <td><button className="ws-text-button" onClick={open}>{a.student_name}</button></td><td>{a.title}</td><td>{a.attempt_number}</td>
    <td><span className="ws-attempt-status"><Icon size={16} className={processing ? 'ws-spin' : ''} aria-hidden="true" />{processing ? (a.ai_status === 'queued' ? 'AI в опашката' : 'AI проверява') : label(a.status)}</span>{a.ai_status === 'completed' && finalized && <small className="ws-ai-graded">AI проверено</small>}</td>
    <td>{date(a.submitted_at)}</td><td><div className="ws-grading-actions">{pending && <button className="command-button" disabled={action.busy || processing || failed && !canRetry} title={failed ? 'Повтори AI проверката и публикувай резултата' : 'AI проверка и автоматично публикуване'} onClick={() => void runAi()}>{processing || action.busy ? <LoaderCircle size={17} className="ws-spin" aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}{failed ? 'Повтори AI' : 'AI проверка'}</button>}<button className="icon-button" title={finalized ? 'Преглед и корекция' : 'Ръчна проверка'} onClick={open}><PencilLine size={17} /></button></div><Feedback error={processing || finalized ? '' : action.error} />{failed && pending && <p className="ws-ai-error" role="status">{a.ai_error || 'AI проверката не успя.'}</p>}</td>
  </tr>
}
function ReviewPanel({ api, id, back }: { api: WorkspaceApi; id: number; back: () => void }) {
  const review = useRemote<Review | null>(api, `/attempts/${id}/review`, null)
  const action = useAction()
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [key, setKey] = useState(() => crypto.randomUUID())
  const publicationDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!confirm) return
    const dialog = publicationDialog.current, previousFocus = document.activeElement
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [confirm])
  if (!review.data) return <Feedback error={review.error} busy={review.loading} />
  const value = review.data
  const points = value.questions.reduce((sum, q) => sum + Number(q.final_points ?? 0), 0)
  const max = value.questions.reduce((sum, q) => sum + Number(q.maximum_points), 0)
  const pending = value.questions.filter(q => !q.reviewed || q.final_points === null).length
  const correction = value.attempt.status === 'finalized'
  return <section className="ws-section"><SectionHead title={`Опит #${id} · ${value.student.name}`}><button className="icon-button danger" title="Анулирай опита с причина" disabled={action.busy || value.attempt.status === 'voided'} onClick={() => setVoiding(true)}><Ban size={17} /></button><button className="icon-button" title="Към проверките" onClick={back}><ArrowLeft size={18} /></button></SectionHead><Feedback error={action.error || review.error} message={action.message} busy={action.busy} /><p>{label(value.attempt.status)} · {points} / {max} точки · {pending} непроверени отговора</p>
    {value.questions.map(q => <QuestionReview key={`${q.id}-${q.final_points}-${q.reviewed}`} api={api} attempt={id} question={q} refresh={review.reload} />)}
    <section className="ws-publication"><h3>{correction ? 'Нова резултатна ревизия' : 'Окончателен резултат'}</h3><button className="primary command-button" disabled={pending > 0 || action.busy || value.attempt.status === 'voided'} onClick={() => setConfirm(true)}><Check size={17} /> Потвърди</button></section>
    <h3>История на резултатите</h3>{!value.revisions.length ? <Empty>Резултатът още не е публикуван.</Empty> : <table className="ws-table"><thead><tr><th>Ревизия</th><th>Точки</th><th>Оценка</th><th>Изход</th><th>Автор / дата</th><th>Причина</th></tr></thead><tbody>{value.revisions.map(r => <tr key={r.id}><td>{r.revision_number}</td><td>{r.points}/{r.maximum_points}</td><td>{r.grade}</td><td>{label(r.outcome)}</td><td>#{r.author_id} · {date(r.published_at ?? null)}</td><td>{r.reason || '-'}</td></tr>)}</tbody></table>}
    <details><summary>Журнал на изпитните събития ({value.events.length})</summary><table className="ws-table"><thead><tr><th>Събитие</th><th>Въпрос</th><th>Сървърно време</th></tr></thead><tbody>{value.events.map((e, i) => <tr key={i}><td>{e.event_type}</td><td>{e.question_id ?? '-'}</td><td>{date(e.received_at)}</td></tr>)}</tbody></table></details>
    {voiding && <VoidAttemptDialog api={api} id={id} student={value.student.name} close={() => setVoiding(false)} saved={review.reload} />}
    {confirm && <dialog ref={publicationDialog} className="delete-dialog ws-publication-dialog" aria-labelledby="publish-result" aria-describedby="publish-result-summary" aria-busy={action.busy} onCancel={e => { e.preventDefault(); if (!action.busy) setConfirm(false) }}><h2 id="publish-result">{correction ? 'Публикуване на корекция' : 'Публикуване на резултат'}</h2><p id="publish-result-summary">{value.student.name} · {points}/{max} точки</p><p>Известието ще бъде адресирано до потвърдения имейл за известия на обучаемия.</p>{correction && <label>Причина за корекция<textarea required disabled={action.busy} value={reason} onChange={e => setReason(e.target.value)} /></label>}<Feedback error={action.error} /><div className="dialog-actions"><button disabled={action.busy} onClick={() => setConfirm(false)}>Отказ</button><button className="primary command-button" disabled={action.busy || correction && !reason.trim()} onClick={() => void action.run(async () => { await api.post(`/attempts/${id}/${correction ? 'result-revisions' : 'finalize'}`, { idempotencyKey: key, ...(correction ? { reason: reason.trim() } : {}) }); setKey(crypto.randomUUID()); setReason(''); setConfirm(false); await review.reload() }, 'Резултатът е публикуван; известието е в опашката.')}><Check size={17} /> Потвърди</button></div></dialog>}
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
  const maximum = Number(row.maximum_points)
  const validPoints = points.trim() !== '' && Number.isFinite(Number(points)) && Number(points) >= 0 && Number(points) <= maximum
  return <article className="ws-question"><h3>{snapshot.question.text}</h3><WorkspaceImage api={api} id={snapshot.question.imageId} /><p>{label(row.status)} · {row.maximum_points} максимални точки · Автоматични: {row.automatic_points ?? 'ръчна проверка'}</p><div className="ws-review-choices">{snapshot.options.map(o => <div key={o.id} className={o.correct ? 'good' : ''}>{submitted?.optionIds.includes(o.id) ? 'Избран · ' : ''}{o.text}{o.correct ? ' · верен' : ''}</div>)}</div>{submitted?.text && <pre className="ws-student-text">{submitted.text}</pre>}{!submitted && <p>Няма окончателен отговор.</p>}{draft && <details><summary>Запазена чернова</summary><pre className="ws-student-text">{draft.text || snapshot.options.filter(o => draft.optionIds.includes(o.id)).map(o => o.text).join('\n')}</pre></details>}<p>Критерии: {snapshot.question.criteria || snapshot.question.acceptedAnswers.join(', ') || '-'}</p><p>Отворен: {date(row.opened_at)} · Срок: {date(row.deadline_at)} · Затворен: {date(row.closed_at)}</p>
    <form className="ws-form-grid" onSubmit={e => { e.preventDefault(); if (!validPoints || !e.currentTarget.reportValidity()) return; void action.run(async () => { await api.call(`/attempts/${attempt}/grading`, 'PATCH', { questionId: row.id, points: Number(points), comment, reason }); await refresh() }, 'Проверката е запазена.') }}><label>Финални точки<input type="number" required min={0} max={maximum} step="0.0001" value={points} onChange={e => { const value = e.target.value; setPoints(value === '' ? '' : Number(value) > maximum ? String(maximum) : Number(value) < 0 ? '0' : value) }} /></label><label>Коментар<input value={comment} onChange={e => setComment(e.target.value)} /></label><label>Причина за корекция<input value={reason} onChange={e => setReason(e.target.value)} /></label><button className="command-button" disabled={action.busy || !validPoints}><Save size={17} /> Запази проверката</button></form><Feedback error={action.error} message={action.message} />
  </article>
}
