import { useEffect, useState } from 'react'
import { Plus, Save, Trash2, Copy, Sparkles, ArrowLeft, X, Check, Library, Pencil } from 'lucide-react'
import { useAction, useRemote } from './api'
import type { WorkspaceApi } from './api'
import type { AiJob, Assessment, Definition, Question, QuestionType } from './types'
import { date, label } from './types'
import { Empty, Feedback, SectionHead } from './ui'
import { WorkspaceImage } from './WorkspaceImage'
import { imageBase64 } from './imageUpload'

const question = (): Question => ({ type: 'SINGLE_CHOICE', text: '', difficulty: 'MEDIUM', points: 1, timeSeconds: 60, options: [{ text: '', correct: true }, { text: '', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: '' })
const blank = (): Definition => ({ title: 'Нов тест', description: '', subject: '', level: '', instructions: '', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, questions: [question()] })
const types: [QuestionType, string][] = [['SINGLE_CHOICE', 'Един верен отговор'], ['MULTIPLE_CHOICE', 'Няколко верни'], ['TRUE_FALSE', 'Вярно / невярно'], ['SHORT_ANSWER', 'Кратък текст'], ['OPEN_ANSWER', 'Свободен отговор']]

export function AssessmentEditor({ api, userId }: { api: WorkspaceApi; userId: number }) {
  const list = useRemote<Assessment[]>(api, '/tests', [])
  const action = useAction()
  const [addCount, setAddCount] = useState(1)
  const [jobMode, setJobMode] = useState<'new' | 'append'>('new')
  const [aiSubject, setAiSubject] = useState(''), [aiLevel, setAiLevel] = useState(''), [aiLanguage, setAiLanguage] = useState('bg')
  const [aiTypes, setAiTypes] = useState<string[]>(['SINGLE_CHOICE'])
  const [distribution, setDistribution] = useState<Record<string, number>>({ EASY: 2, MEDIUM: 2, HARD: 1, VERY_HARD: 0 })
  function reviewJob() {
    if (!job?.result_json) return
    const definition = (JSON.parse(job.result_json) as { definition: Definition }).definition
    if (jobMode === 'append') setDraft(previous => previous ? { ...previous, questions: [...previous.questions, ...definition.questions] } : previous)
    else { setCurrent(null); setDraft(definition) }
    setJob(null)
  }
  const [current, setCurrent] = useState<Assessment | null>(null)
  const [preview, setPreview] = useState<{ assessment: Assessment; definition: Definition } | null>(null)
  const [draft, setDraft] = useState<Definition | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Assessment | null>(null)
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
          else { setCurrent(null); setDraft(definition) }
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
  async function save() {
    if (!draft) return
    await action.run(async () => {
      const saved = await api.call<Assessment>(current ? `/tests/${current.id}` : '/tests', current ? 'PUT' : 'POST', draft)
      setCurrent(saved)
      await api.post(`/tests/${saved.id}/publish`)
      await list.reload()
      setDraft(null); setCurrent(null); setPreview(null); setShowAi(false)
      window.scrollTo({ top: 0 })
    }, 'Тестът е запазен.')
  }
  return <section className="ws-section">
    <SectionHead title={draft ? draft.title : 'Библиотека с тестове'}>
      {draft ? <><button title="Към библиотеката" className="icon-button" disabled={action.busy || generating} onClick={() => { setDraft(null); setCurrent(null); setJob(null) }}><ArrowLeft size={18} /></button><button className="primary command-button" disabled={action.busy || !editable || !!job && ['queued', 'running'].includes(job.status)} onClick={() => void save()}><Save size={17} /> Запази теста</button></> : <div className="ws-actions"><button className="primary command-button" disabled={!!job && ['queued', 'running'].includes(job.status)} onClick={() => { setCurrent(null); setDraft(blank()); setJob(null) }}><Plus size={17} /> Ръчен тест</button><button aria-expanded={showAi} className="command-button" onClick={() => setShowAi(!showAi)}><Sparkles size={17} /> С AI</button></div>}
    </SectionHead>
    <Feedback error={action.error || list.error || pollError} message={action.message} busy={action.busy || list.loading} />
    {!draft ? <>
      <div className="ws-table-wrap"><table className="ws-table" aria-label="Тестове"><thead><tr><th>Тест</th><th>Статус</th><th>Достъп</th><th>Променен</th><th>Действия</th></tr></thead><tbody>{list.data.map(test => <tr key={test.id} aria-selected={preview?.assessment.id === test.id} className={`ws-selectable-row${preview?.assessment.id === test.id ? ' ws-selected-row' : ''}`} tabIndex={0} aria-disabled={action.busy} onClick={e => { if (!(e.target as HTMLElement).closest('button, a, input, select, textarea')) selectTest(test) }} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectTest(test) } }}><td><button className="ws-text-button" aria-pressed={preview?.assessment.id === test.id} disabled={action.busy} onClick={() => selectTest(test)}>{test.title}</button></td><td>{label(test.status)}</td><td>{test.shared ? 'Споделен' : 'Личен'}</td><td>{date(test.updated_at)}</td><td><div className="ws-actions"><button className="icon-button" title="Дублирай" onClick={() => void action.run(async () => { await api.post(`/tests/${test.id}/duplicate`); await list.reload() })}><Copy size={17} /></button>{test.owner_id === userId && <><button className="icon-button" title={test.shared ? 'Направи личен' : 'Сподели с учителите'} onClick={() => void action.run(async () => { await api.put(`/tests/${test.id}/sharing`, { shared: !test.shared }); await list.reload() })}><Library size={17} /></button><button className="icon-button danger" title="Изтрий / архивирай" onClick={() => setPendingDelete(test)}><Trash2 size={17} /></button></>}</div></td></tr>)}</tbody></table></div>{!list.data.length && !list.loading && <Empty />}
      {preview && <section className="ws-test-preview" aria-label="Избран тест">
        <SectionHead title={preview.assessment.title}>{preview.assessment.owner_id === userId && <button className="command-button" disabled={action.busy || generating} onClick={() => { setCurrent(preview.assessment); setDraft(preview.definition) }}><Pencil size={17} /> Редактирай теста</button>}</SectionHead>
        {preview.definition.description && <p>{preview.definition.description}</p>}
        <p className="ws-summary">{preview.definition.questions.length} въпроса · {preview.definition.questions.reduce((sum, q) => sum + q.points, 0)} точки</p>
        <div className="ws-table-wrap"><table className="ws-table" aria-label="Въпроси на избрания тест"><thead><tr><th>#</th><th>Въпрос и отговори</th><th>Тип</th><th>Точки</th><th>Време</th></tr></thead><tbody>{preview.definition.questions.map((q, index) => <tr key={index}><td>{index + 1}</td><td className="ws-preview-question"><p className="ws-preview-prompt">{q.text}</p><WorkspaceImage api={api} id={q.imageId} />{q.options.length > 0 && <ol className="ws-preview-options">{q.options.map((option, i) => <li key={i} className={option.correct ? 'ws-correct-option' : undefined}>{option.correct && <Check size={15} aria-label="Верен отговор" />}{option.text}</li>)}</ol>}{q.acceptedAnswers.length > 0 && <p>Допустими отговори: {q.acceptedAnswers.join(', ')}</p>}{q.criteria && <p>Критерии: {q.criteria}</p>}{q.explanation && <p className="ws-muted">{q.explanation}</p>}</td><td>{types.find(([key]) => key === q.type)?.[1] ?? q.type}</td><td>{q.points}</td><td>{q.timeSeconds} s</td></tr>)}</tbody></table></div>
        {!preview.definition.questions.length && <Empty>Няма въпроси в този тест.</Empty>}
      </section>}
      {showAi && <div className="ws-ai-band"><h3><Sparkles size={18} /> Създаване с AI</h3><div className="ws-form-grid"><label>Тема<input value={topic} maxLength={500} onChange={e => setTopic(e.target.value)} /></label><label>Въпроси<input type="number" min={1} max={20} value={count} onChange={e => setCount(Number(e.target.value))} /></label><label>Трудност<select value={difficulty} onChange={e => setDifficulty(e.target.value)}><option value="EASY">Лесни</option><option value="MEDIUM">Средни</option><option value="HARD">Трудни</option><option value="VERY_HARD">Много трудни</option><option value="MIXED">По разпределение</option></select></label></div><div className="ws-form-grid"><label>Дисциплина<input value={aiSubject} maxLength={190} onChange={e => setAiSubject(e.target.value)} /></label><label>Клас / ниво<input value={aiLevel} maxLength={190} onChange={e => setAiLevel(e.target.value)} /></label><label>Език<select value={aiLanguage} onChange={e => setAiLanguage(e.target.value)}><option value="bg">Български</option><option value="en">Английски</option></select></label></div><div className="ws-actions">{types.map(([key, title]) => <label className="ws-check" key={key}><input type="checkbox" checked={aiTypes.includes(key)} onChange={e => setAiTypes(e.target.checked ? [...aiTypes, key] : aiTypes.filter(t => t !== key))} />{title}</label>)}</div>{difficulty === 'MIXED' && <div className="ws-form-grid">{Object.entries({ EASY: 'Лесни', MEDIUM: 'Средни', HARD: 'Трудни', VERY_HARD: 'Много трудни' }).map(([key, title]) => <label key={key}>{title}<input type="number" min={0} max={20} value={distribution[key]} onChange={e => setDistribution({ ...distribution, [key]: Number(e.target.value) })} /></label>)}</div>}<label>Учебен текст<textarea value={source} maxLength={20000} onChange={e => setSource(e.target.value)} /></label><div className="ws-actions"><button disabled={action.busy || !topic.trim() || !aiTypes.length || !Number.isInteger(count) || count < 1 || count > 20 || !!job && ['queued', 'running'].includes(job.status)} onClick={() => void action.run(async () => { setJobMode('new'); setPollError(''); setJob(await api.post<AiJob>('/ai/test-generations', { requestKey: crypto.randomUUID(), topic, subject: aiSubject, level: aiLevel, language: aiLanguage, questionCount: count, difficulty, sourceText: source, questionTypes: aiTypes, difficultyCounts: difficulty === 'MIXED' ? distribution : { [difficulty]: count } })) })}><Sparkles size={16} /> {job && ['queued', 'running'].includes(job.status) ? 'Генериране…' : 'Генерирай'}</button>{job && <span role="status">{label(job.status)}</span>}{job?.status === 'completed' && <button onClick={() => { reviewJob() }}><Check size={16} /> Прегледай черновата</button>}{job?.status === 'failed' && <><span className="error">{job.error_message}</span><button onClick={() => void action.run(async () => setJob(await api.post<AiJob>(`/ai/test-generations/${job.id}/retry`)))}>Повтори</button></>}</div></div>}
    </> : <fieldset className="ws-editor" disabled={action.busy || !editable || generating}>
      <div className="ws-form-grid"><label>Заглавие<input value={draft.title} maxLength={190} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label>Дисциплина<input value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} /></label><label>Клас / ниво<input value={draft.level} onChange={e => setDraft({ ...draft, level: e.target.value })} /></label><label>Език<select value={draft.language} onChange={e => setDraft({ ...draft, language: e.target.value })}><option value="bg">Български</option><option value="Bulgarian">Български</option><option value="en">Английски</option></select></label></div>
      <label>Описание<textarea value={draft.description ?? ''} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label><label>Инструкции за изпита<textarea value={draft.instructions ?? ''} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /></label>
      <div className="ws-form-grid"><label>Скала<select value={draft.gradingScale} onChange={e => setDraft({ ...draft, gradingScale: e.target.value })}><option value="bulgarian">Българска (2–6)</option><option value="percentage">Процент</option><option value="pass_fail">Успешен / неуспешен</option></select></label><label>Праг за успех (%)<input type="number" min={0} max={100} value={draft.passThreshold} onChange={e => setDraft({ ...draft, passThreshold: Number(e.target.value) })} /></label><p className="ws-summary">{draft.questions.length} въпроса · {draft.questions.reduce((sum, q) => sum + q.points, 0)} точки · {draft.questions.reduce((sum, q) => sum + q.timeSeconds, 0)} секунди</p></div>
      {draft.questions.map((q, index) => <article className="ws-question" key={index}><div className="ws-question-head"><strong>Въпрос {index + 1}</strong><button className="icon-button" title="Запази въпроса в банката" onClick={() => void action.run(async () => { await api.post('/question-bank', { subject: draft.subject, shared: false, question: q }) }, 'Въпросът е запазен в банката.')}><Library size={17} /></button><button className="icon-button" title="Сподели въпроса в общата банка" onClick={() => void action.run(async () => { await api.post('/question-bank', { subject: draft.subject, shared: true, question: q }) }, 'Въпросът е споделен.')}><Copy size={17} /></button><select aria-label={`Тип на въпрос ${index + 1}`} value={q.type} onChange={e => typeChange(index, e.target.value as QuestionType)}>{types.map(([type, text]) => <option key={type} value={type}>{text}</option>)}</select><button className="icon-button danger" title="Изтрий въпрос" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, i) => i !== index) })}><Trash2 size={17} /></button></div><label>Текст<textarea value={q.text} onChange={e => patchQuestion(index, { text: e.target.value })} /></label><div className="ws-form-grid"><label>Трудност<select value={q.difficulty} onChange={e => patchQuestion(index, { difficulty: e.target.value, timeSeconds: ({ EASY: 30, MEDIUM: 60, HARD: 120, VERY_HARD: 180 })[e.target.value as 'EASY'] })}><option value="EASY">Лесен</option><option value="MEDIUM">Среден</option><option value="HARD">Труден</option><option value="VERY_HARD">Много труден</option></select></label><label>Точки<input type="number" min={0.0001} step="0.1" value={q.points} onChange={e => patchQuestion(index, { points: Number(e.target.value) })} /></label><label>Време (s)<input type="number" min={10} max={3600} value={q.timeSeconds} onChange={e => patchQuestion(index, { timeSeconds: Number(e.target.value) })} /></label></div>
        {q.options.map((option, i) => <div className="ws-option-editor" key={i}><input aria-label={`Верен отговор ${i + 1}`} type={q.type === 'MULTIPLE_CHOICE' ? 'checkbox' : 'radio'} name={`correct-${index}`} checked={option.correct} onChange={e => patchQuestion(index, { options: q.options.map((o, j) => j === i ? { ...o, correct: e.target.checked } : q.type === 'MULTIPLE_CHOICE' ? o : { ...o, correct: false }) })} /><input aria-label={`Опция ${i + 1}`} value={option.text} onChange={e => patchQuestion(index, { options: q.options.map((o, j) => j === i ? { ...o, text: e.target.value } : o) })} /><button className="icon-button" title="Премахни опция" onClick={() => patchQuestion(index, { options: q.options.filter((_, j) => j !== i) })}><X size={16} /></button></div>)}
        {['SINGLE_CHOICE', 'MULTIPLE_CHOICE'].includes(q.type) && <button className="command-button" onClick={() => patchQuestion(index, { options: [...q.options, { text: '', correct: false }] })}><Plus size={16} /> Опция</button>}
        {q.type === 'SHORT_ANSWER' && <><label>Допустими отговори (по един на ред)<textarea value={q.acceptedAnswers.join('\n')} onChange={e => patchQuestion(index, { acceptedAnswers: e.target.value ? e.target.value.split('\n') : [] })} /></label><div className="ws-actions"><label className="ws-check"><input type="checkbox" checked={q.caseInsensitive} onChange={e => patchQuestion(index, { caseInsensitive: e.target.checked })} /> Без разлика малки / главни</label><label className="ws-check"><input type="checkbox" checked={q.collapseWhitespace} onChange={e => patchQuestion(index, { collapseWhitespace: e.target.checked })} /> Нормализирай интервали</label></div></>}
        {['SHORT_ANSWER', 'OPEN_ANSWER'].includes(q.type) && <label>Критерии за ръчна проверка<textarea value={q.criteria} onChange={e => patchQuestion(index, { criteria: e.target.value })} /></label>}<div className="ws-actions"><label className="ws-file">Изображение<input type="file" accept="image/png,image/jpeg" onChange={e => { const file = e.target.files?.[0]; if (file) void action.run(async () => { const value = await api.post<{ id: number }>('/files', { purpose: 'question', base64: await imageBase64(file) }); patchQuestion(index, { imageId: value.id }) }) }} /></label>{q.imageId && <button className="icon-button" title="Премахни изображението от въпроса" onClick={() => patchQuestion(index, { imageId: null })}><X size={16} /></button>}</div><WorkspaceImage api={api} id={q.imageId} /><label>Обяснение след разрешен преглед<textarea value={q.explanation ?? ''} onChange={e => patchQuestion(index, { explanation: e.target.value })} /></label>
      </article>)}
      <section className="ws-add-questions" aria-label="Добавяне на въпроси">
        <div className="ws-inline-form"><label>Брой нови въпроси<input type="number" min={1} max={Math.max(1, addLimit)} step={1} value={addCount} disabled={!addLimit} onChange={e => setAddCount(Number(e.target.value))} /></label><button className="command-button" disabled={!validAddCount || generating} onClick={() => setDraft(previous => previous ? { ...previous, questions: [...previous.questions, ...Array.from({ length: addCount }, question)] } : previous)}><Plus size={17} /> Ръчно</button><button className="command-button" disabled={!validAddCount || generating || !draft.title.trim()} onClick={() => void appendAiQuestions()}><Sparkles size={17} /> С AI</button><span className="ws-summary">{draft.questions.length} / 100</span></div>
        <Feedback error={action.error || (job?.status === 'failed' ? job.error_message ?? 'AI заявката не успя.' : pollError)} busy={generating} />
        {job && <span role="status">{label(job.status)}</span>}
        {job?.status === 'failed' && <button className="command-button" onClick={() => void action.run(async () => setJob(await api.post<AiJob>(`/ai/test-generations/${job.id}/retry`)))}><Sparkles size={17} /> Повтори</button>}
      </section>
    </fieldset>}
    {pendingDelete && <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="remove-title"><h2 id="remove-title">Премахване на тест</h2><p>{pendingDelete.title}</p><p>Публикуваните версии и старите опити се запазват в архива.</p><div className="ws-actions"><button onClick={() => setPendingDelete(null)}>Отказ</button><button className="danger" disabled={action.busy} onClick={() => void action.run(async () => { await api.remove(`/tests/${pendingDelete.id}`); if (preview?.assessment.id === pendingDelete.id) setPreview(null); setPendingDelete(null); await list.reload() })}><Trash2 size={16} /> Потвърди</button></div></section></div>}
  </section>
}
