import { createContext, useContext } from 'react'
import type { Assessment } from './types'

export interface Subject { name: string; preset: boolean; personal?: boolean }
export interface SyllabusDraft { fileName: string; subject: string; topics: string[] }
export interface SavedSyllabus { subject: Subject; topics: string[] }
export const normalizeSubject = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
export const subjectKey = (value: string) => normalizeSubject(value).toLocaleLowerCase('bg-BG')
export function assessmentSubject(test: Assessment): string {
  if (typeof test.subject === 'string') return normalizeSubject(test.subject)
  // Compatibility with cached responses from deployments without subject metadata.
  try { return normalizeSubject(JSON.parse(test.definition_json || '{}').subject || '') } catch { return '' }
}
export function assessmentLevel(test: Assessment): string {
  if (typeof test.level === 'string') return test.level
  try { return JSON.parse(test.definition_json || '{}').level || '' } catch { return '' }
}
export const gradeLabel = (value: string) => /^(?:[1-9]|1[0-2])$/.test(value) ? `${value}. клас` : value
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
  deleteSubject: (name: string) => Promise<void>
  loadTopics: (subject: string, level: string) => Promise<string[]>
  loadPersonalTopics: (subject: string, level: string) => Promise<string[]>
  saveTopic: (subject: string, level: string, name: string) => Promise<{ name: string }>
  deleteTopic: (subject: string, level: string, name: string) => Promise<void>
  importSyllabus: (fileName: string, base64: string) => Promise<SyllabusDraft>
  saveSyllabus: (subject: string, topics: string[]) => Promise<SavedSyllabus>
  refreshTopics: () => void
}
export const SubjectCatalogContext = createContext<SubjectCatalogValue | null>(null)
export function useSubjectCatalog() {
  const catalog = useContext(SubjectCatalogContext)
  if (!catalog) throw new Error('Subject catalog is unavailable.')
  return catalog
}
