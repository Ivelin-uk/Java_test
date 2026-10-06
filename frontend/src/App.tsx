import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Plus, Save, Send, Sparkles, Trash2, LogOut, UserRound, Shield, BookOpen, ClipboardList, ArrowLeft } from 'lucide-react'
import './App.css'
import { api } from './api/client'
import { AuthPanel } from './components/AuthPanel'
import { DeleteTestDialog } from './components/DeleteTestDialog'
import { TestBuilder, starterTest, toRequest } from './components/TestBuilder'
import { AdminPanel } from './components/AdminPanel'
import { ProfilePanel } from './components/ProfilePanel'
import { StudentPanel } from './components/StudentPanel'
import { canAccess, hasPermission, roleLabels, subscriptionLabel, formatDate } from './api/access'
import type { AuthResponse, CreatorResult, DashboardStats, PublicTest, TestDetail, TestRequest, TestSummary } from './types/models'

function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(() => {
    try { return JSON.parse(localStorage.getItem('quicktest.auth') ?? 'null') } catch { return null }
  })
  const [verified, setVerified] = useState(false)
  const [view, setView] = useState<'admin' | 'creator' | 'student' | 'profile' | null>(null)
  const [error, setError] = useState('')
  const publicCode = window.location.pathname.startsWith('/quiz/') ? window.location.pathname.split('/').pop() : null
  const token = auth?.token

  useEffect(() => {
    if (!token) return
    let alive = true
    async function verify() {
      try {
        const user = await api.me(token!)
        if (alive) {
          setAuth(current => current?.token === token ? { token: token!, user } : current)
          setVerified(true)
          setError('')
        }
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Връзката е прекъсната.')
      }
    }
    const expired = (event: Event) => {
      if ((event as CustomEvent).detail === token) { setAuth(null); setVerified(false); setView(null); localStorage.removeItem('quicktest.auth') }
    }
    window.addEventListener('quicktest:session-expired', expired)
    window.addEventListener('focus', verify)
    const timer = window.setInterval(verify, 30000)
    void verify()
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', verify); window.removeEventListener('quicktest:session-expired', expired) }
  }, [token])

  useEffect(() => { if (auth) localStorage.setItem('quicktest.auth', JSON.stringify(auth)) }, [auth])

  function signedIn(next: AuthResponse) { setAuth(next); setVerified(true); setView(null) }
  async function logout() {
    if (token) { try { await api.logout(token) } catch { /* Local logout also works when the server is unavailable. */ } }
    localStorage.removeItem('quicktest.auth'); setAuth(null); setVerified(false); setView(null)
  }
  async function refreshProfile() {
    if (token) setAuth({ token, user: await api.me(token) })
  }

  if (!auth) return <AuthPanel onAuth={signedIn} />
  if (!verified) return <main className="app-shell"><p role="status">{error || 'Проверка на сесията...'}</p><button onClick={() => void logout()}>Изход</button></main>
  const creatorAvailable = ['DashboardController.dashboard', 'QuizController.list', 'QuizController.create', 'QuizController.allResults', 'AiController.generateTest'].some(key => hasPermission(auth.user, key))
  const studentAvailable = ['StudentController.catalog', 'StudentController.results'].some(key => hasPermission(auth.user, key))
  const defaultView = auth.user.role === 'ADMIN' ? 'admin' : auth.user.role === 'STUDENT' ? (studentAvailable ? 'student' : 'profile') : creatorAvailable ? 'creator' : 'profile'
  const selected = view === 'admin' && auth.user.role !== 'ADMIN' || view === 'creator' && !creatorAvailable || view === 'student' && !studentAvailable ? defaultView : view ?? defaultView
  const forced = auth.user.passwordChangeRequired

  return <main className="app-shell">
    <header className="topbar account-topbar">
      <div><span className="eyebrow">QuickTest</span><h1>{forced ? 'Нова парола' : publicCode ? 'Решаване на тест' : selected === 'admin' ? 'Администрация' : selected === 'student' ? 'Моите тестове' : selected === 'profile' ? 'Моят профил' : 'Тестове'}</h1></div>
      <div className="account-summary"><strong>{auth.user.name}</strong><span>{roleLabels[auth.user.role]}</span><span className={auth.user.subscription.active ? 'status-text good' : 'status-text'}>{subscriptionLabel(auth.user)}{auth.user.subscription.paidUntil && ` · до ${formatDate(auth.user.subscription.paidUntil)}`}</span></div>
      <button className="icon-button" title="Изход" aria-label="Изход" onClick={() => void logout()}><LogOut size={18} /></button>
    </header>
    {!forced && <nav className="app-tabs" aria-label="Основна навигация">
      {publicCode ? <a className="command-button" href="/"><ArrowLeft size={17} /> Начало</a> : <>
        {auth.user.role === 'ADMIN' && <button className={selected === 'admin' ? 'active' : ''} onClick={() => setView('admin')}><Shield size={17} /> Администрация</button>}
        {creatorAvailable && <button className={selected === 'creator' ? 'active' : ''} onClick={() => setView('creator')}><ClipboardList size={17} /> {auth.user.role === 'ADMIN' ? 'Всички тестове' : 'Редактор'}</button>}
        {studentAvailable && <button className={selected === 'student' ? 'active' : ''} onClick={() => setView('student')}><BookOpen size={17} /> Решаване</button>}
        <button className={selected === 'profile' ? 'active' : ''} onClick={() => setView('profile')}><UserRound size={17} /> Профил</button>
      </>}
    </nav>}
    {error && <p className="error" role="alert">{error}</p>}
    <div key={auth.token}>
      {forced || !publicCode && selected === 'profile' ? <ProfilePanel auth={auth} onAuth={signedIn} />
        : publicCode ? <ParticipantPage code={publicCode} auth={auth} />
          : selected === 'admin' ? <AdminPanel auth={auth} onProfileRefresh={refreshProfile} />
            : selected === 'student' ? <StudentPanel auth={auth} /> : <CreatorApp auth={auth} />}
    </div>
  </main>
}

