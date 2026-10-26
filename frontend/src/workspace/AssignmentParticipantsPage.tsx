import { ArrowLeft, CalendarDays, Clock3, Copy, KeyRound, Users } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import type { Assignment } from './types'
import { AssignmentParticipants } from './AssignmentsPanel'
import { Feedback, SectionHead } from './ui'

const summaryDate = new Intl.DateTimeFormat('bg-BG', { timeZone: 'Europe/Sofia', day: '2-digit', month: 'long', year: 'numeric' })
const summaryTime = new Intl.DateTimeFormat('bg-BG', { timeZone: 'Europe/Sofia', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function AssignmentParticipantsPage({ api, id, back }: { api: WorkspaceApi; id: number; back: () => void }) {
  const assignments = useRemote<Assignment[]>(api, '/assignments', [])
  const action = useAction()
  const assignment = assignments.data.find(value => value.id === id)
  return <section className="ws-section" aria-label="Участници във възлагането">
    <SectionHead title="Участници във възлагането" description="Виж кои ученици имат достъп и следи техните опити за този тест."><button type="button" className="command-button" title="Към възлаганията" aria-label="Към възлаганията" onClick={back}><ArrowLeft size={18} /> Към възлаганията</button></SectionHead>
    <Feedback error={action.error || assignments.error || (!assignments.loading && !assignment ? 'Възлагането не е намерено или нямате достъп до него.' : '')} busy={assignments.loading} />
    {assignment && <>
      <div className="ws-assignment-context">
        <div className="ws-assignment-context-main">
          <h3>{assignment.title}</h3>
          <div className="ws-assignment-context-audience">
            <span><Users size={18} aria-hidden="true" /><span>Получатели: <output aria-label="Брой получатели">{assignment.recipients}</output></span></span>
            {!!assignment.recipient_groups?.length && <span>Групи: {assignment.recipient_groups.map(group => group.name).join(', ')}</span>}
          </div>
          <div className="ws-assignment-context-dates">
            <div className="ws-assignment-context-date"><CalendarDays size={20} aria-hidden="true" /><div><span>Начало</span><time dateTime={assignment.starts_at}><strong>{summaryTime.format(new Date(assignment.starts_at))}</strong><span>{summaryDate.format(new Date(assignment.starts_at))}</span></time></div></div>
            <div className="ws-assignment-context-date"><Clock3 size={20} aria-hidden="true" /><div><span>Краен срок</span><time dateTime={assignment.ends_at}><strong>{summaryTime.format(new Date(assignment.ends_at))}</strong><span>{summaryDate.format(new Date(assignment.ends_at))}</span></time></div></div>
          </div>
        </div>
        <div className="ws-assignment-access-panel">
          <span><KeyRound size={18} aria-hidden="true" />Код за достъп</span>
          <output aria-label="Код за достъп" title={assignment.access_code ? undefined : 'Няма активен код'}>{assignment.access_code || '—'}</output>
          <button type="button" className="command-button" aria-label="Копирай кода за достъп" disabled={action.busy || !assignment.access_code} onClick={() => void action.run(() => navigator.clipboard.writeText(assignment.access_code!), 'Кодът е копиран.')}><Copy size={17} aria-hidden="true" />Копирай кода</button>
        </div>
      </div>
      <AssignmentParticipants api={api} assignment={assignment.id} endsAt={assignment.ends_at} groups={assignment.recipient_groups ?? []} recipientsChanged={assignments.reload} />
    </>}
  </section>
}
