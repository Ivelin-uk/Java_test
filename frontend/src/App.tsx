import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { api } from './api/client'
import { AuthPanel } from './components/AuthPanel'
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

  const token = auth?.token ?? ''

  useEffect(() => {
    if (auth) {
      localStorage.setItem('quicktest.auth', JSON.stringify(auth))
      void refresh(auth.token)
    }
  }, [auth])

  async function refresh(nextToken = token) {
    if (!nextToken) return
    const [dashboard, testList, resultList] = await Promise.all([api.dashboard(nextToken), api.tests(nextToken), api.results(nextToken)])
    setStats(dashboard)
    setTests(testList)
    setResults(resultList)
  }

  async function save() {
    setMessage('Saving...')
    const saved = current ? await api.updateTest(token, current.id, draft) : await api.createTest(token, draft)
    setCurrent(saved)
    setDraft(toRequest(saved))
    setMessage('Saved')
    await refresh()
  }

  async function generate() {
    setMessage('Generating draft...')
    const generated = await api.generateTest(token, {
      topic: aiTopic,
      instructions: 'Generate a concise MVP-ready test draft.',
      language: 'Bulgarian',
      questionCount: 5,
      difficulty: 'MEDIUM',
    })
    setDraft(generated.test)
    setCurrent(null)
    setMessage(`Generated with ${generated.model}`)
    await refresh()
  }

  async function publish() {
    const saved = current ?? (await api.createTest(token, draft))
    const published = await api.publish(token, saved.id)
    setCurrent({ ...saved, status: 'PUBLISHED', publicCode: published.publicCode })
    setMessage(`Published: ${published.publicUrl}`)
    await refresh()
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
          <button className="primary wide" onClick={() => { setCurrent(null); setDraft(starterTest()) }}>+ Създай тест</button>
          <div className="ai-box">
            <label>AI тема<input value={aiTopic} onChange={(event) => setAiTopic(event.target.value)} /></label>
            <button onClick={generate}>Генерирай тест</button>
          </div>
          <h2>Последни тестове</h2>
          <div className="test-list">
            {tests.map((test) => (
              <button className="test-pill" key={test.id} onClick={async () => {
                const detail = await api.test(token, test.id)
                setCurrent(detail)
                setDraft(toRequest(detail))
                setMessage('Loaded')
              }}>
                <strong>{test.title}</strong>
                <span>{test.status} · {test.questionCount} въпроса</span>
                {test.publicCode && <small>/quiz/{test.publicCode}</small>}
              </button>
            ))}
          </div>
        </aside>

        <section className="main-column">
          <div className="toolbar panel">
            <strong>{current ? `Editing #${current.id}` : 'New draft'}</strong>
            <span className="save-state">{message}</span>
            <button onClick={save}>Запази</button>
            <button className="primary" onClick={publish}>Publish</button>
          </div>
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
