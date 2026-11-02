import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { WorkspaceApi } from './api'
import { mergeSubjects, SubjectCatalogContext } from './subjects'
import type { Subject } from './subjects'

export function SubjectCatalogProvider({ api, children }: { api: WorkspaceApi; children: ReactNode }) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
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
  async function create(name: string) {
    const subject = await api.post<Subject>('/subjects', { name })
    if (mounted.current) { setSubjects(previous => mergeSubjects([...previous, subject])); setError('') }
    return subject
  }
  return <SubjectCatalogContext.Provider value={{ subjects, loading, error, reload, create }}>{children}</SubjectCatalogContext.Provider>
}
