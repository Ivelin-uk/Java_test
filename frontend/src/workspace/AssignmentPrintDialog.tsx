import { useEffect, useId, useRef, useState } from 'react'
import { Download, LoaderCircle, X } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { Feedback } from './ui'
import type { Assignment, Definition } from './types'
import { downloadPrintableTest, printableVariantLimit } from './printableTest'

export function AssignmentPrintDialog({ api, assignment, onClose }: { api: WorkspaceApi; assignment: Assignment; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [definition, setDefinition] = useState<Definition | null>(null)
  const [variantCount, setVariantCount] = useState(3)
  const [includeAnswerKey, setIncludeAnswerKey] = useState(true)
  const [shuffleQuestions, setShuffleQuestions] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const maximum = definition ? printableVariantLimit(definition, shuffleQuestions) : 20

  useEffect(() => {
    const element = dialog.current, previous = document.activeElement
    let active = true
    element?.showModal()
    void api.get<Definition>(`/assignments/${assignment.id}/print`).then(value => {
      if (active) { setDefinition(value); setVariantCount(Math.min(3, printableVariantLimit(value))) }
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Тестът не може да се зареди за печат.')
    })
    return () => { active = false; element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [api, assignment.id])

  function close() { onClose() }
  function changeQuestionShuffle(checked: boolean) {
    setShuffleQuestions(checked)
    if (definition) setVariantCount(value => Math.min(value, printableVariantLimit(definition, checked)))
  }
  async function download() {
    if (!definition || !Number.isInteger(variantCount) || variantCount < 1 || variantCount > maximum) return
    setBusy(true)
    setError('')
    try { await downloadPrintableTest(definition, variantCount, includeAnswerKey, 'pdf', imageId => api.image(imageId), shuffleQuestions) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'PDF файлът не може да бъде генериран.') }
    finally { setBusy(false) }
  }

  return <dialog ref={dialog} className="delete-dialog ws-assignment-settings-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} onCancel={event => { event.preventDefault(); close() }}>
    <h2 id={`${id}-title`}>Свали PDF за печат</h2>
    <p id={`${id}-description`}>{assignment.title} · точната възложена версия</p>
    <form onSubmit={event => { event.preventDefault(); void download() }}>
      <fieldset className="delete-dialog-fields" disabled={!definition || busy}>
        <label>Брой варианти<input type="number" min={1} max={maximum} step={1} required value={variantCount} onChange={event => setVariantCount(Number(event.target.value))} /></label>
        <label className="ws-check"><input type="checkbox" checked={shuffleQuestions} onChange={event => changeQuestionShuffle(event.target.checked)} />Разбъркай въпросите във всеки вариант</label>
        <label className="ws-check"><input type="checkbox" checked={includeAnswerKey} onChange={event => setIncludeAnswerKey(event.target.checked)} />Отделен ключ с верните отговори</label>
      </fieldset>
      <Feedback error={error} busy={busy || (!definition && !error)} />
      <div className="dialog-actions">
        <button type="button" className="command-button" disabled={busy} onClick={close}><X size={16} aria-hidden="true" />Отказ</button>
        <button type="submit" className="primary command-button" disabled={busy || !definition || !Number.isInteger(variantCount) || variantCount < 1 || variantCount > maximum}>{busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}Свали PDF</button>
      </div>
    </form>
  </dialog>
}
