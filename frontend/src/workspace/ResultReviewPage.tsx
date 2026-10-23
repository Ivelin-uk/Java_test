import { ArrowLeft, Check, CheckCircle2, Circle, CircleMinus, Clock3, FileCheck2, Info, MessageSquareText, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { QuestionText } from '../components/QuestionText'
import { useAction, useRemote, type WorkspaceApi } from './api'
import type { ExamAnswer, Question, Result, ReviewQuestion } from './types'
import { date, label } from './types'
import { Feedback, SectionHead } from './ui'
import { WorkspaceImage } from './WorkspaceImage'
import './ResultReviewPage.css'

type ResultDetail = Result & { details?: { questions: ReviewQuestion[]; gradeOverridden: boolean; outcomeOverridden: boolean; correctAnswersVisible?: boolean } }
type QuestionSnapshot = { question: Partial<Question>; options: { id: string; text: string; correct?: boolean }[] }
type ResultReviewPageProps = { api: WorkspaceApi; attempt: number; back: () => void }

const questionTypes: Record<string, string> = {
  SINGLE_CHOICE: 'Един верен отговор',
  MULTIPLE_CHOICE: 'Няколко верни отговора',
  TRUE_FALSE: 'Вярно / невярно',
  SHORT_ANSWER: 'Кратък отговор',
  OPEN_ANSWER: 'Свободен отговор',
}

function number(value: unknown) {
  return value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value).toLocaleString('bg-BG', { maximumFractionDigits: 2 }) : '—'
}

function snapshotOf(value: string): QuestionSnapshot | null {
  try {
    const snapshot = JSON.parse(value) as QuestionSnapshot
    if (!snapshot || typeof snapshot.question !== 'object' || snapshot.question === null || typeof snapshot.question.text !== 'string') return null
    return { question: snapshot.question, options: Array.isArray(snapshot.options) ? snapshot.options.filter(option => option && typeof option.id === 'string' && typeof option.text === 'string') : [] }
  } catch { return null }
}

function answerOf(value: string | null): ExamAnswer | null {
  if (!value) return null
  try {
    const answer = JSON.parse(value) as Partial<ExamAnswer> | null
    if (!answer || typeof answer !== 'object') return null
    return { optionIds: Array.isArray(answer.optionIds) ? answer.optionIds.filter(id => typeof id === 'string') : [], text: typeof answer.text === 'string' ? answer.text : '' }
  } catch { return null }
}

export function ResultReviewPage(props: ResultReviewPageProps) {
  return <ResultReviewContent key={props.attempt} {...props} />
}

