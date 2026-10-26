import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ArrowUpRight, BookOpen, ClipboardList, CreditCard, GraduationCap, LayoutDashboard, LogOut, Shield, UserRound, Users } from 'lucide-react'
import type { AuthResponse } from '../types/models'
import { roleLabels } from '../api/access'
import { AdminPanel } from '../components/AdminPanel'
import { ProfilePanel } from '../components/ProfilePanel'
import { workspaceClient, useRemote } from './api'
import type { WorkspaceApi } from './api'
import type { Assignment, Attempt, Group, Result } from './types'
import { AssessmentEditor } from './AssessmentEditor'
import { GroupsPanel } from './GroupsPanel'
import { AssignmentsPanel } from './AssignmentsPanel'
import { AssignmentParticipantsPage } from './AssignmentParticipantsPage'
import { GradingPanel } from './GradingPanel'
import { BillingPanel } from './BillingPanel'
import { LearnerPanel } from './StudentPanel'
import { ResultReviewPage } from './ResultReviewPage'
import { ExamScreen } from './ExamScreen'
import { NotificationEmailVerification, WorkspaceProfile } from './AccountPanels'
import { Feedback, Panel, SectionHead } from './ui'
import './workspace.css'
import { ThemeToggle } from '../components/ThemeToggle'

type View = 'dashboard' | 'groups' | 'tests' | 'assignments' | 'grading' | 'billing' | 'learner' | 'profile' | 'admin'

type WorkspaceScreen = { view: View; participants: number | null; result: number | null }

function workspaceLocation(fallback: View): WorkspaceScreen {
  const path = window.location.pathname
  const match = path.match(/^\/assignments\/([1-9][0-9]{0,14})\/participants$/)
  if (match) return { view: 'assignments', participants: Number(match[1]), result: null }
  if (path === '/assignments') return { view: 'assignments', participants: null, result: null }
  if (path === '/billing') return { view: 'billing', participants: null, result: null }
  const resultMatch = path.match(/^\/results\/([1-9][0-9]{0,14})$/)
  if (resultMatch) return { view: 'learner', participants: null, result: Number(resultMatch[1]) }
  if (path.startsWith('/verify-email')) return { view: 'profile', participants: null, result: null }
  const view = history.state?.examaiView
  return { view: ['dashboard', 'groups', 'tests', 'assignments', 'grading', 'billing', 'learner', 'profile', 'admin'].includes(view) ? view : fallback, participants: null, result: null }
}

