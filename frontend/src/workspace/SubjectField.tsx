import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { useSubjectCatalog, normalizeSubject, subjectKey, mergeSubjects } from './subjects'
import type { Subject } from './subjects'
import { useNotifications } from '../notifications'

function NewSubjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (subject: Subject) => void }) {
  const catalog = useSubjectCatalog()
  const notify = useNotifications()
  const dialog = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const title = useId()
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    element?.showModal()
    element?.querySelector('input')?.focus()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  async function save() {
    if (submitting.current) return
    const value = normalizeSubject(name)
    if (!value || value.length > 190) { setError('Въведете име на дисциплина до 190 символа.'); return }
    submitting.current = true; setBusy(true); setError('')
    try {
      const subject = await catalog.create(value)
      onCreated(subject)
      notify('Дисциплината е добавена към твоя списък.')
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Дисциплината не може да бъде добавена.') }
    finally { submitting.current = false; setBusy(false) }
  }
  return createPortal(<dialog ref={dialog} className="ws-subject-dialog" aria-labelledby={title} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <form noValidate onSubmit={event => { event.preventDefault(); void save() }}>
      <h2 id={title}>Нова дисциплина</h2>
      <p className="ws-muted">Добавете предмет или специализирана дисциплина. Тя ще остане в личния ви списък и за следващите тестове.</p>
      <label>Име на дисциплината<input required maxLength={190} value={name} disabled={busy} placeholder="Например: Авиационна техника" onChange={event => { setName(event.target.value); setError('') }} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="command-button" disabled={busy} onClick={onClose}>Отказ</button><button type="submit" className="primary command-button" disabled={busy || !normalizeSubject(name)}><Plus size={17} aria-hidden="true" />{busy ? 'Добавяне...' : 'Добави дисциплина'}</button></div>
    </form>
  </dialog>, document.body)
}

export function NewSubjectButton({ onCreated, disabled = false, compact = false }: { onCreated?: (subject: Subject) => void; disabled?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className={compact ? 'icon-button' : 'command-button'} aria-label="Добави дисциплина" title="Добави дисциплина" disabled={disabled} onClick={() => setOpen(true)}><Plus size={17} aria-hidden="true" />{!compact && 'Добави дисциплина'}</button>
    {open && <NewSubjectDialog onClose={() => setOpen(false)} onCreated={subject => onCreated?.(subject)} />}
  </>
}

export function SubjectCatalogNotice() {
  const catalog = useSubjectCatalog()
  return catalog.error ? <div className="ws-subject-notice"><p className="error" role="alert">{catalog.error}</p><button type="button" className="command-button" disabled={catalog.loading} onClick={() => void catalog.reload()}><RefreshCw size={16} aria-hidden="true" />Зареди дисциплините</button></div> : null
}

export function SubjectField({ value, onChange, disabled = false, autoFocus = false }: { value: string; onChange: (name: string) => void; disabled?: boolean; autoFocus?: boolean }) {
  const catalog = useSubjectCatalog()
  const id = useId()
  const options = mergeSubjects([...catalog.subjects, ...(value ? [{ name: value, preset: false }] : [])])
  const selected = options.find(subject => subjectKey(subject.name) === subjectKey(value))?.name ?? ''
  return <div className="ws-subject-field">
    <label htmlFor={id}>Дисциплина</label>
    <div className="ws-subject-control"><select id={id} autoFocus={autoFocus} value={selected} disabled={disabled || catalog.loading} onChange={event => onChange(event.target.value)}><option value="">Без дисциплина</option>{options.map(subject => <option key={subjectKey(subject.name)} value={subject.name}>{subject.name}</option>)}</select><NewSubjectButton compact disabled={disabled || catalog.loading} onCreated={subject => onChange(subject.name)} /></div>
    <SubjectCatalogNotice />
  </div>
}
