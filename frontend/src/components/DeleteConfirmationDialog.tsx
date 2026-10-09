import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { LoaderCircle, Trash2, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Props = {
  title: string
  description: ReactNode
  confirmLabel?: string
  confirmIcon?: LucideIcon
  confirmDisabled?: boolean
  children?: ReactNode
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

export function DeleteConfirmationButton({ label, icon: Icon = Trash2, disabled = false, ...dialogProps }: Omit<Props, 'onCancel'> & { label: string; icon?: LucideIcon; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="icon-button danger" title={label} aria-label={label} disabled={disabled} onClick={() => setOpen(true)}><Icon size={17} /></button>
    {open && <DeleteConfirmationDialog {...dialogProps} confirmDisabled={disabled || dialogProps.confirmDisabled} onCancel={() => setOpen(false)} />}
  </>
}

export function DeleteConfirmationDialog({ title, description, confirmLabel = 'Изтрий', confirmIcon: ConfirmIcon = Trash2, confirmDisabled = false, children, onCancel, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const inFlight = useRef(false)
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    element?.showModal()
    cancelButton.current?.focus()
    return () => {
      element?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  function cancel() { if (!inFlight.current) onCancel() }
  async function confirm() {
    if (inFlight.current || confirmDisabled) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      onCancel()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Действието не успя. Опитайте отново.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return <dialog ref={dialog} className="delete-dialog delete-confirmation-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} onCancel={event => { event.preventDefault(); cancel() }}>
    <h2 id={`${id}-title`}>{title}</h2>
    <p id={`${id}-description`}>{description}</p>
    {children && <fieldset className="delete-dialog-fields" disabled={busy}>{children}</fieldset>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="dialog-actions">
      <button ref={cancelButton} type="button" className="command-button" disabled={busy} onClick={cancel}><X size={16} aria-hidden="true" /> Отказ</button>
      <button type="button" className="command-button danger-fill" disabled={busy || confirmDisabled} onClick={() => void confirm()}>
        {busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <ConfirmIcon size={16} aria-hidden="true" />}
        {busy ? 'Изчакване...' : confirmLabel}
      </button>
    </div>
  </dialog>
}
