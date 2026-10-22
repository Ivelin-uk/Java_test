import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const now = new Date('2026-10-22T15:37:00Z')
const teacher = { token: 'schedule-teacher-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const student = { token: 'schedule-student-fixture', user: { id: 102, name: 'Student', email: 'student@example.test', role: 'STUDENT', active: true, passwordChangeRequired: false } }
const assignments = [67, 68].map(id => ({ id, teacher_id: 101, title: 'Нов тест1', starts_at: '2026-10-22T13:35:00Z', ends_at: '2026-10-22T14:35:00Z', max_attempts: 1, recipients: 1, access_code: id === 67 ? 'ABCDEFGH' : 'JKLMNPQR', recipient_groups: [{ id: 301, name: '12А' }] }))
const errors = [], saves = []
let failNext = false, holdSave = false, releaseSave
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  async function session(auth) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Sofia' })
    await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
    // Every API request is intercepted; no changes reach the user's database.
    await context.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      if (!path.startsWith('/api/')) return route.continue()
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (method === 'GET') {
        const data = { '/api/auth/me': auth.user, '/api/v1/groups': [], '/api/v1/assignments': assignments, '/api/v1/tests': [], '/api/v1/grading': [], '/api/v1/attempts': [], '/api/v1/results': [] }
        if (Object.hasOwn(data, path)) return respond(data[path])
      }
      const schedule = path.match(/^\/api\/v1\/assignments\/(67|68)\/schedule$/)
      if (method === 'PUT' && schedule) {
        assert.equal(auth.user.role, 'TEACHER')
        const id = Number(schedule[1]), body = request.postDataJSON()
        saves.push({ id, ...body })
        if (failNext) { failNext = false; return respond({ detail: 'Има активни опити. Изчакайте приключването им, преди да промените датите.' }, 409) }
        if (holdSave) await new Promise(resolve => { releaseSave = resolve })
        Object.assign(assignments.find(assignment => assignment.id === id), { starts_at: body.startsAt, ends_at: body.endsAt })
        return route.fulfill({ status: 200, body: '' })
      }
      errors.push(`Unexpected API: ${method} ${path}`)
      return respond({ detail: 'Unexpected API' }, 404)
    })
    const result = await context.newPage()
    result.on('pageerror', error => errors.push(error.message))
    await result.clock.setFixedTime(now)
    return result
  }
  const learner = await session(student)
  page = learner
  await learner.goto(frontend)
  await learner.getByRole('button', { name: 'Моите тестове', exact: true }).click()
  const studentRow = id => learner.getByRole('table', { name: 'Възложени тестове', exact: true }).getByRole('row').filter({ hasText: `Възлагане №${id}` })
  await studentRow(67).getByText('Срокът е изтекъл', { exact: true }).waitFor()
  assert.equal(await studentRow(67).getByRole('button', { name: 'Подготовка', exact: true }).isDisabled(), true)

  page = await session(teacher)
  await page.goto(`${frontend}/assignments`)
  const edit = page.getByRole('button', { name: 'Промени датите на възлагане №67', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Промени датите', exact: true })
  const start = dialog.getByLabel('Начало', { exact: true }), end = dialog.getByLabel('Краен срок', { exact: true })
  const save = dialog.getByRole('button', { name: 'Запази датите', exact: true })
  await edit.click()
  assert.equal(await start.inputValue(), '2026-10-22T16:35')
  assert.equal(await end.inputValue(), '2026-10-22T17:35')
  assert.equal(await end.evaluate(element => element === document.activeElement), true)
  await end.fill('2026-10-22T20:37')
  await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
  assert.equal(saves.length, 0)
  assert.equal(await edit.evaluate(element => element === document.activeElement), true)
  await edit.click()
  assert.equal(await end.inputValue(), '2026-10-22T17:35')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(saves.length, 0)

  await edit.click()
  await save.click()
  await dialog.getByRole('alert').getByText('Крайният срок трябва да е в бъдещето.', { exact: true }).waitFor()
  await start.fill(''); await save.click()
  await dialog.getByRole('alert').getByText('Попълнете началната дата и час.', { exact: true }).waitFor()
  await start.fill('2026-10-22T18:00'); await end.fill(''); await save.click()
  await dialog.getByRole('alert').getByText('Попълнете крайната дата и час.', { exact: true }).waitFor()
  for (const invalidEnd of ['2026-10-22T18:00', '2026-10-22T17:59']) {
    await end.fill(invalidEnd)
    await dialog.getByRole('alert').getByText('Крайният срок трябва да е след началото.', { exact: true }).waitFor()
    assert.equal(await end.getAttribute('aria-invalid'), 'true')
    await save.click()
    assert.equal(await end.evaluate(element => element === document.activeElement), true)
  }
  assert.equal(saves.length, 0)
  await end.fill('2026-10-22T20:37')
  failNext = true
  await save.click()
  await dialog.getByRole('alert').getByText('Има активни опити. Изчакайте приключването им, преди да промените датите.', { exact: true }).waitFor()
  assert.equal(await end.inputValue(), '2026-10-22T20:37')
  assert.equal(assignments[0].ends_at, '2026-10-22T14:35:00Z')
  holdSave = true
  const submitted = page.waitForRequest(request => request.method() === 'PUT')
  await save.click(); await submitted
  assert.equal(await dialog.getAttribute('aria-busy'), 'true')
  assert.equal(await dialog.getByRole('button', { name: 'Отказ', exact: true }).isDisabled(), true)
  await dialog.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit() })
  await page.keyboard.press('Escape')
  assert.equal(await dialog.isVisible(), true)
  assert.equal(saves.length, 2)
  releaseSave()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByText('Датите на възлагането са запазени.', { exact: true }).waitFor()
  assert.deepEqual(saves[1], { id: 67, startsAt: '2026-10-22T15:00:00.000Z', endsAt: '2026-10-22T17:37:00.000Z' })
  assert.equal(assignments[0].access_code, 'ABCDEFGH')
  assert.equal(assignments[1].ends_at, '2026-10-22T14:35:00Z')
  await learner.getByRole('button', { name: 'Обнови', exact: true }).click()
  await studentRow(67).getByText('Активен', { exact: true }).waitFor()
  assert.equal(await studentRow(67).getByRole('button', { name: 'Подготовка', exact: true }).isEnabled(), true)
  await studentRow(68).getByText('Срокът е изтекъл', { exact: true }).waitFor()
  assert.equal(await learner.getByRole('button', { name: /Промени датите/ }).count(), 0)

  await page.reload(); await edit.click()
  assert.equal(await start.inputValue(), '2026-10-22T18:00')
  assert.equal(await end.inputValue(), '2026-10-22T20:37')
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true)
    await page.screenshot({ path: new URL(`assignment-schedule-${width}.png`, artifacts).pathname })
  }
  assert.deepEqual(errors, [])
  console.log('Passed: edit correct assignment, local/UTC dates, cancel/Escape and focus, invalid/expired dates blocked, server conflict and retry, busy/double-submit protection, persistent dates, same code, expired student test reopens after refresh, unrelated test unchanged, desktop/mobile. API fixtures only.')
} catch (error) {
  console.error('Fixture API/page errors:', errors)
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('assignment-schedule-failure.png', artifacts).pathname })
  throw error
} finally {
  await browser.close()
}
