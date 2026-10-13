import { useState } from 'react'
import type { FormEvent } from 'react'
import { GraduationCap, Presentation } from 'lucide-react'
import { api } from '../api/client'
import type { AuthResponse } from '../types/models'
import { AuthLayout } from './AuthLayout'

export function RoleSelectionPanel({ auth, onAuth, logout }: {
  auth: AuthResponse
  onAuth: (auth: AuthResponse) => void
  logout: () => Promise<void>
}) {
  const [role, setRole] = useState<'STUDENT' | 'TEACHER' | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!role || busy) return
    setBusy(true)
    setError('')
    try {
      const user = await api.selectRole(auth.token, role)
      onAuth({ ...auth, user })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ролята не беше запазена. Опитайте отново.')
    } finally {
      setBusy(false)
    }
  }

  return <AuthLayout>
    <form className="auth-panel auth-role-panel" onSubmit={submit}>
      <header><h2>Изберете роля</h2><p>{auth.user.email}</p></header>
      <fieldset className="auth-role-options" aria-label="Роля" disabled={busy}>
        <label className={`auth-role-option${role === 'TEACHER' ? ' is-selected' : ''}`}>
          <input type="radio" name="role" value="TEACHER" required checked={role === 'TEACHER'} onChange={() => setRole('TEACHER')} />
          <Presentation size={24} aria-hidden="true" /><span>Учител / асистент</span>
        </label>
        <label className={`auth-role-option${role === 'STUDENT' ? ' is-selected' : ''}`}>
          <input type="radio" name="role" value="STUDENT" required checked={role === 'STUDENT'} onChange={() => setRole('STUDENT')} />
          <GraduationCap size={24} aria-hidden="true" /><span>Ученик / студент</span>
        </label>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy || !role}>{busy ? 'Запазване...' : 'Продължи'}</button>
      <button className="auth-text-button" type="button" disabled={busy} onClick={() => void logout()}>Изход</button>
    </form>
  </AuthLayout>
}
