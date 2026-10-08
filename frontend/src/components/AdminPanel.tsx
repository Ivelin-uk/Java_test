import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Users, ShieldCheck, History, UserPlus, Pencil, KeyRound, UserCheck, UserX, RefreshCw, Save, X, Copy, Check, Search } from 'lucide-react'
import { api } from '../api/client'
import { formatDate, roleLabels, subscriptionLabel } from '../api/access'
import type { AuditEntry, AuthResponse, PasswordResponse, PermissionChange, PermissionRow, Role, User, UserEdit } from '../types/models'

const modes = { ADMIN: 'Само администратор', PUBLIC: 'Публичен вход', PROFILE: 'Собствен профил', MANAGED: '' }
const actions: Record<string, string> = { USER_CREATED: 'Нов потребител', USER_UPDATED: 'Промяна на профил', PASSWORD_RESET: 'Нова временна парола', PERMISSION_UPDATED: 'Промяна на права' }
const emptyUser: UserEdit = { name: '', email: '', role: 'STUDENT', active: true, subscriptionPaid: false, subscriptionPaidUntil: null }
function userEdit(user: User): UserEdit {
  return { name: user.name, email: user.email, role: user.role, active: user.active, subscriptionPaid: user.subscription.paid, subscriptionPaidUntil: user.subscription.paidUntil }
}