function ResultReviewContent({ api, attempt, back }: ResultReviewPageProps) {
  const remote = useRemote<ResultDetail | null>(api, `/results/${attempt}`, null)
  const [metadata, setMetadata] = useState<Result | null>(null)
  const pageRef = useRef<HTMLElement>(null)
  const action = useAction()
  const result = remote.data
  // The detail endpoint owns access and scores. The list only fills in display metadata.
  const needsMetadata = result !== null && (!result.title || result.attempt_number === undefined)
  useEffect(() => {
    if (!needsMetadata) return
    let active = true
    api.get<Result[]>('/results').then(values => {
      const latest = values.filter(value => value.attempt_id === attempt).sort((a, b) => b.revision_number - a.revision_number)[0]
      if (active) setMetadata(latest ?? null)
    }).catch(() => { /* Display metadata is optional; the detail endpoint owns the result. */ })
    return () => { active = false }
  }, [api, attempt, needsMetadata])
  useEffect(() => { pageRef.current?.focus({ preventScroll: true }) }, [])
  const title = result?.title || metadata?.title || 'Резултат от теста'
  const attemptNumber = result?.attempt_number ?? metadata?.attempt_number
  const details = result?.review_available && result.details ? result.details : null
  const released = details?.correctAnswersVisible === true
  const questions = Array.isArray(details?.questions) ? details.questions : []
  const busy = remote.loading || action.busy
  const error = action.error || remote.error

  return <section ref={pageRef} tabIndex={-1} className="ws-section result-review-page" aria-label="Преглед на теста">
    <SectionHead title="Преглед на теста" description="Виж предадените си отговори, получените точки и обясненията към въпросите.">
      <button type="button" className="command-button" onClick={back}><ArrowLeft size={17} aria-hidden="true" />Към моите тестове</button>
    </SectionHead>
    <Feedback error={error} busy={busy} />
    {error && <div className="ws-actions"><button type="button" className="command-button" disabled={busy} onClick={() => void action.run(() => remote.reload())}><RefreshCw size={17} aria-hidden="true" />Опитай отново</button></div>}
    {result && <>
      <section className="result-review-summary" aria-label="Резултат от теста">
        <header className="result-review-summary-head">
          <div><p className="result-review-eyebrow"><FileCheck2 size={16} aria-hidden="true" />Предаден тест{attemptNumber !== undefined && <><span aria-hidden="true">·</span><span>Опит {attemptNumber}</span></>}</p><h3>{title}</h3></div>
          <span className={`result-review-outcome ${result.outcome === 'passed' ? 'is-passed' : result.outcome === 'failed' ? 'is-failed' : ''}`}>
            {result.outcome === 'passed' ? <CheckCircle2 size={18} aria-hidden="true" /> : result.outcome === 'failed' ? <CircleMinus size={18} aria-hidden="true" /> : <FileCheck2 size={18} aria-hidden="true" />}{result.outcome ? label(result.outcome) : 'Няма данни'}
          </span>
        </header>
        <dl className="result-review-metrics">
          <div><dt>Получени точки</dt><dd>{number(result.points)} <span>/ {number(result.maximum_points)}</span></dd></div>
          <div><dt>Резултат</dt><dd>{result.percentage !== null && result.percentage !== undefined && Number.isFinite(Number(result.percentage)) ? <>{Number(result.percentage).toFixed(2)}<span>%</span></> : '—'}</dd></div>
          <div><dt>Оценка</dt><dd>{result.grade ? label(result.grade) : '—'}</dd></div>
          <div><dt>Въпроси</dt><dd>{details ? questions.length : '—'}</dd></div>
        </dl>
        {(result.published_at || result.revision_number > 1) && <p className="result-review-publication">{result.published_at && <>Публикуван: {date(result.published_at)}</>}{result.revision_number > 1 && <span>Корекция №{result.revision_number - 1}</span>}</p>}
        {details && (details.gradeOverridden || details.outcomeOverridden) && <p className="result-review-notice"><Info size={18} aria-hidden="true" /><span>Учителска корекция на {details.gradeOverridden ? 'оценката' : ''}{details.gradeOverridden && details.outcomeOverridden ? ' и ' : ''}{details.outcomeOverridden ? 'изхода' : ''}.</span></p>}
        {result.reason && <div className="result-review-publication-note"><strong>Бележка към резултата</strong><p>{result.reason}</p></div>}
      </section>

      {!details ? <p className="result-review-notice"><Info size={20} aria-hidden="true" /><span>Учителят не е разрешил преглед на теста и отговорите за този опит.</span></p> : <>
        {!released && <p className="result-review-notice" role="note"><Clock3 size={20} aria-hidden="true" /><span>Верните отговори ще бъдат достъпни след крайния срок на възлагането.</span></p>}
        <div className="result-review-questions-heading"><h3>Отговори по въпроси</h3><p>{released ? 'За всеки въпрос са показани твоят отговор, верният отговор и обяснението.' : 'Сега можеш да видиш предадените си отговори и получените точки.'}</p></div>
        {questions.map((question, index) => <ReviewedQuestion key={question.id} api={api} attempt={result.attempt_id || attempt} row={question} index={index} released={released} />)}
        {!questions.length && <p className="result-review-notice"><Info size={20} aria-hidden="true" /><span>Няма достъпни въпроси за този опит.</span></p>}
      </>}
    </>}
  </section>
}