export function ExamWorkspace({ auth, logout, onAuth, refreshProfile }: { auth: AuthResponse; logout: () => Promise<void>; onAuth: (auth: AuthResponse) => void; refreshProfile: () => Promise<void> }) {
  const api = useMemo(() => workspaceClient(auth.token), [auth.token])
  const teacher = auth.user.role === 'TEACHER', student = auth.user.role === 'STUDENT', admin = auth.user.role === 'ADMIN'
  const [screen, setScreen] = useState(() => workspaceLocation(admin ? 'admin' : 'dashboard'))
  const view = screen.view
  useEffect(() => {
    const changed = () => setScreen(workspaceLocation(admin ? 'admin' : 'dashboard'))
    window.addEventListener('popstate', changed)
    return () => window.removeEventListener('popstate', changed)
  }, [admin])
  function navigate(next: View, participants: number | null = null) {
    const path = next === 'assignments' ? participants === null ? '/assignments' : `/assignments/${participants}/participants` : next === 'billing' ? '/billing' : '/'
    if (window.location.pathname !== path || view !== next) history.pushState({ examaiView: next }, '', path)
    setScreen({ view: next, participants, result: null })
    window.scrollTo({ top: 0 })
  }
  function openResult(attempt: number) {
    const path = `/results/${attempt}`
    if (window.location.pathname !== path) history.pushState({ examaiView: 'learner' }, '', path)
    setScreen({ view: 'learner', participants: null, result: attempt })
    window.scrollTo({ top: 0 })
  }
  const [exam, setExam] = useState<{ assignment: number; attempt?: number; code?: string } | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const available: { key: View; name: string; icon: typeof Users }[] = [
    ...(!admin ? [{ key: 'dashboard' as View, name: 'Табло', icon: LayoutDashboard }, { key: 'groups' as View, name: 'Групи', icon: Users }] : []),
    ...(teacher ? [{ key: 'tests' as View, name: 'Тестове', icon: BookOpen }, { key: 'assignments' as View, name: 'Възлагания', icon: ClipboardList }, { key: 'grading' as View, name: 'Проверка', icon: GraduationCap }, { key: 'billing' as View, name: 'Абонамент', icon: CreditCard }] : []),
    ...(student ? [{ key: 'learner' as View, name: 'Моите тестове', icon: ClipboardList }] : []),
    ...(admin ? [{ key: 'admin' as View, name: 'Администрация', icon: Shield }] : []),
    { key: 'profile', name: 'Профил', icon: UserRound },
  ]
  const actualView = available.some(item => item.key === view) ? view : 'profile'
  if (auth.user.passwordChangeRequired) return <main className="app-shell"><h1>Смяна на временната парола</h1><ProfilePanel auth={auth} onAuth={onAuth} /></main>
  if (exam) return <ExamScreen key={exam.assignment} api={api} user={auth.user.id} assignment={exam.assignment} resume={exam.attempt} initialCode={exam.code} openAssignment={(assignment, code) => setExam({ assignment, code })} back={() => { setExam(null); if (view !== 'groups') navigate('learner') }} />
  return <main className="ws-shell">
    <a className="ws-skip-link" href="#workspace-content">Към съдържанието</a>
    <header className="ws-topbar"><a className="ws-brand" href="/" aria-label="ExamAI — начало"><span className="ws-brand-icon"><BookOpen size={23} aria-hidden="true" /></span>ExamAI</a><div className="ws-account"><strong>{auth.user.name}</strong><span>{roleLabels[auth.user.role]}</span></div><ThemeToggle /><button className="icon-button" title="Изход" aria-label="Изход" onClick={() => void logout()}><LogOut size={18} /></button></header>
    <nav className="ws-nav" aria-label="Основна навигация">{available.map(({ key, name, icon: Icon }) => <button key={key} className={actualView === key ? 'active' : ''} aria-current={actualView === key ? 'page' : undefined} onClick={() => navigate(key)}><Icon size={18} aria-hidden="true" />{name}</button>)}</nav>
    <div className="ws-body" id="workspace-content" tabIndex={-1}>
      {actualView === 'dashboard' && <Dashboard api={api} teacher={teacher} navigate={navigate} />}
      {actualView === 'groups' && <GroupsPanel api={api} openResult={openResult} teacher={teacher} selected={selectedGroup} setSelected={setSelectedGroup} begin={(assignment, attempt) => setExam({ assignment, attempt })} />}
      {actualView === 'tests' && <AssessmentEditor api={api} userId={auth.user.id} />}
      {actualView === 'assignments' && (screen.participants === null
        ? <AssignmentsPanel api={api} userId={auth.user.id} openParticipants={id => navigate('assignments', id)} />
        : <AssignmentParticipantsPage key={screen.participants} api={api} id={screen.participants} back={() => navigate('assignments')} />)}
      {actualView === 'grading' && <GradingPanel api={api} />}
      {actualView === 'billing' && <BillingPanel key={window.location.search} api={api} checkout={new URLSearchParams(window.location.search).get('checkout')} />}
      {actualView === 'learner' && (screen.result === null
        ? <LearnerPanel api={api} openResult={openResult} begin={(assignment, attempt) => setExam({ assignment, attempt })} />
        : <ResultReviewPage key={screen.result} api={api} attempt={screen.result} back={() => navigate('learner')} />)}
      {actualView === 'profile' && (window.location.pathname.startsWith('/verify-email')
        ? <NotificationEmailVerification api={api} back={() => navigate('profile')} />
        : <WorkspaceProfile api={api} auth={auth} onAuth={onAuth} />)}
      {actualView === 'admin' && <section className="ws-section"><SectionHead title="Администрация" description="Управлявай потребителите и правата за достъп. В журнала можеш да проследиш направените промени." /><AdminPanel auth={auth} onProfileRefresh={refreshProfile} /></section>}
    </div>
  </main>
}