export function AdminPanel({ auth, onProfileRefresh }: { auth: AuthResponse; onProfileRefresh: () => Promise<void> }) {
  const [tab, setTab] = useState<'users' | 'permissions' | 'audit'>('users')
  const [users, setUsers] = useState<User[]>([])
  const [rows, setRows] = useState<PermissionRow[]>([])
  const [changes, setChanges] = useState<Record<string, PermissionChange>>({})
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [controller, setController] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<{ id: number | null; value: UserEdit } | null>(null)
  const [confirming, setConfirming] = useState<{ user: User; action: 'reset' | 'toggle' } | null>(null)
  const [credentials, setCredentials] = useState<PasswordResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const token = auth.token

  async function refresh() {
    const [nextUsers, nextRows, nextAudit] = await Promise.all([api.users(token), api.permissions(token), api.audit(token)])
    setUsers(nextUsers); setRows(nextRows); setAudit(nextAudit)
  }
  useEffect(() => {
    let alive = true
    Promise.all([api.users(token), api.permissions(token), api.audit(token)])
      .then(([nextUsers, nextRows, nextAudit]) => { if (alive) { setUsers(nextUsers); setRows(nextRows); setAudit(nextAudit) } })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : 'Неуспешно зареждане.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  async function perform(work: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await work() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Неуспешно действие.') }
    finally { setBusy(false) }
  }
  async function saveUser(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    await perform(async () => {
      if (editing.id === null) { setCredentials(await api.createUser(token, editing.value)); setCopied(false) }
      else { await api.updateUser(token, editing.id, editing.value); setMessage('Профилът е обновен.') }
      setEditing(null)
      await refresh(); await onProfileRefresh()
    })
  }
  async function confirmedAction() {
    if (!confirming) return
    await perform(async () => {
      if (confirming.action === 'reset') { setCredentials(await api.resetPassword(token, confirming.user.id)); setCopied(false) }
      else { await api.updateUser(token, confirming.user.id, { ...userEdit(confirming.user), active: !confirming.user.active }); setMessage(confirming.user.active ? 'Потребителят е деактивиран.' : 'Потребителят е активиран.') }
      setConfirming(null); await refresh(); await onProfileRefresh()
    })
  }
  function changePermission(row: PermissionRow, role: 'TEACHER' | 'STUDENT', property: 'allowed' | 'subscriptionRequired', value: boolean) {
    const column = role === 'TEACHER' ? 'teacher' : 'student'
    const grant = { ...row[column], [property]: value }
    setRows(current => current.map(item => item.key === row.key ? { ...item, [column]: grant } : item))
    setChanges(current => ({ ...current, [`${row.key}:${role}`]: { key: row.key, role, ...grant } }))
  }
  const filteredUsers = users.filter(user => (!role || user.role === role) && `${user.name} ${user.email}`.toLowerCase().includes(query.toLowerCase()))
  const filteredRows = rows.filter(row => (!controller || row.controller === controller) && `${row.controller} ${row.method} ${row.paths.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const dirtyCount = Object.keys(changes).length

  return <section className="admin-panel">
    <div className="section-toolbar">
      <div className="app-tabs inner-tabs" role="tablist" aria-label="Администрация">
        <button role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'active' : ''} onClick={() => { setTab('users'); setQuery(''); setError('') }}><Users size={17} /> Потребители <span className="count-label">{users.length}</span></button>
        <button role="tab" aria-selected={tab === 'permissions'} className={tab === 'permissions' ? 'active' : ''} onClick={() => { setTab('permissions'); setQuery(''); setError('') }}><ShieldCheck size={17} /> Права</button>
        <button role="tab" aria-selected={tab === 'audit'} className={tab === 'audit' ? 'active' : ''} onClick={() => { setTab('audit'); setQuery(''); setError('') }}><History size={17} /> Журнал</button>
      </div>
      <button className="icon-button" title="Обнови" aria-label="Обнови" disabled={busy || dirtyCount > 0} onClick={() => void perform(refresh)}><RefreshCw size={17} /></button>
    </div>
    {loading && <p role="status">Зареждане...</p>}
    {message && <p className="good" role="status">{message}</p>}
    {error && !editing && !confirming && <p className="error action-error" role="alert">{error}</p>}

    {tab === 'users' && <>
      <div className="filter-bar">
        <label className="search-field"><Search size={17} /><input aria-label="Търси потребител" placeholder="Име или имейл" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select aria-label="Филтър по роля" value={role} onChange={event => setRole(event.target.value as Role | '')}><option value="">Всички роли</option>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <button className="primary command-button" disabled={busy} onClick={() => { setError(''); setEditing({ id: null, value: { ...emptyUser } }) }}><UserPlus size={17} /> Нов потребител</button>
      </div>
      <div className="table-scroll"><table className="data-table users-table"><thead><tr><th>Потребител</th><th>Роля</th><th>Статус</th><th>Абонамент / до</th><th>Действия</th></tr></thead><tbody>
        {filteredUsers.map(user => <tr key={user.id}>
          <td><strong>{user.name}{user.id === auth.user.id && <small className="inline-muted"> (Вие)</small>}</strong><small>{user.email}</small>{user.passwordChangeRequired && <small className="warning-text">Временна парола</small>}</td>
          <td>{roleLabels[user.role]}</td>
          <td><span className={`status-badge ${user.active ? 'good' : 'inactive'}`}>{user.active ? 'Активен' : 'Неактивен'}</span></td>
          <td><span className={user.role === 'STUDENT' || user.subscription.active ? 'good' : ''}>{subscriptionLabel(user)}</span>{user.role !== 'STUDENT' && <small>{formatDate(user.subscription.paidUntil)}</small>}</td>
          <td><div className="row-actions">
            <button className="icon-button" title="Редактирай профил и имейл" aria-label={`Редактирай ${user.email}`} disabled={busy} onClick={() => { setError(''); setEditing({ id: user.id, value: userEdit(user) }) }}><Pencil size={16} /></button>
            <button className="icon-button" title={user.id === auth.user.id ? 'Смяна на собствена парола от Профил' : 'Нова временна парола'} aria-label={`Нова парола за ${user.email}`} disabled={busy || user.id === auth.user.id} onClick={() => { setError(''); setConfirming({ user, action: 'reset' }) }}><KeyRound size={16} /></button>
            <button className={`icon-button ${user.active ? 'danger' : ''}`} title={user.active ? 'Деактивирай' : 'Активирай'} aria-label={`${user.active ? 'Деактивирай' : 'Активирай'} ${user.email}`} disabled={busy} onClick={() => { setError(''); setConfirming({ user, action: 'toggle' }) }}>{user.active ? <UserX size={16} /> : <UserCheck size={16} />}</button>
          </div></td>
        </tr>)}
        {!loading && !filteredUsers.length && <tr><td colSpan={5} className="empty-cell">Няма намерени потребители.</td></tr>}
      </tbody></table></div>
    </>}

    {tab === 'permissions' && <>
      <div className="filter-bar">
        <label className="search-field"><Search size={17} /><input aria-label="Търси метод" placeholder="Контролер, метод или път" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select aria-label="Контролер" value={controller} onChange={event => setController(event.target.value)}><option value="">Всички контролери</option>{[...new Set(rows.map(row => row.controller))].map(name => <option key={name}>{name}</option>)}</select>
        <button className="primary command-button" disabled={busy || !dirtyCount} onClick={() => void perform(async () => { setRows(await api.updatePermissions(token, Object.values(changes))); setChanges({}); setAudit(await api.audit(token)); await onProfileRefresh(); setMessage('Правата са обновени.') })}><Save size={17} /> Запази{dirtyCount > 0 && ` (${dirtyCount})`}</button>
      </div>
      <div className="table-scroll"><table className="data-table permissions-table"><thead><tr><th>Контролер</th><th>Метод / маршрут</th><th>Учител</th><th>Ученик / студент</th><th>Администратор</th></tr></thead><tbody>
        {filteredRows.map(row => <tr key={row.key} className={row.mode !== 'MANAGED' ? 'fixed-policy' : ''}>
          <td><strong>{row.controller}</strong></td>
          <td><code>{row.method}</code><small className="route-text">{row.httpMethods.join(', ')} {row.paths.join(', ')}</small>{row.mode !== 'MANAGED' && <small>{modes[row.mode]}</small>}</td>
          {(['TEACHER', 'STUDENT'] as const).map(role => { const grant = row[role === 'TEACHER' ? 'teacher' : 'student']; return <td key={role}>
            {row.mode === 'MANAGED' ? <div className="grant-cell">
              <label className="checkbox-label"><input type="checkbox" aria-label={`${roleLabels[role]}: ${row.key} достъп`} checked={grant.allowed} disabled={busy} onChange={event => changePermission(row, role, 'allowed', event.target.checked)} /> Достъп</label>
              {role === 'TEACHER' && <label className="checkbox-label muted"><input type="checkbox" aria-label={`${roleLabels[role]}: ${row.key} абонамент`} checked={grant.subscriptionRequired} disabled={busy || !grant.allowed} onChange={event => changePermission(row, role, 'subscriptionRequired', event.target.checked)} /> Абонамент</label>}
            </div> : <span className="muted">{grant.allowed ? row.mode === 'PUBLIC' ? 'Публичен' : 'Собствен профил' : 'Няма достъп'}</span>}
          </td> })}
          <td><span className="admin-access"><Check size={16} /> Пълен достъп</span></td>
        </tr>)}
        {!loading && !filteredRows.length && <tr><td colSpan={5} className="empty-cell">Няма намерени методи.</td></tr>}
      </tbody></table></div>
    </>}

    {tab === 'audit' && <div className="table-scroll"><table className="data-table"><thead><tr><th>Дата</th><th>Администратор</th><th>Действие</th><th>Промяна</th></tr></thead><tbody>
      {audit.map(entry => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString('bg-BG')}</td><td>{entry.actorEmail}</td><td>{actions[entry.action] ?? entry.action}<small>{entry.targetEmail}</small></td><td>{entry.details}</td></tr>)}
      {!loading && !audit.length && <tr><td colSpan={4} className="empty-cell">Няма записани промени.</td></tr>}
    </tbody></table></div>}

    {editing && <AdminDialog title={editing.id === null ? 'Нов потребител' : 'Редакция на профил'} busy={busy} onClose={() => { setEditing(null); setError('') }}>
      <form className="user-form" onSubmit={saveUser}>
        <label>Име<input required maxLength={120} value={editing.value.name} onChange={event => setEditing({ ...editing, value: { ...editing.value, name: event.target.value } })} /></label>
        <label>Имейл<input type="email" required maxLength={190} value={editing.value.email} onChange={event => setEditing({ ...editing, value: { ...editing.value, email: event.target.value } })} /></label>
        <label>Роля<select aria-label="Роля" value={editing.value.role} onChange={event => setEditing({ ...editing, value: { ...editing.value, role: event.target.value as Role } })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="checkbox-label"><input type="checkbox" checked={editing.value.active} onChange={event => setEditing({ ...editing, value: { ...editing.value, active: event.target.checked } })} /> Активен потребител</label>
        {editing.value.role !== 'STUDENT' && <fieldset className="subscription-fields"><legend>Абонамент</legend>
          <label className="checkbox-label"><input type="checkbox" checked={editing.value.subscriptionPaid} onChange={event => setEditing({ ...editing, value: { ...editing.value, subscriptionPaid: event.target.checked } })} /> Платен</label>
          <label>Валиден до<input type="date" required={editing.value.subscriptionPaid} value={editing.value.subscriptionPaidUntil ?? ''} onChange={event => setEditing({ ...editing, value: { ...editing.value, subscriptionPaidUntil: event.target.value || null } })} /></label>
        </fieldset>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setEditing(null)}>Отказ</button><button className="primary command-button" disabled={busy}><Save size={17} /> {busy ? 'Запазване...' : 'Запази'}</button></div>
      </form>
    </AdminDialog>}

    {confirming && <AdminDialog title={confirming.action === 'reset' ? 'Нова временна парола' : confirming.user.active ? 'Деактивиране' : 'Активиране'} busy={busy} onClose={() => { setConfirming(null); setError('') }}>
      <p><strong>{confirming.user.name}</strong><br />{confirming.user.email}</p>
      {confirming.action === 'reset' ? <p>Текущата парола и активните сесии ще бъдат анулирани.</p> : confirming.user.active && <p>Достъпът и активните сесии ще бъдат прекратени.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions"><button disabled={busy} onClick={() => setConfirming(null)}>Отказ</button><button className="primary" disabled={busy} onClick={() => void confirmedAction()}>{busy ? 'Изчакване...' : 'Потвърди'}</button></div>
    </AdminDialog>}

    {credentials && <AdminDialog title="Временна парола" busy={false} onClose={() => setCredentials(null)}>
      <p>{credentials.user.email}</p>
      <div className="credential-line"><code>{credentials.temporaryPassword}</code><button className="icon-button" title="Копирай паролата" aria-label="Копирай паролата" onClick={() => void navigator.clipboard.writeText(credentials.temporaryPassword).then(() => setCopied(true)).catch(() => setError('Копирането е неуспешно.'))}>{copied ? <Check size={17} /> : <Copy size={17} />}</button></div>
      <p className="muted">Паролата се показва еднократно. При вход е задължителна смяна.</p>
      <div className="dialog-actions"><button className="primary" onClick={() => setCredentials(null)}>Затвори</button></div>
    </AdminDialog>}
  </section>
}

function AdminDialog({ title, children, busy, onClose }: { title: string; children: ReactNode; busy: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return <dialog ref={ref} className="delete-dialog admin-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" title="Затвори" aria-label="Затвори прозореца" disabled={busy} onClick={onClose}><X size={18} /></button></div>
    {children}
  </dialog>
}
