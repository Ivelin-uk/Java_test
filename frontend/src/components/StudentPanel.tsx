import { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { api } from '../api/client'
import { canAccess, hasPermission } from '../api/access'
import type { AuthResponse, CreatorResult, TestSummary } from '../types/models'
import { TableContainer } from '../workspace/ui'

export function StudentPanel({ auth }: { auth: AuthResponse }) {
  const [tests, setTests] = useState<TestSummary[]>([])
  const [results, setResults] = useState<CreatorResult[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const catalog = canAccess(auth.user, 'StudentController.catalog')
  const ownResults = canAccess(auth.user, 'StudentController.results')

  useEffect(() => {
    let alive = true
    Promise.all([catalog ? api.studentTests(auth.token) : Promise.resolve([]), ownResults ? api.studentResults(auth.token) : Promise.resolve([])])
      .then(([nextTests, nextResults]) => { if (alive) { setTests(nextTests); setResults(nextResults); setError('') } })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : 'Неуспешно зареждане.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [auth.token, catalog, ownResults])

  return <div className="student-sections">
    {error && <p className="error" role="alert">{error}</p>}
    {(!catalog && hasPermission(auth.user, 'StudentController.catalog') || !ownResults && hasPermission(auth.user, 'StudentController.results')) && <p className="status-text" role="status">Необходим е активен платен абонамент.</p>}
    {loading && <p role="status">Зареждане...</p>}
    {catalog && <section>
      <h2>Публикувани тестове <span className="count-label">{tests.length}</span></h2>
      <TableContainer label="Публикувани тестове — таблица"><table className="ws-table data-table student-catalog" aria-label="Публикувани тестове"><thead><tr><th>Тест</th><th>Въпроси</th><th>Език</th><th>Действие</th></tr></thead><tbody>
        {tests.map(test => <tr key={test.id}><td><strong>{test.title}</strong><small>{test.description}</small></td><td>{test.questionCount} въпроса</td><td>{test.language}</td><td>{test.publicCode && canAccess(auth.user, 'QuizController.publicTest') && <a className="command-button table-link" href={`/quiz/${test.publicCode}`}><ArrowUpRight size={17} /> Реши</a>}</td></tr>)}
        {!loading && !tests.length && <tr><td colSpan={4} className="empty-cell">Няма публикувани тестове.</td></tr>}
      </tbody></table></TableContainer>
    </section>}
    {ownResults && <section>
      <h2>Моите резултати</h2>
      <TableContainer label="Моите резултати — таблица"><table className="ws-table data-table student-results" aria-label="Моите резултати"><thead><tr><th>Тест</th><th>Резултат</th><th>Оценка</th><th>Предаден</th></tr></thead><tbody>
        {results.map(result => <tr key={result.attemptId}><td>{result.testTitle}</td><td>{result.score}/{result.maxScore} · {result.percentage}%</td><td><strong>{result.grade}</strong></td><td>{new Date(result.submittedAt).toLocaleString('bg-BG')}</td></tr>)}
        {!loading && !results.length && <tr><td colSpan={4} className="empty-cell">Няма предадени тестове.</td></tr>}
      </tbody></table></TableContainer>
    </section>}
  </div>
}
