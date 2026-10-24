import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Plus, Save, Trash2, Sparkles, ArrowLeft, X, Check, Pencil, ImagePlus, Copy, Download, Search } from 'lucide-react'
import { useAction, useRemote } from './api'
import type { WorkspaceApi } from './api'
import type { AiJob, Assessment, Definition, Question, QuestionType } from './types'
import { date, label } from './types'
import { Empty, Feedback, Panel, SectionHead, TableContainer } from './ui'
import { WorkspaceImage } from './WorkspaceImage'
import { imageBase64 } from './imageUpload'
import { formatDuration } from './duration'
import { DurationInput } from './DurationInput'
import { QuestionText } from '../components/QuestionText'
import { plainQuestionText, questionTextLimit } from '../components/richText'
import { DeleteConfirmationButton, DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog'
import { AiTestFields } from './AiTestFields'
import { QuestionReplacementDialog } from './QuestionReplacementDialog'
import { difficulties, generationPayload, newAiSettings, questionTypes as types, validAiSettings } from './aiSettings'
import { useNotifications } from '../notifications'

const QuestionTextEditor = lazy(() => import('../components/QuestionTextEditor').then(module => ({ default: module.QuestionTextEditor })))

const question = (): Question => ({ type: 'SINGLE_CHOICE', text: '', difficulty: 'MEDIUM', points: 1, timeSeconds: 60, options: [{ text: '', correct: true }, { text: '', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: '' })
const duration = (questions: Question[]) => formatDuration(questions.reduce((total, q) => total + q.timeSeconds, 0))
const blank = (): Definition => ({ title: 'Нов тест', description: '', subject: '', level: '', instructions: '', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, questions: [question()], additionalInformation: '' })
const librarySearchText = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('bg-BG')

function isEmptyQuestion(q: Question) {
  const defaultTrueFalse = q.type === 'TRUE_FALSE' && q.options.length === 2 && q.options[0].text === 'Вярно' && q.options[1].text === 'Невярно'
  return !plainQuestionText(q.text).trim() && !q.imageId && !q.criteria?.trim() && !q.explanation?.trim()
    && q.acceptedAnswers.every(answer => !answer.trim()) && (defaultTrueFalse || q.options.every(option => !option.text.trim()))
}

function fillAiQuestions(definition: Definition, generated: Question[]): Definition {
  let next = 0
  const questions = definition.questions.map(q => isEmptyQuestion(q) && next < generated.length
    ? { ...generated[next++], points: q.points, timeSeconds: q.timeSeconds }
    : q)
  return { ...definition, questions: [...questions, ...generated.slice(next)] }
}

function QuestionPrompt({ api, question: q, textChanged, imageChanged, uploadChanged, disabled }: { disabled: boolean; api: WorkspaceApi; question: Question; textChanged: (text: string) => void; imageChanged: (id: number | null) => void; uploadChanged: (busy: boolean) => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const upload = useAction()
  return <div className="ws-question-prompt">
    <Suspense fallback={<p role="status">Зареждане на редактора…</p>}><QuestionTextEditor value={q.text} onChange={textChanged} disabled={disabled} /></Suspense>
    <div className="ws-actions"><button type="button" className="command-button" disabled={upload.busy} onClick={() => fileInput.current?.click()}><ImagePlus size={17} />{q.imageId ? 'Смени снимката' : 'Добави снимка'}</button>
      <input ref={fileInput} hidden aria-label="Снимка към условието" type="file" accept="image/png,image/jpeg" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload.run(async () => { uploadChanged(true); try { const saved = await api.post<{ id: number }>('/files', { purpose: 'question', base64: await imageBase64(file) }); imageChanged(saved.id) } finally { uploadChanged(false) } }, 'Изображението е добавено.') }} />
      {q.imageId && <DeleteConfirmationButton label="Премахни снимката" icon={X} disabled={upload.busy} title="Премахване на снимка" confirmLabel="Премахни" successMessage="Изображението е премахнато от въпроса." description="Да премахнем ли снимката от условието на въпроса?" onConfirm={() => imageChanged(null)} />}
    </div>
    <Feedback error={upload.error} busy={upload.busy} />
    <WorkspaceImage api={api} id={q.imageId} />
  </div>
}

export function AssessmentEditor({ api, userId }: { api: WorkspaceApi; userId: number }) {
  const notify = useNotifications()
  const list = useRemote<Assessment[]>(api, '/tests', [])
  const [libraryQuery, setLibraryQuery] = useState('')
  const librarySearch = librarySearchText(libraryQuery)
  const visibleTests = list.data.filter(test => !librarySearch || librarySearchText(test.title).includes(librarySearch) || (test.public_number ?? '').includes(librarySearch))
  const action = useAction()
  const [importNumber, setImportNumber] = useState('')
  const importing = useRef(false)
  const [pendingImages, setPendingImages] = useState(0)
  const [addCount, setAddCount] = useState(1)
  const [jobMode, setJobMode] = useState<'new' | 'append'>('new')
  const [aiSettings, setAiSettings] = useState(() => newAiSettings())
  const [appendSettings, setAppendSettings] = useState(() => newAiSettings())
  const [showAppendAi, setShowAppendAi] = useState(false)
  const appendForm = useRef<HTMLFormElement>(null)
  const appendTrigger = useRef<HTMLElement | null>(null)
  const appendQuestionCount = useRef(0)
  function reviewJob() {
    if (!job?.result_json) return
    const definition = (JSON.parse(job.result_json) as { definition: Definition }).definition
    if (jobMode === 'append') { setDraft(previous => previous ? fillAiQuestions(previous, definition.questions) : previous); setShowAppendAi(false) }
    else { setCurrent(null); setDraft(definition); setShowAi(false) }
    setJob(null)
  }
  const [current, setCurrent] = useState<Assessment | null>(null)
  const [preview, setPreview] = useState<{ assessment: Assessment; definition: Definition } | null>(null)
  const previewRef = useRef<HTMLElement>(null)
  const [draft, setDraft] = useState<Definition | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Assessment | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<{ questionIndex: number; optionIndex?: number } | null>(null)
  const [replacement, setReplacement] = useState<{ index: number; question: Question } | null>(null)
  const replacementTrigger = useRef<HTMLElement | null>(null)
  const [job, setJob] = useState<AiJob | null>(null)
  const [showAi, setShowAi] = useState(false)
  const [pollError, setPollError] = useState('')
  const editable = !current || current.owner_id === userId
  const generating = !!job && ['queued', 'running'].includes(job.status)
  const saveDisabled = action.busy || !editable || generating || pendingImages > 0 || !!replacement
  const addLimit = Math.min(20, 100 - (draft?.questions.length ?? 0))
  const emptyQuestions = draft?.questions.filter(isEmptyQuestion) ?? []
  const aiLimit = Math.min(20, 100 - (draft?.questions.length ?? 0) + emptyQuestions.length)
  const validAddCount = Number.isInteger(addCount) && addCount >= 1 && addCount <= addLimit
  const validGeneration = validAiSettings(aiSettings)
  const draftDifficulties = [...new Set(draft?.questions.map(q => q.difficulty))]
  const draftImageCount = draft?.questions.filter(q => q.imageId).length ?? 0

  useEffect(() => { window.scrollTo({ top: 0 }) }, [showAi])

  useEffect(() => {
    if (!preview) return
    previewRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
  }, [preview])

  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return
    let active = true
    let inFlight = false
    const timer = window.setInterval(() => {
      if (inFlight) return
      inFlight = true
      api.get<AiJob>(`/ai/test-generations/${job.id}`).then(next => {
        if (!active) return
        setPollError('')
        if (next.status === 'completed' && next.result_json) {
          const definition = (JSON.parse(next.result_json) as { definition: Definition }).definition
          if (jobMode === 'append') { setDraft(previous => previous ? fillAiQuestions(previous, definition.questions) : previous); setShowAppendAi(false) }
          else { setCurrent(null); setDraft(definition); setShowAi(false) }
          setJob(null)
        } else setJob(next)
      }).catch(() => { if (active) setPollError('Не може да се провери AI заявката. Изчаква се връзка със сървъра.') }).finally(() => { inFlight = false })
    }, 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [api, job, jobMode])
  function openAppendAi() {
    if (!draft || saveDisabled || aiLimit < 1) return
    if (document.activeElement instanceof HTMLElement) appendTrigger.current = document.activeElement
    if (showAppendAi) { appendForm.current?.querySelector('input')?.focus(); return }
    setAppendSettings(newAiSettings({ ...draft, questions: emptyQuestions.length ? emptyQuestions : draft.questions }, Math.min(aiLimit, emptyQuestions.length || (validAddCount ? addCount : 1))))
    setJob(null); setPollError(''); setShowAppendAi(true)
  }
  function closeAppendAi() {
    if (saveDisabled) return
    setShowAppendAi(false); setJob(null); setPollError('')
    appendTrigger.current?.focus()
  }
  async function appendAiQuestions() {
    if (!draft || saveDisabled || !validAiSettings(appendSettings, aiLimit)) return
    await action.run(async () => {
      appendQuestionCount.current = appendSettings.questionCount
      setJobMode('append'); setPollError('')
      setJob(await api.post<AiJob>('/ai/test-generations', {
        ...generationPayload(appendSettings), level: draft.level, language: draft.language,
        ...(appendSettings.useSourceMaterial && appendSettings.sourceMaterial ? {
          additionalInformation: `${appendSettings.additionalInformation.trim()}\nВече включени въпроси (създай различни нови въпроси само по качения материал):\n${draft.questions.map(q => plainQuestionText(q.text)).join('\n')}`.slice(0, 20000),
        } : {
          sourceText: `${draft.description ?? ''}\n${draft.instructions ?? ''}\nВече включени въпроси (създай различни нови въпроси):\n${draft.questions.map(q => plainQuestionText(q.text)).join('\n')}`.slice(0, 20000),
        }),
      }))
    })
  }
  async function retryAppendAi() {
    if (!job || job.status !== 'failed' || saveDisabled) return
    await action.run(async () => {
      if (appendQuestionCount.current > aiLimit) throw new Error('Няма достатъчно място за тази AI заявка. Освободете място или генерирайте по-малко въпроси с нова заявка.')
      setPollError(''); setJob(await api.post<AiJob>(`/ai/test-generations/${job.id}/retry`))
    })
  }
  function patchQuestion(index: number, patch: Partial<Question>) { if (draft) setDraft({ ...draft, questions: draft.questions.map((q, i) => i === index ? { ...q, ...patch } : q) }) }
  function openReplacement(index: number) {
    if (!draft || saveDisabled || !draft.questions[index]) return
    replacementTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    action.clearFeedback()
    setShowAppendAi(false); setJob(null); setPollError('')
    setReplacement({ index, question: draft.questions[index] })
  }
  function closeReplacement() {
    setReplacement(null)
    window.requestAnimationFrame(() => replacementTrigger.current?.focus())
  }
  function replaceQuestion(next: Question) {
    if (!replacement || !draft || !editable || draft.questions[replacement.index] !== replacement.question) {
      throw new Error('Въпросът е променен. Затворете прозореца и опитайте отново.')
    }
    const { index, question: original } = replacement
    setDraft(previous => previous && previous.questions[index] === original ? {
      ...previous,
      questions: previous.questions.map((q, i) => i === index ? { ...next, points: original.points, timeSeconds: original.timeSeconds } : q),
    } : previous)
    closeReplacement()
    notify('Въпросът е подменен в черновата.')
  }
  function typeChange(index: number, type: QuestionType) {
    const text = ['SHORT_ANSWER', 'OPEN_ANSWER'].includes(type)
    patchQuestion(index, { type, options: text ? [] : type === 'TRUE_FALSE' ? [{ text: 'Вярно', correct: true }, { text: 'Невярно', correct: false }] : [{ text: '', correct: true }, { text: '', correct: false }] })
  }
  function selectTest(test: Assessment) {
    void action.run(async () => {
      const row = await api.get<Assessment>(`/tests/${test.id}`)
      setPreview({ assessment: row, definition: JSON.parse(row.definition_json) as Definition })
      setShowAi(false)
    })
  }
  async function importTest() {
    if (importing.current || action.busy || generating) return
    importing.current = true
    try {
      await action.run(async () => {
        const number = importNumber.trim()
        if (!/^[1-9][0-9]{11}$/.test(number)) throw new Error('Номерът на теста трябва да съдържа 12 цифри.')
        const copy = await api.post<Assessment>('/tests/import', { number })
        await list.reload()
        setImportNumber('')
        setLibraryQuery('')
        setPreview({ assessment: copy, definition: JSON.parse(copy.definition_json) as Definition })
      }, 'Тестът е добавен в твоята библиотека.')
    } finally { importing.current = false }
  }
  function editTest(test: Assessment) {
    void action.run(async () => {
      const row = await api.get<Assessment>(`/tests/${test.id}`)
      setCurrent(row); setDraft(JSON.parse(row.definition_json) as Definition); setShowAi(false); setShowAppendAi(false)
      window.scrollTo({ top: 0 })
    })
  }
  async function save() {
    if (!draft || saveDisabled) return
    await action.run(async () => {
      const invalidText = draft.questions.findIndex(q => !plainQuestionText(q.text).trim() || q.text.length > questionTextLimit)
      if (invalidText >= 0) throw new Error(`Условието на въпрос ${invalidText + 1} е празно или надвишава ${questionTextLimit} символа с форматирането.`)
      const invalid = draft.questions.findIndex(q => !Number.isInteger(q.timeSeconds) || q.timeSeconds < 10 || q.timeSeconds > 3600)
      if (invalid >= 0) throw new Error(`Времето за въпрос ${invalid + 1} трябва да е между 0 мин 10 сек и 60 мин 0 сек, в цели секунди.`)
      const saved = await api.call<Assessment>(current ? `/tests/${current.id}` : '/tests', current ? 'PUT' : 'POST', draft)
      setCurrent(saved)
      await api.post(`/tests/${saved.id}/publish`)
      await list.reload()
      setDraft(null); setCurrent(null); setPreview(null); setShowAi(false); setShowAppendAi(false); setJob(null)
      setLibraryQuery('')
      window.scrollTo({ top: 0 })
    }, 'Тестът е запазен.')
  }
  if (showAi && !draft) return <section className="ws-section" aria-label="Създаване на тест с AI">
    <SectionHead title="Създаване на тест с AI" description="Опиши темата и избери настройките. Ще можеш да прегледаш и редактираш въпросите, преди да запазиш теста."><button type="button" title="Към библиотеката" className="command-button" disabled={action.busy || generating} onClick={() => setShowAi(false)}><ArrowLeft size={18} /> Към библиотеката</button></SectionHead>
    <Feedback error={action.error || pollError || (job?.status === 'failed' ? job.error_message ?? 'AI заявката не успя.' : '')} busy={action.busy || generating} />
    <form className="ws-ai-form" onSubmit={e => {
      e.preventDefault()
      if (!validGeneration || action.busy || generating) return
      void action.run(async () => {
        setJobMode('new'); setPollError('')
        setJob(await api.post<AiJob>('/ai/test-generations', { ...generationPayload(aiSettings), level: '', language: 'bg' }))
      })
    }}>
      <AiTestFields api={api} value={aiSettings} onChange={setAiSettings} disabled={action.busy || generating} />
      <div className="ws-actions">
        <button type="submit" className="primary command-button" disabled={action.busy || generating || !validGeneration}><Sparkles size={17} />{generating ? 'Генериране...' : 'Генерирай'}</button>
        {job && <span role="status">{label(job.status)}</span>}
        {job?.status === 'completed' && <button type="button" className="command-button" onClick={reviewJob}><Check size={17} /> Прегледай черновата</button>}
        {job?.status === 'failed' && <button type="button" className="command-button" disabled={action.busy} onClick={() => void action.run(async () => { setPollError(''); setJob(await api.post<AiJob>(`/ai/test-generations/${job.id}/retry`)) })}><Sparkles size={17} /> Повтори</button>}
      </div>
    </form>
  </section>
  return <section className="ws-section">
    <SectionHead title={draft ? draft.title : 'Библиотека с тестове'} description={draft ? 'Попълни настройките и въпросите, след което натисни „Запази теста“.' : 'Създай тест ръчно или с AI. Тук ще намериш всички свои и добавени от други учители тестове.'}>
      {draft ? <><button title="Към библиотеката" className="command-button" disabled={action.busy || generating || pendingImages > 0 || !!replacement} onClick={() => { setDraft(null); setCurrent(null); setJob(null); setShowAi(false); setShowAppendAi(false) }}><ArrowLeft size={18} /> Към библиотеката</button><button className="primary command-button" disabled={saveDisabled} onClick={() => void save()}><Save size={17} /> Запази теста</button></> : <div className="ws-actions"><button className="primary command-button" disabled={!!job && ['queued', 'running'].includes(job.status)} onClick={() => { setCurrent(null); setDraft(blank()); setJob(null); setShowAppendAi(false) }}><Plus size={17} /> Ръчен тест</button><button className="command-button" disabled={action.busy} onClick={() => { setPreview(null); setShowAi(true) }}><Sparkles size={17} /> С AI</button></div>}
    </SectionHead>
    <Feedback error={action.error || list.error || pollError} busy={action.busy || list.loading} />
    {!draft ? <>
      <Panel title="Добави тест от друг учител" description="Въведи споделения 12-цифрен номер, за да добавиш собствено копие в библиотеката си.">
      <form className="ws-test-import" aria-label="Добавяне на тест по номер" noValidate onSubmit={event => { event.preventDefault(); void importTest() }}>
        <label>Номер на тест<input type="text" inputMode="numeric" autoComplete="off" maxLength={32} placeholder="12-цифрен номер" value={importNumber} disabled={action.busy || generating} onChange={event => { setImportNumber(event.target.value); action.clearFeedback() }} /></label>
        <button type="submit" className="command-button" disabled={action.busy || generating || !importNumber.trim()}><Download size={17} /> Добави по номер</button>

      </form>
      </Panel>
      <Panel title="Твоите тестове" description="Отметни „Телефон“, за да разрешиш решаване от телефон за всички съществуващи и бъдещи възлагания на теста. Избери име на тест, за да видиш въпросите.">
      <div className="ws-library-search" role="search" aria-label="Търсене в библиотеката">
        <label>Търси тест по име или номер<div className="ws-library-search-input"><Search size={18} aria-hidden="true" /><input type="search" placeholder="Име на тест или номер" value={libraryQuery} onChange={event => setLibraryQuery(event.target.value)} /></div></label>
        <button type="button" className="command-button" disabled={!libraryQuery} onClick={() => setLibraryQuery('')}><X size={16} aria-hidden="true" />Изчисти търсенето</button>
        <span className="ws-summary" role="status">{visibleTests.length} от {list.data.length} теста</span>
      </div>
      <TableContainer label="Тестове — таблица"><table className="ws-table" aria-label="Тестове"><thead><tr><th>Тест</th><th>Номер</th><th>Въпроси</th><th>Време</th><th>Телефон</th><th>Променен</th><th>Действия</th></tr></thead><tbody>{visibleTests.map(test => <tr key={test.id} aria-selected={preview?.assessment.id === test.id} className={`ws-selectable-row${preview?.assessment.id === test.id ? ' ws-selected-row' : ''}`} tabIndex={0} aria-disabled={action.busy} onClick={e => { if (!(e.target as HTMLElement).closest('button, a, input, select, textarea')) selectTest(test) }} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectTest(test) } }}><td><button className="ws-text-button" aria-pressed={preview?.assessment.id === test.id} disabled={action.busy} onClick={() => selectTest(test)}>{test.title}</button></td><td>{test.public_number ? <div className="ws-test-number"><code>{test.public_number}</code><button type="button" className="icon-button" title="Копирай номера на теста" aria-label={`Копирай номера на тест ${test.title}`} disabled={action.busy} onClick={() => void action.run(() => navigator.clipboard.writeText(test.public_number!), 'Номерът е копиран.')}><Copy size={16} /></button></div> : '—'}</td><td>{test.question_count}</td><td>{formatDuration(test.total_time_seconds)}</td><td>{test.owner_id === userId ? <label className="ws-check"><input type="checkbox" checked={test.mobile_allowed === true} aria-label={`Разреши решаване от телефон: ${test.title}`} ref={input => { if (input) input.indeterminate = test.mobile_allowed === null }} disabled={action.busy} onChange={event => { const mobileAllowed = event.target.checked; void action.run(async () => { await api.put(`/tests/${test.id}/mobile-mode`, { mobileAllowed }); list.setData(items => items.map(item => item.id === test.id ? { ...item, mobile_allowed: mobileAllowed } : item)) }, 'Настройката за телефон е приложена към всички възлагания.') }} /></label> : test.mobile_allowed === true ? 'Разрешено' : test.mobile_allowed === null ? 'Смесено' : 'Не е разрешено'}</td><td>{date(test.updated_at)}</td><td><div className="ws-actions">{test.owner_id === userId && <button className="command-button" aria-label="Редактирай теста" title="Редактирай теста" disabled={action.busy || generating} onClick={() => editTest(test)}><Pencil size={17} /> Редактирай</button>}<button className="icon-button danger" title="Изтрий теста" disabled={action.busy} onClick={() => setPendingDelete(test)}><Trash2 size={17} /></button></div></td></tr>)}</tbody></table></TableContainer>{!visibleTests.length && !list.loading && !list.error && <Empty>{librarySearch ? 'Няма тестове, съвпадащи с търсенето.' : 'Все още няма тестове в библиотеката.'}</Empty>}
      </Panel>
      {preview && <section ref={previewRef} className="ws-test-preview" aria-label="Избран тест">
        <SectionHead title={preview.assessment.title}>{preview.assessment.owner_id === userId && <button className="command-button" disabled={action.busy || generating} onClick={() => { setCurrent(preview.assessment); setDraft(preview.definition); setShowAppendAi(false) }}><Pencil size={17} /> Редактирай теста</button>}</SectionHead>
        {preview.definition.description && <p>{preview.definition.description}</p>}
        <p className="ws-summary">{preview.definition.questions.length} въпроса · {preview.definition.questions.reduce((sum, q) => sum + q.points, 0)} точки · {duration(preview.definition.questions)}</p>
        <TableContainer label="Въпроси на избрания тест — таблица"><table className="ws-table" aria-label="Въпроси на избрания тест"><thead><tr><th>#</th><th>Въпрос и отговори</th><th>Тип</th><th>Точки</th><th>Време</th></tr></thead><tbody>{preview.definition.questions.map((q, index) => <tr key={index}><td>{index + 1}</td><td className="ws-preview-question"><QuestionText value={q.text} className="ws-preview-prompt" /><WorkspaceImage api={api} id={q.imageId} />{q.options.length > 0 && <ol className="ws-preview-options">{q.options.map((option, i) => <li key={i} className={option.correct ? 'ws-correct-option' : undefined}>{option.correct && <Check size={15} aria-label="Верен отговор" />}{option.text}</li>)}</ol>}{q.acceptedAnswers.length > 0 && <p>Допустими отговори: {q.acceptedAnswers.join(', ')}</p>}{q.criteria && <p>Критерии: {q.criteria}</p>}{q.explanation && <p className="ws-muted">{q.explanation}</p>}</td><td>{types.find(([key]) => key === q.type)?.[1] ?? q.type}</td><td>{q.points}</td><td>{formatDuration(q.timeSeconds)}</td></tr>)}</tbody></table></TableContainer>
        {!preview.definition.questions.length && <Empty>Няма въпроси в този тест.</Empty>}
      </section>}
    </> : <fieldset className="ws-editor" disabled={saveDisabled}>
      <div className="ws-test-settings" role="group" aria-labelledby="test-settings-title">
      <div className="ws-section-head"><h3 id="test-settings-title">Настройки на теста</h3><button type="button" className="command-button" disabled={saveDisabled || aiLimit < 1} onClick={openAppendAi}><Sparkles size={17} /> Добави с AI</button></div>
      <div className="ws-form-grid"><label>Тема<input value={draft.title} maxLength={190} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label>Дисциплина<input value={draft.subject ?? ''} maxLength={190} onChange={e => setDraft({ ...draft, subject: e.target.value })} /></label><label>Въпроси<input type="number" readOnly value={draft.questions.length} /></label><label>Трудност<input readOnly value={draftDifficulties.length === 1 ? difficulties[draftDifficulties[0]] : draftDifficulties.length ? difficulties.MIXED : ''} /></label></div>
      <fieldset className="ws-ai-types" disabled><legend>Типове въпроси</legend><div className="ws-actions">{types.map(([key, text]) => <label className="ws-check" key={key}><input type="checkbox" readOnly checked={draft.questions.some(q => q.type === key)} />{text}</label>)}</div></fieldset>
      <div className="ws-ai-image-settings"><label className="ws-check"><input type="checkbox" disabled readOnly checked={draftImageCount > 0} />С изображения</label>{draftImageCount > 0 && <label>Въпроси с изображение<input type="number" readOnly value={draftImageCount} /></label>}</div>
      {draftDifficulties.length > 1 && <div className="ws-form-grid">{Object.entries(difficulties).filter(([key]) => key !== 'MIXED').map(([key, text]) => <label key={key}>{text}<input type="number" readOnly value={draft.questions.filter(q => q.difficulty === key).length} /></label>)}</div>}
      <label>Допълнителна информация за теста<textarea aria-label="Допълнителна информация за теста" rows={5} maxLength={20000} value={draft.additionalInformation ?? ''} onChange={e => setDraft({ ...draft, additionalInformation: e.target.value })} /></label>
      <details className="ws-test-advanced"><summary>Настройки за изпита</summary><div className="ws-test-advanced-fields">
        <div className="ws-form-grid"><label>Клас / ниво<input value={draft.level ?? ''} onChange={e => setDraft({ ...draft, level: e.target.value })} /></label><label>Език<select value={draft.language} onChange={e => setDraft({ ...draft, language: e.target.value })}><option value="bg">Български</option><option value="Bulgarian">Български</option><option value="en">Английски</option></select></label></div>
        <label>Описание<textarea aria-label="Описание" value={draft.description ?? ''} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label><label>Инструкции за изпита<textarea aria-label="Инструкции за изпита" value={draft.instructions ?? ''} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /></label>
        <div className="ws-form-grid"><label>Скала<select value={draft.gradingScale} onChange={e => setDraft({ ...draft, gradingScale: e.target.value })}><option value="bulgarian">Българска (2–6)</option><option value="percentage">Процент</option><option value="pass_fail">Успешен / неуспешен</option></select></label><label>Праг за успех (%)<input type="number" min={0} max={100} value={draft.passThreshold} onChange={e => setDraft({ ...draft, passThreshold: Number(e.target.value) })} /></label></div>
      </div></details>
      <p className="ws-summary">{draft.questions.length} въпроса · {draft.questions.reduce((sum, q) => sum + q.points, 0)} точки · {duration(draft.questions)}</p>
      </div>
      {draft.questions.map((q, index) => <article className="ws-question" key={index}><div className="ws-question-head"><strong>Въпрос {index + 1}</strong><select aria-label={`Тип на въпрос ${index + 1}`} value={q.type} onChange={e => typeChange(index, e.target.value as QuestionType)}>{types.map(([type, text]) => <option key={type} value={type}>{text}</option>)}</select><button type="button" className="command-button" aria-label={`Подмени въпрос ${index + 1} с AI`} disabled={saveDisabled} onClick={() => openReplacement(index)}><Sparkles size={17} /> Подмени с AI</button><button className="icon-button danger" title="Изтрий въпрос" onClick={() => setPendingRemoval({ questionIndex: index })}><Trash2 size={17} /></button></div><QuestionPrompt disabled={saveDisabled} api={api} question={q} textChanged={text => patchQuestion(index, { text })} imageChanged={imageId => patchQuestion(index, { imageId })} uploadChanged={busy => setPendingImages(previous => previous + (busy ? 1 : -1))} /><div className="ws-form-grid"><label>Трудност<select value={q.difficulty} onChange={e => patchQuestion(index, { difficulty: e.target.value, timeSeconds: ({ EASY: 30, MEDIUM: 60, HARD: 120, VERY_HARD: 180 })[e.target.value as 'EASY'] })}><option value="EASY">Лесен</option><option value="MEDIUM">Среден</option><option value="HARD">Труден</option><option value="VERY_HARD">Много труден</option></select></label><label>Точки<input type="number" min={0.0001} step="0.1" value={q.points} onChange={e => patchQuestion(index, { points: Number(e.target.value) })} /></label><DurationInput seconds={q.timeSeconds} question={index + 1} onChange={timeSeconds => patchQuestion(index, { timeSeconds })} /></div>
        {q.options.map((option, i) => <div className="ws-option-editor" key={i}><input aria-label={`Верен отговор ${i + 1}`} type={q.type === 'MULTIPLE_CHOICE' ? 'checkbox' : 'radio'} name={`correct-${index}`} checked={option.correct} onChange={e => patchQuestion(index, { options: q.options.map((o, j) => j === i ? { ...o, correct: e.target.checked } : q.type === 'MULTIPLE_CHOICE' ? o : { ...o, correct: false }) })} /><input aria-label={`Опция ${i + 1}`} value={option.text} onChange={e => patchQuestion(index, { options: q.options.map((o, j) => j === i ? { ...o, text: e.target.value } : o) })} /><button className="icon-button danger" title="Премахни опция" onClick={() => setPendingRemoval({ questionIndex: index, optionIndex: i })}><X size={16} /></button></div>)}
        {['SINGLE_CHOICE', 'MULTIPLE_CHOICE'].includes(q.type) && <button className="command-button" onClick={() => patchQuestion(index, { options: [...q.options, { text: '', correct: false }] })}><Plus size={16} /> Опция</button>}
        {q.type === 'SHORT_ANSWER' && <><label>Допустими отговори (по един на ред)<textarea value={q.acceptedAnswers.join('\n')} onChange={e => patchQuestion(index, { acceptedAnswers: e.target.value ? e.target.value.split('\n') : [] })} /></label><div className="ws-actions"><label className="ws-check"><input type="checkbox" checked={q.caseInsensitive} onChange={e => patchQuestion(index, { caseInsensitive: e.target.checked })} /> Без разлика малки / главни</label><label className="ws-check"><input type="checkbox" checked={q.collapseWhitespace} onChange={e => patchQuestion(index, { collapseWhitespace: e.target.checked })} /> Нормализирай интервали</label></div></>}
        {['SHORT_ANSWER', 'OPEN_ANSWER'].includes(q.type) && <label>Критерии за ръчна проверка<textarea value={q.criteria} onChange={e => patchQuestion(index, { criteria: e.target.value })} /></label>}<label>Обяснение след разрешен преглед<textarea value={q.explanation ?? ''} onChange={e => patchQuestion(index, { explanation: e.target.value })} /></label>
      </article>)}
      <section className="ws-add-questions" aria-label="Добавяне на въпроси">
        <div className="ws-inline-form"><label>Брой нови въпроси<input type="number" min={1} max={Math.max(1, addLimit)} step={1} value={addCount} disabled={!addLimit} onChange={e => setAddCount(Number(e.target.value))} /></label><button className="command-button" disabled={!validAddCount || generating} onClick={() => setDraft(previous => previous ? { ...previous, questions: [...previous.questions, ...Array.from({ length: addCount }, question)] } : previous)}><Plus size={17} /> Ръчно</button><button type="button" className="command-button" disabled={saveDisabled || aiLimit < 1} onClick={openAppendAi}><Sparkles size={17} /> С AI</button><span className="ws-summary">{draft.questions.length} / 100</span></div>
        <Feedback error={action.error || (job?.status === 'failed' ? job.error_message ?? 'AI заявката не успя.' : pollError)} busy={generating} />
        {showAppendAi && <form ref={appendForm} className="ws-ai-form ws-append-ai" aria-label="Добавяне на въпроси с AI" onSubmit={e => { e.preventDefault(); void appendAiQuestions() }}>
          <div className="ws-section-head"><h3>{emptyQuestions.length ? 'Попълване на празни въпроси с AI' : 'Нови въпроси с AI'}</h3><button type="button" className="icon-button" title="Затвори AI настройките" disabled={saveDisabled} onClick={closeAppendAi}><X size={18} /></button></div>
          {emptyQuestions.length > 0 && <p className="ws-muted">AI ще попълни първо празните въпроси ({emptyQuestions.length}) по ред. Въпросите с въведено съдържание, точките и времето се запазват. Ако заявите повече въпроси, останалите ще се добавят в края.</p>}
          <AiTestFields api={api} value={appendSettings} onChange={setAppendSettings} disabled={saveDisabled} maximum={aiLimit} />
          <div className="ws-actions"><button type="submit" className="primary command-button" disabled={saveDisabled || !validAiSettings(appendSettings, aiLimit)}><Sparkles size={17} />{generating ? 'Генериране...' : 'Генерирай'}</button>
            {job && <span role="status">{label(job.status)}</span>}
            {job?.status === 'failed' && <button type="button" className="command-button" disabled={saveDisabled} onClick={() => void retryAppendAi()}><Sparkles size={17} /> Повтори</button>}
          </div>
        </form>}
      </section>
      <div className="ws-actions ws-editor-footer"><button type="button" className="primary command-button" disabled={saveDisabled} onClick={() => void save()}><Save size={17} /> Запази</button></div>
    </fieldset>}
    {replacement && draft && <QuestionReplacementDialog api={api} definition={draft} questionIndex={replacement.index} onClose={closeReplacement} onReplace={replaceQuestion} />}
    {pendingDelete && <TestDeleteDialog api={api} test={pendingDelete} owned={pendingDelete.owner_id === userId} close={() => setPendingDelete(null)} deleted={async () => { if (preview?.assessment.id === pendingDelete.id) setPreview(null); await list.reload(); setPendingDelete(null) }} />}
    {pendingRemoval && draft && <DeleteConfirmationDialog
      title={pendingRemoval.optionIndex === undefined ? 'Изтриване на въпрос' : 'Премахване на опция'}
      confirmLabel={pendingRemoval.optionIndex === undefined ? 'Изтрий' : 'Премахни'}
      successMessage={pendingRemoval.optionIndex === undefined ? 'Въпросът е премахнат от черновата.' : 'Опцията е премахната от черновата.'}
      confirmDisabled={action.busy || generating || pendingImages > 0}
      description={pendingRemoval.optionIndex === undefined ? <>Да изтрием ли <strong>въпрос {pendingRemoval.questionIndex + 1}</strong> заедно с отговорите му? {draft.questions[pendingRemoval.questionIndex]?.text}</> : <>Да премахнем ли <strong>опция {pendingRemoval.optionIndex + 1}</strong> от въпрос {pendingRemoval.questionIndex + 1}? {draft.questions[pendingRemoval.questionIndex]?.options[pendingRemoval.optionIndex]?.text}</>}
      onCancel={() => setPendingRemoval(null)}
      onConfirm={() => setDraft(previous => previous ? { ...previous, questions: pendingRemoval.optionIndex === undefined ? previous.questions.filter((_, index) => index !== pendingRemoval.questionIndex) : previous.questions.map((q, index) => index === pendingRemoval.questionIndex ? { ...q, options: q.options.filter((_, i) => i !== pendingRemoval.optionIndex) } : q) } : previous)}
    />}
  </section>
}

function TestDeleteDialog({ api, test, owned, close, deleted }: { api: WorkspaceApi; test: Assessment; owned: boolean; close: () => void; deleted: () => Promise<void> }) {
  return <DeleteConfirmationDialog title="Изтриване на тест" successMessage={owned ? 'Тестът е изтрит.' : 'Тестът е премахнат от библиотеката.'} description={owned ? <>Да изтрием ли теста <strong>{test.title}</strong>? Възлаганията и резултатите от проведени изпити ще се запазят.</> : <>Да премахнем ли <strong>{test.title}</strong> от твоята библиотека? Споделеният тест ще остане достъпен за автора и другите учители.</>} onCancel={close} onConfirm={async () => { await api.remove(`/tests/${test.id}`); await deleted() }} />
}
