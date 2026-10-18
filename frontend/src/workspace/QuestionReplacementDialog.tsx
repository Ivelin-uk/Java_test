import { plainQuestionText } from '../components/richText'
import { QuestionText } from '../components/QuestionText'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, LoaderCircle, RefreshCw, Sparkles, X } from 'lucide-react'
import { AiTestFields } from './AiTestFields'
import { difficulties as difficultyLabels, generationPayload, newAiSettings, questionTypes, validAiSettings } from './aiSettings'
import type { AiSettings } from './aiSettings'
import type { WorkspaceApi } from './api'
import { formatDuration } from './duration'
import type { AiJob, Definition, Question } from './types'
import { WorkspaceImage } from './WorkspaceImage'
import './questionReplacement.css'

const invalidResult = 'AI не върна един валиден въпрос. Опитайте с нова заявка.'
const difficulties = ['EASY', 'MEDIUM', 'HARD', 'VERY_HARD']

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readJob(value: unknown, expectedId?: number): AiJob {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) || Number(value.id) < 1 || expectedId !== undefined && value.id !== expectedId || !['queued', 'running', 'completed', 'failed'].includes(String(value.status))) throw new Error('Сървърът върна невалидна AI заявка. Опитайте отново.')
  return { id: Number(value.id), status: String(value.status), result_json: typeof value.result_json === 'string' ? value.result_json : null, error_message: typeof value.error_message === 'string' ? value.error_message : null }
}

function readQuestion(result: string | null): Question {
  try {
    const value: unknown = JSON.parse(result ?? '')
    if (!isRecord(value) || !isRecord(value.definition) || !Array.isArray(value.definition.questions) || value.definition.questions.length !== 1) throw new Error(invalidResult)
    const q: unknown = value.definition.questions[0]
    if (!isRecord(q) || !questionTypes.some(([key]) => key === q.type) || !difficulties.includes(String(q.difficulty)) || typeof q.text !== 'string' || !q.text.trim() || q.text.length > 12000 || typeof q.points !== 'number' || !Number.isFinite(q.points) || q.points <= 0 || q.points > 10000 || !Number.isInteger(q.timeSeconds) || Number(q.timeSeconds) < 10 || Number(q.timeSeconds) > 3600 || !Array.isArray(q.options) || q.options.length > 30 || !Array.isArray(q.acceptedAnswers) || q.acceptedAnswers.length > 30 || typeof q.caseInsensitive !== 'boolean' || typeof q.collapseWhitespace !== 'boolean' || q.criteria != null && typeof q.criteria !== 'string' || q.explanation != null && typeof q.explanation !== 'string' || q.imageId != null && (!Number.isSafeInteger(q.imageId) || Number(q.imageId) < 1)) throw new Error(invalidResult)
    const options: Question['options'] = q.options.map((option: unknown) => {
      if (!isRecord(option) || typeof option.text !== 'string' || !option.text.trim() || option.text.length > 4000 || typeof option.correct !== 'boolean') throw new Error(invalidResult)
      return { text: option.text, correct: option.correct }
    })
    const acceptedAnswers = q.acceptedAnswers.map((answer: unknown) => {
      if (typeof answer !== 'string' || !answer.trim() || answer.length > 4000) throw new Error(invalidResult)
      return answer
    })
    const correct = options.filter(option => option.correct).length
    if (new Set(options.map(option => option.text.trim().toLowerCase())).size !== options.length || ['SINGLE_CHOICE', 'TRUE_FALSE'].includes(String(q.type)) && (options.length < 2 || correct !== 1) || q.type === 'TRUE_FALSE' && options.length !== 2 || q.type === 'MULTIPLE_CHOICE' && (options.length < 2 || correct < 1) || ['SHORT_ANSWER', 'OPEN_ANSWER'].includes(String(q.type)) && options.length !== 0 || q.type === 'OPEN_ANSWER' && (typeof q.criteria !== 'string' || !q.criteria.trim())) throw new Error(invalidResult)
    return { type: q.type as Question['type'], text: q.text, difficulty: String(q.difficulty), points: q.points, timeSeconds: Number(q.timeSeconds), options, acceptedAnswers, caseInsensitive: q.caseInsensitive, collapseWhitespace: q.collapseWhitespace, criteria: typeof q.criteria === 'string' ? q.criteria : '', explanation: typeof q.explanation === 'string' ? q.explanation : '', imageId: q.imageId == null ? null : Number(q.imageId) }
  } catch {
    throw new Error(invalidResult)
  }
}

