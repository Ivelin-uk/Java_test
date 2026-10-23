import { useEffect, useId, useRef, useState } from 'react'
import { LoaderCircle, Save, X } from 'lucide-react'
import type { Assignment } from './types'

export function AssignmentMobileDialog({ assignment, onClose, onSave }: {
  assignment: Assignment
  onClose: () => void
  onSave: (mobileAllowed: boolean) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const checkbox = useRef<HTMLInputElement>(null)
  const saving = useRef(false)
  const id = useId()
  const [allowed, setAllowed] = useState(!!assignment.mobile_allowed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement
    element?.showModal(); checkbox.current?.focus()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  function close() { if (!saving.current) onClose() }
  async function save() {
    if (saving.current) return
    saving.current = true; setBusy(true); setError('')
    try { await onSave(allowed); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Режимът не може да бъде запазен. Опитайте отново.') }
    finally { saving.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="delete-dialog ws-mobile-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} onCancel={event => { event.preventDefault(); close() }}>
    <h2 id={`${id}-title`}>Мобилен режим</h2>
    <p id={`${id}-description`}>{assignment.title}</p>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <fieldset className="delete-dialog-fields" disabled={busy}>
        <label className="ws-check"><input ref={checkbox} type="checkbox" checked={allowed} onChange={event => { setAllowed(event.target.checked); setError('') }} />Разреши решаване от телефон</label>
        <p className="ws-muted">На телефон не се изисква цял екран. Браузърът не може да блокира системното минимизиране, но при засечено скриване на страницата, смяна на приложение или излизане от цял екран текущият въпрос приключва с 0 точки. Сроковете и броят опити се запазват.</p>
        <p className="ws-muted">Промяната важи за всички съществуващи и бъдещи възлагания на теста. Започнатите опити запазват режима си.</p>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="command-button" disabled={busy} onClick={close}><X size={16} />Отказ</button><button type="submit" className="primary command-button" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}Запази режима</button></div>
    </form>
  </dialog>
}
