import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { BookOpen, LoaderCircle, Pencil, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-react'
import { api } from '../api/client'
import type { CatalogSubject, CatalogTopic } from '../types/catalog'
import { useNotifications } from '../notifications'
import { GradeField } from '../workspace/GradeField'
import { TableContainer } from '../workspace/ui'
import { DeleteConfirmationDialog } from './DeleteConfirmationDialog'

type Editor = { kind: 'subject'; item?: CatalogSubject } | { kind: 'topic'; subject: CatalogSubject; item?: CatalogTopic }
type Removal = { kind: 'subject'; item: CatalogSubject } | { kind: 'topic'; subject: CatalogSubject; item: CatalogTopic }
type TopicResult = { subjectId: number | null; data: CatalogTopic[]; loading: boolean; error: string }
const sortedSubjects = (items: CatalogSubject[]) => [...items].sort((a, b) => a.name.localeCompare(b.name, 'bg'))
const sortedTopics = (items: CatalogTopic[]) => [...items].sort((a, b) => a.name.localeCompare(b.name, 'bg') || Number(a.level) - Number(b.level))
const detail = (cause: unknown) => cause instanceof Error ? cause.message : 'Неуспешно действие. Опитайте отново.'

export function AdminSubjects({ token, revision, onBusy, onChanged }: { token: string; revision: number; onBusy: (busy: boolean) => void; onChanged: () => void }) {
  const [subjects, setSubjects] = useState<CatalogSubject[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [subjectRevision, setSubjectRevision] = useState(0)
  const [topicRevision, setTopicRevision] = useState(0)
  const [topicResult, setTopicResult] = useState<TopicResult>({ subjectId: null, data: [], loading: false, error: '' })
  const [subjectSearch, setSubjectSearch] = useState('')
  const [topicSearch, setTopicSearch] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [removal, setRemoval] = useState<Removal | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const notify = useNotifications()

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; onBusy(false) }
  }, [onBusy])

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    api.catalogSubjects(token).then(items => {
      if (!active) return
      setSubjects(sortedSubjects(items))
      setSelectedId(current => items.some(item => item.id === current) ? current : sortedSubjects(items)[0]?.id ?? null)
    }).catch(cause => { if (active) setError(detail(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token, revision, subjectRevision])

  useEffect(() => {
    if (selectedId === null) return
    let active = true
    setTopicResult({ subjectId: selectedId, data: [], loading: true, error: '' })
    api.catalogTopics(token, selectedId).then(items => {
      if (active) setTopicResult({ subjectId: selectedId, data: sortedTopics(items), loading: false, error: '' })
    }).catch(cause => { if (active) setTopicResult({ subjectId: selectedId, data: [], loading: false, error: detail(cause) }) })
    return () => { active = false }
  }, [token, selectedId, revision, topicRevision])

  async function mutate(work: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); onBusy(true)
    try { await work() }
    finally { inFlight.current = false; if (mounted.current) { setBusy(false); onBusy(false) } }
  }

  async function save(name: string, level: string) {
    if (!editor) return
    await mutate(async () => {
      if (editor.kind === 'subject') {
        const saved = editor.item ? await api.updateCatalogSubject(token, editor.item.id, name) : await api.createCatalogSubject(token, name)
        if (!mounted.current) return
        setSubjects(current => sortedSubjects([...current.filter(item => item.id !== saved.id), saved]))
        setSelectedId(saved.id); setSubjectSearch(''); setTopicSearch('')
        notify(editor.item ? 'Дисциплината е обновена.' : 'Дисциплината е добавена в общия каталог.')
      } else {
        const subjectId = editor.subject.id
        const saved = editor.item ? await api.updateCatalogTopic(token, subjectId, editor.item.id, name, level) : await api.createCatalogTopic(token, subjectId, name, level)
        if (!mounted.current) return
        const topics = sortedTopics([...topicResult.data.filter(item => item.id !== saved.id), saved])
        setTopicResult({ subjectId, data: topics, loading: false, error: '' })
        setSubjects(current => current.map(item => item.id === subjectId ? { ...item, topicCount: topics.length } : item))
        setTopicSearch('')
        notify(editor.item ? 'Темата е обновена.' : 'Темата е добавена към дисциплината.')
      }
      onChanged()
    })
  }

  async function remove() {
    if (!removal) return
    await mutate(async () => {
      if (removal.kind === 'subject') {
        await api.deleteCatalogSubject(token, removal.item.id)
        if (!mounted.current) return
        const remaining = subjects.filter(item => item.id !== removal.item.id)
        setSubjects(remaining)
        setSelectedId(current => current === removal.item.id ? remaining[0]?.id ?? null : current)
      } else {
        await api.deleteCatalogTopic(token, removal.subject.id, removal.item.id)
        if (!mounted.current) return
        const topics = topicResult.data.filter(item => item.id !== removal.item.id)
        setTopicResult({ subjectId: removal.subject.id, data: topics, loading: false, error: '' })
        setSubjects(current => current.map(item => item.id === removal.subject.id ? { ...item, topicCount: topics.length } : item))
      }
      onChanged()
    })
  }

  const selected = subjects.find(item => item.id === selectedId)
  const topicLoading = !!selected && (topicResult.subjectId !== selectedId || topicResult.loading)
  const topicError = topicResult.subjectId === selectedId ? topicResult.error : ''
  const topics = topicResult.subjectId === selectedId ? topicResult.data : []
  const visibleSubjects = subjects.filter(item => item.name.toLocaleLowerCase('bg').includes(subjectSearch.trim().toLocaleLowerCase('bg')))
  const visibleTopics = topics.filter(item => item.name.toLocaleLowerCase('bg').includes(topicSearch.trim().toLocaleLowerCase('bg')))

  return <div className="admin-subjects">
    <p className="admin-catalog-intro">Общ каталог за всички учители. Изберете дисциплина, за да управлявате темите към нея. Промените в каталога запазват съдържанието на съществуващите тестове.</p>
    <div className="admin-catalog-grid">
      <section className="admin-catalog-section" aria-label="Дисциплини">
        <div className="admin-catalog-heading"><h2><BookOpen size={20} aria-hidden="true" />Дисциплини <span className="count-label">{subjects.length}</span></h2><button type="button" className="primary command-button" disabled={busy || loading} onClick={() => setEditor({ kind: 'subject' })}><Plus size={17} aria-hidden="true" />Добави дисциплина</button></div>
        <label className="admin-catalog-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Търси дисциплина" placeholder="Търси дисциплина" value={subjectSearch} onChange={event => setSubjectSearch(event.target.value)} /></label>
        {loading && <p role="status">Зареждане на дисциплините…</p>}
        {error && <div className="admin-catalog-error"><p className="error" role="alert">{error}</p><button type="button" className="command-button" disabled={busy || loading} onClick={() => setSubjectRevision(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Зареди дисциплините</button></div>}
        <TableContainer label="Каталог с дисциплини — таблица"><table className="ws-table data-table admin-catalog-table" aria-label="Дисциплини"><thead><tr><th>Дисциплина</th><th>Теми</th><th>Действия</th></tr></thead><tbody>{visibleSubjects.map(subject => <tr key={subject.id} aria-selected={subject.id === selectedId}>
          <td><button type="button" className="admin-catalog-select" aria-label={`Избери дисциплина ${subject.name}`} aria-pressed={subject.id === selectedId} disabled={busy} onClick={() => { setSelectedId(subject.id); setTopicSearch('') }}>{subject.name}</button></td><td>{subject.topicCount}</td>
          <td><div className="admin-catalog-actions"><button type="button" className="icon-button" aria-label={`Редактирай дисциплина ${subject.name}`} title="Редактирай дисциплината" disabled={busy || loading} onClick={() => setEditor({ kind: 'subject', item: subject })}><Pencil size={16} /></button><button type="button" className="icon-button danger" aria-label={`Изтрий дисциплина ${subject.name}`} title="Изтрий дисциплината" disabled={busy || loading} onClick={() => setRemoval({ kind: 'subject', item: subject })}><Trash2 size={16} /></button></div></td>
        </tr>)}{!loading && !error && !visibleSubjects.length && <tr><td colSpan={3} className="empty-cell">{subjectSearch ? 'Няма дисциплини според търсенето.' : 'Все още няма дисциплини. Добавете първата.'}</td></tr>}</tbody></table></TableContainer>
      </section>
      <section className="admin-catalog-section" aria-label="Теми">
        <div className="admin-catalog-heading"><h2>{selected ? `Теми към „${selected.name}“` : 'Теми'} {selected && <span className="count-label">{topics.length}</span>}</h2><button type="button" className="primary command-button" disabled={busy || !selected || topicLoading || !!topicError} onClick={() => selected && setEditor({ kind: 'topic', subject: selected })}><Plus size={17} aria-hidden="true" />Добави тема</button></div>
        {!selected ? <p className="muted">Изберете дисциплина от списъка.</p> : <>
          <label className="admin-catalog-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Търси тема" placeholder="Търси тема в дисциплината" value={topicSearch} onChange={event => setTopicSearch(event.target.value)} /></label>
          {topicLoading && <p role="status">Зареждане на темите…</p>}
          {topicError && <div className="admin-catalog-error"><p className="error" role="alert">{topicError}</p><button type="button" className="command-button" disabled={busy || topicLoading} onClick={() => setTopicRevision(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Зареди темите</button></div>}
          <TableContainer label="Теми към дисциплината — таблица"><table className="ws-table data-table admin-catalog-table" aria-label="Теми"><thead><tr><th>Тема</th><th>Клас</th><th>Действия</th></tr></thead><tbody>{visibleTopics.map(topic => <tr key={topic.id}><td>{topic.name}</td><td>{topic.level ? `${topic.level}. клас` : 'Всички класове'}</td><td><div className="admin-catalog-actions"><button type="button" className="icon-button" aria-label={`Редактирай тема ${topic.name}`} title="Редактирай темата" disabled={busy || topicLoading} onClick={() => setEditor({ kind: 'topic', subject: selected, item: topic })}><Pencil size={16} /></button><button type="button" className="icon-button danger" aria-label={`Изтрий тема ${topic.name}`} title="Изтрий темата" disabled={busy || topicLoading} onClick={() => setRemoval({ kind: 'topic', subject: selected, item: topic })}><Trash2 size={16} /></button></div></td></tr>)}{!topicLoading && !topicError && !visibleTopics.length && <tr><td colSpan={3} className="empty-cell">{topicSearch ? 'Няма теми според търсенето.' : 'Все още няма теми към тази дисциплина.'}</td></tr>}</tbody></table></TableContainer>
        </>}
      </section>
    </div>
    {editor && <CatalogEditor value={editor} onCancel={() => setEditor(null)} onSave={save} />}
    {removal && <DeleteConfirmationDialog title={removal.kind === 'subject' ? 'Изтриване на дисциплина' : 'Изтриване на тема'} description={removal.kind === 'subject' ? <>Да изтрием ли „{removal.item.name}“ и всички нейни теми от общия каталог? Съществуващите тестове ще запазят дисциплината и съдържанието си.</> : <>Да изтрием ли темата „{removal.item.name}“ от „{removal.subject.name}“? Съществуващите тестове ще запазят темата и съдържанието си.</>} confirmLabel={removal.kind === 'subject' ? 'Изтрий дисциплината' : 'Изтрий темата'} successMessage={removal.kind === 'subject' ? 'Дисциплината е изтрита от общия каталог.' : 'Темата е изтрита от общия каталог.'} onCancel={() => setRemoval(null)} onConfirm={remove} />}
  </div>
}

function CatalogEditor({ value, onSave, onCancel }: { value: Editor; onSave: (name: string, level: string) => Promise<void>; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)
  const [name, setName] = useState(value.item?.name ?? '')
  const [level, setLevel] = useState(value.kind === 'topic' ? value.item?.level ?? '' : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = useId()
  const title = value.kind === 'subject' ? value.item ? 'Редакция на дисциплина' : 'Нова дисциплина' : value.item ? 'Редакция на тема' : 'Нова тема'
  useEffect(() => {
    const previous = document.activeElement
    const element = dialog.current
    element?.showModal(); nameInput.current?.focus()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  function cancel() { if (!inFlight.current) onCancel() }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current || !name.trim()) return
    inFlight.current = true; setBusy(true); setError('')
    try { await onSave(name.trim(), level); onCancel() }
    catch (cause) { setError(detail(cause)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="admin-dialog admin-catalog-dialog" aria-labelledby={`${id}-title`} aria-busy={busy} onCancel={event => { event.preventDefault(); cancel() }}>
    <h2 id={`${id}-title`}>{title}</h2>
    <p className="muted">{value.kind === 'subject' ? 'Дисциплината ще се предлага на всички учители.' : `Дисциплина: ${value.subject.name}`}</p>
    <form onSubmit={event => void submit(event)}>
      <fieldset disabled={busy}><label>{value.kind === 'subject' ? 'Име на дисциплината' : 'Име на темата'}<input ref={nameInput} required maxLength={190} autoComplete="off" value={name} onChange={event => setName(event.target.value)} /></label>
        {value.kind === 'topic' && <><GradeField value={level} onChange={setLevel} /><p className="muted">Без зададен клас темата се предлага за всички класове.</p></>}
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="command-button" disabled={busy} onClick={cancel}><X size={16} aria-hidden="true" />Отказ</button><button type="submit" className="primary command-button" disabled={busy || !name.trim()}>{busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}{busy ? 'Записване…' : 'Запази'}</button></div>
    </form>
  </dialog>
}
