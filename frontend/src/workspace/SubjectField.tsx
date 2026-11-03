import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Plus, RefreshCw, X } from 'lucide-react'
import { useSubjectCatalog, normalizeSubject, subjectKey, mergeSubjects } from './subjects'
import type { Subject } from './subjects'
import { useNotifications } from '../notifications'
import { SyllabusImportButton } from './SyllabusImport'
import { DeleteConfirmationButton } from '../components/DeleteConfirmationDialog'

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
  const [query, setQuery] = useState(selected)
  const [open, setOpen] = useState(false)
  useEffect(() => { if (!open) setQuery(selected) }, [selected, open])
  const results = options.filter(subject => subject.name.toLocaleLowerCase('bg-BG').includes(query.trim().toLocaleLowerCase('bg-BG')))
  function choose(name: string) { onChange(name); setQuery(name); setOpen(false) }
  return <div className="ws-subject-field">
    <label htmlFor={id}>Дисциплина</label>
    <div className="ws-subject-control">
      <div className="ws-subject-picker" onBlur={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false)
          setQuery(selected)
        }
      }}>
        <input id={id} role="combobox" autoFocus={autoFocus} autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${id}-results` : undefined}
          value={open ? query : selected} disabled={disabled || catalog.loading} placeholder="Търси дисциплина"
          onFocus={() => { setQuery(selected); setOpen(true) }}
          onChange={event => { setQuery(event.target.value); setOpen(true); if (!event.target.value) onChange('') }}
          onKeyDown={event => {
            if (event.key === 'Escape') { setQuery(selected); setOpen(false) }
            else if (event.key === 'Enter' && open) { event.preventDefault(); if (results[0]) choose(results[0].name) }
          }} />
        <div className="ws-subject-picker-tools">
          {selected && <button type="button" className="icon-button" aria-label="Изчисти дисциплината" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => { onChange(''); setQuery(''); setOpen(true) }}><X size={15} aria-hidden="true" /></button>}
          <button type="button" className="icon-button" aria-label="Покажи дисциплините" aria-expanded={open} disabled={disabled || catalog.loading} onMouseDown={event => event.preventDefault()} onClick={() => { setOpen(value => !value); setQuery(selected) }}><ChevronDown size={17} aria-hidden="true" /></button>
        </div>
        {open && !disabled && <div className="ws-subject-picker-results" id={`${id}-results`} role="listbox" aria-label="Дисциплини">
          {results.map(subject => <button type="button" role="option" aria-selected={subjectKey(value) === subjectKey(subject.name)} key={subjectKey(subject.name)} onMouseDown={event => event.preventDefault()} onClick={() => choose(subject.name)}>{subject.name}</button>)}
          {!results.length && <p>Няма намерени дисциплини.</p>}
        </div>}
      </div>
      <NewSubjectButton compact disabled={disabled || catalog.loading} onCreated={subject => choose(subject.name)} />
      {selected && options.find(subject => subjectKey(subject.name) === subjectKey(selected))?.personal && <DeleteConfirmationButton
        label={`Изтрий дисциплината ${selected}`}
        title="Изтриване на дисциплина"
        description={<>Да изтрия ли дисциплината <strong>{selected}</strong> и всички лични теми към нея?</>}
        successMessage="Дисциплината и личните ѝ теми са изтрити."
        disabled={disabled || catalog.loading}
        onConfirm={async () => {
          await catalog.deleteSubject(selected)
          onChange('')
          setQuery('')
          setOpen(false)
        }}
      />}
    </div>
    <SyllabusImportButton disabled={disabled || catalog.loading} onImported={subject => onChange(subject.name)} />
    <SubjectCatalogNotice />
  </div>
}
