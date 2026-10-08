import { useMemo, useState } from 'react'
import { BookOpen, ClipboardList, GraduationCap, LayoutDashboard, LogOut, Shield, UserRound, Users } from 'lucide-react'
import type { AuthResponse } from '../types/models'
import { roleLabels } from '../api/access'
import { AdminPanel } from '../components/AdminPanel'
import { ProfilePanel } from '../components/ProfilePanel'
import { workspaceClient, useRemote } from './api'
import type { WorkspaceApi } from './api'
import type { Assignment, Attempt, Result } from './types'
import { date } from './types'
import { AssessmentEditor } from './AssessmentEditor'
import { GroupsPanel } from './GroupsPanel'
import { AssignmentsPanel } from './AssignmentsPanel'
import { GradingPanel } from './GradingPanel'
import { LearnerPanel } from './StudentPanel'
import { ExamScreen } from './ExamScreen'
import { WorkspaceProfile } from './AccountPanels'
import { Empty, Feedback, SectionHead } from './ui'
import './workspace.css'

type View = 'dashboard' | 'groups' | 'tests' | 'assignments' | 'grading' | 'learner' | 'profile' | 'admin'

export function ExamWorkspace({ auth, logout, onAuth, refreshProfile }: { auth: AuthResponse; logout: () => Promise<void>; onAuth: (auth: AuthResponse) => void; refreshProfile: () => Promise<void> }) {
  const api = useMemo(() => workspaceClient(auth.token), [auth.token])
  const teacher = auth.user.role === 'TEACHER', student = auth.user.role === 'STUDENT', admin = auth.user.role === 'ADMIN'
  const [view, setView] = useState<View>(() => window.location.pathname.startsWith('/results/') ? 'learner' : window.location.pathname.startsWith('/verify-email') ? 'profile' : admin ? 'admin' : 'dashboard')
  const [exam, setExam] = useState<{ assignment: number; attempt?: number } | null>(null)
  const available: { key: View; name: string; icon: typeof Users }[] = [
    ...(!admin ? [{ key: 'dashboard' as View, name: 'Табло', icon: LayoutDashboard }, { key: 'groups' as View, name: 'Групи', icon: Users }] : []),
    ...(teacher ? [{ key: 'tests' as View, name: 'Тестове', icon: BookOpen }, { key: 'assignments' as View, name: 'Възлагания', icon: ClipboardList }, { key: 'grading' as View, name: 'Проверка', icon: GraduationCap }] : []),
    ...(student ? [{ key: 'learner' as View, name: 'Моите тестове', icon: ClipboardList }] : []),
    ...(admin ? [{ key: 'admin' as View, name: 'Администрация', icon: Shield }] : []),
    { key: 'profile', name: 'Профил', icon: UserRound },
  ]
  const actualView = available.some(item => item.key === view) ? view : 'profile'
  if (auth.user.passwordChangeRequired) return <main className="app-shell"><h1>Смяна на временната парола</h1><ProfilePanel auth={auth} onAuth={onAuth} /></main>
  if (exam) return <ExamScreen key={exam.assignment} api={api} user={auth.user.id} assignment={exam.assignment} resume={exam.attempt} back={() => { setExam(null); setView('learner') }} />
  return <main className="ws-shell">
    <header className="ws-topbar"><a className="ws-brand" href="/">ExamAI</a><div className="ws-account"><strong>{auth.user.name}</strong><span>{roleLabels[auth.user.role]}</span></div><button className="icon-button" title="Изход" aria-label="Изход" onClick={() => void logout()}><LogOut size={18} /></button></header>
    <nav className="ws-nav" aria-label="Основна навигация">{available.map(({ key, name, icon: Icon }) => <button key={key} className={actualView === key ? 'active' : ''} onClick={() => setView(key)}><Icon size={17} />{name}</button>)}</nav>
    <div className="ws-body">
      {actualView === 'dashboard' && <Dashboard api={api} teacher={teacher} />}
      {actualView === 'groups' && <GroupsPanel api={api} teacher={teacher} />}
      {actualView === 'tests' && <AssessmentEditor api={api} userId={auth.user.id} />}
      {actualView === 'assignments' && <AssignmentsPanel api={api} />}
      {actualView === 'grading' && <GradingPanel api={api} />}
      {actualView === 'learner' && <LearnerPanel api={api} begin={(assignment, attempt) => setExam({ assignment, attempt })} />}
      {actualView === 'profile' && <WorkspaceProfile api={api} auth={auth} onAuth={onAuth} />}
      {actualView === 'admin' && <AdminPanel auth={auth} onProfileRefresh={refreshProfile} />}
    </div>
  </main>
}

function Dashboard({ api, teacher }: { api: WorkspaceApi; teacher: boolean }) {
  const assignments = useRemote<Assignment[]>(api, '/assignments', [])
  const records = useRemote<(Attempt | Result)[]>(api, teacher ? '/grading' : '/results', [])
  return <section className="ws-section"><SectionHead title="Моето табло" /><Feedback error={assignments.error || records.error} busy={assignments.loading} /><div className="ws-metrics"><div><span>Възложени тестове</span><strong>{assignments.data.length}</strong></div><div><span>{teacher ? 'Чакащи проверки' : 'Публикувани резултати'}</span><strong>{teacher ? records.data.filter(item => 'status' in item && item.status === 'pending_review').length : records.data.length}</strong></div></div><h3>Възлагания</h3><div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>Тест</th><th>Начало</th><th>Краен срок</th></tr></thead><tbody>{assignments.data.slice(0, 8).map(item => <tr key={item.id}><td>{item.title}</td><td>{date(item.starts_at)}</td><td>{date(item.ends_at)}</td></tr>)}</tbody></table></div>{!assignments.data.length && !assignments.loading && <Empty />}</section>
}
