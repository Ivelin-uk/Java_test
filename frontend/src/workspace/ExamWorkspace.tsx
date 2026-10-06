import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Building2, ClipboardList, CreditCard, GraduationCap, LayoutDashboard, LogOut, MessageSquare, Plus, Settings, Shield, UserRound, Users } from 'lucide-react'
import type { AuthResponse } from '../types/models'
import { PlatformPanel } from './PlatformPanel'
import { SettingsPanel } from './SettingsPanel'
import { ProfilePanel } from '../components/ProfilePanel'
import { workspaceClient, useAction, useRemote } from './api'
import type { WorkspaceApi } from './api'
import type { Assignment, Attempt, Organization, Result } from './types'
import { date, label, roleNames, roles } from './types'
import { AssessmentEditor } from './AssessmentEditor'
import { GroupsPanel } from './GroupsPanel'
import { AssignmentsPanel } from './AssignmentsPanel'
import { GradingPanel } from './GradingPanel'
import { LearnerPanel } from './StudentPanel'
import { ExamScreen } from './ExamScreen'
import { BillingPanel, MembersPanel, WorkspaceProfile } from './AccountPanels'
import { ChatPanel } from './ChatPanel'
import { Empty, Feedback, SectionHead } from './ui'
import './workspace.css'
import { WorkspaceImage } from './WorkspaceImage'

