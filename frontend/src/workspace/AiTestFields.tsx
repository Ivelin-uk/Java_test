import { useEffect, useId, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { AlignLeft, BookOpen, Check, CircleDot, FileText, Image, ListChecks, LoaderCircle, MessageSquareText, Sparkles, Upload, X } from 'lucide-react'
import { difficulties, questionTypes, requestedImages, validDistribution } from './aiSettings'
import type { AiSettings } from './aiSettings'
import type { WorkspaceApi } from './api'
import { TestGradingFields } from './TestGradingFields'
import { SubjectField } from './SubjectField'
import { TopicField } from './TopicField'
import { GradeField } from './GradeField'
import './aiCreation.css'

export function AiTestFields({ api, value, onChange, disabled, maximum = 20, fixedQuestionCount, showGradingSettings = false }: { api: WorkspaceApi; value: AiSettings; onChange: Dispatch<SetStateAction<AiSettings>>; disabled: boolean; maximum?: number; fixedQuestionCount?: number; showGradingSettings?: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const reader = useRef<FileReader | null>(null)
  const request = useRef(0)
  const mounted = useRef(false)
  const [uploadName, setUploadName] = useState('')
  const [reading, setReading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const descriptionId = useId()
  function patch(next: Partial<AiSettings>) { onChange(previous => ({ ...previous, ...next })) }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      request.current += 1
      reader.current?.abort()
      onChange(previous => previous.sourceMaterialLoading ? { ...previous, sourceMaterial: null, useSourceMaterial: false, sourceMaterialLoading: false, sourceMaterialError: '' } : previous)
    }
  }, [onChange])

  function removeMaterial() {
    request.current += 1
    reader.current?.abort()
    reader.current = null
    setUploadName('')
    setReading(false)
    patch({ sourceMaterial: null, useSourceMaterial: false, sourceMaterialLoading: false, sourceMaterialError: '' })
  }

  async function uploadMaterial(file: File) {
    const currentRequest = ++request.current
    reader.current?.abort()
    reader.current = null
    patch({ sourceMaterial: null, useSourceMaterial: false, sourceMaterialLoading: false, sourceMaterialError: '' })
    setUploadName('')
    if (!/\.(pdf|pptx|docx|txt)$/i.test(file.name)) {
      patch({ sourceMaterialError: 'Изберете PDF, PPTX, DOCX или TXT файл.' })
      return
    }
    if (!file.size || file.size > 8 * 1024 * 1024) {
      patch({ sourceMaterialError: file.size ? 'Файлът трябва да е до 8 MB.' : 'Файлът е празен. Изберете друг материал.' })
      return
    }
    setUploadName(file.name)
    setReading(true)
    patch({ sourceMaterialLoading: true })
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const nextReader = new FileReader()
        reader.current = nextReader
        nextReader.onerror = () => reject(new Error('Файлът не може да бъде прочетен. Изберете го отново.'))
        nextReader.onabort = () => reject(new Error('Прочитането е прекъснато.'))
        nextReader.onload = () => {
          const data = String(nextReader.result)
          resolve(data.slice(data.indexOf(',') + 1))
        }
        nextReader.readAsDataURL(file)
      })
      if (!mounted.current || request.current !== currentRequest) return
      reader.current = null
      setReading(false)
      const material = await api.post<NonNullable<AiSettings['sourceMaterial']>>('/ai/test-generations/source-material', { fileName: file.name, base64 })
      if (!mounted.current || request.current !== currentRequest) return
      if (typeof material.sourceText !== 'string' || !material.sourceText.trim() || material.sourceText.length > 100000) throw new Error('Материалът трябва да съдържа текст до 100 000 символа.')
      patch({ sourceMaterial: material, useSourceMaterial: true, sourceMaterialLoading: false, sourceMaterialError: '' })
      setUploadName('')
    } catch (cause) {
      if (!mounted.current || request.current !== currentRequest) return
      setUploadName('')
      setReading(false)
      patch({ sourceMaterial: null, useSourceMaterial: false, sourceMaterialLoading: false, sourceMaterialError: cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Материалът не може да бъде обработен. Опитайте отново.' })
    }
  }

  return <fieldset className={`ws-editor ws-ai-fields ${showGradingSettings ? 'ws-ai-fields-full' : 'ws-ai-fields-compact'}`} disabled={disabled}>
    <section className="ws-ai-card">
      <header className="ws-ai-card-head"><span className="ws-ai-card-step" aria-hidden="true">01</span><div><h3>Основи на теста</h3><p>Избери какво ще проверяваш и за кого е тестът.</p></div><BookOpen size={20} aria-hidden="true" /></header>
      <div className="ws-form-grid ws-context-fields">
        <SubjectField value={value.subject} autoFocus={showGradingSettings} disabled={disabled} onChange={subject => patch({ subject, ...(subject !== value.subject && showGradingSettings ? { topic: '' } : {}) })} />
        <TopicField subject={value.subject} level={value.level} value={value.topic} disabled={disabled} requireSubject={showGradingSettings} onChange={topic => patch({ topic })} />
        <GradeField value={value.level} disabled={disabled || !value.subject} onChange={level => patch({ level })} />
        <label>Въпроси<input type="number" min={1} max={maximum} step={1} readOnly={fixedQuestionCount !== undefined} value={fixedQuestionCount ?? value.questionCount} onChange={e => patch({ questionCount: Number(e.target.value) })} /></label>
        <label>Трудност<select aria-label="Трудност" value={value.difficulty} onChange={e => patch({ difficulty: e.target.value })}>{Object.entries(difficulties).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      </div>
      {value.difficulty === 'MIXED' && <div className="ws-ai-distribution"><p>Разпредели въпросите по трудност</p><div className="ws-form-grid">{Object.entries(difficulties).filter(([key]) => key !== 'MIXED').map(([key, title]) => <label key={key}>{title}<input type="number" min={0} max={20} step={1} value={value.difficultyCounts[key]} onChange={e => patch({ difficultyCounts: { ...value.difficultyCounts, [key]: Number(e.target.value) } })} /></label>)}</div></div>}
      {!validDistribution(value) && <p className="error" role="alert">Сумата по трудност трябва да е равна на броя въпроси.</p>}
    </section>
    <section className="ws-ai-card">
      <header className="ws-ai-card-head"><span className="ws-ai-card-step" aria-hidden="true">02</span><div><h3>Формат на въпросите</h3><p>Избери един или комбинирай няколко типа.</p></div><ListChecks size={20} aria-hidden="true" /></header>
      <fieldset className="ws-ai-types"><legend>Типове въпроси</legend><div className="ws-ai-type-options ws-actions">{questionTypes.map(([key, title]) => {
        const Icon = key === 'SINGLE_CHOICE' ? CircleDot : key === 'MULTIPLE_CHOICE' ? ListChecks : key === 'TRUE_FALSE' ? Check : key === 'SHORT_ANSWER' ? MessageSquareText : AlignLeft
        const description = key === 'SINGLE_CHOICE' ? 'Един правилен избор' : key === 'MULTIPLE_CHOICE' ? 'Повече от един избор' : key === 'TRUE_FALSE' ? 'Две възможности' : key === 'SHORT_ANSWER' ? 'Кратък писмен отговор' : 'Разгърнат писмен отговор'
        return <label className="ws-check ws-ai-type-option" data-selected={value.questionTypes.includes(key)} key={key}><input type="checkbox" checked={value.questionTypes.includes(key)} onChange={e => patch({ questionTypes: e.target.checked ? [...value.questionTypes, key] : value.questionTypes.filter(t => t !== key) })} /><Icon size={19} aria-hidden="true" /><span><strong>{title}</strong><small aria-hidden="true">{description}</small></span></label>
      })}</div></fieldset>
      <div className="ws-ai-image-settings"><label className="ws-check"><input type="checkbox" checked={value.includeImages} onChange={e => patch({ includeImages: e.target.checked })} /><Image size={18} aria-hidden="true" />С изображения</label>{value.includeImages ? <label>Въпроси с изображение<input type="number" min={1} max={value.questionCount} step={1} value={requestedImages(value)} onChange={e => patch({ imageCount: Number(e.target.value) })} /></label> : <p className="ws-ai-field-hint">Добави генерирани илюстрации към избрани въпроси.</p>}</div>
    </section>
    <section className="ws-ai-card">
      <header className="ws-ai-card-head"><span className="ws-ai-card-step" aria-hidden="true">03</span><div><h3>Материали и насоки</h3><p>По желание дай на AI повече контекст за урока.</p></div><FileText size={20} aria-hidden="true" /></header>
      <fieldset className="ws-ai-source" aria-describedby={descriptionId}>
        <legend>Лекция или презентация</legend>
        <div className={`ws-ai-material-dropzone${dragging ? ' ws-ai-material-dragging' : ''}${value.sourceMaterial ? ' ws-ai-material-ready' : ''}`} onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true) }} onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false) }} onDrop={event => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (!disabled && file) void uploadMaterial(file) }}>
          <span className="ws-ai-material-icon" aria-hidden="true">{value.sourceMaterial ? <FileText size={25} /> : <Upload size={25} />}</span>
          <div className="ws-ai-material-copy"><strong>{value.sourceMaterial ? 'Материалът е готов' : 'Добави материал към темата'}</strong><p id={descriptionId} className="ws-muted">PDF, PowerPoint (PPTX), Word (DOCX) или TXT до 8 MB и 100 000 символа. Материалът трябва да съдържа избираем текст.</p></div>
          <div className="ws-actions">
            <button type="button" className="command-button" onClick={() => fileInput.current?.click()}><Upload size={17} aria-hidden="true" />{value.sourceMaterial || value.sourceMaterialLoading ? 'Смени файла' : 'Качи файл'}</button>
            <input ref={fileInput} hidden type="file" aria-label="Лекция или презентация" accept=".pdf,.pptx,.docx,.txt" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void uploadMaterial(file) }} />
            {(value.sourceMaterial || value.sourceMaterialLoading) && <button type="button" className="command-button" onClick={removeMaterial}><X size={17} aria-hidden="true" />Премахни материала</button>}
          </div>
        </div>
        {value.sourceMaterialLoading && <p className="ws-ai-source-status" role="status"><LoaderCircle size={17} className="ws-spin" aria-hidden="true" /><span>{reading ? 'Прочитане на' : 'Обработване на'} {uploadName}...</span></p>}
        {value.sourceMaterial && <p className="ws-ai-source-status" role="status"><FileText size={17} aria-hidden="true" /><span><strong>{value.sourceMaterial.fileName}</strong> · {value.sourceMaterial.characterCount.toLocaleString('bg-BG')} символа текст</span></p>}
        {value.sourceMaterialError && <p className="error" role="alert">{value.sourceMaterialError}</p>}
        <label className="ws-check"><input type="checkbox" checked={value.useSourceMaterial} disabled={!value.sourceMaterial || value.sourceMaterialLoading} onChange={e => patch({ useSourceMaterial: e.target.checked })} />Генерирай тест по качения материал</label>
        {value.useSourceMaterial && <p className="ws-muted">Въпросите ще се основават на съдържанието на качения материал.</p>}
      </fieldset>
      <label className="ws-ai-additional">Допълнителна информация за теста<textarea aria-label="Допълнителна информация за теста" rows={4} placeholder="Например: повече практически задачи, акцент върху основните понятия…" value={value.additionalInformation} maxLength={20000} onChange={e => patch({ additionalInformation: e.target.value })} /><span className="ws-ai-field-hint" aria-hidden="true">{value.additionalInformation.length.toLocaleString('bg-BG')} / 20 000 символа</span></label>
    </section>
    {showGradingSettings && <section className="ws-ai-card ws-ai-grading-card"><header className="ws-ai-card-head"><span className="ws-ai-card-step" aria-hidden="true">04</span><div><h3>Оценяване</h3><p>Настрой скалата и прага за успешен резултат.</p></div><Sparkles size={20} aria-hidden="true" /></header><TestGradingFields value={value} onChange={patch} /></section>}
  </fieldset>
}