function initialSettings(definition: Definition, original?: Question): AiSettings {
  const settings = newAiSettings(definition, 1)
  const difficulty = original && difficulties.includes(original.difficulty) ? original.difficulty : 'MEDIUM'
  return { ...settings, difficulty, questionTypes: original ? [original.type] : ['SINGLE_CHOICE'], difficultyCounts: { EASY: 0, MEDIUM: 0, HARD: 0, VERY_HARD: 0, [difficulty]: 1 }, includeImages: !!original?.imageId }
}

function replacementPayload(settings: AiSettings, definition: Definition, questionIndex: number) {
  const original = definition.questions[questionIndex]
  const oldQuestion = `Въпрос за подмяна:\n${plainQuestionText(original.text).slice(0, 12000)}\n`
  const existing = `Други въпроси в теста:\n${definition.questions.filter((_, index) => index !== questionIndex).map((q, index) => `${index + 1}. ${plainQuestionText(q.text).slice(0, 1000)}`).join('\n')}`
  const context = `${oldQuestion}${existing}`.slice(0, 16000)
  const guidance = 'Създай един различен въпрос за подмяна на избрания. Избягвай повторение на въпроса за подмяна и на другите въпроси в теста.'
  const payload = generationPayload(settings)
  if (settings.useSourceMaterial && settings.sourceMaterial) {
    return { ...payload, level: definition.level ?? '', language: definition.language ?? 'bg', additionalInformation: `${guidance}\n${context}\nУказания от учителя:\n${settings.additionalInformation.trim().slice(0, 20000 - context.length - guidance.length - 30)}`.slice(0, 20000) }
  }
  return { ...payload, level: definition.level ?? '', language: definition.language ?? 'bg', sourceOnly: false, sourceText: `${context}\nОписание на теста:\n${definition.description ?? ''}\nИнструкции:\n${definition.instructions ?? ''}`.slice(0, 20000), additionalInformation: `${guidance}\n${settings.additionalInformation.trim()}`.slice(0, 20000) }
}

async function pollWithTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Проверката отне твърде дълго.')), 20000) })])
  } finally {
    clearTimeout(timer)
  }
}

function errorMessage(cause: unknown) {
  return cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Връзката със сървъра е прекъсната. Опитайте отново.'
}

