import type { Definition, QuestionType } from './types'

export const questionTypes: [QuestionType, string][] = [['SINGLE_CHOICE', 'Един верен отговор'], ['MULTIPLE_CHOICE', 'Няколко верни'], ['TRUE_FALSE', 'Вярно / невярно'], ['SHORT_ANSWER', 'Кратък текст'], ['OPEN_ANSWER', 'Свободен отговор']]
export const difficulties: Record<string, string> = { EASY: 'Лесни', MEDIUM: 'Средни', HARD: 'Трудни', VERY_HARD: 'Много трудни', MIXED: 'По разпределение' }

export interface AiSettings {
  topic: string
  subject: string
  questionCount: number
  difficulty: string
  gradingScale: string
  passThreshold: number
  questionTypes: QuestionType[]
  difficultyCounts: Record<string, number>
  includeImages: boolean
  imageCount: number
  additionalInformation: string
  sourceMaterial: { fileName: string; sourceText: string; characterCount: number } | null
  useSourceMaterial: boolean
  sourceMaterialLoading: boolean
  sourceMaterialError: string
}

export function newAiSettings(definition?: Definition, count = 5): AiSettings {
  const selectedTypes = [...new Set(definition?.questions.map(q => q.type))]
  const difficulty = definition?.questions.at(-1)?.difficulty ?? 'MEDIUM'
  return {
    topic: definition?.title ?? '', subject: definition?.subject ?? '', questionCount: count,
    gradingScale: definition?.gradingScale ?? 'bulgarian', passThreshold: definition?.passThreshold ?? 50,
    difficulty, questionTypes: selectedTypes.length ? selectedTypes : ['SINGLE_CHOICE'],
    difficultyCounts: definition ? { EASY: 0, MEDIUM: 0, HARD: 0, VERY_HARD: 0, [difficulty]: count } : { EASY: 2, MEDIUM: 2, HARD: 1, VERY_HARD: 0 },
    includeImages: false, imageCount: 1, additionalInformation: definition?.additionalInformation ?? '',
    sourceMaterial: null, useSourceMaterial: false, sourceMaterialLoading: false, sourceMaterialError: '',
  }
}

export function requestedImages(settings: AiSettings) {
  return settings.includeImages ? Math.min(settings.imageCount, settings.questionCount) : 0
}

export function validDistribution(settings: AiSettings) {
  return settings.difficulty !== 'MIXED' || Object.values(settings.difficultyCounts).every(value => Number.isInteger(value) && value >= 0 && value <= 20) && Object.values(settings.difficultyCounts).reduce((sum, value) => sum + value, 0) === settings.questionCount
}

export function validAiSettings(settings: AiSettings, maximum = 20) {
  return ['bulgarian', 'percentage', 'pass_fail'].includes(settings.gradingScale) && Number.isFinite(settings.passThreshold) && settings.passThreshold >= 0 && settings.passThreshold <= 100 && !settings.sourceMaterialLoading && (!settings.useSourceMaterial || !!settings.sourceMaterial?.sourceText.trim()) && !!settings.topic.trim() && settings.topic.trim().length <= 190 && settings.questionTypes.length > 0 && Number.isInteger(settings.questionCount) && settings.questionCount >= 1 && settings.questionCount <= maximum && validDistribution(settings) && (!settings.includeImages || Number.isInteger(requestedImages(settings)) && requestedImages(settings) >= 1)
}

export function generationPayload(settings: AiSettings) {
  return {
    requestKey: crypto.randomUUID(), topic: settings.topic.trim(), subject: settings.subject,
    questionCount: settings.questionCount, difficulty: settings.difficulty, questionTypes: settings.questionTypes,
    difficultyCounts: settings.difficulty === 'MIXED' ? settings.difficultyCounts : { [settings.difficulty]: settings.questionCount },
    additionalInformation: settings.additionalInformation.trim(), imageCount: requestedImages(settings),
    sourceOnly: !!(settings.useSourceMaterial && settings.sourceMaterial),
    ...(settings.useSourceMaterial && settings.sourceMaterial ? { sourceText: settings.sourceMaterial.sourceText } : {}),
  }
}
