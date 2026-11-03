import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { WorkspaceApi } from './api'
import { mergeSubjects, SubjectCatalogContext } from './subjects'
import type { Subject } from './subjects'
import type { SavedSyllabus, SyllabusDraft } from './subjects'

export function SubjectCatalogProvider({ api, children }: { api: WorkspaceApi; children: ReactNode }) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [topicRevision, setTopicRevision] = useState(0)
  const mounted = useRef(false)
  const sequence = useRef(0)
  useEffect(() => {
    mounted.current = true
    const request = ++sequence.current
    api.get<Subject[]>('/subjects').then(values => {
      if (mounted.current && request === sequence.current) { setSubjects(mergeSubjects(values)); setError('') }
    }).catch(() => {
      if (mounted.current && request === sequence.current) setError('Дисциплините не могат да бъдат заредени. Опитайте отново.')
    }).finally(() => { if (mounted.current && request === sequence.current) setLoading(false) })
    return () => { mounted.current = false; sequence.current += 1 }
  }, [api, revision])
  const reload = useCallback(() => { setLoading(true); setRevision(value => value + 1) }, [])
  const loadTopics = useCallback((subject: string, level: string) => api.get<string[]>(`/subjects/topics?${new URLSearchParams({ subject, level })}`), [api, topicRevision])
  const loadPersonalTopics = useCallback((subject: string, level: string) => api.get<string[]>(`/subjects/topics/personal?${new URLSearchParams({ subject, level })}`), [api, topicRevision])
  const saveTopic = useCallback((subject: string, level: string, name: string) =>
    api.post<{ name: string }>('/subjects/topics', { subject, level, name }), [api])
  const deleteTopic = useCallback(async (subject: string, level: string, name: string) => {
    await api.remove(`/subjects/topics?${new URLSearchParams({ subject, level, name })}`)
    setTopicRevision(value => value + 1)
  }, [api])
  const importSyllabus = useCallback((fileName: string, base64: string) =>
    api.post<SyllabusDraft>('/subjects/syllabus-import', { fileName, base64 }), [api])
  const saveSyllabus = useCallback(async (subject: string, topics: string[]) => {
    const saved = await api.post<SavedSyllabus>('/subjects/syllabus-import/confirm', { subject, topics })
    setSubjects(previous => mergeSubjects([...previous, saved.subject]))
    setError('')
    setTopicRevision(value => value + 1)
    return saved
  }, [api])
  const refreshTopics = useCallback(() => setTopicRevision(value => value + 1), [])
  async function create(name: string) {
    const subject = await api.post<Subject>('/subjects', { name })
    if (mounted.current) { setSubjects(previous => mergeSubjects([...previous, subject])); setError('') }
    return subject
  }
  const deleteSubject = useCallback(async (name: string) => {
    await api.remove(`/subjects?${new URLSearchParams({ name })}`)
    if (mounted.current) setSubjects(previous => previous.filter(subject => subject.name.toLocaleLowerCase('bg-BG') !== name.toLocaleLowerCase('bg-BG')))
    setTopicRevision(value => value + 1)
  }, [api])
  return <SubjectCatalogContext.Provider value={{ subjects, loading, error, reload, create, deleteSubject, loadTopics, loadPersonalTopics, saveTopic, deleteTopic, importSyllabus, saveSyllabus, refreshTopics }}>{children}</SubjectCatalogContext.Provider>
}
