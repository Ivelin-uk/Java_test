import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Check, FileImage, FileText, LoaderCircle, ShieldCheck, Sparkles, UploadCloud, X } from 'lucide-react'
import type { WorkspaceApi } from './api'
import type { Definition } from './types'
import './aiDocumentImport.css'

export interface ImportedTestDraft { fileName: string; definition: Definition; warnings: string[] }

export function TestDocumentImport({ api, onImported, onBusyChange, sourceMode = 'google-forms' }: { api: WorkspaceApi; onImported: (result: ImportedTestDraft) => void; onBusyChange: (busy: boolean) => void; sourceMode?: 'google-forms' | 'photo' }) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const reader = useRef<FileReader | null>(null)
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [stage, setStage] = useState<'idle' | 'reading' | 'processing'>('idle')
  const [dragging, setDragging] = useState(false)
  const busy = stage !== 'idle'

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; reader.current?.abort(); onBusyChange(false) }
  }, [onBusyChange])

  function choose(next: File) {
    if (inFlight.current) return
    setError('')
    setFile(null)
    const supported = sourceMode === 'photo' ? /\.(png|jpe?g)$/i.test(next.name) : /\.(docx|pdf)$/i.test(next.name)
    if (!supported) {
      setError(sourceMode === 'photo' ? 'Избери снимка или сканирано изображение (PNG/JPG).' : 'Избери PDF или Word (.docx) файл.')
      return
    }
    if (!next.size || next.size > 8 * 1024 * 1024) {
      setError(next.size ? 'Файлът трябва да е до 8 MB.' : 'Файлът е празен. Избери друг файл.')
      return
    }
    setFile(next)
  }

  async function process() {
    if (!file || inFlight.current) return
    inFlight.current = true
    setError(''); setStage('reading'); onBusyChange(true)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const next = new FileReader()
        reader.current = next
        next.onerror = () => reject(new Error('Файлът не може да бъде прочетен. Избери го отново.'))
        next.onabort = () => reject(new Error('Прочитането е прекъснато.'))
        next.onload = () => { const data = String(next.result); resolve(data.slice(data.indexOf(',') + 1)) }
        next.readAsDataURL(file)
      })
      if (!mounted.current) return
      reader.current = null
      setStage('processing')
      const result = await api.post<ImportedTestDraft>('/ai/test-generations/import', { fileName: file.name, base64 })
      if (!mounted.current) return
      if (!result?.definition || !Array.isArray(result.definition.questions) || !result.definition.questions.length || result.definition.questions.length > 100) {
        throw new Error('AI не върна четим тест. Опитай с по-ясен файл.')
      }
      onImported({ ...result, warnings: Array.isArray(result.warnings) ? result.warnings.filter((warning): warning is string => typeof warning === 'string') : [] })
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Неуспешна връзка. Опитай отново със същия файл.')
    } finally {
      inFlight.current = false
      if (mounted.current) setStage('idle')
      onBusyChange(false)
    }
  }

  const isPhoto = sourceMode === 'photo'
  return <form className="ws-ai-import-form" aria-label={isPhoto ? 'Импортиране на тест от снимка' : 'Импортиране на тест от Google Forms'} aria-busy={busy} onSubmit={event => { event.preventDefault(); void process() }}>
    <header className="ws-ai-import-heading"><span className="ws-ai-import-heading-icon"><UploadCloud size={24} aria-hidden="true" /></span><div><h3>{isPhoto ? 'Превърни снимката в тест' : 'Импортирай тест от Google Forms'}</h3><p>{isPhoto ? 'Качи ясна снимка или сканирано изображение. AI ще разчете въпросите и отговорите.' : 'В Google Forms избери Печат и запази като PDF, след което качи файла тук. AI ще извлече въпросите и отговорите.'}</p></div></header>
    <div className="ws-ai-import-formats" aria-label="Поддържани формати">{isPhoto ? <span><FileImage size={16} aria-hidden="true" />Снимка · PNG / JPG</span> : <><span><FileText size={16} aria-hidden="true" />Google Forms · PDF</span><span><FileText size={16} aria-hidden="true" />Word · .docx</span></>}</div>
    <input ref={input} id={`${id}-file`} hidden type="file" aria-label={isPhoto ? 'Снимка на теста' : 'PDF файл от Google Forms'} accept={isPhoto ? '.png,.jpg,.jpeg,image/png,image/jpeg' : '.docx,.pdf,application/pdf'} disabled={busy} onChange={event => { const next = event.target.files?.[0]; event.target.value = ''; if (next) choose(next) }} />
    <div className="ws-ai-import-dropzone" data-dragging={dragging || undefined} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false) }} onDrop={event => {
      event.preventDefault(); setDragging(false)
      if (busy) return
      if (event.dataTransfer.files.length !== 1) { setError('Добави един файл с тест.'); return }
      choose(event.dataTransfer.files[0])
    }}>
      {file ? <div className="ws-ai-import-selected"><span className="ws-ai-import-file-icon">{/\.(png|jpe?g)$/i.test(file.name) ? <FileImage size={28} aria-hidden="true" /> : <FileText size={28} aria-hidden="true" />}</span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toLocaleString('bg-BG', { maximumFractionDigits: 2 })} MB · Готов за обработка</small><div className="ws-actions"><button type="button" className="command-button" disabled={busy} onClick={() => input.current?.click()}><UploadCloud size={16} aria-hidden="true" />Смени файла</button><button type="button" className="icon-button" aria-label="Премахни файла" title="Премахни файла" disabled={busy} onClick={() => { setFile(null); setError('') }}><X size={18} aria-hidden="true" /></button></div></div>
        : <><span className="ws-ai-import-upload-icon"><UploadCloud size={34} strokeWidth={1.5} aria-hidden="true" /></span><strong>{isPhoto ? 'Пусни снимката тук' : 'Пусни PDF файла тук'}</strong><p>или избери файл от устройството си</p><button type="button" className="command-button" disabled={busy} onClick={() => input.current?.click()}>{isPhoto ? 'Избери снимка' : 'Избери PDF файл'}<ArrowRight size={16} aria-hidden="true" /></button><small>Един файл до 8 MB{isPhoto ? '' : ' · PDF до 50 страници'}</small></>}
    </div>
    {error && <p className="error ws-ai-import-error" role="alert">{error}</p>}
    {busy && <div className="ws-ai-import-progress" role="status"><LoaderCircle size={22} className="ws-spin" aria-hidden="true" /><div><strong>{stage === 'reading' ? 'Прочитане на файла…' : 'AI разчита и обработва теста…'}</strong><p>Изчакай черновата, за да прегледаш въпросите и верните отговори.</p></div></div>}
    <div className="ws-ai-import-review-note"><ShieldCheck size={20} aria-hidden="true" /><p>Ти потвърждаваш крайния резултат. Ще можеш да редактираш всеки въпрос, преди да запазиш теста.</p></div>
    <footer className="ws-ai-import-footer"><span><Check size={16} aria-hidden="true" />AI обработка · 1 кредит</span><button type="submit" className="primary command-button" aria-label="Обработи с AI" disabled={busy || !file}>{busy ? <LoaderCircle size={18} className="ws-spin" aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}{busy ? 'Обработване…' : 'Обработи с AI'}{!busy && <ArrowRight size={17} aria-hidden="true" />}</button></footer>
  </form>
}
