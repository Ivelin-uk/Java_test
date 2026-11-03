import { useEffect, useId, useState } from 'react'
import { ChevronDown, Plus, RefreshCw } from 'lucide-react'
import { subjectKey, useSubjectCatalog } from './subjects'
import { useNotifications } from '../notifications'
import { DeleteConfirmationButton } from '../components/DeleteConfirmationDialog'

export function TopicField({ subject, level, value, onChange, disabled = false, requireSubject = false }: { subject: string; level: string; value: string; onChange: (value: string) => void; disabled?: boolean; requireSubject?: boolean }) {
  const { loadTopics, loadPersonalTopics, saveTopic, deleteTopic } = useSubjectCatalog()
  const notify = useNotifications()
  const id = useId()
  const [revision, setRevision] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<{ key: string; values: string[]; personal: string[]; error: boolean }>({ key: '', values: [], personal: [], error: false })
  const key = JSON.stringify([subject, level, revision])
  useEffect(() => {
    if (!subject.trim()) return
    let active = true
    Promise.all([loadTopics(subject, level), loadPersonalTopics(subject, level)])
      .then(([values, personal]) => { if (active) setResult({ key, values, personal, error: false }) })
      .catch(() => { if (active) setResult({ key, values: [], personal: [], error: true }) })
    return () => { active = false }
  }, [subject, level, key, loadTopics, loadPersonalTopics])
  const failed = !!subject && result.key === key && result.error
  const values = result.key === key ? result.values : []
  const personal = result.key === key ? result.personal : []
  const matches = values.filter(topic => topic.toLocaleLowerCase('bg-BG').includes(value.trim().toLocaleLowerCase('bg-BG')))
  async function addTopic() {
    if (saving || !subject.trim() || !value.trim()) return
    setSaving(true)
    setSaveError('')
    try {
      await saveTopic(subject, level, value)
      setRevision(current => current + 1)
      notify('Темата е запазена в личния ти списък.')
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Темата не може да бъде запазена.')
    } finally {
      setSaving(false)
    }
  }
  const selectedPersonalTopic = personal.find(topic => subjectKey(topic) === subjectKey(value))
  return <div className="ws-subject-field">
    <label htmlFor={`${id}-input`}>Тема</label>
    <div className="ws-subject-control">
      <div className="ws-topic-picker" onBlur={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}>
        <input id={`${id}-input`} required type="text" autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={open}
          aria-controls={open ? `${id}-results` : undefined} value={value} maxLength={190} disabled={disabled || (requireSubject && !subject.trim())}
          placeholder={subject ? 'Търси или въведи тема' : 'Първо избери дисциплина'} aria-describedby={`${id}-hint`}
          onFocus={() => setOpen(true)} onChange={event => { onChange(event.target.value); setOpen(true) }}
          onKeyDown={event => {
            if (event.key === 'Escape') setOpen(false)
            else if (event.key === 'Enter' && open && matches[0]) { event.preventDefault(); onChange(matches[0]); setOpen(false) }
          }} />
        {subject.trim() && <button type="button" className="icon-button ws-topic-list-button" aria-label="Покажи темите" title="Покажи темите" aria-expanded={open} disabled={disabled || (requireSubject && !subject.trim())} onMouseDown={event => event.preventDefault()} onClick={() => setOpen(value => !value)}><ChevronDown size={17} aria-hidden="true" /></button>}
        {open && !disabled && subject.trim() && <div className="ws-subject-picker-results" id={`${id}-results`} role="listbox" aria-label="Теми по дисциплината">
          {matches.map(topic => <button type="button" role="option" aria-selected={subjectKey(value) === subjectKey(topic)} key={topic} onMouseDown={event => event.preventDefault()} onClick={() => { onChange(topic); setOpen(false) }}>{topic}</button>)}
          {!matches.length && <p>Няма намерени теми. Можеш да въведеш нова.</p>}
        </div>}
      </div>
      {subject.trim() && <button type="button" className="icon-button" aria-label="Запази темата лично" title={value.trim() ? 'Запази темата лично' : 'Въведи тема, за да я запазиш лично'} disabled={disabled || saving || !value.trim()} onClick={() => void addTopic()}><Plus size={18} aria-hidden="true" /></button>}
      {selectedPersonalTopic && <DeleteConfirmationButton
        label={`Изтрий темата ${selectedPersonalTopic}`}
        title="Изтриване на тема"
        description={<>Да изтрия ли личната тема <strong>{selectedPersonalTopic}</strong> от дисциплината <strong>{subject}</strong>{level ? <> за клас <strong>{level}</strong></> : ' без зададен клас'}?</>}
        successMessage="Темата е изтрита от личния ти списък."
        disabled={disabled}
        onConfirm={async () => {
          await deleteTopic(subject, level, selectedPersonalTopic)
          onChange('')
          setRevision(current => current + 1)
        }}
      />}
    </div>
    <p id={`${id}-hint`} className="ws-topic-hint">{!subject ? 'Избери дисциплина за предложения на теми.' : failed ? 'Темите не могат да се заредят. Можеш да въведеш нова.' : 'Теми от общия каталог и от твоите тестове. Можеш да въведеш и нова.'}</p>
    {saveError && <p className="error" role="alert">{saveError}</p>}
    {failed && <button type="button" className="ws-text-button" disabled={disabled} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} aria-hidden="true" />Опитай отново</button>}
  </div>
}