function CreatorApp({ auth }: { auth: AuthResponse }) {
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

  const token = auth.token
  const allowed = (key: string) => canAccess(auth.user, key)

  const loadWorkspace = useCallback((nextToken = token) => Promise.all([
      canAccess(auth.user, 'DashboardController.dashboard') ? api.dashboard(nextToken) : Promise.resolve(null),
      canAccess(auth.user, 'QuizController.list') ? api.tests(nextToken) : Promise.resolve([]),
      canAccess(auth.user, 'QuizController.allResults') ? api.results(nextToken) : Promise.resolve([]),
    ]), [auth.user, token])

  async function refresh(nextToken = token) {
    const [dashboard, testList, resultList] = await loadWorkspace(nextToken)
    setStats(dashboard)
    setTests(testList)
    setResults(resultList)
  }

  const reportError = useCallback((cause: unknown) => {
    setMessage('')
    setError(cause instanceof Error ? cause.message : 'Възникна грешка. Опитай отново.')
  }, [])

  useEffect(() => {
    let alive = true
    loadWorkspace().then(([dashboard, testList, resultList]) => {
      if (alive) { setStats(dashboard); setTests(testList); setResults(resultList) }
    }).catch(reportError)
    return () => { alive = false }
  }, [loadWorkspace, reportError])

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
      const saved = current ? (allowed('QuizController.update') ? await api.updateTest(token, current.id, draft) : current) : await api.createTest(token, draft)
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

  return (
    <div>
      {allowed('DashboardController.dashboard') && <section className="stats-grid">
        <Stat label="Тестове" value={stats?.totalTests ?? 0} />
        <Stat label="Активни" value={stats?.activeTests ?? 0} />
        <Stat label="Опити" value={stats?.attempts ?? 0} />
        <Stat label="AI заявки" value={stats?.aiGenerations ?? 0} />
      </section>}

      <section className="workspace">
        <aside className="panel side-panel">
          {allowed('QuizController.create') && <button className="primary wide command-button" onClick={newDraft} disabled={busy !== null}>
            <Plus size={18} aria-hidden="true" /> Създай тест
          </button>}
          {hasPermission(auth.user, 'AiController.generateTest') && <div className="ai-box">
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
            <button className="command-button" onClick={generate} disabled={!allowed('AiController.generateTest') || busy !== null || !aiTopic.trim() || !Number.isInteger(questionCount) || questionCount < 1 || questionCount > 20}>
              {busy === 'generate' ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}
              {busy === 'generate' ? 'Генериране...' : 'Генерирай тест'}
            </button>
            {!allowed('AiController.generateTest') && <p className="status-text">Необходим е активен платен абонамент.</p>}
          </div>}
          <h2>Последни тестове</h2>
          <div className="test-list">
            {tests.length === 0 && <p className="save-state">Няма създадени тестове.</p>}
            {tests.map((test) => (
              <div className={`test-item${current?.id === test.id ? ' is-selected' : ''}`} key={test.id}>
                <button className="test-pill" onClick={() => void load(test.id)} disabled={busy !== null || !allowed('QuizController.get')} aria-pressed={current?.id === test.id}>
                  <strong>{test.title}</strong>
                  <span>{test.status} · {test.questionCount} въпроса</span>
                  {test.status === 'PUBLISHED' && test.publicCode && <small>/quiz/{test.publicCode}</small>}
                </button>
                {allowed('QuizController.delete') && <button className="icon-button danger test-delete" title={`Изтрий тест: ${test.title}`} aria-label={`Изтрий тест: ${test.title}`} disabled={busy !== null} onClick={() => { setError(''); setPendingDelete(test) }}>
                  <Trash2 size={17} aria-hidden="true" />
                </button>}
              </div>
            ))}
          </div>
        </aside>

        <section className="main-column">
          <div className="toolbar panel">
            <strong>{current ? `Редакция #${current.id}` : 'Нов тест'}</strong>
            <span className="save-state" role="status" aria-live="polite">{message}</span>
            <div className="toolbar-actions">
              {current && allowed('QuizController.delete') && <button className="icon-button danger" title="Изтрий тест" aria-label="Изтрий текущия тест" disabled={busy !== null} onClick={() => { setError(''); setPendingDelete(current) }}><Trash2 size={17} aria-hidden="true" /></button>}
              {allowed(current ? 'QuizController.update' : 'QuizController.create') && <button className="command-button" onClick={save} disabled={busy !== null}><Save size={17} aria-hidden="true" /> Запази</button>}
              {allowed('QuizController.publish') && <button className="primary command-button" onClick={publish} disabled={busy !== null || !current && !allowed('QuizController.create')}><Send size={17} aria-hidden="true" /> Публикувай</button>}
            </div>
          </div>
          {error && !pendingDelete && <p className="action-error error" role="alert">{error}</p>}
          {(current || allowed('QuizController.create') || allowed('AiController.generateTest')) && <fieldset className="builder-fieldset" disabled={busy !== null || !allowed(current ? 'QuizController.update' : 'QuizController.create')}><TestBuilder draft={draft} onChange={setDraft} /></fieldset>}
        </section>
      </section>

      {allowed('QuizController.allResults') && <section className="results-panel">
        <h2>Последни резултати</h2>
        <div className="table">
          <div className="table-row table-head"><span>Участник</span><span>Тест</span><span>Резултат</span><span>Оценка</span></div>
          {results.map((result) => (
            <div className="table-row" key={result.attemptId}>
              <span>{result.participantName}</span>
              <span>{result.testTitle}</span>
              <span>{result.score}/{result.maxScore} · {result.percentage}%</span>
              <span>{result.grade}</span>
            </div>
          ))}
        </div>
      </section>}
      {pendingDelete && <DeleteTestDialog title={pendingDelete.title} busy={busy === 'delete'} error={error} onCancel={() => { setPendingDelete(null); setError('') }} onConfirm={() => void remove()} />}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat panel"><span>{label}</span><strong>{value}</strong></div>
}

function ParticipantPage({ code, auth }: { code: string; auth: AuthResponse }) {
  const [test, setTest] = useState<PublicTest | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [answers, setAnswers] = useState<Record<number, { answerIds: number[]; textAnswer: string }>>({})
  const [result, setResult] = useState<{ score: number; maxScore: number; percentage: number; grade: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.publicTest(auth.token, code).then(setTest).catch((err) => setError(err instanceof Error ? err.message : 'Тестът не е намерен.'))
  }, [code, auth.token])

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
    if (submitting) return
    const payload = {
      participantName: auth.user.name,
      answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId: Number(questionId), ...answer })),
    }
    setSubmitting(true)
    try { setResult(await api.submitAttempt(auth.token, code, payload)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Неуспешно предаване.') }
    finally { setSubmitting(false) }
  }

  if (error && !test) return <div className="participant"><p className="error" role="alert">{error}</p></div>
  if (!test) return <section className="participant"><p role="status">Зареждане...</p></section>
  if (result) {
    return (
      <section className="participant">
        <section className="panel result-card">
          <span className="eyebrow">Резултат</span>
          <h1>{result.score} / {result.maxScore}</h1>
          <p>{result.percentage}% · Оценка {result.grade}</p>
        </section>
      </section>
    )
  }

  return (
    <section className="participant">
      <section className="panel participant-head">
        <h1>{test.title}</h1>
        <p>{test.description}</p>
        <p>{auth.user.name}</p>
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
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary submit-button" onClick={submit} disabled={submitting || !canAccess(auth.user, 'QuizController.submit')}>{submitting ? 'Предаване...' : 'Завърши теста'}</button>
    </section>
  )
}

export default App
