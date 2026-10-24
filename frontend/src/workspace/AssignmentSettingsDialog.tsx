import { useEffect, useId, useRef, useState } from 'react'
import { LoaderCircle, Save, X } from 'lucide-react'
import type { Assignment } from './types'

export type AssignmentSettings = { shuffleQuestions: boolean; shuffleOptions: boolean; answersAfterDeadline: boolean; autoAiGrading: boolean }

export function AssignmentSettingsFields({ value, onChange }: { value: AssignmentSettings; onChange: (value: AssignmentSettings) => void }) {
  return <div className="ws-assignment-settings" role="group" aria-label="Настройки на възлагането">
    <label className="ws-check"><input type="checkbox" checked={value.shuffleQuestions} onChange={event => onChange({ ...value, shuffleQuestions: event.target.checked })} />Разбъркай въпросите</label>
    <label className="ws-check"><input type="checkbox" checked={value.shuffleOptions} onChange={event => onChange({ ...value, shuffleOptions: event.target.checked })} />Разбъркай опциите</label>
    <label className="ws-check"><input type="checkbox" checked={value.answersAfterDeadline} onChange={event => onChange({ ...value, answersAfterDeadline: event.target.checked })} />Верни отговори след срока</label>
    <label className="ws-check"><input type="checkbox" checked={value.autoAiGrading} onChange={event => onChange({ ...value, autoAiGrading: event.target.checked })} />Автоматична проверка с AI</label>
    <p className="ws-muted">При автоматична проверка предадените тестове се оценяват и резултатите се публикуват без натискане на „AI проверка“. При грешка остава възможност за повторение или ръчна проверка.</p>
  </div>
}

export function AssignmentSettingsDialog({ assignment, onClose, onSave }: { assignment: Assignment; onClose: () => void; onSave: (value: AssignmentSettings) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const saving = useRef(false)
  const id = useId()
  const [value, setValue] = useState<AssignmentSettings>({ shuffleQuestions: !!assignment.shuffle_questions, shuffleOptions: !!assignment.shuffle_options, answersAfterDeadline: assignment.answers_after_deadline !== false, autoAiGrading: !!assignment.auto_ai_grading })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement
    element?.showModal(); element?.querySelector<HTMLInputElement>('input')?.focus()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  function close() { if (!saving.current) onClose() }
  async function save() {
    if (saving.current) return
    saving.current = true; setBusy(true); setError('')
    try { await onSave(value); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Настройките не могат да бъдат запазени. Опитайте отново.') }
    finally { saving.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="delete-dialog ws-assignment-settings-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} onCancel={event => { event.preventDefault(); close() }}>
    <h2 id={`${id}-title`}>Настройки на възлагането</h2>
    <p id={`${id}-description`}>{assignment.title}</p>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <fieldset className="delete-dialog-fields" disabled={busy}>
        <AssignmentSettingsFields value={value} onChange={next => { setValue(next); setError('') }} />
        <p className="ws-muted">Разбъркването важи за новите опити. Автоматичната проверка обхваща и предадените тестове, които още чакат проверка. Вече започналите AI проверки ще приключат.</p>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="command-button" disabled={busy} onClick={close}><X size={16} aria-hidden="true" />Отказ</button><button type="submit" className="primary command-button" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}Запази настройките</button></div>
    </form>
  </dialog>
}
