import { ArrowLeft } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useRemote } from './api'
import type { Assignment } from './types'
import { date } from './types'
import { AssignmentParticipants } from './AssignmentsPanel'
import { Feedback, SectionHead } from './ui'

export function AssignmentParticipantsPage({ api, id, back }: { api: WorkspaceApi; id: number; back: () => void }) {
  const assignments = useRemote<Assignment[]>(api, '/assignments', [])
  const assignment = assignments.data.find(value => value.id === id)
  return <section className="ws-section" aria-label="Участници във възлагането">
    <SectionHead title="Участници във възлагането"><button type="button" className="icon-button" title="Към възлаганията" aria-label="Към възлаганията" onClick={back}><ArrowLeft size={18} /></button></SectionHead>
    <Feedback error={assignments.error || (!assignments.loading && !assignment ? 'Възлагането не е намерено или нямате достъп до него.' : '')} busy={assignments.loading} />
    {assignment && <>
      <div className="ws-assignment-context">
        <h3>{assignment.title}</h3>
        <div className="ws-actions ws-muted"><span>Възлагане №{assignment.id}</span><span>Получатели: <output aria-label="Брой получатели">{assignment.recipients}</output></span>{!!assignment.recipient_groups?.length && <span>Групи: {assignment.recipient_groups.map(group => group.name).join(', ')}</span>}</div>
        <div className="ws-actions ws-muted"><span>Начало: {date(assignment.starts_at)}</span><span>Краен срок: {date(assignment.ends_at)}</span></div>
      </div>
      <AssignmentParticipants api={api} assignment={assignment.id} endsAt={assignment.ends_at} groupAssignment={!!assignment.recipient_groups?.length} recipientsChanged={assignments.reload} />
    </>}
  </section>
}
