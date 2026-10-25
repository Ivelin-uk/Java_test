import { useEffect, useId, useRef, useState } from 'react'
import { LoaderCircle, Save, X } from 'lucide-react'

export type AssignmentAccommodation = { fullscreenExempt: boolean; timeMultiplier: number; maxAttempts: number; reason: string }
type Recipient = { name: string; email?: string; fullscreen_exempt: boolean; time_multiplier: number; max_attempts: number; accommodation_reason: string | null }

export function AssignmentAccommodationDialog({ recipient, onClose, onSave }: { recipient: Recipient; onClose: () => void; onSave: (value: AssignmentAccommodation) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const saving = useRef(false)
  const id = useId()
  const [exempt, setExempt] = useState(recipient.fullscreen_exempt)
  const [multiplier, setMultiplier] = useState<number | ''>(Number(recipient.time_multiplier))
  const [max, setMax] = useState<number | ''>(recipient.max_attempts)
  const [reason, setReason] = useState(recipient.accommodation_reason ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = dialog.current, previous = document.activeElement
    element?.showModal()
    element?.querySelector<HTMLInputElement>('input')?.focus()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])

  function close() { if (!saving.current) onClose() }
  async function save() {
    if (saving.current || multiplier === '' || max === '') return
    saving.current = true; setBusy(true); setError('')
    try {
      await onSave({ fullscreenExempt: exempt, timeMultiplier: multiplier, maxAttempts: max, reason })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Изключението не може да бъде запазено. Опитайте отново.')
    } finally { saving.current = false; setBusy(false) }
  }

  return <dialog ref={dialog} className="delete-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} onCancel={event => { event.preventDefault(); close() }}>
    <h2 id={`${id}-title`}>Изключение / опити</h2>
    <p id={`${id}-description`}><strong>{recipient.name}</strong>{recipient.email && <><br /><span className="ws-muted">{recipient.email}</span></>}</p>
    <form onSubmit={event => { event.preventDefault(); void save() }} onChange={() => setError('')}>
      <fieldset className="delete-dialog-fields" disabled={busy}>
        <label className="ws-check"><input type="checkbox" checked={exempt} onChange={event => setExempt(event.target.checked)} />Без цял екран</label>
        <label>Множител на времето<input type="number" required min={1} max={5} step="0.25" value={multiplier} onChange={event => setMultiplier(event.target.value === '' ? '' : Number(event.target.value))} /></label>
        <label>Опити<input type="number" required min={1} max={Math.max(20, recipient.max_attempts)} step={1} value={max} onChange={event => setMax(event.target.value === '' ? '' : Number(event.target.value))} /></label>
        <label>Причина<input required value={reason} onChange={event => setReason(event.target.value)} /></label>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="command-button" disabled={busy} onClick={close}><X size={16} aria-hidden="true" />Отказ</button>
        <button type="submit" className="primary command-button" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}{busy ? 'Запазване...' : 'Запази'}</button>
      </div>
    </form>
  </dialog>
}
