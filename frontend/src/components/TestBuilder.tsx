import type { AnswerInput, QuestionInput, QuestionType, TestDetail, TestRequest } from '../types/models'

const blankAnswer = (answer = '', correct = false): AnswerInput => ({ answer, correct })
export const starterTest = (): TestRequest => ({
  title: 'Нов тест',
  description: '',
  language: 'Bulgarian',
  durationMinutes: null,
  questionOrderRandom: false,
  answerOrderRandom: false,
  showResult: true,
  showAnswers: true,
  questions: [
    {
      type: 'SINGLE_CHOICE',
      question: 'Примерен въпрос',
      difficulty: 'MEDIUM',
      points: 1,
      explanation: '',
      answers: [blankAnswer('Правилен отговор', true), blankAnswer('Грешен отговор')],
    },
  ],
})

export function toRequest(test: TestRequest | TestDetail): TestRequest {
  return {
    title: test.title,
    description: test.description,
    language: test.language,
    durationMinutes: test.durationMinutes,
    questionOrderRandom: test.questionOrderRandom,
    answerOrderRandom: test.answerOrderRandom,
    showResult: test.showResult,
    showAnswers: test.showAnswers,
    questions: test.questions.map((question) => ({
      type: question.type,
      question: question.question,
      difficulty: question.difficulty,
      points: question.points,
      explanation: question.explanation,
      answers: question.answers.map((answer) => ({ answer: answer.answer, correct: answer.correct })),
    })),
  }
}

export function TestBuilder({ draft, onChange }: { draft: TestRequest; onChange: (draft: TestRequest) => void }) {
  function updateQuestion(index: number, patch: Partial<QuestionInput>) {
    onChange({ ...draft, questions: draft.questions.map((question, i) => (i === index ? { ...question, ...patch } : question)) })
  }

  function updateAnswer(questionIndex: number, answerIndex: number, patch: Partial<AnswerInput>) {
    onChange({
      ...draft,
      questions: draft.questions.map((question, i) =>
        i === questionIndex
          ? { ...question, answers: question.answers.map((answer, j) => (j === answerIndex ? { ...answer, ...patch } : answer)) }
          : question,
      ),
    })
  }

  function addQuestion(type: QuestionType = 'SINGLE_CHOICE') {
    onChange({
      ...draft,
      questions: [
        ...draft.questions,
        { type, question: '', difficulty: 'MEDIUM', points: 1, explanation: '', answers: [blankAnswer('', true), blankAnswer('')] },
      ],
    })
  }

  return (
    <section className="builder">
      <div className="panel">
        <div className="grid two">
          <label>Заглавие<input value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} /></label>
          <label>Език<input value={draft.language} onChange={(event) => onChange({ ...draft, language: event.target.value })} /></label>
        </div>
        <label>Описание<textarea value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} /></label>
        <div className="settings-row">
          <label><input type="checkbox" checked={draft.showResult} onChange={(event) => onChange({ ...draft, showResult: event.target.checked })} /> Показвай резултат</label>
          <label><input type="checkbox" checked={draft.showAnswers} onChange={(event) => onChange({ ...draft, showAnswers: event.target.checked })} /> Показвай верни отговори</label>
          <label>Минути<input type="number" min="1" value={draft.durationMinutes ?? ''} onChange={(event) => onChange({ ...draft, durationMinutes: event.target.value ? Number(event.target.value) : null })} /></label>
        </div>
      </div>

      {draft.questions.map((question, questionIndex) => (
        <article className="panel question-panel" key={questionIndex}>
          <div className="question-head">
            <strong>Въпрос {questionIndex + 1}</strong>
            <select value={question.type} onChange={(event) => updateQuestion(questionIndex, { type: event.target.value as QuestionType })}>
              <option value="SINGLE_CHOICE">Single Choice</option>
              <option value="MULTIPLE_CHOICE">Multiple Choice</option>
              <option value="TRUE_FALSE">True / False</option>
              <option value="SHORT_ANSWER">Short Answer</option>
              <option value="OPEN_ANSWER">Open Answer</option>
            </select>
            <input className="points" type="number" min="1" value={question.points} onChange={(event) => updateQuestion(questionIndex, { points: Number(event.target.value) })} />
          </div>
          <textarea value={question.question} onChange={(event) => updateQuestion(questionIndex, { question: event.target.value })} placeholder="Текст на въпроса" />
          <div className="answers">
            {question.answers.map((answer, answerIndex) => (
              <div className="answer-row" key={answerIndex}>
                <input type="checkbox" checked={answer.correct} onChange={(event) => updateAnswer(questionIndex, answerIndex, { correct: event.target.checked })} />
                <input value={answer.answer} onChange={(event) => updateAnswer(questionIndex, answerIndex, { answer: event.target.value })} placeholder="Отговор" />
              </div>
            ))}
          </div>
          <div className="question-actions">
            <button type="button" onClick={() => updateQuestion(questionIndex, { answers: [...question.answers, blankAnswer()] })}>+ Отговор</button>
            <button type="button" onClick={() => onChange({ ...draft, questions: draft.questions.filter((_, i) => i !== questionIndex) })}>Изтрий</button>
          </div>
        </article>
      ))}

      <div className="add-row">
        <button type="button" onClick={() => addQuestion()}>+ Добави въпрос</button>
      </div>
    </section>
  )
}