function ReviewedQuestion({ api, attempt, row, index, released }: { api: WorkspaceApi; attempt: number; row: ReviewQuestion; index: number; released: boolean }) {
  const snapshot = snapshotOf(row.definition_json)
  const answer = answerOf(row.answer_json)
  const selected = new Set(answer?.optionIds ?? [])
  const awarded = row.final_points === null || row.final_points === undefined ? null : Number(row.final_points)
  const maximum = Number(row.maximum_points)
  const scored = released && awarded !== null && Number.isFinite(awarded) && Number.isFinite(maximum)
  const verdict = !scored ? answer ? 'Предаден отговор' : 'Без предаден отговор' : awarded === 0 ? 'Без точки' : maximum > 0 && awarded >= maximum ? 'Пълен брой точки' : 'Частични точки'
  const verdictClass = !scored ? '' : awarded === 0 ? 'is-zero' : maximum > 0 && awarded >= maximum ? 'is-full' : 'is-partial'
  const VerdictIcon = !scored ? Circle : awarded === 0 ? X : maximum > 0 && awarded >= maximum ? Check : CircleMinus
  const id = `review-question-${row.id}`
  const answers = snapshot?.options.filter(option => selected.has(option.id)) ?? []
  const correct = released ? snapshot?.options.filter(option => option.correct === true) ?? [] : []
  const accepted = released && Array.isArray(snapshot?.question.acceptedAnswers) ? snapshot.question.acceptedAnswers.filter(value => typeof value === 'string' && value.trim()) : []
  const criteria = released && typeof snapshot?.question.criteria === 'string' ? snapshot.question.criteria.trim() : ''
  const explanation = released && typeof snapshot?.question.explanation === 'string' ? snapshot.question.explanation.trim() : ''

  return <article className={`result-review-question ${verdictClass}`} aria-labelledby={id}>
    <header className="result-review-question-head">
      <div><h3 id={id}>Въпрос {index + 1}</h3>{snapshot?.question.type && <p>{questionTypes[snapshot.question.type] ?? 'Въпрос'}</p>}</div>
      <div className="result-review-question-score"><span className={`result-review-verdict ${verdictClass}`}><VerdictIcon size={17} aria-hidden="true" />{verdict}</span><strong>{number(row.final_points)} / {number(row.maximum_points)} точки</strong></div>
    </header>
    <div className="result-review-question-body">
      {!snapshot ? <p className="result-review-notice"><Info size={18} aria-hidden="true" /><span>Данните за този въпрос не могат да се покажат.</span></p> : <>
        <div className="result-review-prompt"><QuestionText value={snapshot.question.text ?? ''} /></div>
        <WorkspaceImage api={api} id={snapshot.question.imageId} attempt={attempt} />
        {snapshot.options.length > 0 && <section className="result-review-options" aria-label={`Възможни отговори за въпрос ${index + 1}`}>
          <h4>Възможни отговори</h4>
          <ul>{snapshot.options.map((option, optionIndex) => {
            const chosen = selected.has(option.id)
            const isCorrect = released && option.correct === true
            const incorrect = released && chosen && !isCorrect
            return <li key={option.id} className={`${chosen ? 'is-selected' : ''} ${isCorrect ? 'is-correct' : ''} ${incorrect ? 'is-incorrect' : ''}`}>
              <span className="result-review-option-letter" aria-hidden="true">{String.fromCharCode(65 + optionIndex)}</span>
              <span className="result-review-option-text">{option.text}</span>
              <span className="result-review-option-markers">{chosen && <span className="result-review-selection"><Check size={14} aria-hidden="true" />Твоят избор</span>}{isCorrect && <span className="result-review-correct"><CheckCircle2 size={14} aria-hidden="true" />Верен отговор</span>}{isCorrect && !chosen && <span className="result-review-missed">Не е избран</span>}{incorrect && <span className="result-review-incorrect"><X size={14} aria-hidden="true" />Неверен избор</span>}</span>
            </li>
          })}</ul>
        </section>}
        <div className="result-review-answer-grid">
          <section className="result-review-answer result-review-student-answer" aria-label={`Твоят отговор на въпрос ${index + 1}`}>
            <h4><FileCheck2 size={18} aria-hidden="true" />Твоят отговор</h4>
            {!answer ? <p className="result-review-empty-answer">Няма предаден отговор</p> : answers.length ? <ul>{answers.map(option => <li key={option.id}>{option.text}</li>)}</ul> : <p className={answer.text.trim() ? '' : 'result-review-empty-answer'}>{answer.text.trim() ? answer.text : 'Празен отговор'}</p>}
            {row.status !== 'answered' && <small>Статус: {label(row.status)}</small>}
          </section>
          {released && <section className="result-review-answer result-review-solution" aria-label={`Верен отговор за въпрос ${index + 1}`}>
            <h4><CheckCircle2 size={18} aria-hidden="true" />Верен отговор / критерии</h4>
            {correct.length ? <ul>{correct.map(option => <li key={option.id}>{option.text}</li>)}</ul> : accepted.length ? <ul>{accepted.map((value, acceptedIndex) => <li key={acceptedIndex}>{value}</li>)}</ul> : criteria ? <p>{criteria}</p> : <p className="result-review-empty-answer">Няма добавен верен отговор или критерии.</p>}
            {criteria && (correct.length > 0 || accepted.length > 0) && <p>{criteria}</p>}
          </section>}
        </div>
        {released && <section className="result-review-explanation" aria-label={`Обяснение към въпрос ${index + 1}`}><h4><Info size={18} aria-hidden="true" />Обяснение</h4>{explanation ? <QuestionText value={explanation} /> : <p className="result-review-empty-answer">Няма добавено обяснение към този въпрос.</p>}</section>}
      </>}
      {released && row.teacher_comment?.trim() && <section className="result-review-comment" aria-label={`Коментар от учителя за въпрос ${index + 1}`}><h4><MessageSquareText size={18} aria-hidden="true" />Коментар от учителя</h4><p>{row.teacher_comment}</p></section>}
    </div>
  </article>
}
