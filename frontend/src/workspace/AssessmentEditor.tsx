import { useEffect, useRef, useState } from 'react'
import { Plus, Save, Trash2, Sparkles, ArrowLeft, X, Check, Pencil, ImagePlus } from 'lucide-react'
import { useAction, useRemote } from './api'
import type { WorkspaceApi } from './api'
import type { AiJob, Assessment, Definition, Question, QuestionType } from './types'
import { date, label } from './types'
import { Empty, Feedback, SectionHead } from './ui'
import { WorkspaceImage } from './WorkspaceImage'
import { imageBase64 } from './imageUpload'
import { formatDuration } from './duration'
import { DurationInput } from './DurationInput'
import { DeleteConfirmationButton, DeleteConfirmationDialog } from '../components/DeleteConfirmationDialog'

const question = (): Question => ({ type: 'SINGLE_CHOICE', text: '', difficulty: 'MEDIUM', points: 1, timeSeconds: 60, options: [{ text: '', correct: true }, { text: '', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: '' })
const duration = (questions: Question[]) => formatDuration(questions.reduce((total, q) => total + q.timeSeconds, 0))
const blank = (): Definition => ({ title: 'Нов тест', description: '', subject: '', level: '', instructions: '', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, questions: [question()] })
const types: [QuestionType, string][] = [['SINGLE_CHOICE', 'Един верен отговор'], ['MULTIPLE_CHOICE', 'Няколко верни'], ['TRUE_FALSE', 'Вярно / невярно'], ['SHORT_ANSWER', 'Кратък текст'], ['OPEN_ANSWER', 'Свободен отговор']]

function QuestionPrompt({ api, question: q, textChanged, imageChanged, uploadChanged }: { api: WorkspaceApi; question: Question; textChanged: (text: string) => void; imageChanged: (id: number | null) => void; uploadChanged: (busy: boolean) => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const upload = useAction()
  return <div className="ws-question-prompt">
    <label>Условие на въпроса<textarea aria-label="Текст" value={q.text} onChange={e => textChanged(e.target.value)} /></label>
    <div className="ws-actions"><button type="button" className="command-button" disabled={upload.busy} onClick={() => fileInput.current?.click()}><ImagePlus size={17} />{q.imageId ? 'Смени снимката' : 'Добави снимка'}</button>
      <input ref={fileInput} hidden aria-label="Снимка към условието" type="file" accept="image/png,image/jpeg" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload.run(async () => { uploadChanged(true); try { const saved = await api.post<{ id: number }>('/files', { purpose: 'question', base64: await imageBase64(file) }); imageChanged(saved.id) } finally { uploadChanged(false) } }) }} />
      {q.imageId && <DeleteConfirmationButton label="Премахни снимката" icon={X} disabled={upload.busy} title="Премахване на снимка" confirmLabel="Премахни" description="Да премахнем ли снимката от условието на въпроса?" onConfirm={() => imageChanged(null)} />}
    </div>
    <Feedback error={upload.error} busy={upload.busy} />
    <WorkspaceImage api={api} id={q.imageId} />
  </div>
}

export function AssessmentEditor({ api, userId }: { api: WorkspaceApi; userId: number }) {
  const list = useRemote<Assessment[]>(api, '/tests', [])
  const action = useAction()
  const [pendingImages, setPendingImages] = useState(0)
  const [addCount, setAddCount] = useState(1)
  const [jobMode, setJobMode] = useState<'new' | 'append'>('new')
  const [aiSubject, setAiSubject] = useState(''), [aiLevel, setAiLevel] = useState(''), [aiLanguage, setAiLanguage] = useState('bg')
  const [aiTypes, setAiTypes] = useState<string[]>(['SINGLE_CHOICE'])
  const [distribution, setDistribution] = useState<Record<string, number>>({ EASY: 2, MEDIUM: 2, HARD: 1, VERY_HARD: 0 })
  function reviewJob() {
    if (!job?.result_json) return
    const definition = (JSON.parse(job.result_json) as { definition: Definition }).definition
    if (jobMode === 'append') setDraft(previous => previous ? { ...previous, questions: [...previous.questions, ...definition.questions] } : previous)
    else { setCurrent(null); setDraft(definition); setShowAi(false) }
    setJob(null)
  }
  const [current, setCurrent] = useState<Assessment | null>(null)
  const [preview, setPreview] = useState<{ assessment: Assessment; definition: Definition } | null>(null)
  const previewRef = useRef<HTMLElement>(null)
  const [draft, setDraft] = useState<Definition | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Assessment | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<{ questionIndex: number; optionIndex?: number } | null>(null)
  const [topic, setTopic] = useState('Основи на Java')
  const [count, setCount] = useState(5)
  const [difficulty, setDifficulty] = useState('MEDIUM')
  const [source, setSource] = useState('')
  const [job, setJob] = useState<AiJob | null>(null)
  const [showAi, setShowAi] = useState(false)
  const [pollError, setPollError] = useState('')
  const editable = !current || current.owner_id === userId
  const generating = !!job && ['queued', 'running'].includes(job.status)
  const addLimit = Math.min(20, 100 - (draft?.questions.length ?? 0))
  const validAddCount = Number.isInteger(addCount) && addCount >= 1 && addCount <= addLimit
  const validDistribution = difficulty !== 'MIXED' || Object.values(distribution).every(value => Number.isInteger(value) && value >= 0 && value <= 20) && Object.values(distribution).reduce((sum, value) => sum + value, 0) === count
  const validGeneration = !!topic.trim() && aiTypes.length > 0 && Number.isInteger(count) && count >= 1 && count <= 20 && validDistribution

  useEffect(() => { window.scrollTo({ top: 0 }) }, [showAi])

  useEffect(() => {
    if (!preview) return
    previewRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
  }, [preview])

  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return
    let active = true
    const timer = window.setInterval(() => {
      api.get<AiJob>(`/ai/test-generations/${job.id}`).then(next => {
        if (!active) return
        setPollError('')
        if (next.status === 'completed' && next.result_json) {
          const definition = (JSON.parse(next.result_json) as { definition: Definition }).definition
          if (jobMode === 'append') setDraft(previous => previous ? { ...previous, questions: [...previous.questions, ...definition.questions] } : previous)
          else { setCurrent(null); setDraft(definition); setShowAi(false) }
          setJob(null)
        } else setJob(next)
      }).catch(() => { if (active) setPollError('Не може да се провери AI заявката. Изчаква се връзка със сървъра.') })
    }, 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [api, job, jobMode])
  async function appendAiQuestions() {
    if (!draft || !validAddCount || generating) return
    await action.run(async () => {
      const last = draft.questions.at(-1)
      const nextDifficulty = last?.difficulty ?? 'MEDIUM'
      setJobMode('append'); setPollError('')
      setJob(await api.post<AiJob>('/ai/test-generations', {
        requestKey: crypto.randomUUID(), topic: draft.title, subject: draft.subject, level: draft.level, language: draft.language,
        questionCount: addCount, difficulty: nextDifficulty, questionTypes: [last?.type ?? 'SINGLE_CHOICE'], difficultyCounts: { [nextDifficulty]: addCount },
        sourceText: `${draft.description ?? ''}\n${draft.instructions ?? ''}\nВече включени въпроси (създай различни нови въпроси):\n${draft.questions.map(q => q.text).join('\n')}`.slice(0, 20000),
      }))
    })
  }
  function patchQuestion(index: number, patch: Partial<Question>) { if (draft) setDraft({ ...draft, questions: draft.questions.map((q, i) => i === index ? { ...q, ...patch } : q) }) }
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
  function editTest(test: Assessment) {
    void action.run(async () => {
      const row = await api.get<Assessment>(`/tests/${test.id}`)
      setCurrent(row); setDraft(JSON.parse(row.definition_json) as Definition); setShowAi(false)
      window.scrollTo({ top: 0 })
    })
  }
  async function save() {
    if (!draft) return
    await action.run(async () => {
      const invalid = draft.questions.findIndex(q => !Number.isInteger(q.timeSeconds) || q.timeSeconds < 10 || q.timeSeconds > 3600)
      if (invalid >= 0) throw new Error(`Времето за въпрос ${invalid + 1} трябва да е между 0 мин 10 сек и 60 мин 0 сек, в цели секунди.`)
      const saved = await api.call<Assessment>(current ? `/tests/${current.id}` : '/tests', current ? 'PUT' : 'POST', draft)
      setCurrent(saved)
      await api.post(`/tests/${saved.id}/publish`)
      await list.reload()
      setDraft(null); setCurrent(null); setPreview(null); setShowAi(false)
      window.scrollTo({ top: 0 })
    }, 'Тестът е запазен.')
  }
  if (showAi && !draft) return <section className="ws-section" aria-label="Създаване на тест с AI">
    <SectionHead title="Създаване на тест с AI"><button type="button" title="Към библиотеката" className="icon-button" disabled={action.busy || generating} onClick={() => setShowAi(false)}><ArrowLeft size={18} /></button></SectionHead>
    <Feedback error={action.error || pollError || (job?.status === 'failed' ? job.error_message ?? 'AI заявката не успя.' : '')} busy={action.busy || generating} />
    <form className="ws-ai-form" onSubmit={e => {
      e.preventDefault()
      if (!validGeneration || action.busy || generating) return
      void action.run(async () => {
        setJobMode('new'); setPollError('')
        setJob(await api.post<AiJob>('/ai/test-generations', { requestKey: crypto.randomUUID(), topic: topic.trim(), subject: aiSubject, level: aiLevel, language: aiLanguage, questionCount: count, difficulty, sourceText: source, questionTypes: aiTypes, difficultyCounts: difficulty === 'MIXED' ? distribution : { [difficulty]: count } }))
      })
    }}>
      <fieldset className="ws-editor" disabled={action.busy || generating}>
        <div className="ws-form-grid">
          <label>Тема<input autoFocus required value={topic} maxLength={500} onChange={e => setTopic(e.target.value)} /></label>
          <label>Въпроси<input type="number" min={1} max={20} step={1} value={count} onChange={e => setCount(Number(e.target.value))} /></label>
          <label>Трудност<select value={difficulty} onChange={e => setDifficulty(e.target.value)}><option value="EASY">Лесни</option><option value="MEDIUM">Средни</option><option value="HARD">Трудни</option><option value="VERY_HARD">Много трудни</option><option value="MIXED">По разпределение</option></select></label>
        </div>
        <div className="ws-form-grid">
          <label>Дисциплина<input value={aiSubject} maxLength={190} onChange={e => setAiSubject(e.target.value)} /></label>
          <label>Клас / ниво<input value={aiLevel} maxLength={190} onChange={e => setAiLevel(e.target.value)} /></label>
          <label>Език<select value={aiLanguage} onChange={e => setAiLanguage(e.target.value)}><option value="bg">Български</option><option value="en">Английски</option></select></label>
        </div>
        <fieldset className="ws-ai-types"><legend>Типове въпроси</legend><div className="ws-actions">{types.map(([key, title]) => <label className="ws-check" key={key}><input type="checkbox" checked={aiTypes.includes(key)} onChange={e => setAiTypes(e.target.checked ? [...aiTypes, key] : aiTypes.filter(t => t !== key))} />{title}</label>)}</div></fieldset>
        {difficulty === 'MIXED' && <div className="ws-form-grid">{Object.entries({ EASY: 'Лесни', MEDIUM: 'Средни', HARD: 'Трудни', VERY_HARD: 'Много трудни' }).map(([key, title]) => <label key={key}>{title}<input type="number" min={0} max={20} step={1} value={distribution[key]} onChange={e => setDistribution({ ...distribution, [key]: Number(e.target.value) })} /></label>)}</div>}
        {!validDistribution && <p className="error" role="alert">Сумата по трудност трябва да е равна на броя въпроси.</p>}
        <label>Учебен текст<textarea value={source} maxLength={20000} onChange={e => setSource(e.target.value)} /></label>
      </fieldset>
      <div className="ws-actions">
        <button type="submit" className="primary command-button" disabled={action.busy || generating || !validGeneration}><Sparkles size={17} />{generating ? 'Генериране...' : 'Генерирай'}</button>
        {job && <span role="status">{label(job.status)}</span>}
        {job?.status === 'completed' && <button type="button" className="command-button" onClick={reviewJob}><Check size={17} /> Прегледай черновата</button>}
        {job?.status === 'failed' && <button type="button" className="command-button" disabled={action.busy} onClick={() => void action.run(async () => { setPollError(''); setJob(await api.post<AiJob>(`/ai/test-generations/${job.id}/retry`)) })}><Sparkles size={17} /> Повтори</button>}
      </div>
    </form>
  </section>
  return <section className="ws-section">
    <SectionHead title={draft ? draft.title : 'Библиотека с тестове'}>
      {draft ? <><button title="Към библиотеката" className="icon-button" disabled={action.busy || generating || pendingImages > 0} onClick={() => { setDraft(null); setCurrent(null); setJob(null); setShowAi(false) }}><ArrowLeft size={18} /></button><button className="primary command-button" disabled={action.busy || !editable || pendingImages > 0 || !!job && ['queued', 'running'].includes(job.status)} onClick={() => void save()}><Save size={17} /> Запази теста</button></> : <div className="ws-actions"><button className="primary command-button" disabled={!!job && ['queued', 'running'].includes(job.status)} onClick={() => { setCurrent(null); setDraft(blank()); setJob(null) }}><Plus size={17} /> Ръчен тест</button><button className="command-button" disabled={action.busy} onClick={() => { setPreview(null); setShowAi(true) }}><Sparkles size={17} /> С AI</button></div>}
    </SectionHead>
    <Feedback error={action.error || list.error || pollError} message={action.message} busy={action.busy || list.loading} />
    {!draft ? <>
      <div className="ws-table-wrap"><table className="ws-table" aria-label="Тестове"><thead><tr><th>Тест</th><th>Въпроси</th><th>Време</th><th>Променен</th><th>Действия</th></tr></thead><tbody>{list.data.map(test => <tr key={test.id} aria-selected={preview?.assessment.id === test.id} className={`ws-selectable-row${preview?.assessment.id === test.id ? ' ws-selected-row' : ''}`} tabIndex={0} aria-disabled={action.busy} onClick={e => { if (!(e.target as HTMLElement).closest('button, a, input, select, textarea')) selectTest(test) }} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectTest(test) } }}><td><button className="ws-text-button" aria-pressed={preview?.assessment.id === test.id} disabled={action.busy} onClick={() => selectTest(test)}>{test.title}</button></td><td>{test.question_count}</td><td>{formatDuration(test.total_time_seconds)}</td><td>{date(test.updated_at)}</td><td><div className="ws-actions">{test.owner_id === userId && <button className="icon-button" title="Редактирай теста" disabled={action.busy || generating} onClick={() => editTest(test)}><Pencil size={17} /></button>}<button className="icon-button danger" title="Изтрий теста" disabled={action.busy} onClick={() => setPendingDelete(test)}><Trash2 size={17} /></button></div></td></tr>)}</tbody></table></div>{!list.data.length && !list.loading && <Empty />}
      {preview && <section ref={previewRef} className="ws-test-preview" aria-label="Избран тест">
        <SectionHead title={preview.assessment.title}>{preview.assessment.owner_id === userId && <button className="command-button" disabled={action.busy || generating} onClick={() => { setCurrent(preview.assessment); setDraft(preview.definition) }}><Pencil size={17} /> Редактирай теста</button>}</SectionHead>
        {preview.definition.description && <p>{preview.definition.description}</p>}
        <p className="ws-summary">{preview.definition.questions.length} въпроса · {preview.definition.questions.reduce((sum, q) => sum + q.points, 0)} точки · {duration(preview.definition.questions)}</p>
        <div className="ws-table-wrap"><table className="ws-table" aria-label="Въпроси на избрания тест"><thead><tr><th>#</th><th>Въпрос и отговори</th><th>Тип</th><th>Точки</th><th>Време</th></tr></thead><tbody>{preview.definition.questions.map((q, index) => <tr key={index}><td>{index + 1}</td><td className="ws-preview-question"><p className="ws-preview-prompt">{q.text}</p><WorkspaceImage api={api} id={q.imageId} />{q.options.length > 0 && <ol className="ws-preview-options">{q.options.map((option, i) => <li key={i} className={option.correct ? 'ws-correct-option' : undefined}>{option.correct && <Check size={15} aria-label="Верен отговор" />}{option.text}</li>)}</ol>}{q.acceptedAnswers.length > 0 && <p>Допустими отговори: {q.acceptedAnswers.join(', ')}</p>}{q.criteria && <p>Критерии: {q.criteria}</p>}{q.explanation && <p className="ws-muted">{q.explanation}</p>}</td><td>{types.find(([key]) => key === q.type)?.[1] ?? q.type}</td><td>{q.points}</td><td>{formatDuration(q.timeSeconds)}</td></tr>)}</tbody></table></div>
        {!preview.definition.questions.length && <Empty>Няма въпроси в този тест.</Empty>}
      </section>}
    </> : <fieldset className="ws-editor" disabled={action.busy || !editable || generating || pendingImages > 0}>
      <div className="ws-test-settings" role="group" aria-labelledby="test-settings-title">
      <h3 id="test-settings-title">Настройки на теста</h3>
      <div className="ws-form-grid"><label>Заглавие<input value={draft.title} maxLength={190} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label>Дисциплина<input value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} /></label><label>Клас / ниво<input value={draft.level} onChange={e => setDraft({ ...draft, level: e.target.value })} /></label><label>Език<select value={draft.language} onChange={e => setDraft({ ...draft, language: e.target.value })}><option value="bg">Български</option><option value="Bulgarian">Български</option><option value="en">Английски</option></select></label></div>
      <label>Описание<textarea value={draft.description ?? ''} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label><label>Инструкции за изпита<textarea value={draft.instructions ?? ''} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /></label>
      <div className="ws-form-grid"><label>Скала<select value={draft.gradingScale} onChange={e => setDraft({ ...draft, gradingScale: e.target.value })}><option value="bulgarian">Българска (2–6)</option><option value="percentage">Процент</option><option value="pass_fail">Успешен / неуспешен</option></select></label><label>Праг за успех (%)<input type="number" min={0} max={100} value={draft.passThreshold} onChange={e => setDraft({ ...draft, passThreshold: Number(e.target.value) })} /></label><p className="ws-summary">{draft.questions.length} въпроса · {draft.questions.reduce((sum, q) => sum + q.points, 0)} точки · {duration(draft.questions)}</p></div>
      </div>
      {draft.questions.map((q, index) => <article className="ws-question" key={index}><div className="ws-question-head"><strong>Въпрос {index + 1}</strong><select aria-label={`Тип на въпрос ${index + 1}`} value={q.type} onChange={e => typeChange(index, e.target.value as QuestionType)}>{types.map(([type, text]) => <option key={type} value={type}>{text}</option>)}</select><button className="icon-button danger" title="Изтрий въпрос" onClick={() => setPendingRemoval({ questionIndex: index })}><Trash2 size={17} /></button></div><QuestionPrompt api={api} question={q} textChanged={text => patchQuestion(index, { text })} imageChanged={imageId => patchQuestion(index, { imageId })} uploadChanged={busy => setPendingImages(previous => previous + (busy ? 1 : -1))} /><div className="ws-form-grid"><label>Трудност<select value={q.difficulty} onChange={e => patchQuestion(index, { difficulty: e.target.value, timeSeconds: ({ EASY: 30, MEDIUM: 60, HARD: 120, VERY_HARD: 180 })[e.target.value as 'EASY'] })}><option value="EASY">Лесен</option><option value="MEDIUM">Среден</option><option value="HARD">Труден</option><option value="VERY_HARD">Много труден</option></select></label><label>Точки<input type="number" min={0.0001} step="0.1" value={q.points} onChange={e => patchQuestion(index, { points: Number(e.target.value) })} /></label><DurationInput seconds={q.timeSeconds} question={index + 1} onChange={timeSeconds => patchQuestion(index, { timeSeconds })} /></div>
        {q.options.map((option, i) => <div className="ws-option-editor" key={i}><input aria-label={`Верен отговор ${i + 1}`} type={q.type === 'MULTIPLE_CHOICE' ? 'checkbox' : 'radio'} name={`correct-${index}`} checked={option.correct} onChange={e => patchQuestion(index, { options: q.options.map((o, j) => j === i ? { ...o, correct: e.target.checked } : q.type === 'MULTIPLE_CHOICE' ? o : { ...o, correct: false }) })} /><input aria-label={`Опция ${i + 1}`} value={option.text} onChange={e => patchQuestion(index, { options: q.options.map((o, j) => j === i ? { ...o, text: e.target.value } : o) })} /><button className="icon-button danger" title="Премахни опция" onClick={() => setPendingRemoval({ questionIndex: index, optionIndex: i })}><X size={16} /></button></div>)}
        {['SINGLE_CHOICE', 'MULTIPLE_CHOICE'].includes(q.type) && <button className="command-button" onClick={() => patchQuestion(index, { options: [...q.options, { text: '', correct: false }] })}><Plus size={16} /> Опция</button>}
        {q.type === 'SHORT_ANSWER' && <><label>Допустими отговори (по един на ред)<textarea value={q.acceptedAnswers.join('\n')} onChange={e => patchQuestion(index, { acceptedAnswers: e.target.value ? e.target.value.split('\n') : [] })} /></label><div className="ws-actions"><label className="ws-check"><input type="checkbox" checked={q.caseInsensitive} onChange={e => patchQuestion(index, { caseInsensitive: e.target.checked })} /> Без разлика малки / главни</label><label className="ws-check"><input type="checkbox" checked={q.collapseWhitespace} onChange={e => patchQuestion(index, { collapseWhitespace: e.target.checked })} /> Нормализирай интервали</label></div></>}
        {['SHORT_ANSWER', 'OPEN_ANSWER'].includes(q.type) && <label>Критерии за ръчна проверка<textarea value={q.criteria} onChange={e => patchQuestion(index, { criteria: e.target.value })} /></label>}<label>Обяснение след разрешен преглед<textarea value={q.explanation ?? ''} onChange={e => patchQuestion(index, { explanation: e.target.value })} /></label>
      </article>)}
      <section className="ws-add-questions" aria-label="Добавяне на въпроси">
        <div className="ws-inline-form"><label>Брой нови въпроси<input type="number" min={1} max={Math.max(1, addLimit)} step={1} value={addCount} disabled={!addLimit} onChange={e => setAddCount(Number(e.target.value))} /></label><button className="command-button" disabled={!validAddCount || generating} onClick={() => setDraft(previous => previous ? { ...previous, questions: [...previous.questions, ...Array.from({ length: addCount }, question)] } : previous)}><Plus size={17} /> Ръчно</button><button className="command-button" disabled={!validAddCount || generating || !draft.title.trim()} onClick={() => void appendAiQuestions()}><Sparkles size={17} /> С AI</button><span className="ws-summary">{draft.questions.length} / 100</span></div>
        <Feedback error={action.error || (job?.status === 'failed' ? job.error_message ?? 'AI заявката не успя.' : pollError)} busy={generating} />
        {job && <span role="status">{label(job.status)}</span>}
        {job?.status === 'failed' && <button className="command-button" onClick={() => void action.run(async () => setJob(await api.post<AiJob>(`/ai/test-generations/${job.id}/retry`)))}><Sparkles size={17} /> Повтори</button>}
      </section>
    </fieldset>}
    {pendingDelete && <TestDeleteDialog api={api} test={pendingDelete} owned={pendingDelete.owner_id === userId} close={() => setPendingDelete(null)} deleted={async () => { if (preview?.assessment.id === pendingDelete.id) setPreview(null); await list.reload(); setPendingDelete(null) }} />}
    {pendingRemoval && draft && <DeleteConfirmationDialog
      title={pendingRemoval.optionIndex === undefined ? 'Изтриване на въпрос' : 'Премахване на опция'}
      confirmLabel={pendingRemoval.optionIndex === undefined ? 'Изтрий' : 'Премахни'}
      confirmDisabled={action.busy || generating || pendingImages > 0}
      description={pendingRemoval.optionIndex === undefined ? <>Да изтрием ли <strong>въпрос {pendingRemoval.questionIndex + 1}</strong> заедно с отговорите му? {draft.questions[pendingRemoval.questionIndex]?.text}</> : <>Да премахнем ли <strong>опция {pendingRemoval.optionIndex + 1}</strong> от въпрос {pendingRemoval.questionIndex + 1}? {draft.questions[pendingRemoval.questionIndex]?.options[pendingRemoval.optionIndex]?.text}</>}
      onCancel={() => setPendingRemoval(null)}
      onConfirm={() => setDraft(previous => previous ? { ...previous, questions: pendingRemoval.optionIndex === undefined ? previous.questions.filter((_, index) => index !== pendingRemoval.questionIndex) : previous.questions.map((q, index) => index === pendingRemoval.questionIndex ? { ...q, options: q.options.filter((_, i) => i !== pendingRemoval.optionIndex) } : q) } : previous)}
    />}
  </section>
}

function TestDeleteDialog({ api, test, owned, close, deleted }: { api: WorkspaceApi; test: Assessment; owned: boolean; close: () => void; deleted: () => Promise<void> }) {
  return <DeleteConfirmationDialog title="Изтриване на тест" description={owned ? <>Да изтрием ли теста <strong>{test.title}</strong>? Възлаганията и резултатите от проведени изпити ще се запазят.</> : <>Да премахнем ли <strong>{test.title}</strong> от твоята библиотека? Споделеният тест ще остане достъпен за автора и другите учители.</>} onCancel={close} onConfirm={async () => { await api.remove(`/tests/${test.id}`); await deleted() }} />
}
