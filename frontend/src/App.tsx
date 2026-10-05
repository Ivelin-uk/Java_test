import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Plus, Save, Send, Sparkles, Trash2 } from 'lucide-react'
import './App.css'
import { api, ApiError } from './api/client'
import { AuthPanel } from './components/AuthPanel'
import { DeleteTestDialog } from './components/DeleteTestDialog'
import { TestBuilder, starterTest, toRequest } from './components/TestBuilder'
import type { AuthResponse, CreatorResult, DashboardStats, PublicTest, TestDetail, TestRequest, TestSummary } from './types/models'

function App() {
  const publicCode = window.location.pathname.startsWith('/quiz/') ? window.location.pathname.split('/').pop() : null
  if (publicCode) return <ParticipantPage code={publicCode} />
  return <CreatorApp />
}

function CreatorApp() {
  const [auth, setAuth] = useState<AuthResponse | null>(() => {
    const stored = localStorage.getItem('quicktest.auth')
    return stored ? JSON.parse(stored) : null
  })
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [tests, setTests] = useState<TestSummary[]>([])
  const [results, setResults] = useState<CreatorResult[]>([])
  const [draft, setDraft] = useState<TestRequest>(starterTest)
  const [current, setCurrent] = useState<TestDetail | null>(null)
  const [message, setMessage] = useState('')
  const [aiTopic, setAiTopic] = useState('Обектно-ориентирано програмиране с Java')
  const [questionCount, setQuestionCount] = useState(5)
  const [difficulty, setDifficulty] = useState('MEDIUM')
  const [busy, setBusy] = useState<'save' | 'publish' | 'generate' | 'delete' | 'load' | null>(null)
  const [error, setError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Pick<TestSummary, 'id' | 'title'> | null>(null)

  const token = auth?.token ?? ''

  useEffect(() => {
    if (auth) {
      localStorage.setItem('quicktest.auth', JSON.stringify(auth))
      void refresh(auth.token).catch(reportError)
    }
  }, [auth])

  async function refresh(nextToken = token) {
    if (!nextToken) return
    const [dashboard, testList, resultList] = await Promise.all([api.dashboard(nextToken), api.tests(nextToken), api.results(nextToken)])
    setStats(dashboard)
    setTests(testList)
    setResults(resultList)
  }

  function reportError(cause: unknown) {
    setMessage('')
    setError(cause instanceof Error ? cause.message : 'Възникна грешка. Опитай отново.')
    if (cause instanceof ApiError && cause.status === 401) {
      localStorage.removeItem('quicktest.auth')
      setAuth(null)
    }
  }

  async function perform(action: NonNullable<typeof busy>, work: () => Promise<void>) {
    if (busy) return
    setBusy(action)
    setError('')
    try {
      await work()
    } catch (cause) {
      reportError(cause)
    } finally {
      setBusy(null)
    }
  }

  function newDraft() {
    setCurrent(null)
    setDraft(starterTest())
    setMessage('')
    setError('')
  }

  async function save() {
    await perform('save', async () => {
      setMessage('Запазване...')
      const saved = current ? await api.updateTest(token, current.id, draft) : await api.createTest(token, draft)
      setCurrent(saved)
      setDraft(toRequest(saved))
      setMessage('Запазено')
      await refresh()
    })
  }

  async function generate() {
    await perform('generate', async () => {
      setMessage('Генериране на въпроси...')
      const generated = await api.generateTest(token, {
        topic: aiTopic.trim(),
        instructions: 'Създай ясни и разнообразни въпроси с проверими верни отговори. Съобрази ги с посочения клас и възраст.',
        language: 'Bulgarian',
        questionCount,
        difficulty,
      })
      setDraft(generated.test)
      setCurrent(null)
      setMessage(`Готово: ${generated.test.questions.length} въпроса · ${generated.model}`)
      await refresh()
    })
  }

  async function publish() {
    await perform('publish', async () => {
      const saved = current ?? (await api.createTest(token, draft))
      const published = await api.publish(token, saved.id)
      setCurrent({ ...saved, status: 'PUBLISHED', publicCode: published.publicCode })
      setMessage(`Публикувано: ${published.publicUrl}`)
      await refresh()
    })
  }

  async function remove() {
    if (!pendingDelete) return
    const target = pendingDelete
    await perform('delete', async () => {
      await api.deleteTest(token, target.id)
      if (current?.id === target.id) newDraft()
      setPendingDelete(null)
      setMessage(`Изтрит тест: ${target.title}`)
      await refresh()
    })
  }

  async function load(id: number) {
    await perform('load', async () => {
      const detail = await api.test(token, id)
      setCurrent(detail)
      setDraft(toRequest(detail))
      setMessage('Заредено')
    })
  }

  if (!auth) {
    return <AuthPanel onAuth={setAuth} />
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">QuickTest</span>
          <h1>Dashboard</h1>
        </div>
        <div className="top-actions">
          <span>{auth.user.name}</span>
          <button onClick={() => { localStorage.removeItem('quicktest.auth'); setAuth(null) }}>Изход</button>
        </div>
      </header>

      <section className="stats-grid">
        <Stat label="Тестове" value={stats?.totalTests ?? 0} />
        <Stat label="Активни" value={stats?.activeTests ?? 0} />
        <Stat label="Опити" value={stats?.attempts ?? 0} />
        <Stat label="AI заявки" value={stats?.aiGenerations ?? 0} />
      </section>

      <section className="workspace">
        <aside className="panel side-panel">
          <button className="primary wide command-button" onClick={newDraft} disabled={busy !== null}>
            <Plus size={18} aria-hidden="true" /> Създай тест
          </button>
          <div className="ai-box">
            <label>AI тема<input value={aiTopic} maxLength={500} disabled={busy !== null} onChange={(event) => setAiTopic(event.target.value)} /></label>
            <div className="ai-settings">
              <label>Въпроси<input type="number" min={1} max={20} value={questionCount} disabled={busy !== null} onChange={(event) => setQuestionCount(Number(event.target.value))} /></label>
              <label>Трудност<select aria-label="Трудност" value={difficulty} disabled={busy !== null} onChange={(event) => setDifficulty(event.target.value)}>
                <option value="EASY">Лесно</option>
                <option value="MEDIUM">Средно</option>
                <option value="HARD">Трудно</option>
                <option value="MIXED">Смесено</option>
              </select></label>
            </div>
            <button className="command-button" onClick={generate} disabled={busy !== null || !aiTopic.trim() || !Number.isInteger(questionCount) || questionCount < 1 || questionCount > 20}>
              {busy === 'generate' ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}
              {busy === 'generate' ? 'Генериране...' : 'Генерирай тест'}
            </button>
          </div>
          <h2>Последни тестове</h2>
          <div className="test-list">
            {tests.length === 0 && <p className="save-state">Няма създадени тестове.</p>}
            {tests.map((test) => (
              <div className={`test-item${current?.id === test.id ? ' is-selected' : ''}`} key={test.id}>
                <button className="test-pill" onClick={() => void load(test.id)} disabled={busy !== null} aria-pressed={current?.id === test.id}>
                  <strong>{test.title}</strong>
                  <span>{test.status} · {test.questionCount} въпроса</span>
                  {test.status === 'PUBLISHED' && test.publicCode && <small>/quiz/{test.publicCode}</small>}
                </button>
                <button className="icon-button danger test-delete" title={`Изтрий тест: ${test.title}`} aria-label={`Изтрий тест: ${test.title}`} disabled={busy !== null} onClick={() => { setError(''); setPendingDelete(test) }}>
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="main-column">
          <div className="toolbar panel">
            <strong>{current ? `Редакция #${current.id}` : 'Нов тест'}</strong>
            <span className="save-state" role="status" aria-live="polite">{message}</span>
            <div className="toolbar-actions">
              {current && <button className="icon-button danger" title="Изтрий тест" aria-label="Изтрий текущия тест" disabled={busy !== null} onClick={() => { setError(''); setPendingDelete(current) }}><Trash2 size={17} aria-hidden="true" /></button>}
              <button className="command-button" onClick={save} disabled={busy !== null}><Save size={17} aria-hidden="true" /> Запази</button>
              <button className="primary command-button" onClick={publish} disabled={busy !== null}><Send size={17} aria-hidden="true" /> Публикувай</button>
            </div>
          </div>
          {error && !pendingDelete && <p className="action-error error" role="alert">{error}</p>}
          <TestBuilder draft={draft} onChange={setDraft} />
        </section>
      </section>

      <section className="panel results-panel">
        <h2>Последни резултати</h2>
        <div className="table">
          <div className="table-row table-head"><span>Participant</span><span>Test</span><span>Score</span><span>Grade</span></div>
          {results.map((result) => (
            <div className="table-row" key={result.attemptId}>
              <span>{result.participantName}</span>
              <span>{result.testTitle}</span>
              <span>{result.score}/{result.maxScore} · {result.percentage}%</span>
              <span>{result.grade}</span>
            </div>
          ))}
        </div>
      </section>
      {pendingDelete && <DeleteTestDialog title={pendingDelete.title} busy={busy === 'delete'} error={error} onCancel={() => { setPendingDelete(null); setError('') }} onConfirm={() => void remove()} />}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat panel"><span>{label}</span><strong>{value}</strong></div>
}

function ParticipantPage({ code }: { code: string }) {
  const [test, setTest] = useState<PublicTest | null>(null)
  const [name, setName] = useState('')
  const [answers, setAnswers] = useState<Record<number, { answerIds: number[]; textAnswer: string }>>({})
  const [result, setResult] = useState<{ score: number; maxScore: number; percentage: number; grade: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.publicTest(code).then(setTest).catch((err) => setError(err instanceof Error ? err.message : 'Test not found'))
  }, [code])

  const progress = useMemo(() => {
    if (!test) return 0
    return test.questions.filter((question) => {
      const answer = answers[question.id]
      return answer && (answer.answerIds.length > 0 || answer.textAnswer.trim())
    }).length
  }, [answers, test])

  function toggle(questionId: number, answerId: number, multiple: boolean) {
    setAnswers((current) => {
      const existing = current[questionId] ?? { answerIds: [], textAnswer: '' }
      const nextIds = multiple
        ? existing.answerIds.includes(answerId) ? existing.answerIds.filter((id) => id !== answerId) : [...existing.answerIds, answerId]
        : [answerId]
      return { ...current, [questionId]: { ...existing, answerIds: nextIds } }
    })
  }

  async function submit() {
    if (!name.trim()) {
      setError('Въведете име преди предаване.')
      return
    }
    const payload = {
      participantName: name,
      answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId: Number(questionId), ...answer })),
    }
    setResult(await api.submitAttempt(code, payload))
  }

  if (error) return <main className="participant"><div className="panel error">{error}</div></main>
  if (!test) return <main className="participant"><div className="panel">Loading...</div></main>
  if (result) {
    return (
      <main className="participant">
        <section className="panel result-card">
          <span className="eyebrow">Резултат</span>
          <h1>{result.score} / {result.maxScore}</h1>
          <p>{result.percentage}% · Оценка {result.grade}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="participant">
      <section className="panel participant-head">
        <h1>{test.title}</h1>
        <p>{test.description}</p>
        <label>Име<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <progress value={progress} max={test.questions.length}></progress>
      </section>
      {test.questions.map((question, index) => (
        <article className="panel question-panel" key={question.id}>
          <strong>Въпрос {index + 1} / {test.questions.length}</strong>
          <p>{question.question}</p>
          {question.type === 'SHORT_ANSWER' || question.type === 'OPEN_ANSWER' ? (
            <textarea onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: { answerIds: [], textAnswer: event.target.value } }))} />
          ) : (
            question.answers.map((answer) => (
              <label className="choice" key={answer.id}>
                <input
                  type={question.type === 'MULTIPLE_CHOICE' ? 'checkbox' : 'radio'}
                  name={`q-${question.id}`}
                  checked={(answers[question.id]?.answerIds ?? []).includes(answer.id)}
                  onChange={() => toggle(question.id, answer.id, question.type === 'MULTIPLE_CHOICE')}
                />
                {answer.answer}
              </label>
            ))
          )}
        </article>
      ))}
      <button className="primary submit-button" onClick={submit}>Завърши теста</button>
    </main>
  )
}

export default App
