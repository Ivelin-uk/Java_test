import { useEffect, useState } from 'react'
import { Play, RotateCw, FileCheck, X } from 'lucide-react'
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
  const summary = new Map<number, Result>()
  for (const result of results.data) if (!summary.has(result.assignment_id)) summary.set(result.assignment_id, result)
  return <section className="ws-section"><SectionHead title="Моите тестове"><button className="icon-button" title="Обнови" onClick={() => void action.run(async () => { await assignments.reload(); await attempts.reload(); await results.reload() })}><RotateCw size={17} /></button></SectionHead><Feedback error={assignments.error || attempts.error || results.error || action.error || linkError} busy={action.busy || assignments.loading || attempts.loading || results.loading} />
    <div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Тест</th><th>Начало</th><th>Краен срок</th><th>Опити</th><th>Оценка</th><th>Действие</th></tr></thead><tbody>{assignments.data.map(a => { const active = attempts.data.find(attempt => attempt.assignment_id === a.id && attempt.status === 'in_progress'); const result = summary.get(a.id); return <tr key={a.id}><td>{a.title}</td><td>{date(a.starts_at)}</td><td>{date(a.ends_at)}</td><td>{attempts.data.filter(attempt => attempt.assignment_id === a.id).length}/{a.max_attempts}</td><td>{result ? result.grade + ' · опит ' + result.attempt_number : '-'}</td><td><button className="command-button" disabled={!!a.canceled || !active && new Date(a.ends_at).getTime() <= now} onClick={() => begin(a.id, active?.id)}><Play size={17} /> {active ? 'Продължи' : 'Подготовка'}</button></td></tr> })}</tbody></table></div>{!assignments.data.length && !assignments.loading && <Empty>Нямате възложени тестове.</Empty>}
    <p className="ws-muted">Обобщена оценка: последният публикуван, неанулиран опит по пореден номер.</p>
    <h3>Опити</h3><div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Тест</th><th>Номер</th><th>Статус</th><th>Предаден</th></tr></thead><tbody>{attempts.data.map(a => <tr key={a.id}><td>{a.title}</td><td>{a.attempt_number}</td><td>{label(a.status)}</td><td>{date(a.submitted_at)}</td></tr>)}</tbody></table></div>
    <h3>Публикувани резултати</h3><div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Тест</th><th>Опит</th><th>Точки</th><th>Процент</th><th>Оценка</th><th>Изход</th><th>Преглед</th></tr></thead><tbody>{results.data.map(r => <tr key={r.id}><td>{r.title}{r.revision_number > 1 && <div>Корекция №{r.revision_number - 1}</div>}</td><td>{r.attempt_number}</td><td>{r.points}/{r.maximum_points}</td><td>{Number(r.percentage).toFixed(2)}%</td><td>{r.grade}</td><td>{label(r.outcome)}</td><td><button className="icon-button" title="Преглед на резултата" onClick={() => void action.run(async () => setDetail(await api.get('/results/' + r.attempt_id)))}><FileCheck size={17} /></button></td></tr>)}</tbody></table></div>{!results.loading && !results.data.length && <Empty>Няма публикувани резултати.</Empty>}{detail && <div className="ws-result"><SectionHead title={'Оценка ' + detail.grade + ' · ' + label(detail.outcome)}><button className="icon-button" title="Затвори резултата" onClick={() => setDetail(null)}><X size={17} /></button></SectionHead><p>{date(detail.published_at ?? null)}{detail.revision_number > 1 ? ' · Корекция №' + (detail.revision_number - 1) : ''}</p>{detail.reason && <p>{detail.reason}</p>}{detail.details ? <ResultDetails api={api} attempt={detail.attempt_id} value={detail.details} /> : <p>Подробните отговори ще бъдат достъпни след края на разрешения период.</p>}</div>}
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
