import { ArrowLeft, Copy } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useAction, useRemote } from './api'
import type { Assignment } from './types'
import { date } from './types'
import { AssignmentParticipants } from './AssignmentsPanel'
import { Feedback, SectionHead } from './ui'

export function AssignmentParticipantsPage({ api, id, back }: { api: WorkspaceApi; id: number; back: () => void }) {
  const assignments = useRemote<Assignment[]>(api, '/assignments', [])
  const action = useAction()
  const assignment = assignments.data.find(value => value.id === id)
  return <section className="ws-section" aria-label="Участници във възлагането">
    <SectionHead title="Участници във възлагането" description="Виж кои ученици имат достъп и следи техните опити за този тест."><button type="button" className="command-button" title="Към възлаганията" aria-label="Към възлаганията" onClick={back}><ArrowLeft size={18} /> Към възлаганията</button></SectionHead>
    <Feedback error={action.error || assignments.error || (!assignments.loading && !assignment ? 'Възлагането не е намерено или нямате достъп до него.' : '')} busy={assignments.loading} />
    {assignment && <>
      <div className="ws-assignment-context">
        <h3>{assignment.title}</h3>
        <div className="ws-actions ws-muted"><span>Получатели: <output aria-label="Брой получатели">{assignment.recipients}</output></span>{!!assignment.recipient_groups?.length && <span>Групи: {assignment.recipient_groups.map(group => group.name).join(', ')}</span>}</div>
        <div className="ws-actions ws-muted"><span>Начало: {date(assignment.starts_at)}</span><span>Краен срок: {date(assignment.ends_at)}</span></div>
        <div className="ws-actions"><span>Код за достъп:</span><div className="ws-group-code"><output aria-label="Код за достъп" title={assignment.access_code ? undefined : 'Няма активен код'}>{assignment.access_code || '—'}</output><button type="button" className="icon-button" aria-label="Копирай кода за достъп" title="Копирай кода за достъп" disabled={action.busy || !assignment.access_code} onClick={() => void action.run(() => navigator.clipboard.writeText(assignment.access_code!), 'Кодът е копиран.')}><Copy size={17} /></button></div></div>
      </div>
      <AssignmentParticipants api={api} assignment={assignment.id} endsAt={assignment.ends_at} groups={assignment.recipient_groups ?? []} recipientsChanged={assignments.reload} />
    </>}
  </section>
}