export function QuestionReplacementDialog({ api, definition, questionIndex, onClose, onReplace }: { api: WorkspaceApi; definition: Definition; questionIndex: number; onClose: () => void; onReplace: (question: Question) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [original] = useState(() => definition.questions[questionIndex])
  const [settings, setSettings] = useState(() => initialSettings(definition, original))
  const [job, setJob] = useState<AiJob | null>(null)
  const [preview, setPreview] = useState<Question | null>(null)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState('')
  const [slowRequest, setSlowRequest] = useState(false)
  const [pollRevision, setPollRevision] = useState(0)
  const mounted = useRef(false)
  const mutation = useRef(false)
  const sequence = useRef(0)
  const submitted = useRef<{ signature: string; payload: ReturnType<typeof replacementPayload>; ambiguous: boolean } | null>(null)
  const previewRef = useRef<HTMLElement>(null)
  const id = useId()
  const generating = !!job && ['queued', 'running'].includes(job.status)
  const disabled = busy || generating

  useEffect(() => {
    mounted.current = true
    const element = dialog.current
    const previousFocus = document.activeElement
    element?.showModal()
    element?.querySelector<HTMLInputElement>('input')?.focus()
    return () => {
      mounted.current = false
      sequence.current += 1
      element?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    if (!busy) return
    const timer = window.setTimeout(() => setSlowRequest(true), 20000)
    return () => window.clearTimeout(timer)
  }, [busy])

  const receiveJob = useCallback((value: unknown, expectedId?: number) => {
    const next = readJob(value, expectedId)
    setJob(next)
    if (next.status === 'completed') {
      setPreview(null)
      try { setPreview(readQuestion(next.result_json)); setError('') }
      catch (cause) { setError(errorMessage(cause)) }
    } else if (next.status === 'failed') {
      setPreview(null)
      setError(next.error_message || 'AI заявката не успя. Може да я повторите.')
    }
  }, [])

  const jobId = job?.id
  const jobStatus = job?.status
  useEffect(() => {
    if (!jobId || !['queued', 'running'].includes(jobStatus ?? '')) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const currentSequence = sequence.current
    async function poll() {
      setChecking(true)
      try {
        const next = await pollWithTimeout(api.get<AiJob>(`/ai/test-generations/${jobId}`))
        if (!active || !mounted.current || sequence.current !== currentSequence) return
        receiveJob(next, jobId)
        setPollError('')
      } catch {
        if (active && mounted.current && sequence.current === currentSequence) setPollError('Не може да се провери AI заявката. Проверката ще продължи автоматично.')
      } finally {
        if (active && mounted.current && sequence.current === currentSequence) {
          setChecking(false)
          timer = setTimeout(() => void poll(), 2000)
        }
      }
    }
    timer = setTimeout(() => void poll(), pollRevision ? 0 : 2000)
    return () => { active = false; clearTimeout(timer) }
  }, [api, jobId, jobStatus, pollRevision, receiveJob])

  useEffect(() => {
    if (!preview) return
    previewRef.current?.focus({ preventScroll: true })
    previewRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }, [preview])

  async function generate(retry = false) {
    if (!original || mutation.current || generating || !retry && !validAiSettings(settings, 1) || retry && job?.status !== 'failed') return
    mutation.current = true
    const currentSequence = ++sequence.current
    const retryId = retry ? job?.id : undefined
    setBusy(true); setSlowRequest(false); setError(''); setPollError(''); setPreview(null)
    if (!retry) setJob(null)
    try {
      if (retryId) {
        const current = readJob(await pollWithTimeout(api.get<AiJob>(`/ai/test-generations/${retryId}`)), retryId)
        if (!mounted.current || sequence.current !== currentSequence) return
        if (current.status !== 'failed') { receiveJob(current, retryId); return }
        const next = await api.post<AiJob>(`/ai/test-generations/${retryId}/retry`)
        if (mounted.current && sequence.current === currentSequence) receiveJob(next, retryId)
      } else {
        const freshPayload = replacementPayload(settings, definition, questionIndex)
        const signature = JSON.stringify({ ...freshPayload, requestKey: undefined })
        const payload = submitted.current?.ambiguous && submitted.current.signature === signature ? submitted.current.payload : freshPayload
        submitted.current = { signature, payload, ambiguous: true }
        const next = readJob(await api.post<AiJob>('/ai/test-generations', payload))
        if (mounted.current && sequence.current === currentSequence) {
          submitted.current.ambiguous = false
          receiveJob(next)
        }
      }
    } catch (cause) {
      if (mounted.current && sequence.current === currentSequence) setError(errorMessage(cause))
    } finally {
      if (mounted.current && sequence.current === currentSequence) {
        mutation.current = false
        setBusy(false); setSlowRequest(false)
      }
    }
  }

  function dismiss() {
    mounted.current = false
    sequence.current += 1
    onClose()
  }

  function apply() {
    if (!original || !preview || disabled || mutation.current) return
    mutation.current = true
    try { onReplace({ ...preview, points: original.points, timeSeconds: original.timeSeconds }) }
    catch (cause) { setError(errorMessage(cause)); mutation.current = false }
  }

  return <dialog ref={dialog} className="ws-replacement-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); dismiss() }}>
    <form className="ws-replacement-form" aria-label="Генериране на заместващ въпрос" onSubmit={event => { event.preventDefault(); void generate() }}>
      <header className="ws-replacement-header">
        <h2 id={`${id}-title`}>Подмяна на въпрос {questionIndex + 1}</h2>
        <button type="button" className="icon-button" aria-label="Затвори подмяната" title="Затвори подмяната" onClick={dismiss}><X size={19} aria-hidden="true" /></button>
      </header>
      <div className="ws-replacement-content">
        <p id={`${id}-description`}>Прегледайте новия въпрос и потвърдете подмяната. {original && <>Точките ({original.points}) и времето ({formatDuration(original.timeSeconds)}) се запазват.</>}</p>
        {original && <details className="ws-replacement-original"><summary>Текущ въпрос</summary><QuestionText value={original.text} /></details>}
        <AiTestFields api={api} value={settings} onChange={setSettings} disabled={disabled || !original} maximum={1} fixedQuestionCount={1} />
        {preview && <section ref={previewRef} tabIndex={-1} className="ws-replacement-preview" aria-label="Преглед на новия въпрос">
          <h3><Check size={19} aria-hidden="true" />Преглед на новия въпрос</h3>
          <p className="ws-muted">{questionTypes.find(([key]) => key === preview.type)?.[1]} · {difficultyLabels[preview.difficulty]} · {original.points} точки · {formatDuration(original.timeSeconds)}</p>
          <QuestionText value={preview.text} className="ws-replacement-prompt" />
          <WorkspaceImage api={api} id={preview.imageId} />
          {preview.options.length > 0 && <ol className="ws-preview-options">{preview.options.map((option, index) => <li key={index} className={option.correct ? 'ws-correct-option' : undefined}>{option.correct && <Check size={15} aria-label="Верен отговор" />}{option.text}</li>)}</ol>}
          {preview.acceptedAnswers.length > 0 && <p><strong>Допустими отговори:</strong> {preview.acceptedAnswers.join(', ')}</p>}
          {preview.type === 'SHORT_ANSWER' && <p className="ws-muted">{preview.caseInsensitive ? 'Без значение на главни и малки букви.' : 'С отчитане на главни и малки букви.'} {preview.collapseWhitespace ? 'Излишните интервали се пренебрегват.' : 'Интервалите се отчитат.'}</p>}
          {preview.criteria && <p><strong>Критерии:</strong> {preview.criteria}</p>}
          {preview.explanation && <p><strong>Обяснение:</strong> {preview.explanation}</p>}
        </section>}
      </div>
      <footer className="ws-replacement-footer">
        {(busy || generating) && <p className="ws-replacement-status" role="status"><LoaderCircle size={17} className="ws-spin" aria-hidden="true" />{busy ? 'Изпращане на заявката...' : 'Генериране на нов въпрос...'}</p>}
        {slowRequest && <p className="ws-muted" role="status">Сървърът отговаря бавно. Може да изчакате или да затворите прозореца.</p>}
        {(busy || generating) && <p className="ws-muted">Затварянето няма да спре вече изпратената AI заявка.</p>}
        {(error || !original) && <p className="error" role="alert">{error || 'Въпросът вече не е наличен. Затворете прозореца и го изберете отново.'}</p>}
        {pollError && <div className="ws-replacement-poll-error"><p className="error" role="alert">{pollError}</p><button type="button" className="command-button" disabled={checking} onClick={() => { setChecking(false); setPollRevision(previous => previous + 1) }}><RefreshCw size={16} aria-hidden="true" />Провери отново</button></div>}
        <div className="ws-actions ws-replacement-actions">
          <button type="button" className="command-button" onClick={dismiss}>Отказ</button>
          {job?.status === 'failed' && <button type="button" className="command-button" disabled={busy} onClick={() => void generate(true)}><RefreshCw size={17} aria-hidden="true" />Повтори заявката</button>}
          <button type="submit" className={`${preview ? '' : 'primary '}command-button`} disabled={disabled || !original || !validAiSettings(settings, 1)}><Sparkles size={17} aria-hidden="true" />Генерирай</button>
          {preview && <button type="button" className="primary command-button" disabled={disabled} onClick={apply}><Check size={17} aria-hidden="true" />Подмени въпроса</button>}
        </div>
      </footer>
    </form>
  </dialog>
}
