import { createContext, useContext } from 'react'
import type { Assessment } from './types'

export interface Subject { name: string; preset: boolean }
export const normalizeSubject = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
export const subjectKey = (value: string) => normalizeSubject(value).toLocaleLowerCase('bg-BG')
export function assessmentSubject(test: Assessment): string {
  if (typeof test.subject === 'string') return normalizeSubject(test.subject)
  // Compatibility with cached responses from deployments without subject metadata.
  try { return normalizeSubject(JSON.parse(test.definition_json || '{}').subject || '') } catch { return '' }
}
export function mergeSubjects(values: Subject[]): Subject[] {
  const unique = new Map<string, Subject>()
  for (const value of values) if (value.name.trim() && !unique.has(subjectKey(value.name))) unique.set(subjectKey(value.name), value)
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'bg'))
}
export interface SubjectCatalogValue {
  subjects: Subject[]
  loading: boolean
  error: string
  reload: () => void
  create: (name: string) => Promise<Subject>
}
export const SubjectCatalogContext = createContext<SubjectCatalogValue | null>(null)
export function useSubjectCatalog() {
  const catalog = useContext(SubjectCatalogContext)
  if (!catalog) throw new Error('Subject catalog is unavailable.')
  return catalog
}