type View = 'dashboard' | 'groups' | 'tests' | 'assignments' | 'grading' | 'learner' | 'chat' | 'billing' | 'members' | 'settings' | 'profile' | 'platform'
export function ExamWorkspace({ auth, logout, onAuth, refreshProfile }: { auth: AuthResponse; logout: () => Promise<void>; onAuth: (auth: AuthResponse) => void; refreshProfile: () => Promise<void> }) {
  const globalApi = useMemo(() => workspaceClient(auth.token), [auth.token])
  const organizations = useRemote<Organization[]>(globalApi, '/organizations', [])
  const [selected, setSelected] = useState(() => Number(new URLSearchParams(window.location.search).get('organization')) || Number(localStorage.getItem(`examai.organization.${auth.user.id}`)) || 0)
  const organization = organizations.data.find(o => o.id === selected) ?? organizations.data[0]
  const api = useMemo(() => workspaceClient(auth.token, organization?.id), [auth.token, organization?.id])
  const orgRoles = organization ? roles(organization) : []
  const teacher = orgRoles.includes('TEACHER'), admin = orgRoles.includes('ORG_ADMIN'), student = orgRoles.includes('STUDENT')
  const [view, setView] = useState<View>(window.location.pathname.startsWith('/results/') ? 'learner' : window.location.pathname.startsWith('/verify-email') || window.location.hash.includes('invitation=') ? 'profile' : 'dashboard')
  const [create, setCreate] = useState(false)
  const [conversation, setConversation] = useState<number | null>(null)
  useEffect(() => { const open = (event: Event) => { setConversation((event as CustomEvent<number>).detail); setView('chat') }; window.addEventListener('examai:open-chat', open); return () => window.removeEventListener('examai:open-chat', open) }, [])
  const [exam, setExam] = useState<{ assignment: number; attempt?: number } | null>(null)
  const reloadOrganizations = organizations.reload
  const organizationId = organization?.id
  const userId = auth.user.id
  useEffect(() => {
    const refresh = () => { void reloadOrganizations() }
    window.addEventListener('examai:organizations-refresh', refresh)
    return () => window.removeEventListener('examai:organizations-refresh', refresh)
  }, [reloadOrganizations])
  useEffect(() => { if (organizationId) localStorage.setItem(`examai.organization.${userId}`, String(organizationId)) }, [organizationId, userId])
  const available: { key: View; name: string; icon: typeof Users }[] = [
    ...(organization ? [{ key: 'dashboard' as View, name: 'Табло', icon: LayoutDashboard }, { key: 'groups' as View, name: 'Групи', icon: Users }] : []),
    ...(teacher ? [{ key: 'tests' as View, name: 'Тестове', icon: BookOpen }, { key: 'assignments' as View, name: 'Възлагания', icon: ClipboardList }, { key: 'grading' as View, name: 'Проверка', icon: GraduationCap }] : []),
    ...(student ? [{ key: 'learner' as View, name: 'Моите тестове', icon: ClipboardList }] : []),
    ...(organization ? [{ key: 'chat' as View, name: 'Чат', icon: MessageSquare }, { key: 'billing' as View, name: 'Абонамент', icon: CreditCard }] : []),
    ...(admin ? [{ key: 'members' as View, name: 'Членове', icon: Shield }, { key: 'settings' as View, name: 'Настройки', icon: Settings }] : []),
    { key: 'profile', name: 'Профил', icon: UserRound },
    ...(auth.user.role === 'ADMIN' ? [{ key: 'platform' as View, name: 'Платформа', icon: Settings }] : []),
  ]
  const actualView = available.some(v => v.key === view) ? view : auth.user.role === 'ADMIN' ? 'platform' : 'profile'
  if (exam && organization) return <ExamScreen key={`${organization.id}-${exam.assignment}`} api={api} organization={organization.id} user={auth.user.id} assignment={exam.assignment} resume={exam.attempt} back={() => { setExam(null); setView('learner') }} />
  if (auth.user.passwordChangeRequired) return <main className="app-shell"><h1>Смяна на временната парола</h1><ProfilePanel auth={auth} onAuth={onAuth} /></main>
  return <main className="ws-shell">
    <header className="ws-topbar"><a className="ws-brand" href="/">ExamAI</a><WorkspaceImage api={api} id={organization?.logo_id} logo /><label className="ws-org-selector"><Building2 size={18} /><select aria-label="Активна организация" value={organization?.id ?? ''} onChange={e => { setSelected(Number(e.target.value)); setView('dashboard') }}><option value="" disabled>{organizations.loading ? 'Зареждане...' : 'Няма организация'}</option>{organizations.data.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label><button className="icon-button" title="Нова организация" onClick={() => setCreate(true)}><Plus size={18} /></button><div className="ws-account"><strong>{auth.user.name}</strong><span>{orgRoles.map(r => r === 'STUDENT' ? organization?.student_label : roleNames[r]).join(' · ') || (auth.user.role === 'ADMIN' ? 'Администратор на платформата' : 'Без активно членство')}</span></div><button className="icon-button" title="Изход" aria-label="Изход" onClick={() => void logout()}><LogOut size={18} /></button></header>
    <nav className="ws-nav" aria-label="Основна навигация">{available.map(({ key, name, icon: Icon }) => <button key={key} className={actualView === key ? 'active' : ''} onClick={() => setView(key)}><Icon size={17} />{name}</button>)}</nav>
    <Feedback error={organizations.error} /><div className="ws-body" key={organization?.id ?? 'global'}>
      {actualView === 'dashboard' && organization && (admin && !teacher && !student ? <AdminDashboard api={api} organization={organization} /> : <Dashboard api={api} teacher={teacher} organization={organization} />)}
      {actualView === 'groups' && <GroupsPanel api={api} teacher={teacher} />}
      {actualView === 'tests' && <AssessmentEditor api={api} userId={auth.user.id} />}
      {actualView === 'assignments' && <AssignmentsPanel api={api} />}
      {actualView === 'grading' && <GradingPanel api={api} />}
      {actualView === 'learner' && <LearnerPanel api={api} begin={(assignment, attempt) => setExam({ assignment, attempt })} />}
      {actualView === 'chat' && <ChatPanel key={conversation ?? 0} api={api} teacher={teacher} admin={admin} initial={conversation} />}
      {actualView === 'billing' && <BillingPanel api={api} admin={admin} />}
      {actualView === 'members' && <MembersPanel api={api} />}
      {actualView === 'settings' && <SettingsPanel api={api} />}
      {actualView === 'profile' && <WorkspaceProfile api={api} auth={auth} onAuth={onAuth} />}
      {actualView === 'platform' && <PlatformPanel api={globalApi} auth={auth} refresh={refreshProfile} />}
    </div>{create && <NewOrganization api={globalApi} close={() => setCreate(false)} created={async id => { await organizations.reload(); setSelected(id); setView('dashboard'); setCreate(false) }} />}
  </main>
}
function AdminDashboard({ api, organization }: { api: WorkspaceApi; organization: Organization }) {
  const metrics = useRemote<Record<string, number> | null>(api, '/metrics', null)
  return <section className="ws-section"><SectionHead title={organization.name} /><Feedback error={metrics.error} busy={metrics.loading} /><div className="ws-metrics">{([['members', 'Активни членове'], ['activeAttempts', 'Активни опити'], ['pendingReviews', 'Чакащи проверки'], ['mailFailures', 'Проблеми с доставки']] as const).map(([key, title]) => <div key={key}><span>{title}</span><strong>{metrics.data?.[key] ?? '-'}</strong></div>)}</div></section>
}
function Dashboard({ api, teacher, organization }: { api: WorkspaceApi; teacher: boolean; organization: Organization }) {
  const assignments = useRemote<Assignment[]>(api, '/assignments', [])
  const records = useRemote<(Attempt | Result)[]>(api, teacher ? '/grading' : '/results', [])
  return <section className="ws-section"><SectionHead title={organization.name} /><Feedback error={assignments.error || records.error} busy={assignments.loading} /><div className="ws-metrics"><div><span>Възложени тестове</span><strong>{assignments.data.length}</strong></div><div><span>{teacher ? 'Чакащи проверки' : 'Публикувани резултати'}</span><strong>{teacher ? records.data.filter(a => 'status' in a && a.status === 'pending_review').length : records.data.length}</strong></div><div><span>Организационен абонамент</span><strong className="ws-metric-text">{label(organization.subscription_status)}</strong><small>до {date(organization.paid_through)}</small></div></div><h3>Възлагания</h3><table className="ws-table"><thead><tr><th>Тест</th><th>Начало</th><th>Краен срок</th></tr></thead><tbody>{assignments.data.slice(0, 8).map(a => <tr key={a.id}><td>{a.title}</td><td>{date(a.starts_at)}</td><td>{date(a.ends_at)}</td></tr>)}</tbody></table>{!assignments.data.length && !assignments.loading && <Empty />}</section>
}
function NewOrganization({ api, close, created }: { api: WorkspaceApi; close: () => void; created: (id: number) => Promise<void> }) {
  const action = useAction()
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [type, setType] = useState('school'), [studentLabel, setStudentLabel] = useState('Ученик')
  return <div className="dialog-backdrop"><form className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-org" onSubmit={e => { e.preventDefault(); void action.run(async () => { const value = await api.post<Organization>('/organizations', { name, contactEmail: email, organizationType: type, timezone: 'Europe/Sofia', studentLabel }); await created(value.id) }) }}><h2 id="new-org">Нова организация</h2><label>Име<input required maxLength={190} value={name} onChange={e => setName(e.target.value)} /></label><label>Контактен имейл<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Тип<select value={type} onChange={e => setType(e.target.value)}><option value="school">Училище</option><option value="university">Университет</option><option value="training">Обучителен център</option></select></label><label>Наименование на обучаем<select value={studentLabel} onChange={e => setStudentLabel(e.target.value)}><option>Ученик</option><option>Студент</option><option>Курсист</option></select></label><Feedback error={action.error} /><div className="ws-actions"><button type="button" onClick={close}>Отказ</button><button className="primary" disabled={action.busy}><Plus size={17} /> Създай</button></div></form></div>
}
