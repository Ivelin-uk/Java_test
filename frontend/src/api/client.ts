import type {
  AttemptResult,
  AuthResponse,
  CreatorResult,
  DashboardStats,
  PublicTest,
  TestDetail,
  TestRequest,
  TestSummary,
  User,
  UserEdit,
  PasswordResponse,
  PermissionRow,
  PermissionChange,
  AuditEntry,
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
    if (response.status === 401 && token) window.dispatchEvent(new CustomEvent('quicktest:session-expired', { detail: token }))
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
  me: (token: string) => request<User>('/api/auth/me', {}, token),
  logout: (token: string) => request<void>('/api/auth/logout', { method: 'POST' }, token),
  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    request<AuthResponse>('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }, token),
  users: (token: string) => request<User[]>('/api/admin/users', {}, token),
  createUser: (token: string, payload: UserEdit) => request<PasswordResponse>('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) }, token),
  updateUser: (token: string, id: number, payload: UserEdit) => request<User>(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }, token),
  resetPassword: (token: string, id: number) => request<PasswordResponse>(`/api/admin/users/${id}/reset-password`, { method: 'POST' }, token),
  permissions: (token: string) => request<PermissionRow[]>('/api/admin/permissions', {}, token),
  updatePermissions: (token: string, changes: PermissionChange[]) => request<PermissionRow[]>('/api/admin/permissions', { method: 'PUT', body: JSON.stringify({ changes }) }, token),
  audit: (token: string) => request<AuditEntry[]>('/api/admin/audit', {}, token),
  studentTests: (token: string) => request<TestSummary[]>('/api/student/tests', {}, token),
  studentResults: (token: string) => request<CreatorResult[]>('/api/student/results', {}, token),
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
  publicTest: (token: string, code: string) => request<PublicTest>(`/api/public/tests/${code}`, {}, token),
  submitAttempt: (token: string, code: string, payload: unknown) =>
    request<AttemptResult>(`/api/public/tests/${code}/attempts`, { method: 'POST', body: JSON.stringify(payload) }, token),
}
