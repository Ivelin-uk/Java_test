export type QuestionType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'OPEN_ANSWER'
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'MIXED'
export type TestStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT'
export type Subscription = { paid: boolean; paidUntil: string | null; paidAt: string | null; active: boolean }
export type User = {
  id: number; name: string; email: string; role: Role; active: boolean; passwordChangeRequired: boolean
  subscription: Subscription; allowedMethods: string[]; subscriptionMethods: string[]
}
export type AuthResponse = { token: string; user: User }
export type UserEdit = {
  name: string; email: string; role: Role; active: boolean; subscriptionPaid: boolean; subscriptionPaidUntil: string | null
}
export type PasswordResponse = { user: User; temporaryPassword: string }
export type Grant = { allowed: boolean; subscriptionRequired: boolean }
export type PermissionRow = {
  key: string; controller: string; method: string; httpMethods: string[]; paths: string[]
  mode: 'MANAGED' | 'PUBLIC' | 'PROFILE' | 'ADMIN'; teacher: Grant; student: Grant
}
export type PermissionChange = Grant & { key: string; role: 'TEACHER' | 'STUDENT' }
export type AuditEntry = { id: number; actorEmail: string; targetEmail: string | null; action: string; details: string; createdAt: string }

export type AnswerInput = { answer: string; correct: boolean }
export type QuestionInput = {
  type: QuestionType
  question: string
  difficulty: Difficulty
  points: number
  explanation: string
  answers: AnswerInput[]
}

export type TestRequest = {
  title: string
  description: string
  language: string
  durationMinutes: number | null
  questionOrderRandom: boolean
  answerOrderRandom: boolean
  showResult: boolean
  showAnswers: boolean
  questions: QuestionInput[]
}

export type TestSummary = {
  id: number
  title: string
  description: string
  language: string
  status: TestStatus
  publicCode: string | null
  questionCount: number
  updatedAt: string
}

export type TestDetail = TestRequest & {
  id: number
  status: TestStatus
  publicCode: string | null
}

export type PublicTest = {
  title: string
  description: string
  durationMinutes: number | null
  showResult: boolean
  showAnswers: boolean
  questions: Array<{
    id: number
    type: QuestionType
    question: string
    points: number
    answers: Array<{ id: number; answer: string }>
  }>
}

export type AttemptResult = {
  attemptId: number
  participantName: string
  score: number
  maxScore: number
  percentage: number
  grade: string
  submittedAt: string
}

export type CreatorResult = AttemptResult & {
  testId: number
  testTitle: string
  participantEmail?: string
}

export type DashboardStats = {
  totalTests: number
  activeTests: number
  draftTests: number
  attempts: number
  aiGenerations: number
}
