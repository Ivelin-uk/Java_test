import { useEffect, useRef } from 'react'
import { LoaderCircle, Trash2, X } from 'lucide-react'

type Props = {
  title: string
  busy: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}

export function DeleteTestDialog({ title, busy, error, onCancel, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)

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

  return (
    <dialog
      ref={dialog}
      className="delete-dialog"
      aria-labelledby="delete-dialog-title"
      aria-describedby="delete-dialog-description"
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}
    >
      <h2 id="delete-dialog-title">Изтриване на тест</h2>
      <p id="delete-dialog-description">Да се изтрие ли <strong>{title}</strong> заедно с въпросите, отговорите и резултатите му?</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button ref={cancelButton} type="button" className="command-button" onClick={onCancel} disabled={busy}>
          <X size={16} aria-hidden="true" /> Отказ
        </button>
        <button type="button" className="command-button danger-fill" onClick={onConfirm} disabled={busy}>
          {busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
          {busy ? 'Изтриване...' : 'Изтрий'}
        </button>
      </div>
    </dialog>
  )
}
