import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Plus, Save, Trash2, Sparkles, ArrowLeft, ArrowRight, X, Check, Pencil, ImagePlus, Copy, Download, Search, BookOpen, Hash, Smartphone, FolderOpen } from 'lucide-react'
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
import { TestGradingFields } from './TestGradingFields'
import { QuestionReplacementDialog } from './QuestionReplacementDialog'
import { difficulties, generationPayload, newAiSettings, questionTypes as types, validAiSettings } from './aiSettings'
import { useNotifications } from '../notifications'
import { SubjectCatalogProvider } from './SubjectCatalog'
import { TopicField } from './TopicField'
import { GradeField } from './GradeField'
import { NewSubjectButton, SubjectCatalogNotice, SubjectField } from './SubjectField'
import { assessmentLevel, assessmentSubject, gradeLabel, mergeSubjects, subjectKey, useSubjectCatalog } from './subjects'
import './assessmentLibrary.css'

const QuestionTextEditor = lazy(() => import('../components/QuestionTextEditor').then(module => ({ default: module.QuestionTextEditor })))

const question = (): Question => ({ type: 'SINGLE_CHOICE', text: '', difficulty: 'MEDIUM', points: 1, timeSeconds: 60, options: [{ text: '', correct: true }, { text: '', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: '' })
const duration = (questions: Question[]) => formatDuration(questions.reduce((total, q) => total + q.timeSeconds, 0))
const blank = (): Definition => ({ title: 'Нов тест', description: '', subject: '', level: '', instructions: '', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, questions: [question()], additionalInformation: '' })
const librarySearchText = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('bg-BG')
function assessmentDifficulty(test: Assessment): string {
  try {
    const questions = (JSON.parse(test.definition_json) as Definition)?.questions
    if (!Array.isArray(questions) || !questions.length) return ''
    const values = new Set(questions.map(q => q?.difficulty))
    if ([...values].some(value => typeof value !== 'string' || !Object.hasOwn(difficulties, value) || value === 'MIXED')) return ''
    return values.size > 1 ? 'MIXED' : questions[0].difficulty
  } catch { return '' }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function shuffleList<T>(items: T[]) {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }
  return next
}

function normalizePrintableText(value: string) {
  if (!value) return ''
  const text = new DOMParser().parseFromString(value, 'text/html').body.textContent ?? ''
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function openPrintableTest(definition: Definition, variantCount: number) {
  const count = Math.min(20, Math.max(1, Number.isInteger(variantCount) ? variantCount : 1))
  const printWindow = window.open('', '_blank', 'width=1100,height=900')
  if (!printWindow) {
    window.alert('Блокиран е отварянето на печатния прозорец. Моля, разрешете новите прозорци за този сайт.')
    return
  }
  printWindow.opener = null

  const pages = Array.from({ length: count }, (_, variantIndex) => {
    const questions = shuffleList(definition.questions).map((question, questionIndex) => {
      const text = escapeHtml(normalizePrintableText(question.text) || 'Въпрос без текст')
      const optionMarkup = question.options.length > 0
        ? `<ol class="print-options">${shuffleList(question.options).map((option, optionIndex) => `<li><span class="print-choice-mark">${escapeHtml(String.fromCharCode(65 + optionIndex))}</span><span>${escapeHtml(normalizePrintableText(option.text) || 'Празен отговор')}</span></li>`).join('')}</ol>`
        : '<div class="print-lines"><span>_____________________________________</span><span>_____________________________________</span></div>'
      const blankLines = question.type === 'SHORT_ANSWER' || question.type === 'OPEN_ANSWER'
        ? '<div class="print-lines"><span>_____________________________________</span><span>_____________________________________</span><span>_____________________________________</span></div>'
        : ''

      return `<div class="print-question"><p class="print-question-title"><strong>${questionIndex + 1}.</strong> ${text}</p>${question.type === 'TRUE_FALSE' ? '<div class="print-two-col"><span>Вярно</span><span>Невярно</span></div>' : optionMarkup}${blankLines}</div>`
    }).join('')

    return `<section class="print-variant"><div class="print-header"><div><div class="print-label">Тест</div><h1>${escapeHtml(definition.title || 'Без заглавие')}</h1></div><div class="print-meta"><div class="print-label">Вариант</div><strong>${variantIndex + 1}/${count}</strong></div></div>${definition.description ? `<p class="print-description">${escapeHtml(normalizePrintableText(definition.description))}</p>` : ''}<div class="print-body">${questions}</div></section>`
  }).join('')

  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8" /><title>${escapeHtml(definition.title || 'Тест')}</title><style>
    @page { size: A4; margin: 14mm; }
    :root { color-scheme: light only; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: #111827; background: white; }
    body { padding: 12mm; }
    .print-variant { page-break-after: always; break-after: page; max-width: 820px; margin: 0 auto 18mm; }
    .print-variant:last-child { page-break-after: auto; }
    .print-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding-bottom: 10px; border-bottom: 2px solid #d1d5db; margin-bottom: 12px; }
    .print-label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280; margin-bottom: 4px; }
    h1 { margin: 0; font-size: 26px; line-height: 1.2; }
    .print-meta { text-align: right; }
    .print-description { margin: 0 0 14px; color: #374151; font-size: 14px; }
    .print-body { display: grid; gap: 16px; }
    .print-question { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 12px 10px; background: #fff; }
    .print-question-title { margin: 0 0 10px; font-size: 16px; line-height: 1.5; }
    .print-options { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    .print-options li { display: flex; align-items: flex-start; gap: 8px; font-size: 15px; line-height: 1.4; }
    .print-choice-mark { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: 1px solid #111827; border-radius: 50%; font-size: 11px; font-weight: 700; margin-top: 1px; }
    .print-two-col { display: grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); gap: 10px; margin-top: 6px; }
    .print-two-col span { display: block; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 10px; }
    .print-lines { display: grid; gap: 8px; margin-top: 10px; }
    .print-lines span { display: block; border-bottom: 1px solid #111827; min-height: 20px; padding-bottom: 2px; }
  </style></head><body>${pages}</body></html>`

  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => printWindow.print(), 250)
}

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
  return <SubjectCatalogProvider api={api}><AssessmentEditorContent api={api} userId={userId} /></SubjectCatalogProvider>
}

function AssessmentEditorContent({ api, userId }: { api: WorkspaceApi; userId: number }) {
  const notify = useNotifications()
  const catalog = useSubjectCatalog()
  const list = useRemote<Assessment[]>(api, '/tests', [])
  const libraryId = useId()
  const [libraryTab, setLibraryTab] = useState<'library' | 'import'>('library')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [librarySubject, setLibrarySubject] = useState('')
  const [libraryTopic, setLibraryTopic] = useState('')
  const [libraryLevel, setLibraryLevel] = useState('')
  const [libraryQuestionCount, setLibraryQuestionCount] = useState('')
  const [libraryDifficulty, setLibraryDifficulty] = useState('')
  const librarySearch = librarySearchText(libraryQuery)
  const topicSearch = librarySearchText(libraryTopic)
  const libraryEntries = useMemo(() => list.data.map(test => ({ test, subject: assessmentSubject(test), level: assessmentLevel(test).trim(), difficulty: assessmentDifficulty(test) })), [list.data])
  const librarySubjects = mergeSubjects([...catalog.subjects, ...list.data.map(test => ({ name: assessmentSubject(test), preset: false }))])
  const subjectCounts = new Map<string, number>()
  for (const test of list.data) {
    const key = subjectKey(assessmentSubject(test))
    subjectCounts.set(key, (subjectCounts.get(key) ?? 0) + 1)
  }
  const subjectCount = (name: string) => subjectCounts.get(subjectKey(name)) ?? 0
  const selectedSubject = librarySubjects.find(subject => `subject:${subjectKey(subject.name)}` === librarySubject)?.name ?? ''
  const matchesSubject = (subject: string) => !librarySubject || (librarySubject === 'unassigned' ? !subject : `subject:${subjectKey(subject)}` === librarySubject)
  const matchesLevel = (level: string) => !libraryLevel || (libraryLevel === 'unassigned' ? !level : level === libraryLevel)
  const libraryTopics = mergeSubjects(libraryEntries.filter(entry => matchesSubject(entry.subject) && matchesLevel(entry.level)).map(({ test }) => ({ name: test.title, preset: false })))
  const libraryGrades = [...new Set([...Array.from({ length: 12 }, (_, index) => String(index + 1)), ...libraryEntries.map(entry => entry.level).filter(Boolean)])]
  const hasLibraryFilters = !!(libraryQuery || librarySubject || libraryTopic || libraryLevel || libraryQuestionCount || libraryDifficulty)
  const visibleTests = libraryEntries.filter(({ test, subject, level, difficulty }) => (!librarySearch || librarySearchText(test.title).includes(librarySearch) || (test.public_number ?? '').includes(librarySearch))
    && matchesSubject(subject) && matchesLevel(level)
    && (!topicSearch || librarySearchText(test.title).includes(topicSearch))
    && (!libraryQuestionCount || Number(libraryQuestionCount) === test.question_count)
    && (!libraryDifficulty || difficulty === libraryDifficulty)).map(entry => entry.test)
  function resetLibraryFilters() {
    setLibraryQuery(''); setLibrarySubject(''); setLibraryTopic(''); setLibraryLevel(''); setLibraryQuestionCount(''); setLibraryDifficulty('')
  }
  const action = useAction()
  const [importNumber, setImportNumber] = useState('')
  const importing = useRef(false)
  const [pendingImages, setPendingImages] = useState(0)
  const [addCount, setAddCount] = useState(1)
  const [questionCountInput, setQuestionCountInput] = useState('1')
  const [defaultDraftDifficulty, setDefaultDraftDifficulty] = useState<Question['difficulty']>('MEDIUM')
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
    else { setCurrent(null); setDefaultDraftDifficulty(definition.questions.at(-1)?.difficulty ?? 'MEDIUM'); setDraft({ ...definition, subject: aiSettings.subject || definition.subject, level: aiSettings.level, gradingScale: aiSettings.gradingScale, passThreshold: aiSettings.passThreshold }); setShowAi(false) }
    setJob(null)
  }
  const [current, setCurrent] = useState<Assessment | null>(null)
  const [preview, setPreview] = useState<{ assessment: Assessment; definition: Definition } | null>(null)
  const [printCount, setPrintCount] = useState(3)
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

  useEffect(() => { setQuestionCountInput(String(draft?.questions.length ?? 0)) }, [draft?.questions.length])
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
          else { setCurrent(null); setDefaultDraftDifficulty(definition.questions.at(-1)?.difficulty ?? 'MEDIUM'); setDraft({ ...definition, subject: aiSettings.subject || definition.subject, level: aiSettings.level, gradingScale: aiSettings.gradingScale, passThreshold: aiSettings.passThreshold }); setShowAi(false) }
          setJob(null)
        } else setJob(next)
      }).catch(() => { if (active) setPollError('Не може да се провери AI заявката. Изчаква се връзка със сървъра.') }).finally(() => { inFlight = false })
    }, 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [api, job, jobMode, aiSettings.subject, aiSettings.level, aiSettings.gradingScale, aiSettings.passThreshold])
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
        ...generationPayload(appendSettings), language: draft.language,
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
  function resizeDraftQuestions(count: number) {
    setDraft(previous => {
      if (!previous) return previous
      const current = previous.questions.length
      const questions = count < current
        ? previous.questions.slice(0, count)
        : [...previous.questions, ...Array.from({ length: count - current }, () => ({ ...question(), difficulty: defaultDraftDifficulty }))]
      return { ...previous, questions }
    })
  }
  function commitQuestionCount() {
    const count = Number(questionCountInput)
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      setQuestionCountInput(String(draft?.questions.length ?? 0))
      return
    }
    resizeDraftQuestions(count)
  }
  function setDraftDifficulty(difficulty: Question['difficulty']) {
    setDefaultDraftDifficulty(difficulty)
    setDraft(previous => previous ? { ...previous, questions: previous.questions.map(item => ({ ...item, difficulty })) } : previous)
  }
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
        resetLibraryFilters()
        setLibraryTab('library')
        setPreview({ assessment: copy, definition: JSON.parse(copy.definition_json) as Definition })
        window.requestAnimationFrame(() => document.getElementById(`${libraryId}-library-tab`)?.focus({ preventScroll: true }))
      }, 'Тестът е добавен в твоята библиотека.')
    } finally { importing.current = false }
  }
  function editTest(test: Assessment) {
    void action.run(async () => {
      const row = await api.get<Assessment>(`/tests/${test.id}`)
      const definition = JSON.parse(row.definition_json) as Definition
      setCurrent(row); setDefaultDraftDifficulty(definition.questions.at(-1)?.difficulty ?? 'MEDIUM'); setDraft(definition); setShowAi(false); setShowAppendAi(false)
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
      resetLibraryFilters()
      if (librarySubject) setLibrarySubject(subjectKey(draft.subject || '') ? `subject:${subjectKey(draft.subject)}` : 'unassigned')
      void catalog.reload()
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
        setJob(await api.post<AiJob>('/ai/test-generations', { ...generationPayload(aiSettings), language: 'bg' }))
      })
    }}>
      <AiTestFields api={api} value={aiSettings} onChange={setAiSettings} disabled={action.busy || generating} showGradingSettings />
      <div className="ws-actions">
        <button type="submit" className="primary command-button" disabled={action.busy || generating || !validGeneration}><Sparkles size={17} />{generating ? 'Генериране...' : 'Генерирай'}</button>
        {job && <span role="status">{label(job.status)}</span>}
        {job?.status === 'completed' && <button type="button" className="command-button" onClick={reviewJob}><Check size={17} /> Прегледай черновата</button>}
        {job?.status === 'failed' && <button type="button" className="command-button" disabled={action.busy} onClick={() => void action.run(async () => { setPollError(''); setJob(await api.post<AiJob>(`/ai/test-generations/${job.id}/retry`)) })}><Sparkles size={17} /> Повтори</button>}
      </div>
    </form>
  </section>
  return <section className={`ws-section${!draft ? ' ws-library' : ''}`}>
    <SectionHead title={draft ? draft.title : 'Библиотека с тестове'} description={draft ? 'Попълни настройките и въпросите, след което натисни „Запази теста“.' : 'Създай тест ръчно или с AI. Тук ще намериш всички свои и добавени от други учители тестове.'}>
      {draft ? <><button type="button" title="Към библиотеката" className="command-button" disabled={action.busy || generating || pendingImages > 0 || !!replacement} onClick={() => { setDraft(null); setCurrent(null); setJob(null); setShowAi(false); setShowAppendAi(false) }}><ArrowLeft size={18} /> Към библиотеката</button><button type="button" className="primary command-button" disabled={saveDisabled} onClick={() => void save()}><Save size={17} /> Запази теста</button></> : <div className="ws-actions"><button type="button" className="primary command-button" disabled={!!job && ['queued', 'running'].includes(job.status)} onClick={() => { setLibraryTab('library'); setCurrent(null); setDefaultDraftDifficulty('MEDIUM'); setDraft({ ...blank(), subject: selectedSubject }); setJob(null); setShowAppendAi(false) }}><Plus size={17} /> Ръчен тест</button><button type="button" className="command-button" disabled={action.busy} onClick={() => { setLibraryTab('library'); setPreview(null); setAiSettings(previous => ({ ...previous, subject: selectedSubject || previous.subject, topic: selectedSubject && selectedSubject !== previous.subject ? '' : previous.topic })); setShowAi(true) }}><Sparkles size={17} /> С AI</button></div>}
    </SectionHead>
    <Feedback error={action.error || list.error || pollError} busy={action.busy || list.loading} />
    {!draft ? <>
      <div className="ws-library-tabs" role="tablist" aria-label="Раздели на библиотеката" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
        const index = tabs.indexOf(event.target as HTMLButtonElement)
        if (index < 0) return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
        tabs[next]?.focus(); tabs[next]?.click()
      }}>
        <button type="button" role="tab" id={`${libraryId}-library-tab`} aria-controls={`${libraryId}-library-panel`} aria-selected={libraryTab === 'library'} tabIndex={libraryTab === 'library' ? 0 : -1} disabled={action.busy || generating} onClick={() => { setLibraryTab('library'); action.clearFeedback() }}><span className="ws-library-tab-icon"><BookOpen size={20} aria-hidden="true" /></span><span className="ws-library-tab-copy"><strong>Моите тестове</strong><small aria-hidden="true">Създавай и управлявай</small></span><span className="ws-library-tab-count" aria-hidden="true">{list.data.length}</span></button>
        <button type="button" role="tab" id={`${libraryId}-import-tab`} aria-controls={`${libraryId}-import-panel`} aria-selected={libraryTab === 'import'} tabIndex={libraryTab === 'import' ? 0 : -1} disabled={action.busy || generating} onClick={() => { setLibraryTab('import'); action.clearFeedback() }}><span className="ws-library-tab-icon"><Download size={20} aria-hidden="true" /></span><span className="ws-library-tab-copy"><strong>Добави от учител</strong><small aria-hidden="true">Използвай споделен номер</small></span><ArrowRight className="ws-library-tab-arrow" size={18} aria-hidden="true" /></button>
      </div>
      <div className="ws-library-view ws-library-collection" role="tabpanel" id={`${libraryId}-library-panel`} aria-labelledby={`${libraryId}-library-tab`} tabIndex={0} hidden={libraryTab !== 'library'}>
      <Panel title="Моите тестове" description="Всичките ти тестове на едно място. Избери тест, за да прегледаш въпросите.">
      <div className="ws-library-search" role="search" aria-label="Търсене в библиотеката">
        <div className="ws-library-search-main">
        <label>Търси тест по име или номер<div className="ws-library-search-input"><Search size={18} aria-hidden="true" /><input type="search" placeholder="Име на тест или номер" value={libraryQuery} onChange={event => setLibraryQuery(event.target.value)} /></div></label>
        <NewSubjectButton disabled={action.busy || catalog.loading} onCreated={subject => { setLibraryQuery(''); setLibraryTopic(''); setLibrarySubject(`subject:${subjectKey(subject.name)}`) }} />
        <button type="button" className="command-button" disabled={!hasLibraryFilters} onClick={resetLibraryFilters}><X size={16} aria-hidden="true" />Изчисти търсенето</button>
        <span className="ws-summary" role="status">{visibleTests.length} от {list.data.length} теста</span>
        </div>
        <div className="ws-library-filters">
          <label>Дисциплина<select aria-label="Филтрирай по дисциплина" value={librarySubject} onChange={event => { setLibrarySubject(event.target.value); setLibraryTopic('') }}><option value="">Всички дисциплини ({list.data.length})</option><option value="unassigned">Без дисциплина ({subjectCount('')})</option>{librarySubjects.map(subject => <option key={subjectKey(subject.name)} value={`subject:${subjectKey(subject.name)}`}>{subject.name} ({subjectCount(subject.name)})</option>)}</select></label>
          <label>Тема<input type="text" aria-label="Филтрирай по тема" autoComplete="off" list={`${libraryId}-topics`} placeholder="Всички теми" value={libraryTopic} onChange={event => setLibraryTopic(event.target.value)} /><datalist id={`${libraryId}-topics`}>{libraryTopics.map(topic => <option key={subjectKey(topic.name)} value={topic.name} />)}</datalist></label>
          <label>Клас<select aria-label="Филтрирай по клас" value={libraryLevel} onChange={event => setLibraryLevel(event.target.value)}><option value="">Всички класове</option><option value="unassigned">Без зададен клас</option>{libraryGrades.map(level => <option key={level} value={level}>{gradeLabel(level)}</option>)}</select></label>
          <label>Въпроси<input type="number" aria-label="Филтрирай по брой въпроси" min={1} max={100} step={1} placeholder="Всички" value={libraryQuestionCount} onChange={event => setLibraryQuestionCount(event.target.value)} /></label>
          <label>Трудност<select aria-label="Филтрирай по трудност" value={libraryDifficulty} onChange={event => setLibraryDifficulty(event.target.value)}><option value="">Всички трудности</option>{Object.entries(difficulties).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        </div>
      </div>
      <SubjectCatalogNotice />
      <TableContainer label="Тестове — таблица"><table className="ws-table ws-library-table" aria-label="Тестове"><thead><tr><th>Тест</th><th>Дисциплина</th><th>Номер</th><th>Въпроси</th><th>Време</th><th>Телефон</th><th>Променен</th><th>Действия</th></tr></thead><tbody>{visibleTests.map(test => <tr key={test.id} aria-selected={preview?.assessment.id === test.id} className={`ws-selectable-row${preview?.assessment.id === test.id ? ' ws-selected-row' : ''}`} tabIndex={0} aria-disabled={action.busy} onClick={e => { if (!(e.target as HTMLElement).closest('button, a, input, select, textarea, label')) selectTest(test) }} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectTest(test) } }}><td><button className="ws-text-button ws-library-title" aria-pressed={preview?.assessment.id === test.id} disabled={action.busy} onClick={() => selectTest(test)}><span className="ws-library-file-icon" aria-hidden="true"><BookOpen size={18} /></span><span>{test.title}</span></button></td><td><span className="ws-library-subject">{assessmentSubject(test) || 'Без дисциплина'}</span>{assessmentLevel(test) && <small className="ws-muted">{gradeLabel(assessmentLevel(test))}</small>}</td><td>{test.public_number ? <div className="ws-test-number"><code>{test.public_number}</code><button type="button" className="icon-button" title="Копирай номера на теста" aria-label={`Копирай номера на тест ${test.title}`} disabled={action.busy} onClick={() => void action.run(() => navigator.clipboard.writeText(test.public_number!), 'Номерът е копиран.')}><Copy size={16} /></button></div> : '—'}</td><td><span className="ws-library-question-count">{test.question_count}</span></td><td>{formatDuration(test.total_time_seconds)}</td><td>{test.owner_id === userId ? <label className="ws-check ws-library-mobile"><input type="checkbox" checked={test.mobile_allowed === true} aria-label={`Разреши решаване от телефон: ${test.title}`} ref={input => { if (input) input.indeterminate = test.mobile_allowed === null }} disabled={action.busy} onChange={event => { const mobileAllowed = event.target.checked; void action.run(async () => { await api.put(`/tests/${test.id}/mobile-mode`, { mobileAllowed }); list.setData(items => items.map(item => item.id === test.id ? { ...item, mobile_allowed: mobileAllowed } : item)) }, 'Настройката за телефон е приложена към всички възлагания.') }} /><span aria-hidden="true" /></label> : test.mobile_allowed === true ? 'Разрешено' : test.mobile_allowed === null ? 'Смесено' : 'Не е разрешено'}</td><td>{date(test.updated_at)}</td><td><div className="ws-actions">{test.owner_id === userId && <button className="command-button" aria-label="Редактирай теста" title="Редактирай теста" disabled={action.busy || generating} onClick={() => editTest(test)}><Pencil size={17} /> Редактирай</button>}<button className="icon-button danger" title="Изтрий теста" disabled={action.busy} onClick={() => setPendingDelete(test)}><Trash2 size={17} /></button></div></td></tr>)}</tbody></table></TableContainer>{!visibleTests.length && !list.loading && !list.error && <div className="ws-library-empty"><FolderOpen size={32} aria-hidden="true" /><Empty>{libraryTopic || libraryLevel || libraryQuestionCount || libraryDifficulty ? 'Няма тестове, съвпадащи с избраните филтри.' : librarySubject ? 'Няма тестове за избраната дисциплина и търсене.' : librarySearch ? 'Няма тестове, съвпадащи с търсенето.' : 'Все още няма тестове в библиотеката.'}</Empty></div>}
      <p className="ws-library-hint"><Smartphone size={16} aria-hidden="true" /><span>„Телефон“ разрешава мобилно решаване за всички настоящи и бъдещи възлагания на теста.</span></p>
      </Panel>
      {preview && <section ref={previewRef} className="ws-test-preview" aria-label="Избран тест">
        <SectionHead title={preview.assessment.title}>
          <div className="ws-print-controls">
            <label>Брой варианти<input type="number" min={1} max={20} step={1} value={printCount} onChange={event => setPrintCount(Math.min(20, Math.max(1, Number(event.target.value) || 1)))} /></label>
            <button className="command-button" disabled={action.busy || generating || !preview.definition.questions.length} onClick={() => openPrintableTest(preview.definition, printCount)}><Download size={17} /> Печатни варианти</button>
            {preview.assessment.owner_id === userId && <button className="command-button" disabled={action.busy || generating} onClick={() => { setCurrent(preview.assessment); setDraft(preview.definition); setShowAppendAi(false) }}><Pencil size={17} /> Редактирай теста</button>}
          </div>
        </SectionHead>
        {preview.definition.description && <p>{preview.definition.description}</p>}
        <p className="ws-summary">{preview.definition.questions.length} въпроса · {preview.definition.questions.reduce((sum, q) => sum + q.points, 0)} точки · {duration(preview.definition.questions)}</p>
        <TableContainer label="Въпроси на избрания тест — таблица"><table className="ws-table" aria-label="Въпроси на избрания тест"><thead><tr><th>#</th><th>Въпрос и отговори</th><th>Тип</th><th>Точки</th><th>Време</th></tr></thead><tbody>{preview.definition.questions.map((q, index) => <tr key={index}><td>{index + 1}</td><td className="ws-preview-question"><QuestionText value={q.text} className="ws-preview-prompt" /><WorkspaceImage api={api} id={q.imageId} />{q.options.length > 0 && <ol className="ws-preview-options">{q.options.map((option, i) => <li key={i} className={option.correct ? 'ws-correct-option' : undefined}>{option.correct && <Check size={15} aria-label="Верен отговор" />}{option.text}</li>)}</ol>}{q.acceptedAnswers.length > 0 && <p>Допустими отговори: {q.acceptedAnswers.join(', ')}</p>}{q.criteria && <p>Критерии: {q.criteria}</p>}{q.explanation && <p className="ws-muted">{q.explanation}</p>}</td><td>{types.find(([key]) => key === q.type)?.[1] ?? q.type}</td><td>{q.points}</td><td>{formatDuration(q.timeSeconds)}</td></tr>)}</tbody></table></TableContainer>
        {!preview.definition.questions.length && <Empty>Няма въпроси в този тест.</Empty>}
      </section>}
      </div>
      <div className="ws-library-view" role="tabpanel" id={`${libraryId}-import-panel`} aria-labelledby={`${libraryId}-import-tab`} tabIndex={0} hidden={libraryTab !== 'import'}>
        <div className="ws-library-import-layout">
          <section className="ws-library-import-card" aria-labelledby={`${libraryId}-import-title`}>
            <span className="ws-library-import-icon"><Download size={28} aria-hidden="true" /></span>
            <span className="ws-library-eyebrow">Споделяйте знания</span>
            <h3 id={`${libraryId}-import-title`}>Добави тест от друг учител</h3>
            <p>Получи готов тест от колега и го направи свой. Нужен ти е само неговият 12-цифрен номер.</p>
            <form className="ws-test-import" aria-label="Добавяне на тест по номер" noValidate onSubmit={event => { event.preventDefault(); void importTest() }}>
              <label htmlFor={`${libraryId}-number`}>Номер на тест</label>
              <div className="ws-library-number-input"><Hash size={21} aria-hidden="true" /><input id={`${libraryId}-number`} aria-describedby={`${libraryId}-number-help`} type="text" inputMode="numeric" autoComplete="off" maxLength={32} placeholder="123456789012" value={importNumber} disabled={action.busy || generating} onChange={event => { setImportNumber(event.target.value); action.clearFeedback() }} /></div>
              <small id={`${libraryId}-number-help`}>Поискай номера от учителя, който е създал теста.</small>
              <button type="submit" className="primary command-button" aria-label="Добави по номер" disabled={action.busy || generating || !importNumber.trim()}><Download size={18} aria-hidden="true" />{action.busy ? 'Добавяне…' : 'Добави по номер'}<ArrowRight size={17} aria-hidden="true" /></button>
            </form>
          </section>
          <aside className="ws-library-import-guide" aria-labelledby={`${libraryId}-guide-title`}>
            <h3 id={`${libraryId}-guide-title`}>От споделен номер до твой тест</h3>
            <ol>
              <li><span aria-hidden="true">1</span><div><strong>Вземи номера</strong><p>Колегата ти го копира от своята библиотека с тестове.</p></div></li>
              <li><span aria-hidden="true">2</span><div><strong>Добави в библиотеката</strong><p>Получаваш собствено копие с въпросите, отговорите и изображенията.</p></div></li>
              <li><span aria-hidden="true">3</span><div><strong>Адаптирай за своя клас</strong><p>Редактирай въпросите и възложи теста, когато си готов.</p></div></li>
            </ol>
            <div className="ws-library-import-note"><Copy size={19} aria-hidden="true" /><p>Копието е твое. Промените ти не засягат оригиналния тест.</p></div>
          </aside>
        </div>
      </div>
    </> : <fieldset className="ws-editor" disabled={saveDisabled}>
      <div className="ws-test-settings" role="group" aria-labelledby="test-settings-title">
      <div className="ws-section-head"><h3 id="test-settings-title">Настройки на теста</h3><button type="button" className="command-button" disabled={saveDisabled || aiLimit < 1} onClick={openAppendAi}><Sparkles size={17} /> Добави с AI</button></div>
      <div className="ws-form-grid ws-context-fields"><SubjectField value={draft.subject ?? ''} disabled={saveDisabled} onChange={subject => setDraft({ ...draft, subject })} /><TopicField subject={draft.subject ?? ''} level={draft.level ?? ''} value={draft.title} disabled={saveDisabled} onChange={title => setDraft({ ...draft, title })} /><GradeField value={draft.level ?? ''} disabled={saveDisabled || !draft.subject} onChange={level => setDraft({ ...draft, level })} /><label>Въпроси<input aria-label="Брой въпроси" type="number" min={1} max={100} step={1} value={questionCountInput} disabled={saveDisabled} onChange={event => setQuestionCountInput(event.target.value)} onBlur={commitQuestionCount} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label><label>Трудност<select aria-label="Трудност" value={draftDifficulties.length > 1 ? '' : draftDifficulties[0] ?? defaultDraftDifficulty} disabled={saveDisabled} onChange={event => setDraftDifficulty(event.target.value as Question['difficulty'])}>{draftDifficulties.length > 1 && <option value="" disabled>Различна</option>}{Object.entries(difficulties).filter(([key]) => key !== 'MIXED').map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label></div>
      <TestGradingFields value={draft} onChange={value => setDraft({ ...draft, ...value })} />
      <fieldset className="ws-ai-types" disabled><legend>Типове въпроси</legend><div className="ws-actions">{types.map(([key, text]) => <label className="ws-check" key={key}><input type="checkbox" readOnly checked={draft.questions.some(q => q.type === key)} />{text}</label>)}</div></fieldset>
      <div className="ws-ai-image-settings"><label className="ws-check"><input type="checkbox" disabled readOnly checked={draftImageCount > 0} />С изображения</label>{draftImageCount > 0 && <label>Въпроси с изображение<input type="number" readOnly value={draftImageCount} /></label>}</div>
      {draftDifficulties.length > 1 && <div className="ws-form-grid">{Object.entries(difficulties).filter(([key]) => key !== 'MIXED').map(([key, text]) => <label key={key}>{text}<input type="number" readOnly value={draft.questions.filter(q => q.difficulty === key).length} /></label>)}</div>}
      <label>Допълнителна информация за теста<textarea aria-label="Допълнителна информация за теста" rows={5} maxLength={20000} value={draft.additionalInformation ?? ''} onChange={e => setDraft({ ...draft, additionalInformation: e.target.value })} /></label>
      <label>Инструкции за изпита<textarea aria-label="Инструкции за изпита" value={draft.instructions ?? ''} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /></label>
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
