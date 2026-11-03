import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileUp, LoaderCircle, Upload, X } from 'lucide-react'
import { useNotifications } from '../notifications'
import { useSubjectCatalog } from './subjects'
import type { Subject } from './subjects'

const MAX_FILE_BYTES = 8 * 1024 * 1024

function SyllabusDialog({ onClose, onImported }: { onClose: () => void; onImported: (subject: Subject) => void }) {
  const catalog = useSubjectCatalog()
  const notify = useNotifications()
  const dialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [fileName, setFileName] = useState('')
  const [subject, setSubject] = useState('')
  const [topics, setTopics] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    element?.showModal()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])

  async function importFile(file?: File) {
    if (!file || busy.current) return
    if (!/\.(pdf|docx)$/i.test(file.name)) { setError('Изберете PDF или DOCX файл.'); return }
    if (!file.size || file.size > MAX_FILE_BYTES) { setError(file.size ? 'Файлът трябва да е до 8 MB.' : 'Файлът е празен.'); return }
    busy.current = true
    setLoading(true)
    setError('')
    setFileName(file.name)
    setReady(false)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('Файлът не може да бъде прочетен.'))
        reader.onload = () => {
          const value = String(reader.result)
          resolve(value.slice(value.indexOf(',') + 1))
        }
        reader.readAsDataURL(file)
      })
      const draft = await catalog.importSyllabus(file.name, base64)
      setSubject(draft.subject)
      setTopics(draft.topics.join('\n'))
      setReady(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Конспектът не може да бъде обработен.')
    } finally {
      busy.current = false
      setLoading(false)
    }
  }

  async function save() {
    const topicList = topics.split(/\r?\n/u).map(topic => topic.trim()).filter(Boolean)
    if (busy.current) return
    if (!subject.trim() || subject.trim().length > 190) { setError('Въведете дисциплина до 190 символа.'); return }
    if (!topicList.length || topicList.length > 300 || topicList.some(topic => topic.length > 190)) {
      setError('Въведете от 1 до 300 теми, всяка до 190 символа, по една на ред.')
      return
    }
    busy.current = true
    setSaving(true)
    setError('')
    try {
      const saved = await catalog.saveSyllabus(subject.trim(), topicList)
      notify(`Импортирани са ${saved.topics.length} теми към „${saved.subject.name}“.`)
      onImported(saved.subject)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Конспектът не може да бъде запазен.')
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  return createPortal(<dialog ref={dialog} className="ws-subject-dialog ws-syllabus-dialog" aria-labelledby="syllabus-import-title" onCancel={event => { event.preventDefault(); if (!busy.current) onClose() }}>
    <form noValidate onSubmit={event => { event.preventDefault(); void save() }}>
      <h2 id="syllabus-import-title">Импортиране на конспект</h2>
      <p className="ws-muted">Качи PDF или DOCX до 8 MB. Текстът се изпраща към AI за разпознаване на дисциплината и темите. Обработката използва 1 AI кредит.</p>
      <div className="ws-actions">
        <button type="button" className="command-button" disabled={loading || saving} onClick={() => fileInput.current?.click()}><Upload size={17} aria-hidden="true" />{ready ? 'Смени файла' : 'Избери файл'}</button>
        <input ref={fileInput} hidden type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-label="PDF или DOCX конспект" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importFile(file) }} />
        {fileName && <span className="ws-muted">{fileName}</span>}
      </div>
      {loading && <p className="ws-ai-source-status" role="status"><LoaderCircle size={17} className="ws-spin" aria-hidden="true" />Обработване на конспекта...</p>}
      {ready && <>
        <label>Дисциплина<input required maxLength={190} value={subject} disabled={saving} onChange={event => setSubject(event.target.value)} /></label>
        <label>Теми (по една на ред)<textarea required rows={10} value={topics} disabled={saving} onChange={event => setTopics(event.target.value)} /></label>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="command-button" disabled={loading || saving} onClick={onClose}><X size={16} aria-hidden="true" />Отказ</button>
        {ready && <button type="submit" className="primary command-button" disabled={saving || loading}><FileUp size={17} aria-hidden="true" />{saving ? 'Запазване...' : 'Потвърди и запази'}</button>}
      </div>
    </form>
  </dialog>, document.body)
}

export function SyllabusImportButton({ onImported, disabled = false }: { onImported: (subject: Subject) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="ws-text-button ws-syllabus-import-button" disabled={disabled} onClick={() => setOpen(true)}><FileUp size={15} aria-hidden="true" />Импортирай конспект</button>
    {open && <SyllabusDialog onClose={() => setOpen(false)} onImported={onImported} />}
  </>
}
