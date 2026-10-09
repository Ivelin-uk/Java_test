import { useEffect, useState } from 'react'
import { Play, RotateCw, FileCheck, X, Clock3, CircleCheck } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import type { Assignment, Attempt, Result, ReviewQuestion, Question, ExamAnswer } from './types'
import { date, label } from './types'
import { Empty, Feedback, SectionHead } from './ui'
import { WorkspaceImage } from './WorkspaceImage'

type ResultDetail = Result & { details?: { questions: ReviewQuestion[]; gradeOverridden: boolean; outcomeOverridden: boolean } }

export function LearnerPanel({ api, begin }: { api: WorkspaceApi; begin: (assignment: number, attempt?: number) => void }) {
  const assignments = useRemote<Assignment[]>(api, '/assignments', [])
  const attempts = useRemote<Attempt[]>(api, '/attempts', [])
  const results = useRemote<Result[]>(api, '/results', [])
  const action = useAction()
  const [detail, setDetail] = useState<ResultDetail | null>(null)
  const [linkError, setLinkError] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    const id = window.location.pathname.match(/^\/results\/(\d+)$/)?.[1]
    if (!id) return
    let active = true
    api.get<ResultDetail>('/results/' + id).then(value => { if (active) setDetail(value) }).catch(cause => { if (active) setLinkError(cause.message) })
    return () => { active = false }
  }, [api])
  const published = new Map<number, Result>()
  const finalized = new Set(attempts.data.filter(attempt => attempt.status === 'finalized').map(attempt => attempt.id))
  for (const result of results.data) {
    if (!finalized.has(result.attempt_id)) continue
    const previous = published.get(result.attempt_id)
    if (!previous || result.revision_number > previous.revision_number) published.set(result.attempt_id, result)
  }
  const summary = new Map<number, Result>()
  for (const result of published.values()) {
    const best = summary.get(result.assignment_id)
    if (!best || Number(result.percentage) > Number(best.percentage) || Number(result.percentage) === Number(best.percentage) && result.attempt_number > best.attempt_number) summary.set(result.assignment_id, result)
  }
  return <section className="ws-section"><SectionHead title="Моите тестове"><button className="icon-button" title="Обнови" onClick={() => void action.run(async () => { await assignments.reload(); await attempts.reload(); await results.reload() })}><RotateCw size={17} /></button></SectionHead><Feedback error={assignments.error || attempts.error || results.error || action.error || linkError} busy={action.busy || assignments.loading || attempts.loading || results.loading} />
    <div className="ws-table-wrap"><table className="ws-table" aria-label="Възложени тестове"><thead><tr><th>Тест</th><th>Начало</th><th>Краен срок</th><th>Опити</th><th>Оценка</th><th>Действие</th></tr></thead><tbody>{assignments.data.map(a => {
      const assignedAttempts = attempts.data.filter(attempt => attempt.assignment_id === a.id)
      const active = assignedAttempts.find(attempt => attempt.status === 'in_progress')
      const exhausted = assignedAttempts.length >= a.max_attempts
      const result = summary.get(a.id)
      return <tr key={a.id}><td>{a.title}</td><td>{date(a.starts_at)}</td><td>{date(a.ends_at)}</td><td>{assignedAttempts.length}/{a.max_attempts}</td><td>{result ? label(result.grade) + ' · опит ' + result.attempt_number : '-'}</td><td><button className="command-button" disabled={attempts.loading || !!attempts.error || !!a.canceled || !active && (exhausted || new Date(a.ends_at).getTime() <= now)} onClick={() => begin(a.id, active?.id)}><Play size={17} /> {active ? 'Продължи' : exhausted ? 'Няма оставащи опити' : 'Подготовка'}</button></td></tr>
    })}</tbody></table></div>{!assignments.data.length && !assignments.loading && <Empty>Нямате възложени тестове.</Empty>}
    <section className="ws-best-results" aria-label="Най-високи резултати"><h3>Най-висок резултат</h3>{[...summary.values()].map(result => <article className="ws-best-result" key={result.assignment_id}>
      <div><strong>{result.title}</strong><span>Възлагане №{result.assignment_id} · Опит {result.attempt_number}</span></div>
      <div className="ws-best-score"><strong>{Number(result.percentage).toFixed(2)}%</strong><span>{result.points}/{result.maximum_points} точки · Оценка {label(result.grade)}</span></div>
    </article>)}{!results.loading && !attempts.loading && !summary.size && <Empty>Няма публикувани резултати.</Empty>}</section>
    <h3>Опити и резултати</h3><div className="ws-table-wrap"><table className="ws-table" aria-label="Опити и резултати"><thead><tr><th scope="col">Тест</th><th scope="col">Опит</th><th scope="col">Статус</th><th scope="col">Предаден</th><th scope="col">Точки</th><th scope="col">Процент</th><th scope="col">Оценка</th><th scope="col">Изход</th><th scope="col">Преглед</th></tr></thead><tbody>{attempts.data.map(attempt => {
      const result = published.get(attempt.id)
      const statusClass = attempt.status === 'pending_review' ? 'ws-attempt-pending' : attempt.status === 'finalized' ? 'ws-attempt-finalized' : undefined
      return <tr key={attempt.id} className={statusClass}><td>{attempt.title}</td><td>{attempt.attempt_number}</td><td><span className="ws-attempt-status">{attempt.status === 'pending_review' && <Clock3 size={16} aria-hidden="true" />}{attempt.status === 'finalized' && <CircleCheck size={16} aria-hidden="true" />}<span>{label(attempt.status)}</span></span>{result && result.revision_number > 1 && <div className="ws-muted">Корекция №{result.revision_number - 1}</div>}</td><td>{date(attempt.submitted_at)}</td><td>{result ? `${result.points}/${result.maximum_points}` : '-'}</td><td>{result ? Number(result.percentage).toFixed(2) + '%' : '-'}</td><td>{result ? label(result.grade) : '-'}</td><td>{result ? label(result.outcome) : '-'}</td><td>{result ? <button className="icon-button" title="Преглед на резултата" disabled={action.busy} onClick={() => void action.run(async () => setDetail(await api.get('/results/' + attempt.id)))}><FileCheck size={17} /></button> : '-'}</td></tr>
    })}</tbody></table></div>{!attempts.loading && !attempts.data.length && <Empty>Няма започнати опити.</Empty>}
    {detail && <div className="ws-result"><SectionHead title={'Оценка ' + label(detail.grade) + ' · ' + label(detail.outcome)}><button className="icon-button" title="Затвори резултата" onClick={() => setDetail(null)}><X size={17} /></button></SectionHead><p>{date(detail.published_at ?? null)}{detail.revision_number > 1 ? ' · Корекция №' + (detail.revision_number - 1) : ''}</p>{detail.reason && <p>{detail.reason}</p>}{detail.details ? <ResultDetails api={api} attempt={detail.attempt_id} value={detail.details} /> : <p>Подробните отговори ще бъдат достъпни след края на разрешения период.</p>}</div>}
  </section>
}
function ResultDetails({ api, attempt, value }: { api: WorkspaceApi; attempt: number; value: NonNullable<ResultDetail['details']> }) {
  return <>{(value.gradeOverridden || value.outcomeOverridden) && <p>Учителска корекция на {value.gradeOverridden ? 'оценката' : ''}{value.gradeOverridden && value.outcomeOverridden ? ' и ' : ''}{value.outcomeOverridden ? 'изхода' : ''}.</p>}{value.questions.map(row => {
    const snapshot = JSON.parse(row.definition_json) as { question: Question; options: { id: string; text: string; correct: boolean }[] }
    const answer = row.answer_json ? JSON.parse(row.answer_json) as ExamAnswer : null
    const selected = snapshot.options.filter(o => answer?.optionIds.includes(o.id)).map(o => o.text).join(', ')
    return <article className="ws-question" key={row.id}><h3>{snapshot.question.text}</h3><WorkspaceImage api={api} id={snapshot.question.imageId} attempt={attempt} /><p>{row.final_points}/{row.maximum_points} точки · {label(row.status)}</p><h4>Вашият отговор</h4><p className="ws-answer-text">{answer ? selected || answer.text || 'Празен отговор' : 'Няма предаден отговор'}</p><h4>Верен отговор / критерии</h4><p className="ws-answer-text">{snapshot.options.filter(o => o.correct).map(o => o.text).join(', ') || snapshot.question.acceptedAnswers.join(', ') || snapshot.question.criteria}</p><p>{snapshot.question.explanation}</p>{row.teacher_comment && <p>{row.teacher_comment}</p>}</article>
  })}</>
}
