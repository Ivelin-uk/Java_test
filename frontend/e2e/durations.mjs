import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { formatDuration } from '../src/workspace/duration.ts'

for (const [seconds, expected] of [[0, '0 мин 0 сек'], [9, '0 мин 9 сек'], [59, '0 мин 59 сек'], [60, '1 мин 0 сек'], [61, '1 мин 1 сек'], [105, '1 мин 45 сек'], [330, '5 мин 30 сек'], [410, '6 мин 50 сек'], [3600, '60 мин 0 сек'], [3661, '61 мин 1 сек'], [59.8, '1 мин 0 сек'], [-5, '0 мин 0 сек'], [NaN, '0 мин 0 сек']]) assert.equal(formatDuration(seconds), expected)

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const teacher = { token: 'duration-teacher', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const student = { token: 'duration-student', user: { ...teacher.user, id: 102, name: 'Student', role: 'STUDENT' } }
const question = timeSeconds => ({ type: 'SINGLE_CHOICE', text: 'Логически тип в Java?', difficulty: 'MEDIUM', points: 1, timeSeconds, options: [{ text: 'boolean', correct: true }, { text: 'int', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: '' })
const definition = { title: 'Основи на Java', description: '', subject: 'Java', level: '12', instructions: '', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, questions: [question(330), question(80)] }
const assessment = { id: 201, title: definition.title, owner_id: teacher.user.id, status: 'published', shared: false, definition_json: JSON.stringify(definition), question_count: 2, total_time_seconds: 410, updated_at: new Date().toISOString() }
const assignment = { id: 301, title: definition.title, teacher_id: teacher.user.id, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), max_attempts: 3, canceled: false }
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const errors = [], saved = [], starts = []
let page
try {
  async function open(auth) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
    const current = await context.newPage()
    let examState
    current.on('pageerror', error => errors.push(error.message))
    await current.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (method === 'GET') {
        const data = { '/api/auth/me': auth.user, '/api/v1/assignments': [assignment], '/api/v1/tests': [assessment], [`/api/v1/tests/${assessment.id}`]: assessment, '/api/v1/groups': [], '/api/v1/grading': [], '/api/v1/results': [], '/api/v1/attempts': [],
          [`/api/v1/assignments/${assignment.id}/preflight`]: { ...assignment, total_seconds: 410, question_count: 2, instructions: '', fullscreen_exempt: true } }
        if (Object.hasOwn(data, path)) return respond(data[path])
      }
      if (method === 'PUT' && path === `/api/v1/tests/${assessment.id}`) {
        const body = request.postDataJSON()
        saved.push(body)
        Object.assign(assessment, { definition_json: JSON.stringify(body), total_time_seconds: body.questions.reduce((sum, q) => sum + q.timeSeconds, 0) })
        return respond(assessment)
      }
      if (method === 'POST' && path === `/api/v1/tests/${assessment.id}/publish`) return respond(assessment)
      if (method === 'POST' && path === `/api/v1/assignments/${assignment.id}/code/rotate`) return respond({ code: 'ABCDEFGH' })
      if (method === 'POST' && path === `/api/v1/assignments/${assignment.id}/attempts`) {
        const body = request.postDataJSON()
        if (body.code !== 'ABCDEFGH') return route.fulfill({ status: 400, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'Невалиден или отменен код.' }) })
        starts.push(body)
        const now = await current.evaluate(() => Date.now())
        examState = { id: 401, assignment_id: assignment.id, status: 'in_progress', server_now: new Date(now).toISOString(), question_number: 1, question_count: 2, question: { id: 501, type: 'SINGLE_CHOICE', text: definition.questions[0].text, status: 'open', maximum_points: 1, time_seconds: 60, open_instance: 'timer-instance', opened_at: new Date(now).toISOString(), deadline_at: new Date(now + 60000).toISOString(), options: [{ id: 'a', text: 'boolean' }, { id: 'b', text: 'int' }], draft: null } }
        return respond(examState)
      }
      if (examState && (method === 'PUT' && path === '/api/v1/attempts/401/questions/501/draft' || method === 'GET' && path === '/api/v1/attempts/401/state')) return respond({ ...examState, server_now: new Date(await current.evaluate(() => Date.now())).toISOString() })
      errors.push(`Unexpected API: ${method} ${path}`)
      return route.fulfill({ status: 404 })
    })
    await current.goto(frontend)
    return current
  }
  page = await open(teacher)
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  const library = page.getByRole('table', { name: 'Тестове', exact: true })
  await library.getByText('6 мин 50 сек', { exact: true }).waitFor()
  await library.getByRole('columnheader', { name: 'Време', exact: true }).waitFor()
  await library.getByRole('button', { name: assessment.title, exact: true }).click()
  const preview = page.getByRole('region', { name: 'Избран тест', exact: true })
  await preview.locator('.ws-summary').getByText('6 мин 50 сек', { exact: false }).waitFor()
  const questions = page.getByRole('table', { name: 'Въпроси на избрания тест', exact: true })
  await questions.getByText('5 мин 30 сек', { exact: true }).waitFor()
  await questions.getByText('1 мин 20 сек', { exact: true }).waitFor()
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: new URL(`duration-library-${width}.png`, artifacts).pathname, fullPage: true })
  }
  await preview.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  const minutes = page.getByRole('spinbutton', { name: 'Минути за въпрос 1', exact: true }), seconds = page.getByRole('spinbutton', { name: 'Секунди за въпрос 1', exact: true })
  assert.equal(await minutes.inputValue(), '5'); assert.equal(await seconds.inputValue(), '30')
  await minutes.fill('6'); await seconds.fill('50')
  await page.locator('.ws-editor .ws-summary').getByText('8 мин 10 сек', { exact: false }).waitFor()
  await minutes.fill('0'); await seconds.fill('9')
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await page.getByRole('alert').first().getByText('между 0 мин 10 сек и 60 мин 0 сек', { exact: false }).waitFor()
  assert.equal(saved.length, 0)
  await minutes.fill('60'); await seconds.fill('0')
  assert.equal(await minutes.inputValue(), '60'); assert.equal(await seconds.inputValue(), '0')
  await minutes.fill('6'); await seconds.fill('50')
  await page.screenshot({ path: new URL('duration-editor-320.png', artifacts).pathname, fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await library.getByText('8 мин 10 сек', { exact: true }).waitFor()
  assert.equal(saved.length, 1); assert.equal(saved[0].questions[0].timeSeconds, 410); assert.equal(saved[0].questions[1].timeSeconds, 80)
  await page.getByRole('button', { name: 'Възлагания', exact: true }).click()
  await page.getByRole('combobox', { name: 'Тест', exact: true }).click()
  await page.getByRole('listbox', { name: 'Тестове за възлагане', exact: true }).getByText('8 мин 10 сек', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Нов код', exact: true }).click()
  await page.locator('.ws-code-details').getByText(`${assignment.title} · Възлагане №${assignment.id}`, { exact: true }).waitFor()
  assert.equal(await page.locator('.ws-code output').innerText(), 'ABCDEFGH')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: new URL('access-code-320.png', artifacts).pathname, fullPage: true })
  await page.context().close()

  page = await open(student)
  await page.getByRole('button', { name: 'Моите тестове', exact: true }).click()
  await page.getByRole('button', { name: 'Подготовка', exact: true }).click()
  await page.locator('.exam-preflight').getByText('6 мин 50 сек', { exact: true }).waitFor()
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  await page.clock.install(); await page.clock.pauseAt(new Date())
  await page.getByText(`Възлагане №${assignment.id}`, { exact: true }).waitFor()
  const code = page.getByLabel('Код за достъп', { exact: true })
  const begin = page.getByRole('button', { name: 'Започни на цял екран', exact: true })
  assert.equal(await begin.isDisabled(), true)
  await code.fill('WRONG234'); await begin.click()
  await page.getByRole('alert').getByText('Поискайте текущия код от учителя.', { exact: false }).waitFor()
  assert.equal(starts.length, 0)
  await code.fill('  abcd efgh  ')
  assert.equal(await code.inputValue(), 'ABCDEFGH')
  await page.getByRole('button', { name: 'Започни на цял екран', exact: true }).click()
  assert.equal(starts.length, 1); assert.equal(starts[0].code, 'ABCDEFGH')
  const timer = page.getByLabel('Оставащо време', { exact: true })
  await timer.getByText('1 мин 0 сек', { exact: true }).waitFor()
  await page.clock.runFor(1000)
  await timer.getByText('0 мин 59 сек', { exact: true }).waitFor()
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await timer.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && element.scrollWidth <= element.clientWidth }), true)
    await page.screenshot({ path: new URL(`duration-timer-${width}.png`, artifacts).pathname })
  }
  assert.deepEqual(errors, [])
  console.log('Passed: duration boundaries, exact totals, library and question preview, minute/second editing and validation, seconds-only API payload, assignment picker and code identity, required code and wrong-code retry, whitespace-safe paste, exam preflight, timer minute rollover, desktop/mobile. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('durations-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  await browser.close()
}
