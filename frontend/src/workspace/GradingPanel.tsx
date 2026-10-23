import { QuestionText } from '../components/QuestionText'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Save, Check, Ban, Sparkles, PencilLine, RefreshCw, LoaderCircle, CircleCheck, CircleX, CircleAlert, Circle, Clock3, Mail, RotateCcw, Copy, X } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import type { Attempt, ExamAnswer, Question, Review, ReviewQuestion } from './types'
import { date, label } from './types'
import { Empty, Feedback, Panel, SectionHead, TableContainer } from './ui'
import { WorkspaceImage } from './WorkspaceImage'
import { DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog'
import { useNotifications } from '../notifications'

const searchText = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('bg')

export function GradingPanel({ api }: { api: WorkspaceApi }) {
  const queue = useRemote<Attempt[]>(api, '/grading', [])
  const { setData: setQueueData } = queue
  const [selected, setSelected] = useState<number | null>(null)
  const [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [studentQuery, setStudentQuery] = useState(''), [groupQuery, setGroupQuery] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
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
  const invalidRange = !!from && !!to && from > to
  const studentSearch = searchText(studentQuery), groupSearch = searchText(groupQuery)
  const visible = queue.data.filter(row => {
    if (invalidRange) return false
    if (studentSearch && !searchText(row.student_name ?? '').includes(studentSearch)) return false
    if (groupSearch && !row.groups?.some(group => searchText(group.name).includes(groupSearch))) return false
    if (!from && !to) return true
    if (!row.submitted_at) return false
    const submitted = new Date(row.submitted_at)
    const day = `${submitted.getFullYear()}-${String(submitted.getMonth() + 1).padStart(2, '0')}-${String(submitted.getDate()).padStart(2, '0')}`
    return (!from || day >= from) && (!to || day <= to)
  })
  if (selected) return <ReviewPanel api={api} id={selected} back={() => { setSelected(null); void refresh.run(queue.reload) }} />
  return <section className="ws-section">
    <SectionHead title="Проверка на опити" description="Прегледай предадените тестове, провери отговорите и публикувай резултатите на учениците."><button className="icon-button" title="Обнови проверките" disabled={refresh.busy} onClick={() => void refresh.run(async () => { await queue.reload(); setPollError('') })}><RefreshCw size={18} /></button></SectionHead>
    <Feedback error={refresh.error || (pollError ?? queue.error)} busy={queue.loading} />
    <Panel title="Предадени опити" description="Търси по ученик, група или дата. Избери името на ученика или бутона за проверка, за да отвориш отговорите.">
    <div className="ws-grading-filters" role="group" aria-label="Филтри на опитите">
      <label>Име на ученик<input type="search" placeholder="Търси по име" value={studentQuery} onChange={event => setStudentQuery(event.target.value)} /></label>
      <label>Група<input type="search" placeholder="Търси по група" value={groupQuery} onChange={event => setGroupQuery(event.target.value)} /></label>
      <label>Предадени от<input type="date" aria-label="Предадени от" max={to || undefined} value={from} aria-invalid={invalidRange || undefined} onChange={event => setFrom(event.target.value)} /></label>
      <label>Предадени до<input type="date" aria-label="Предадени до" min={from || undefined} value={to} aria-invalid={invalidRange || undefined} onChange={event => setTo(event.target.value)} /></label>
      <button type="button" className="command-button" disabled={!from && !to && !studentQuery && !groupQuery} onClick={() => { setFrom(''); setTo(''); setStudentQuery(''); setGroupQuery('') }}><X size={16} /> Изчисти филтъра</button>
      <span className="ws-summary" role="status">{visible.length} от {queue.data.length} опита</span>
    </div>
    {invalidRange && <p className="error" role="alert">Началната дата трябва да е преди или на крайната дата.</p>}
    <TableContainer label="Проверка на опити — таблица"><table className="ws-table" aria-label="Проверка на опити">
      <thead><tr><th>Обучаем</th><th>Тест</th><th>Код за достъп</th><th>Опит</th><th>Резултат</th><th>Статус</th><th>Предаден</th><th>Проверка</th></tr></thead>
      <tbody>{visible.map(a => <GradingRow key={a.id} api={api} attempt={a} now={now} reload={queue.reload} open={() => setSelected(a.id)} update={job => queue.setData(rows => rows.map(row => row.id === a.id ? { ...row, ai_status: job.status, ai_attempts: job.attempts, ai_error: job.error_message } : row))} />)}</tbody>
    </table></TableContainer>
    {!visible.length && !queue.loading && !invalidRange && <Empty>{studentSearch || groupSearch ? 'Няма опити за зададеното търсене.' : from || to ? 'Няма опити за избрания период.' : 'Няма опити за проверка.'}</Empty>}
    </Panel>
  </section>
}

interface GradingJob { status: string; attempts: number; error_message: string | null }
function GradingRow({ api, attempt: a, now, reload, open, update }: { api: WorkspaceApi; attempt: Attempt; now: number; reload: () => Promise<unknown>; open: () => void; update: (job: GradingJob) => void }) {
  const action = useAction()
  const submitting = useRef(false)
  const requestKey = useRef(crypto.randomUUID())
  const processing = a.ai_status === 'queued' || a.ai_status === 'running'
  const notify = useNotifications()
  const remaining = Math.max(0, (a.max_attempts ?? 0) - (a.attempts_used ?? 0))
  const canGrant = !!a.student_id && a.group_assignment && !a.recipient_canceled && !a.active_attempts && remaining === 0 && !!a.assignment_ends_at && new Date(a.assignment_ends_at).getTime() > now
  const pending = a.status === 'pending_review', finalized = a.status === 'finalized'
  const hasScore = finalized && a.result_correct_answers != null && a.result_question_count != null && a.result_percentage != null
  const passed = finalized && a.result_outcome === 'passed', unsuccessful = finalized && a.result_outcome === 'failed'
  const failed = a.ai_status === 'failed', canRetry = failed && (a.ai_attempts ?? 0) < 3
  const Icon = processing ? LoaderCircle : unsuccessful ? CircleX : passed ? CircleCheck : finalized ? Circle : Clock3
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
  async function perform(operation: () => Promise<string>) {
    if (submitting.current) return
    submitting.current = true
    try { await action.run(async () => { const message = await operation(); await reload(); notify(message) }) }
    finally { submitting.current = false }
  }
  return <tr className={pending ? 'ws-attempt-pending' : unsuccessful ? 'ws-attempt-failed' : passed ? 'ws-attempt-finalized' : ''}>
    <td><button className="ws-text-button" onClick={open}>{a.student_name}</button>{!!a.groups?.length && <small className="ws-grading-groups">{a.groups.length === 1 ? 'Група' : 'Групи'}: {a.groups.map(group => group.name).join(', ')}</small>}</td><td>{a.title}</td><td>{a.access_code ? <div className="ws-grading-code"><code>{a.access_code}</code><button type="button" className="icon-button" title="Копирай кода" aria-label="Копирай кода" onClick={() => void action.run(() => navigator.clipboard.writeText(a.access_code!), 'Кодът е копиран.')}><Copy size={15} /></button></div> : <span className="ws-muted">Няма активен код</span>}</td><td>{a.attempt_number}</td>
    <td>{hasScore ? <div className="ws-grading-score"><strong>{a.result_correct_answers} от {a.result_question_count} верни</strong><span>{Number(a.result_percentage).toFixed(2)}%</span></div> : <span className="ws-muted">{pending ? 'Очаква проверка' : '—'}</span>}</td>
    <td><span className="ws-attempt-status"><Icon size={16} className={processing ? 'ws-spin' : ''} aria-hidden="true" />{processing ? (a.ai_status === 'queued' ? 'AI в опашката' : 'AI проверява') : label(a.status)}</span>{(passed || unsuccessful) && <small className="ws-attempt-outcome">{label(a.result_outcome!)}</small>}{a.ai_status === 'completed' && finalized && <small className="ws-ai-graded">AI проверено</small>}</td>
    <td>{date(a.submitted_at)}</td><td><div className="ws-grading-actions">{pending && <button className="command-button" disabled={action.busy || processing || failed && !canRetry} title={failed ? 'Повтори AI проверката и публикувай резултата' : 'AI проверка и автоматично публикуване'} onClick={() => void runAi()}>{processing || action.busy ? <LoaderCircle size={17} className="ws-spin" aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}{failed ? 'Повтори AI' : 'AI проверка'}</button>}<button className="command-button" aria-label={finalized ? 'Преглед и корекция' : 'Ръчна проверка'} title={finalized ? 'Преглед и корекция' : 'Ръчна проверка'} onClick={open}><PencilLine size={17} />{finalized ? 'Преглед и корекция' : 'Ръчна проверка'}</button>{a.group_assignment && <button type="button" className="command-button" title={canGrant ? 'Разреши още един опит на този ученик' : remaining > 0 ? 'Ученикът вече има свободен опит' : 'Нужни са активно групово възлагане, неизтекъл срок и приключили опити'} disabled={action.busy || !canGrant} onClick={() => void perform(async () => { await api.post(`/assignments/${a.assignment_id}/recipients/${a.student_id}/extra-attempt`); return 'Разрешен е още един опит на ученика.' })}><RotateCcw size={17} /> Още един опит</button>}{finalized && <button type="button" className="command-button" disabled={action.busy || a.result_email_status === 'processing'} onClick={() => void perform(async () => {
      const delivery = await api.post<{ status: string; adapter: string }>(`/attempts/${a.id}/result-email`)
      if (delivery.adapter === 'local') return 'Резултатът е в локалната тестова поща. Реален имейл не е изпратен.'
      return delivery.status === 'sent' ? 'Резултатът вече е изпратен към имейл услугата.' : 'Резултатът и линкът за преглед са в опашката за имейл.'
    })}><Mail size={17} /> Изпрати резултата</button>}</div>{(pending || finalized) && <label className="ws-check ws-student-review-setting"><input type="checkbox" aria-label={`Разреши преглед за ${a.student_name} · Опит ${a.attempt_number}`} checked={!!a.student_review_allowed} disabled={action.busy} onChange={event => { const allowed = event.target.checked; void perform(async () => { await api.put(`/attempts/${a.id}/student-review`, { allowed }); return allowed ? 'Прегледът е разрешен за ученика.' : 'Прегледът е скрит за ученика.' }) }} /> Преглед от ученика</label>}{finalized && a.result_email_status && <small className="ws-muted">Имейл: {({ queued: 'в опашката', processing: 'изпраща се', sent: 'обработен', failed: 'неуспешен', uncertain: 'неясен статус' } as Record<string, string>)[a.result_email_status] ?? a.result_email_status}</small>}<Feedback error={action.error} />{failed && pending && <p className="ws-ai-error" role="status">{a.ai_error || 'AI проверката не успя.'}</p>}</td>
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
  return <section className="ws-section"><SectionHead title={`Опит #${id} · ${value.student.name}`}><button className="icon-button danger" title="Анулирай опита с причина" disabled={action.busy || value.attempt.status === 'voided'} onClick={() => setVoiding(true)}><Ban size={17} /></button><button className="command-button" title="Към проверките" onClick={back}><ArrowLeft size={18} /> Към проверките</button></SectionHead><Feedback error={action.error || review.error} busy={action.busy} /><p>{label(value.attempt.status)} · {points} / {max} точки · {pending} непроверени отговора</p>
    {['pending_review', 'finalized'].includes(value.attempt.status) && <label className="ws-check ws-student-review-setting"><input type="checkbox" checked={!!value.attempt.student_review_allowed} disabled={action.busy} onChange={event => { const allowed = event.target.checked; void action.run(async () => { await api.put(`/attempts/${id}/student-review`, { allowed }); await review.reload() }, allowed ? 'Прегледът е разрешен за ученика.' : 'Прегледът е скрит за ученика.') }} /> Разреши на ученика да вижда теста и отговорите си</label>}
    {value.questions.map((q, index) => <QuestionReview key={`${q.id}-${q.final_points}-${q.reviewed}`} api={api} attempt={id} number={index + 1} question={q} refresh={review.reload} />)}
    <section className="ws-publication"><h3>{correction ? 'Нова резултатна ревизия' : 'Окончателен резултат'}</h3><button className="primary command-button" disabled={pending > 0 || action.busy || value.attempt.status === 'voided'} onClick={() => setConfirm(true)}><Check size={17} /> Потвърди</button></section>
    <h3>История на резултатите</h3>{!value.revisions.length ? <Empty>Резултатът още не е публикуван.</Empty> : <table className="ws-table"><thead><tr><th>Ревизия</th><th>Точки</th><th>Оценка</th><th>Изход</th><th>Автор / дата</th><th>Причина</th></tr></thead><tbody>{value.revisions.map(r => <tr key={r.id}><td>{r.revision_number}</td><td>{r.points}/{r.maximum_points}</td><td>{r.grade}</td><td>{label(r.outcome)}</td><td>#{r.author_id} · {date(r.published_at ?? null)}</td><td>{r.reason || '-'}</td></tr>)}</tbody></table>}
    {voiding && <VoidAttemptDialog api={api} id={id} student={value.student.name} close={() => setVoiding(false)} saved={review.reload} />}
    {confirm && <dialog ref={publicationDialog} className="delete-dialog ws-publication-dialog" aria-labelledby="publish-result" aria-describedby="publish-result-summary" aria-busy={action.busy} onCancel={e => { e.preventDefault(); if (!action.busy) setConfirm(false) }}><h2 id="publish-result">{correction ? 'Публикуване на корекция' : 'Публикуване на резултат'}</h2><p id="publish-result-summary">{value.student.name} · {points}/{max} точки</p><p>Известието ще бъде адресирано до потвърдения имейл за известия на обучаемия.</p>{correction && <label>Причина за корекция<textarea required disabled={action.busy} value={reason} onChange={e => setReason(e.target.value)} /></label>}<Feedback error={action.error} /><div className="dialog-actions"><button disabled={action.busy} onClick={() => setConfirm(false)}>Отказ</button><button className="primary command-button" disabled={action.busy || correction && !reason.trim()} onClick={() => void action.run(async () => { await api.post(`/attempts/${id}/${correction ? 'result-revisions' : 'finalize'}`, { idempotencyKey: key, ...(correction ? { reason: reason.trim() } : {}) }); setKey(crypto.randomUUID()); setReason(''); setConfirm(false); await review.reload() }, 'Резултатът е публикуван; известието е в опашката.')}><Check size={17} /> Потвърди</button></div></dialog>}
  </section>
}
function VoidAttemptDialog({ api, id, student, close, saved }: { api: WorkspaceApi; id: number; student: string; close: () => void; saved: () => Promise<unknown> }) {
  const [reason, setReason] = useState('')
  return <DeleteConfirmationDialog title="Анулиране на опит" confirmLabel="Анулирай опита" successMessage="Опитът е анулиран." confirmIcon={Ban} confirmDisabled={!reason.trim()} description={<>Да анулираме ли опит #{id} на <strong>{student}</strong>? Резултатът от този опит няма да участва в обобщената оценка.</>} onCancel={close} onConfirm={async () => {
    await api.post(`/attempts/${id}/void`, { reason: reason.trim() })
    await saved()
  }}><label>Причина за анулиране<textarea required value={reason} onChange={event => setReason(event.target.value)} /></label></DeleteConfirmationDialog>
}
function QuestionReview({ api, attempt, number, question: row, refresh }: { api: WorkspaceApi; attempt: number; number: number; question: ReviewQuestion; refresh: () => Promise<unknown> }) {
  const snapshot = JSON.parse(row.definition_json) as { question: Question; options: { id: string; text: string; correct: boolean }[] }
  const submitted = row.answer_json ? JSON.parse(row.answer_json) as ExamAnswer : null
  const draft = row.draft_json ? JSON.parse(row.draft_json) as ExamAnswer : null
  const action = useAction()
  const [points, setPoints] = useState(row.final_points === null ? '' : String(row.final_points))
  const [comment, setComment] = useState(row.teacher_comment ?? '')
  const [reason, setReason] = useState(row.override_reason ?? '')
  const maximum = Number(row.maximum_points)
  const validPoints = points.trim() !== '' && Number.isFinite(Number(points)) && Number(points) >= 0 && Number(points) <= maximum
  const hasAnswer = !!submitted && (submitted.optionIds.length > 0 || !!submitted.text.trim())
  const choice = snapshot.options.length > 0
  const automatic = row.automatic_points != null && (choice || snapshot.question.type === 'SHORT_ANSWER')
  const awarded = automatic ? row.automatic_points : row.reviewed ? row.final_points ?? null : null
  const result = !hasAnswer ? 'unanswered' : awarded === null ? 'manual' : Number(awarded) >= maximum ? 'correct' : Number(awarded) > 0 ? 'partial' : 'wrong'
  const resultText = { unanswered: 'Без отговор', manual: 'За ръчна проверка', correct: automatic ? 'Верен отговор' : 'Пълни точки', partial: 'Частични точки', wrong: automatic ? 'Грешен отговор' : 'Без точки' }[result]
  const ResultIcon = result === 'correct' ? CircleCheck : result === 'wrong' ? CircleX : result === 'partial' ? CircleAlert : result === 'manual' ? Clock3 : Circle
  return <article className="ws-question ws-review-question" aria-labelledby={`review-question-${row.id}`}>
    <header className="ws-review-head"><strong id={`review-question-${row.id}`}>Въпрос {number}</strong><span className={`ws-review-verdict ws-review-${result}`} data-result={result}><ResultIcon size={17} aria-hidden="true" />{resultText}</span><span className="ws-review-points">{row.final_points ?? '-'} / {row.maximum_points} точки</span></header>
    <div role="heading" aria-level={3} className="question-heading"><QuestionText value={snapshot.question.text} /></div><WorkspaceImage api={api} id={snapshot.question.imageId} /><p className="ws-muted">{label(row.status)} · Автоматични точки: {row.automatic_points ?? 'ръчна проверка'}</p>
    <div className="ws-review-answer"><h4>Отговор на ученика</h4>
      {choice && <ul className="ws-review-choices" aria-label={`Отговори към въпрос ${number}`}>{snapshot.options.map(o => {
        const selected = submitted?.optionIds.includes(o.id) ?? false
        const state = selected ? o.correct ? 'selected-correct' : 'selected-wrong' : o.correct ? hasAnswer ? 'missed' : 'correct-option' : 'neutral'
        const Icon = state === 'selected-correct' ? CircleCheck : state === 'selected-wrong' ? CircleX : state === 'missed' ? CircleAlert : o.correct ? Check : Circle
        const marker = { 'selected-correct': 'Избран от ученика · верен', 'selected-wrong': 'Избран от ученика · грешен', missed: 'Пропуснат верен отговор', 'correct-option': 'Верен отговор', neutral: '' }[state]
        return <li key={o.id} className={`ws-review-choice ws-review-choice-${state}`} data-selected={selected} data-result={state}><Icon size={20} aria-hidden="true" /><div><span className="ws-review-choice-text">{o.text}</span>{marker && <span className="ws-review-choice-marker">{marker}</span>}</div></li>
      })}</ul>}
      {submitted?.text && <pre className={`ws-student-text ws-review-text-answer ws-review-${result}`}>{submitted.text}</pre>}
      {!hasAnswer && <p className="ws-review-no-answer">{submitted ? 'Предаден е празен отговор.' : 'Няма окончателен отговор.'}</p>}
    </div>
    {draft && <details className="ws-review-details"><summary>Запазена чернова</summary><pre className="ws-student-text">{draft.text || snapshot.options.filter(o => draft.optionIds.includes(o.id)).map(o => o.text).join('\n') || 'Празна чернова'}</pre></details>}
    {(snapshot.question.criteria || snapshot.question.acceptedAnswers.length > 0) && <p className="ws-review-criteria"><strong>Критерии:</strong> {snapshot.question.criteria || snapshot.question.acceptedAnswers.join(', ')}</p>}
    <details className="ws-review-details"><summary>Време на отговора</summary><p>Отворен: {date(row.opened_at)} · Срок: {date(row.deadline_at)} · Затворен: {date(row.closed_at)}</p></details>
    <form className="ws-form-grid" onSubmit={e => { e.preventDefault(); if (!validPoints || !e.currentTarget.reportValidity()) return; void action.run(async () => { await api.call(`/attempts/${attempt}/grading`, 'PATCH', { questionId: row.id, points: Number(points), comment, reason }); await refresh() }, 'Проверката е запазена.') }}>
      <label>Финални точки<span className="ws-grading-points"><input aria-label="Финални точки" aria-describedby={`grading-maximum-${row.id}`} type="number" required min={0} max={maximum} step="0.0001" value={points} onChange={e => { const value = e.target.value; setPoints(value === '' ? '' : Number(value) > maximum ? String(maximum) : Number(value) < 0 ? '0' : value) }} /><span id={`grading-maximum-${row.id}`} className="ws-grading-maximum">/ {maximum}</span></span></label>
      <label>Коментар<input value={comment} onChange={e => setComment(e.target.value)} /></label><label>Причина за корекция<input value={reason} onChange={e => setReason(e.target.value)} /></label><button className="command-button" disabled={action.busy || !validPoints}><Save size={17} /> Запази проверката</button>
    </form><Feedback error={action.error} />
  </article>
}
