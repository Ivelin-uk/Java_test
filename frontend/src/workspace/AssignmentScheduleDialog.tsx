import { useEffect, useId, useRef, useState } from 'react'
import { LoaderCircle, Save, X } from 'lucide-react'
import type { Assignment } from './types'
import { localTime, minuteBound } from './assignmentDates'

export type AssignmentSchedule = { startsAt: string; endsAt: string }

export function AssignmentScheduleDialog({ assignment, onClose, onSave }: {
  assignment: Assignment
  onClose: () => void
  onSave: (schedule: AssignmentSchedule) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const startInput = useRef<HTMLInputElement>(null)
  const endInput = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)
  const id = useId()
  const [start, setStart] = useState(() => localTime(new Date(assignment.starts_at)))
  const [end, setEnd] = useState(() => localTime(new Date(assignment.ends_at)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const periodError = start && end && new Date(start) >= new Date(end) ? 'Крайният срок трябва да е след началото.' : ''
  const message = periodError || error

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    element?.showModal()
    endInput.current?.focus()
    return () => {
      element?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  function close() { if (!inFlight.current) onClose() }
  async function save() {
    if (inFlight.current) return
    const startsAt = new Date(start), endsAt = new Date(end)
    if (!Number.isFinite(startsAt.getTime())) {
      setError('Попълнете началната дата и час.'); startInput.current?.focus(); return
    }
    if (!Number.isFinite(endsAt.getTime()) || periodError || endsAt.getTime() <= Date.now()) {
      setError(!Number.isFinite(endsAt.getTime()) ? 'Попълнете крайната дата и час.' : periodError || 'Крайният срок трябва да е в бъдещето.')
      endInput.current?.focus(); return
    }
    inFlight.current = true
    setBusy(true); setError('')
    try {
      await onSave({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Датите не могат да бъдат запазени. Опитайте отново.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return <dialog ref={dialog} className="delete-dialog ws-schedule-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} onCancel={event => { event.preventDefault(); close() }}>
    <h2 id={`${id}-title`}>Промени датите</h2>
    <p id={`${id}-description`}>{assignment.title} · Възлагане №{assignment.id}</p>
    <form noValidate onSubmit={event => { event.preventDefault(); void save() }} onChange={() => setError('')}>
      <fieldset className="delete-dialog-fields" disabled={busy}>
        <label>Начало<input ref={startInput} type="datetime-local" name="startsAt" required max={minuteBound(end, -1)} step={60} value={start} aria-invalid={!!periodError} aria-describedby={message ? `${id}-error` : undefined} onChange={event => setStart(event.target.value)} /></label>
        <label>Краен срок<input ref={endInput} type="datetime-local" name="endsAt" required min={minuteBound(start, 1)} step={60} value={end} aria-invalid={!!message} aria-describedby={message ? `${id}-error` : undefined} onChange={event => setEnd(event.target.value)} /></label>
      </fieldset>
      {message && <p id={`${id}-error`} className="error" role="alert">{message}</p>}
      <div className="dialog-actions">
        <button type="button" className="command-button" disabled={busy} onClick={close}><X size={16} aria-hidden="true" /> Отказ</button>
        <button type="submit" className="primary command-button" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}{busy ? 'Запазване...' : 'Запази датите'}</button>
      </div>
    </form>
  </dialog>
}