function Dashboard({ api, teacher, navigate }: { api: WorkspaceApi; teacher: boolean; navigate: (view: View) => void }) {
  const groups = useRemote<Group[]>(api, '/groups', [])
  const assignments = useRemote<Assignment[]>(api, '/assignments', [])
  const records = useRemote<(Attempt | Result)[]>(api, teacher ? '/grading' : '/results', [])
  const steps: { title: string; description: string; view: View; icon: typeof Users }[] = teacher ? [
    { title: 'Създай група', description: 'Събери учениците на едно място и им изпрати кода за присъединяване.', view: 'groups', icon: Users },
    { title: 'Подготви тест', description: 'Добави свои въпроси, създай ги с AI или използвай споделен тест.', view: 'tests', icon: BookOpen },
    { title: 'Възложи на учениците', description: 'Избери тест, група и срок. След предаването отвори „Проверка“.', view: 'assignments', icon: ClipboardList },
  ] : [
    { title: 'Присъедини се към група', description: 'Отвори „Групи“ и въведи кода, който ти е дал учителят.', view: 'groups', icon: Users },
    { title: 'Отвори възложения тест', description: 'В „Моите тестове“ виж срока и избери „Подготовка“, за да започнеш.', view: 'learner', icon: ClipboardList },
    { title: 'Виж резултата си', description: 'След проверката виж точките и оценката в „Опити и резултати“.', view: 'learner', icon: GraduationCap },
  ]
  return <section className="ws-section">
    <SectionHead title="Моето табло" description={teacher ? 'Твоите групи, възложени тестове и проверки — всичко започва оттук.' : 'Виж възложените тестове, следи сроковете и намери резултатите си.'} />
    <Feedback error={groups.error || assignments.error || records.error} busy={groups.loading || assignments.loading || records.loading} />
    <div className="ws-metrics" role="group" aria-label="Статистика">
      <button type="button" title="Към групите" aria-busy={groups.loading} onClick={() => navigate('groups')}>
        <span>Групи<ArrowUpRight size={17} aria-hidden="true" /></span>
        <strong>{groups.loading || groups.error ? '-' : groups.data.length}</strong>
      </button>
      <button type="button" title={teacher ? 'Към възлаганията' : 'Към моите тестове'} aria-busy={assignments.loading} onClick={() => navigate(teacher ? 'assignments' : 'learner')}>
        <span>Възложени тестове<ArrowUpRight size={17} aria-hidden="true" /></span>
        <strong>{assignments.loading || assignments.error ? '-' : assignments.data.length}</strong>
      </button>
      <button type="button" title={teacher ? 'Към проверките' : 'Към резултатите'} aria-busy={records.loading} onClick={() => navigate(teacher ? 'grading' : 'learner')}>
        <span>{teacher ? 'Чакащи проверки' : 'Публикувани резултати'}<ArrowUpRight size={17} aria-hidden="true" /></span>
        <strong>{records.loading || records.error ? '-' : teacher ? records.data.filter(item => 'status' in item && item.status === 'pending_review').length : records.data.length}</strong>
      </button>
    </div>
    <Panel title="Откъде да започна" description={teacher ? 'Следвай тези три стъпки, за да проведеш първия си тест.' : 'Три лесни стъпки от присъединяването до резултата.'}>
      <div className="ws-start-steps">{steps.map(({ title, description, view: destination, icon: Icon }, index) => <button type="button" className="ws-start-step" key={title} onClick={() => navigate(destination)}>
        <span className="ws-step-top"><span className="ws-step-icon"><Icon size={22} aria-hidden="true" /></span><span className="ws-step-number">Стъпка {index + 1}</span></span>
        <strong>{title}</strong><span className="ws-step-description">{description}</span><span className="ws-step-link">Отвори раздела <ArrowRight size={17} aria-hidden="true" /></span>
      </button>)}</div>
    </Panel>
  </section>
}
