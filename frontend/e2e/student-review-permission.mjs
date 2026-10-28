import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const teacher = { token: 'review-teacher-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true } }
const student = { token: 'review-student-fixture', user: { id: 102, name: 'Мария', email: 'student@example.test', role: 'STUDENT', active: true } }
const attempts = [1, 2].map(number => ({ id: 400 + number, assignment_id: 201, student_id: 102, student_name: 'Мария', title: 'Основи на Java', attempt_number: number, status: 'finalized', submitted_at: new Date().toISOString(), student_review_allowed: false }))
const errors = [], writes = []
let solutionsVisible = false, failNext = false, holdNext = false, releaseSave
const result = attempt => ({ id: attempt.id * 10, attempt_id: attempt.id, assignment_id: 201, title: attempt.title, attempt_number: attempt.attempt_number, revision_number: 1, points: 1, maximum_points: 2, percentage: 50, grade: '3', outcome: 'passed', review_available: attempt.student_review_allowed })
const detail = attempt => ({ ...result(attempt), ...(attempt.student_review_allowed ? { details: { correctAnswersVisible: solutionsVisible, gradeOverridden: false, outcomeOverridden: false, questions: [
  { id: 501, status: 'answered', maximum_points: 1, final_points: 1, answer_json: JSON.stringify({ optionIds: ['a'], text: '' }), definition_json: JSON.stringify({ question: { text: 'Коя стойност е логическа?', acceptedAnswers: [], criteria: '', explanation: solutionsVisible ? 'Обяснение на верния отговор' : '' }, options: [{ id: 'a', text: 'true', ...(solutionsVisible ? { correct: true } : {}) }, { id: 'b', text: '42', ...(solutionsVisible ? { correct: false } : {}) }] }) },
  { id: 502, status: 'answered', maximum_points: 1, final_points: 0, answer_json: JSON.stringify({ optionIds: [], text: 'Моят свободен отговор' }), definition_json: JSON.stringify({ question: { text: 'Обяснете понятието клас.', acceptedAnswers: solutionsVisible ? ['Описание на обекти'] : [], criteria: '', explanation: '' }, options: [] }) },
] } } : {}) })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  async function session(auth) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
    // Fixtures intercept every API route; real accounts and results are untouched.
    await context.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      if (!path.startsWith('/api/')) return route.continue()
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (method === 'GET') {
        const data = { '/api/auth/me': auth.user, '/api/v1/groups': [], '/api/v1/assignments': [], '/api/v1/grading': attempts, '/api/v1/attempts': attempts, '/api/v1/results': attempts.map(result) }
        if (Object.hasOwn(data, path)) return respond(data[path])
        const match = path.match(/^\/api\/v1\/results\/(401|402)$/)
        if (match) return respond(detail(attempts.find(attempt => attempt.id === Number(match[1]))))
        if (path === '/api/v1/attempts/401/review') return respond({ attempt: attempts[0], student: student.user, questions: [], events: [], revisions: [] })
      }
      if (method === 'PUT' && path === '/api/v1/attempts/401/student-review') {
        assert.equal(auth.user.role, 'TEACHER')
        writes.push(request.postDataJSON())
        if (failNext) { failNext = false; return respond({ detail: 'Промяната не успя. Опитайте отново.' }, 409) }
        if (holdNext) { holdNext = false; await new Promise(resolve => { releaseSave = resolve }) }
        attempts[0].student_review_allowed = request.postDataJSON().allowed
        return route.fulfill({ status: 200, body: '' })
      }
      errors.push(`Unexpected API: ${method} ${path}`)
      return respond({ detail: 'Unexpected API' }, 404)
    })
    const nextPage = await context.newPage()
    nextPage.on('pageerror', error => errors.push(error.message))
    return nextPage
  }
  const learner = await session(student)
  page = learner
  await learner.goto(frontend)
  await learner.getByRole('button', { name: 'Моите тестове', exact: true }).click()
  await learner.getByRole('tab', { name: 'Резултати', exact: true }).click()
  const history = learner.getByRole('table', { name: 'Опити и резултати', exact: true })
  await history.getByText('50.00%', { exact: true }).first().waitFor()
  assert.equal(await history.getByRole('button', { name: 'Преглед на резултата', exact: true }).count(), 0)
  await learner.goto(`${frontend}/results/401`)
  await learner.getByText('Учителят не е разрешил преглед на теста и отговорите за този опит.', { exact: true }).waitFor()
  assert.equal(await learner.getByText('Коя стойност е логическа?', { exact: true }).count(), 0)
  await learner.getByRole('button', { name: 'Към моите тестове', exact: true }).click()

  page = await session(teacher)
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Проверка', exact: true }).click()
  const toggle = page.getByRole('checkbox', { name: 'Разреши преглед за Мария · Опит 1', exact: true })
  await toggle.waitFor();assert.equal(await toggle.isChecked(), false)
  failNext = true
  await toggle.click()
  await page.getByRole('alert').getByText('Промяната не успя. Опитайте отново.', { exact: true }).waitFor()
  assert.equal(await toggle.isChecked(), false)
  holdNext = true
  const saving = page.waitForRequest(request => request.method() === 'PUT')
  await toggle.click();await saving
  assert.equal(await toggle.isDisabled(), true)
  releaseSave()
  await page.getByText('Прегледът е разрешен за ученика.', { exact: true }).waitFor()
  assert.equal(await toggle.isChecked(), true)
  assert.equal(await page.getByRole('checkbox', { name: 'Разреши преглед за Мария · Опит 2', exact: true }).isChecked(), false)
  await learner.getByRole('button', { name: 'Обнови', exact: true }).click()
  await history.getByRole('button', { name: 'Преглед на резултата', exact: true }).waitFor()
  assert.equal(await history.getByRole('button', { name: 'Преглед на резултата', exact: true }).count(), 1)
  await history.getByRole('button', { name: 'Преглед на резултата', exact: true }).click()
  await learner.getByText('Моят свободен отговор', { exact: true }).waitFor()
  await learner.getByText('Твоят избор', { exact: true }).waitFor()
  assert.equal(await learner.getByText('Верен отговор / критерии', { exact: true }).count(), 0)
  assert.equal(await learner.getByText('Обяснение на верния отговор', { exact: true }).count(), 0)
  await learner.getByText('Верните отговори ще бъдат достъпни след крайния срок на възлагането.', { exact: true }).waitFor()
  for (const width of [1440, 320]) {
    await learner.setViewportSize({ width, height: 1000 })
    assert.equal(await learner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await learner.screenshot({ path: new URL(`student-review-${width}.png`, artifacts).pathname, fullPage: true })
  }
  solutionsVisible = true
  await learner.getByRole('button', { name: 'Към моите тестове', exact: true }).click()
  await history.getByRole('button', { name: 'Преглед на резултата', exact: true }).click()
  await learner.getByText('Обяснение на верния отговор', { exact: true }).waitFor()
  assert.equal(await learner.getByText('Верен отговор / критерии', { exact: true }).count(), 2)
  await page.reload()
  await page.getByRole('button', { name: 'Проверка', exact: true }).click()
  assert.equal(await toggle.isChecked(), true)
  await page.getByRole('button', { name: 'Мария', exact: true }).first().click()
  const reviewToggle = page.getByRole('checkbox', { name: 'Разреши на ученика да вижда теста и отговорите си', exact: true })
  await reviewToggle.waitFor();assert.equal(await reviewToggle.isChecked(), true)
  await reviewToggle.click()
  await page.getByText('Прегледът е скрит за ученика.', { exact: true }).waitFor()
  await learner.reload()
  await learner.getByText('Учителят не е разрешил преглед на теста и отговорите за този опит.', { exact: true }).waitFor()
  assert.equal(await learner.getByText('Моят свободен отговор', { exact: true }).count(), 0)
  await learner.getByRole('button', { name: 'Към моите тестове', exact: true }).click()
  await history.getByRole('button', { name: 'Преглед на резултата', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await history.getByRole('button', { name: 'Преглед на резултата', exact: true }).count(), 0)
  assert.equal(await learner.getByText('Моят свободен отговор', { exact: true }).count(), 0)
  await history.getByText('50.00%', { exact: true }).first().waitFor()
  assert.equal(await history.getByText('50.00%', { exact: true }).count(), 2)
  assert.deepEqual(writes, [{ allowed: true }, { allowed: true }, { allowed: false }])
  assert.deepEqual(errors, [])
  console.log('Passed: hidden by default, direct link denies test content, per-attempt teacher checkbox, save failure/retry, busy state, persistent permission, own selected/written answers, solution deadline, revocation hides button/content while grades remain, desktop/mobile. API fixtures only.')
} catch (error) {
  console.error('Fixture API/page errors:', errors)
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('student-review-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  await browser.close()
}
