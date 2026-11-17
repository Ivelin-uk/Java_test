import { useEffect, useId, useRef, useState } from 'react'
import { Download, LoaderCircle, Printer, X } from 'lucide-react'
import type { WorkspaceApi } from './api'
import type { Assessment, Definition } from './types'
import { Feedback } from './ui'
import { useNotifications } from '../notifications'
import { downloadPrintableTest, printableVariantLimit } from './printableTest'
import type { PrintFormat } from './printableTest'
import './testPrint.css'

export function TestPrintDialog({ api, test, onClose }: { api: WorkspaceApi; test: Assessment; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const exporting = useRef(false)
  const id = useId()
  const notify = useNotifications()
  const [definition, setDefinition] = useState<Definition | null>(null)
  const [format, setFormat] = useState<PrintFormat>('pdf')
  const [variantCount, setVariantCount] = useState('3')
  const [includeAnswerKey, setIncludeAnswerKey] = useState(true)
  const [shuffleQuestions, setShuffleQuestions] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const maximum = definition ? printableVariantLimit(definition, shuffleQuestions) : 20
  const count = variantCount === '' ? NaN : Number(variantCount)
  const validCount = Number.isInteger(count) && count >= 1 && count <= maximum

  useEffect(() => {
    const element = dialog.current, previous = document.activeElement
    element?.showModal()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])

  useEffect(() => {
    let active = true
    void api.get<Assessment>(`/tests/${test.id}`).then(row => {
      const next = JSON.parse(row.definition_json) as Definition
      if (!Array.isArray(next.questions) || !next.questions.length) throw new Error('Добави въпроси към теста, преди да го свалиш за печат.')
      if (active) {
        setDefinition(next)
        setVariantCount(String(Math.min(3, printableVariantLimit(next))))
      }
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Тестът не може да се зареди за печат.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, test.id, retry])

  async function download() {
    if (!definition || !validCount || loading || exporting.current) return
    exporting.current = true
    setBusy(true)
    setError('')
    try {
      await downloadPrintableTest(definition, count, includeAnswerKey, format, imageId => api.image(imageId), shuffleQuestions)
      notify(format === 'docx' ? 'Word файлът е изтеглен.' : 'PDF файлът е изтеглен.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Файлът не може да бъде генериран. Опитай отново.')
    } finally { exporting.current = false; setBusy(false) }
  }

  function changeQuestionShuffle(checked: boolean) {
    setShuffleQuestions(checked)
    if (definition) {
      const nextMaximum = printableVariantLimit(definition, checked)
      setVariantCount(value => Number.isInteger(Number(value)) && Number(value) > nextMaximum ? String(nextMaximum) : value)
    }
    setError('')
  }

  return <dialog ref={dialog} className="delete-dialog ws-test-print-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={loading || busy} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <div className="ws-test-print-heading"><Printer size={24} aria-hidden="true" /><h2 id={`${id}-title`}>Свали тест за печат</h2></div>
    <p id={`${id}-description`} className="ws-test-print-title">{test.title}</p>
    <p className="ws-muted">Избери формат и брой варианти за изпитване на хартия.</p>
    <form onSubmit={event => { event.preventDefault(); void download() }}>
      <fieldset className="delete-dialog-fields" disabled={loading || busy || !definition}>
        <div className="ws-test-print-fields">
          <label htmlFor={`${id}-format`}>Формат<select id={`${id}-format`} value={format} onChange={event => { setFormat(event.target.value as PrintFormat); setError('') }}><option value="pdf">PDF (.pdf)</option><option value="docx">Word (.docx)</option></select></label>
          <label htmlFor={`${id}-count`}>Брой варианти<input id={`${id}-count`} type="number" inputMode="numeric" min={1} max={maximum} step={1} required value={variantCount} aria-invalid={definition && !validCount ? true : undefined} aria-describedby={`${id}-count-help`} onChange={event => { setVariantCount(event.target.value); setError('') }} /></label>
        </div>
        <p id={`${id}-count-help`} className="ws-muted">{maximum < 20 ? maximum === 1 ? 'За този тест е възможен само 1 различен вариант.' : `За този тест са възможни до ${maximum} различни варианта.` : 'От 1 до 20 варианта.'} {shuffleQuestions ? 'При включено разбъркване всеки вариант използва различен ред на въпросите.' : 'Редът на въпросите се запазва; вариантите се различават чрез разбъркване на отговорите.'} Всеки вариант започва на нова страница.</p>
        {definition && !validCount && <p className="error" role="alert">Въведи цяло число от 1 до {maximum}.</p>}
        <label className="ws-check"><input type="checkbox" checked={shuffleQuestions} onChange={event => changeQuestionShuffle(event.target.checked)} />Разбъркай въпросите във всеки вариант</label>
        <label className="ws-check"><input type="checkbox" checked={includeAnswerKey} onChange={event => setIncludeAnswerKey(event.target.checked)} />Отделен ключ с верните отговори</label>
        <p className="ws-muted">Ключът е на отделни страници в края на файла, предназначени за учителя.</p>
      </fieldset>
      <Feedback error={error} busy={loading || busy} />
      {!loading && !definition && error && <button type="button" className="command-button" onClick={() => { setLoading(true); setError(''); setDefinition(null); setRetry(value => value + 1) }}>Опитай отново</button>}
      <div className="dialog-actions">
        <button type="button" className="command-button" disabled={busy} onClick={onClose}><X size={17} aria-hidden="true" />Отказ</button>
        <button type="submit" className="primary command-button" disabled={busy || loading || !definition || !validCount}>{busy ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}{format === 'docx' ? 'Свали Word' : 'Свали PDF'}</button>
      </div>
    </form>
  </dialog>
}
