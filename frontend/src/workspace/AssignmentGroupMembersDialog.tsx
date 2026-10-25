import { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { GroupMembers } from './GroupsPanel'

export function AssignmentGroupMembersDialog({ api, group, onClose, onChanged }: { api: WorkspaceApi; group: { id: number; name: string }; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement
    element?.showModal()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialog} className="delete-dialog ws-assignment-group-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <div className="ws-assignment-group-dialog-head"><h2 id={`${id}-title`}>Участници в групата</h2><button type="button" className="icon-button" aria-label="Затвори прозореца" title="Затвори прозореца" disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    <p id={`${id}-description`}><strong>{group.name}</strong> · Промените важат за групата и възложените ѝ тестове.</p>
    <GroupMembers api={api} group={group} changed={onChanged} onBusyChange={setBusy} />
    <div className="dialog-actions"><button type="button" className="command-button" disabled={busy} onClick={onClose}><X size={16} aria-hidden="true" />Затвори</button></div>
  </dialog>
}
