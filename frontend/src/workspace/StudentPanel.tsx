import { useEffect, useState } from 'react'
import { Play, RotateCw, FileCheck, Clock3, CircleCheck, CircleX } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import type { Assignment, Attempt, Result } from './types'
import { date, label } from './types'
import { Empty, Feedback, Panel, SectionHead, TableContainer } from './ui'

export function LearnerPanel({ api, begin, openResult, groupId }: { api: WorkspaceApi; openResult: (attempt: number) => void; begin: (assignment: number, attempt?: number) => void; groupId?: number }) {
  const assignments = useRemote<Assignment[]>(api, groupId === undefined ? '/assignments' : `/groups/${groupId}/assignments`, [])
  const attempts = useRemote<Attempt[]>(api, '/attempts', [])
  const results = useRemote<Result[]>(api, '/results', [])
  const action = useAction()
  const [pollError, setPollError] = useState('')
  const [now, setNow] = useState(Date.now)
  const reloadAssignments = assignments.reload
  const reloadAttempts = attempts.reload
  const reloadResults = results.reload
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    let active = true, inFlight = false, timer: ReturnType<typeof setTimeout> | undefined
    function schedule() {
      if (active && !document.hidden && navigator.onLine) timer = window.setTimeout(() => void poll(), 5000)
    }
    async function poll() {
      clearTimeout(timer)
      if (!active || inFlight || document.hidden || !navigator.onLine) return
      inFlight = true
      try {
        await Promise.all([reloadAssignments(), reloadAttempts(), reloadResults()])
        if (active) setPollError('')
      } catch (cause) {
        if (active) setPollError(cause instanceof Error ? cause.message : 'Тестовете и резултатите не могат да се обновят. Ще опитаме отново автоматично.')
      } finally {
        inFlight = false
        schedule()
      }
    }
    function resume() { clearTimeout(timer); void poll() }
    schedule()
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    return () => {
      active = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
    }
  }, [reloadAssignments, reloadAttempts, reloadResults])
  const assignmentIds = new Set(assignments.data.map(assignment => assignment.id))
  const visibleAttempts = groupId === undefined ? attempts.data : attempts.data.filter(attempt => assignmentIds.has(attempt.assignment_id))
  const visibleResults = groupId === undefined ? results.data : results.data.filter(result => assignmentIds.has(result.assignment_id))
  const published = new Map<number, Result>()
  const finalized = new Set(visibleAttempts.filter(attempt => attempt.status === 'finalized').map(attempt => attempt.id))
  for (const result of visibleResults) {
    if (!finalized.has(result.attempt_id)) continue
    const previous = published.get(result.attempt_id)
    if (!previous || result.revision_number > previous.revision_number) published.set(result.attempt_id, result)
  }
  const summary = new Map<number, Result>()
  for (const result of published.values()) {
    const best = summary.get(result.assignment_id)
    if (!best || Number(result.percentage) > Number(best.percentage) || Number(result.percentage) === Number(best.percentage) && result.attempt_number > best.attempt_number) summary.set(result.assignment_id, result)
  }
  return <section className="ws-section"><SectionHead title={groupId === undefined ? 'Моите тестове' : 'Тестове за групата'} description="Тестовете и резултатите се обновяват автоматично."><button className="icon-button" title="Обнови" onClick={() => void action.run(async () => { await assignments.reload(); await attempts.reload(); await results.reload(); setPollError('') })}><RotateCw size={17} /></button></SectionHead><Feedback error={assignments.error || attempts.error || results.error || action.error || pollError} busy={action.busy || assignments.loading || attempts.loading || results.loading} />
    <Panel title="Тестове за решаване" description="Провери срока и избери „Подготовка“. За започнат тест използвай „Продължи“.">
    <TableContainer label="Възложени тестове — таблица"><table className="ws-table" aria-label="Възложени тестове"><thead><tr><th>Тест</th><th>Статус</th><th>Начало</th><th>Краен срок</th><th>Опити</th><th>Оценка</th><th>Действие</th></tr></thead><tbody>{assignments.data.map(a => {
      const assignedAttempts = visibleAttempts.filter(attempt => attempt.assignment_id === a.id)
      const active = assignedAttempts.find(attempt => attempt.status === 'in_progress')
      const exhausted = assignedAttempts.length >= a.max_attempts
      const result = summary.get(a.id)
      const availability = a.canceled ? 'canceled' : new Date(a.ends_at).getTime() <= now ? 'expired' : new Date(a.starts_at).getTime() > now ? 'upcoming' : 'active'
      const availabilityLabel = { active: 'Активен', expired: 'Срокът е изтекъл', upcoming: 'Предстоящ', canceled: 'Отменен' }[availability]
      const AvailabilityIcon = availability === 'active' ? Play : availability === 'canceled' ? CircleX : Clock3
      return <tr key={a.id} className={`ws-assignment-${availability}`}><td><div>{a.title}</div>{a.teacher_name && <small className="ws-assignment-teacher">Възложил: {a.teacher_name}</small>}</td><td><span className="ws-assignment-availability"><AvailabilityIcon size={16} aria-hidden="true" /><span>{availabilityLabel}</span></span></td><td>{date(a.starts_at)}</td><td>{date(a.ends_at)}</td><td>{assignedAttempts.length}/{a.max_attempts}</td><td>{result ? label(result.grade) + ' · опит ' + result.attempt_number : '-'}</td><td><button className="command-button" disabled={attempts.loading || !!attempts.error || !!a.canceled || !active && (exhausted || new Date(a.ends_at).getTime() <= now)} onClick={() => begin(a.id, active?.id)}><Play size={17} /> {active ? 'Продължи' : exhausted ? 'Няма оставащи опити' : 'Подготовка'}</button></td></tr>
    })}</tbody></table></TableContainer>{!assignments.data.length && !assignments.loading && <Empty>Нямате възложени тестове.</Empty>}
    </Panel>
    <section className="ws-best-results" aria-label="Най-високи резултати"><h3>Най-висок резултат</h3>{[...summary.values()].map(result => <article className="ws-best-result" key={result.assignment_id}>
      <div><strong>{result.title}</strong><span>Опит {result.attempt_number}</span></div>
      <div className={result.outcome === 'failed' ? 'ws-best-score ws-best-score-failed' : 'ws-best-score'}><strong>{Number(result.percentage).toFixed(2)}%</strong><span>{result.points}/{result.maximum_points} точки · Оценка {label(result.grade)} · {label(result.outcome)}</span></div>
    </article>)}{!results.loading && !attempts.loading && !summary.size && <Empty>Няма публикувани резултати.</Empty>}</section>
    <Panel title="Опити и резултати" description="След предаване тук ще видиш статуса, точките и оценката. Прегледът на отговорите е достъпен, когато учителят го разреши."><TableContainer label="Опити и резултати — таблица"><table className="ws-table" aria-label="Опити и резултати"><thead><tr><th scope="col">Тест</th><th scope="col">Опит</th><th scope="col">Статус</th><th scope="col">Предаден</th><th scope="col">Точки</th><th scope="col">Процент</th><th scope="col">Оценка</th><th scope="col">Изход</th><th scope="col">Преглед</th></tr></thead><tbody>{visibleAttempts.map(attempt => {
      const result = published.get(attempt.id)
      const failed = result?.outcome === 'failed'
      const statusClass = attempt.status === 'pending_review' ? 'ws-attempt-pending' : attempt.status === 'finalized' ? failed ? 'ws-attempt-finalized ws-attempt-failed' : 'ws-attempt-finalized' : undefined
      return <tr key={attempt.id} className={statusClass}><td>{attempt.title}</td><td>{attempt.attempt_number}</td><td><span className="ws-attempt-status">{attempt.status === 'pending_review' && <Clock3 size={16} aria-hidden="true" />}{attempt.status === 'finalized' && (failed ? <CircleX size={16} aria-hidden="true" /> : <CircleCheck size={16} aria-hidden="true" />)}<span>{label(attempt.status)}</span></span>{result && result.revision_number > 1 && <div className="ws-muted">Корекция №{result.revision_number - 1}</div>}</td><td>{date(attempt.submitted_at)}</td><td>{result ? `${result.points}/${result.maximum_points}` : '-'}</td><td>{result ? Number(result.percentage).toFixed(2) + '%' : '-'}</td><td>{result ? label(result.grade) : '-'}</td><td className="ws-attempt-outcome">{result ? label(result.outcome) : '-'}</td><td>{result?.review_available ? <button className="command-button" aria-label="Преглед на резултата" title="Преглед на резултата" disabled={action.busy} onClick={() => openResult(attempt.id)}><FileCheck size={17} /> Преглед</button> : '-'}</td></tr>
    })}</tbody></table></TableContainer>{!attempts.loading && !visibleAttempts.length && <Empty>Няма започнати опити.</Empty>}
    </Panel>
  </section>
}
