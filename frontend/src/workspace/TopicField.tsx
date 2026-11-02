import { useEffect, useId, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useSubjectCatalog } from './subjects'

export function TopicField({ subject, level, value, onChange, disabled = false, requireSubject = false }: { subject: string; level: string; value: string; onChange: (value: string) => void; disabled?: boolean; requireSubject?: boolean }) {
  const { loadTopics } = useSubjectCatalog()
  const id = useId()
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ key: string; values: string[]; error: boolean }>({ key: '', values: [], error: false })
  const key = JSON.stringify([subject, level, revision])
  useEffect(() => {
    if (!subject.trim()) return
    let active = true
    loadTopics(subject, level).then(values => { if (active) setResult({ key, values, error: false }) })
      .catch(() => { if (active) setResult({ key, values: [], error: true }) })
    return () => { active = false }
  }, [subject, level, key, loadTopics])
  const failed = !!subject && result.key === key && result.error
  return <div className="ws-subject-field">
    <label>Тема<input required type="text" autoComplete="off" list={id} value={value} maxLength={190} disabled={disabled || (requireSubject && !subject.trim())} placeholder={subject ? 'Избери тема или въведи нова' : 'Първо избери дисциплина'} aria-describedby={`${id}-hint`} onChange={event => onChange(event.target.value)} /></label>
    <datalist id={id}>{result.key === key && result.values.map(topic => <option key={topic} value={topic} />)}</datalist>
    <p id={`${id}-hint`} className="ws-topic-hint">{!subject ? 'Избери дисциплина за предложения на теми.' : failed ? 'Темите не могат да се заредят. Можеш да въведеш нова.' : 'Примерни теми и теми от твоите тестове. Можеш да въведеш и нова.'}</p>
    {failed && <button type="button" className="ws-text-button" disabled={disabled} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} aria-hidden="true" />Опитай отново</button>}
  </div>
}
