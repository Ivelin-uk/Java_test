import { ThemeToggle } from '../components/ThemeToggle'
import { WorkspaceImage } from './WorkspaceImage'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Maximize, Send, Timer, WifiOff } from 'lucide-react'
import type { WorkspaceApi } from './api'
import { useRemote } from './api'
import type { ExamAnswer, ExamSession, ExamState, Preflight } from './types'
import { date } from './types'
import { Feedback } from './ui'
import { formatDuration } from './duration'

function randomToken() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') }
export function ExamScreen({ api, user, assignment, resume, back }: { api: WorkspaceApi; user: number; assignment: number; resume?: number; back: () => void }) {
  const preflight = useRemote<Preflight | null>(api, `/assignments/${assignment}/preflight`, null)
  const container = useRef<HTMLDivElement>(null)
  const stateRef = useRef<ExamState | null>(null)
  const [state, setState] = useState<ExamState | null>(null)
  const [answer, setAnswer] = useState<ExamAnswer>({ optionIds: [], text: '' })
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [offline, setOffline] = useState(!navigator.onLine)
  const [fullscreen, setFullscreen] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [initialClock] = useState(() => ({ at: performance.now(), server: Date.now() }))
  const serverClock = useRef(initialClock)
  const storageKey = `examai.exam.${user}.${assignment}`
  const [session] = useState<ExamSession>(() => {
    if (!window.name.startsWith('examai-tab-')) window.name = `examai-tab-${crypto.randomUUID()}`
    const saved = sessionStorage.getItem(storageKey)
    let old: ExamSession | undefined
    if (saved) { try { old = JSON.parse(saved) as ExamSession; if (old.browserId === window.name) return old } catch { /* Invalid local state is replaced. */ } }
    const created = { token: randomToken(), browserId: window.name, startKey: crypto.randomUUID(), ...(resume || old?.attemptId ? { attemptId: resume ?? old?.attemptId } : {}) }
    sessionStorage.setItem(storageKey, JSON.stringify(created)); return created
  })
  const [transferPassword, setTransferPassword] = useState('')
  const apply = useCallback((next: ExamState) => {
    const before = stateRef.current
    if (before && (new Date(next.server_now).getTime() < new Date(before.server_now).getTime() || next.question_number < before.question_number || before.status !== 'in_progress' && next.status === 'in_progress')) return
    stateRef.current = next; setState(next)
    serverClock.current = { at: performance.now(), server: new Date(next.server_now).getTime() }
    setRemaining(next.question?.deadline_at ? Math.max(0, Math.ceil((new Date(next.question.deadline_at).getTime() - serverClock.current.server) / 1000)) : 0)
    if (before?.question?.id !== next.question?.id) setAnswer(next.question?.draft ?? { optionIds: [], text: '' })
    if (next.status !== 'in_progress' && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }, [])
  useEffect(() => {
    if (!session.attemptId) return
    let alive = true
    api.get<ExamState>(`/attempts/${session.attemptId}/state`, session).then(value => { if (alive) apply(value) }).catch(cause => { if (alive) setError(cause.message) })
    return () => { alive = false }
  }, [api, session, apply])
  useEffect(() => {
    const timer = window.setInterval(() => {
      const value = stateRef.current
      const deadline = value?.question?.deadline_at
      setRemaining(deadline ? Math.max(0, Math.ceil((new Date(deadline).getTime() - serverClock.current.server - (performance.now() - serverClock.current.at)) / 1000)) : 0)
    }, 200)
    return () => window.clearInterval(timer)
  }, [])
  const attemptId = state?.id
  const attemptStatus = state?.status
  const questionId = state?.question?.id
  const questionStatus = state?.question?.status
  const openInstance = state?.question?.open_instance
  useEffect(() => {
    if (!attemptId || attemptStatus !== 'in_progress') return
    const poll = window.setInterval(() => {
      if (!busyRef.current) void api.get<ExamState>(`/attempts/${attemptId}/state`, session).then(apply).catch(cause => setError(cause.message))
    }, 1500)
    return () => window.clearInterval(poll)
  }, [api, attemptId, attemptStatus, session, apply])
  useEffect(() => {
    if (!attemptId || !questionId || questionStatus !== 'open') return
    const save = window.setTimeout(() => {
      void api.put<ExamState>(`/attempts/${attemptId}/questions/${questionId}/draft`, { openInstance, answer }, session).then(apply).catch(cause => setError(cause.message))
    }, 400)
    return () => window.clearTimeout(save)
  }, [api, attemptId, questionId, questionStatus, openInstance, answer, session, apply])
  useEffect(() => {
    const emit = (type: string) => {
      const value = stateRef.current
      if (!value || value.status !== 'in_progress') return
      const q = value.question
      const event = { eventKey: crypto.randomUUID(), questionId: q?.status === 'open' ? q.id : null, openInstance: q?.status === 'open' ? q.open_instance : null, type, visible: document.visibilityState === 'visible', fullscreen: document.fullscreenElement === container.current }
      // Persist the original instance so a disconnected sanction cannot hit a later question.
      const queueKey = `${storageKey}.events`
      const pending = JSON.parse(sessionStorage.getItem(queueKey) ?? '[]') as unknown[]
      pending.push(event); sessionStorage.setItem(queueKey, JSON.stringify(pending))
      void flush(value.id)
    }
    async function flush(id: number) {
      const queueKey = `${storageKey}.events`
      const pending = JSON.parse(sessionStorage.getItem(queueKey) ?? '[]') as { eventKey: string }[]
      for (const event of pending) {
        try {
          apply(await api.post<ExamState>(`/attempts/${id}/events`, event, session))
          const current = JSON.parse(sessionStorage.getItem(queueKey) ?? '[]') as { eventKey: string }[]
          sessionStorage.setItem(queueKey, JSON.stringify(current.filter(item => item.eventKey !== event.eventKey)))
        } catch { break }
      }
    }
    const visibility = () => { if (document.visibilityState === 'hidden') emit('visibility_hidden') }
    const fullscreenChanged = () => { setFullscreen(document.fullscreenElement === container.current); if (document.fullscreenElement !== container.current) emit('fullscreen_exit') }
    const blur = () => emit('blur')
    const networkOff = () => { setOffline(true); emit('offline') }
    const networkOn = () => { setOffline(false); emit('online'); if (stateRef.current) void flush(stateRef.current.id) }
    document.addEventListener('visibilitychange', visibility); document.addEventListener('fullscreenchange', fullscreenChanged)
    window.addEventListener('blur', blur); window.addEventListener('offline', networkOff); window.addEventListener('online', networkOn)
    if (stateRef.current) void flush(stateRef.current.id)
    return () => { document.removeEventListener('visibilitychange', visibility); document.removeEventListener('fullscreenchange', fullscreenChanged); window.removeEventListener('blur', blur); window.removeEventListener('offline', networkOff); window.removeEventListener('online', networkOn) }
  }, [api, session, storageKey, apply])
  async function perform(work: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await work() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Неуспешно действие.') }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function fullscreenReady() {
    const mobile = /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
    if (mobile && !preflight.data?.mobile_validated && !preflight.data?.fullscreen_exempt) throw new Error('Мобилният строг режим не е валидиран. Използвайте настолен компютър или индивидуално разрешено изключение.')
    if (!preflight.data?.fullscreen_exempt && document.fullscreenElement !== container.current) {
      if (!document.fullscreenEnabled || !container.current?.requestFullscreen) throw new Error('Този браузър не поддържа строгия режим. Опит не е изразходван.')
      await container.current.requestFullscreen()
    }
    if (document.visibilityState !== 'visible') throw new Error('Страницата трябва да е видима.')
  }
  async function begin() {
    await perform(async () => {
      await fullscreenReady()
      const next = await api.post<ExamState>(`/assignments/${assignment}/attempts`, { code, idempotencyKey: session.startKey, browserId: session.browserId, sessionToken: session.token, fullscreenSupported: document.fullscreenEnabled, fullscreenActive: document.fullscreenElement === container.current, visible: document.visibilityState === 'visible' })
      session.attemptId = next.id; sessionStorage.setItem(storageKey, JSON.stringify(session)); apply(next)
    })
  }
  return <div className="exam-screen" ref={container}>
    <div className="exam-content"><header className="exam-header"><strong>ExamAI · {preflight.data?.title ?? 'Изпит'}</strong>{state?.status === 'in_progress' && <span aria-label="Оставащо време" className={remaining <= 10 ? 'exam-timer danger' : 'exam-timer'}><Timer size={20} /> {formatDuration(remaining)}</span>}<ThemeToggle /></header><Feedback error={error || preflight.error} busy={busy || preflight.loading} />{offline && <p className="error ws-feedback"><WifiOff size={17} /> Няма връзка. Сървърните срокове продължават.</p>}
    {!state && preflight.data && <section className="exam-preflight"><h1>Подготовка за изпит</h1><p>{preflight.data.instructions}</p><dl><dt>Въпроси</dt><dd>{preflight.data.question_count}</dd><dt>Общо време</dt><dd>{formatDuration(preflight.data.total_seconds)}</dd><dt>Краен срок</dt><dd>{date(preflight.data.ends_at)}</dd><dt>Режим</dt><dd>{preflight.data.fullscreen_exempt ? 'Индивидуално разрешено изключение от цял екран' : 'Цял екран'}</dd></dl><p>Напускане на целия екран или скриване на страницата приключва текущия въпрос с 0 точки. Няма връщане към приключени въпроси. Изтичането на времето носи 0 точки и за запазена чернова.</p><p>Браузърът отчита само достъпните му събития. Това не блокира външни приложения и не гарантира липса на преписване.</p>
      {session.attemptId ? <form onSubmit={e => { e.preventDefault(); void perform(async () => { const next = await api.post<ExamState>(`/attempts/${session.attemptId}/session/transfer`, { password: transferPassword, session: { browserId: session.browserId, sessionToken: session.token } }); apply(next) }) }}><label>Парола за прехвърляне на сесията<input type="password" required value={transferPassword} onChange={e => setTransferPassword(e.target.value)} /></label><button disabled={busy}>Прехвърли без промяна на сроковете</button></form> : <><label>Код за достъп<input value={code} maxLength={8} autoComplete="off" onChange={e => setCode(e.target.value.toUpperCase())} /></label><button className="primary command-button" disabled={busy || code.length !== 8} onClick={() => void begin()}><Maximize size={18} /> Започни на цял екран</button></>}
      <button className="command-button" disabled={busy} onClick={back}><ArrowLeft size={17} /> Към тестовете</button>
    </section>}
    {state?.status === 'in_progress' && state.question && <section className="exam-question"><p className="exam-progress">Въпрос {state.question_number} / {state.question_count} · {state.question.maximum_points} точки</p>{state.question.status === 'pending' ? <><h1>Готовност за следващия въпрос</h1><p>Времето започва след потвърждаването.</p><button className="primary command-button" disabled={busy} onClick={() => void perform(async () => { await fullscreenReady(); apply(await api.post<ExamState>(`/attempts/${state.id}/questions/open`, { fullscreenActive: document.fullscreenElement === container.current, visible: document.visibilityState === 'visible' }, session)) })}><Maximize size={18} /> Продължи на цял екран</button></> : !fullscreen && !preflight.data?.fullscreen_exempt ? <><h1>Възстановете целия екран</h1><p>Сървърният срок продължава; времето не се нулира.</p><button className="primary command-button" disabled={busy} onClick={() => void perform(fullscreenReady)}><Maximize size={18} /> Възстанови целия екран</button></> : <><h1>{state.question.text}</h1><WorkspaceImage api={api} id={state.question.imageId} attempt={state.id} session={session} />{['SHORT_ANSWER', 'OPEN_ANSWER'].includes(state.question.type) ? <label>Отговор<textarea className="exam-text" maxLength={30000} value={answer.text} onChange={e => setAnswer({ optionIds: [], text: e.target.value })} /></label> : <div className="exam-options">{state.question.options.map(option => <label className="exam-option" key={option.id}><input type={state.question!.type === 'MULTIPLE_CHOICE' ? 'checkbox' : 'radio'} name="exam-answer" checked={answer.optionIds.includes(option.id)} onChange={() => setAnswer({ text: '', optionIds: state.question!.type === 'MULTIPLE_CHOICE' ? answer.optionIds.includes(option.id) ? answer.optionIds.filter(id => id !== option.id) : [...answer.optionIds, option.id] : [option.id] })} />{option.text}</label>)}</div>}<button className="primary command-button" disabled={busy || offline || remaining === 0} onClick={() => void perform(async () => apply(await api.post<ExamState>(`/attempts/${state.id}/questions/${state.question!.id}/answer`, { idempotencyKey: crypto.randomUUID(), openInstance: state.question!.open_instance, answer }, session)))}><Check size={18} /> Потвърди отговора</button></>}
      <button className="command-button" disabled={busy} onClick={() => { if (window.confirm('Да предадете ли опита? Неотговорените въпроси ще получат 0 точки.')) void perform(async () => apply(await api.post<ExamState>(`/attempts/${state.id}/submit`, undefined, session))) }}><Send size={17} /> Предай опита</button>
    </section>}
    {state && state.status !== 'in_progress' && <section className="exam-finished"><Check size={42} /><h1>Опитът е предаден</h1><p>Окончателният резултат ще бъде достъпен след проверка и публикуване от учителя.</p><button className="primary command-button" onClick={back}><ArrowLeft size={17} /> Моите тестове</button></section>}
    </div>
  </div>
}
