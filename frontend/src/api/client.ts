import type {
  AttemptResult,
  AuthResponse,
  CreatorResult,
  DashboardStats,
  PublicTest,
  TestDetail,
  TestRequest,
  TestSummary,
} from '../types/models'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'

export class ApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (!response.ok) {
    const text = await response.text()
    let message = text || `Неуспешна заявка (${response.status}).`
    try {
      const problem = JSON.parse(text) as { detail?: string; message?: string; title?: string }
      message = problem.detail || problem.message || problem.title || message
    } catch {
      // Some upstream errors return plain text rather than a JSON problem.
    }
    throw new ApiError(message, response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  register: (name: string, email: string, password: string) =>
    request<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  dashboard: (token: string) => request<DashboardStats>('/api/dashboard', {}, token),
  tests: (token: string) => request<TestSummary[]>('/api/tests', {}, token),
  test: (token: string, id: number) => request<TestDetail>(`/api/tests/${id}`, {}, token),
  createTest: (token: string, test: TestRequest) =>
    request<TestDetail>('/api/tests', { method: 'POST', body: JSON.stringify(test) }, token),
  updateTest: (token: string, id: number, test: TestRequest) =>
    request<TestDetail>(`/api/tests/${id}`, { method: 'PUT', body: JSON.stringify(test) }, token),
  deleteTest: (token: string, id: number) => request<void>(`/api/tests/${id}`, { method: 'DELETE' }, token),
  publish: (token: string, id: number) =>
    request<{ publicCode: string; publicUrl: string }>(`/api/tests/${id}/publish`, { method: 'POST' }, token),
  generateTest: (token: string, payload: { topic: string; instructions: string; language: string; questionCount: number; difficulty: string }) =>
    request<{ test: TestRequest; model: string; inputTokens: number; outputTokens: number }>('/api/ai/generate-test', { method: 'POST', body: JSON.stringify(payload) }, token),
  results: (token: string) => request<CreatorResult[]>('/api/tests/results', {}, token),
  publicTest: (code: string) => request<PublicTest>(`/api/public/tests/${code}`),
  submitAttempt: (code: string, payload: unknown) =>
    request<AttemptResult>(`/api/public/tests/${code}/attempts`, { method: 'POST', body: JSON.stringify(payload) }),
}
