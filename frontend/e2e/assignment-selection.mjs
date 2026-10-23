import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const auth = { token: 'assignment-selection-fixture', user: { id: 101, name: 'Student', email: 'student@example.test', role: 'STUDENT', active: true, passwordChangeRequired: false } }
const assignments = [67, 68].map(id => ({ id, title: 'Еднакво име на теста', starts_at: new Date(Date.now() - 60000).toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), max_attempts: 1, canceled: false }))
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
try {
  for (const { width, rateLimited } of [{ width: 1440 }, { width: 320 }, { width: 1280, rateLimited: true }]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
    const page = await context.newPage()
    const errors = [], starts = [], lookups = []
    page.on('pageerror', error => errors.push(error.message))
    const state = () => ({ id: 401, assignment_id: 68, status: 'in_progress', server_now: new Date().toISOString(), question_number: 1, question_count: 1, question: { id: 501, text: 'Въпрос от правилното възлагане', type: 'SINGLE_CHOICE', status: 'open', maximum_points: 1, time_seconds: 180, open_instance: 'fixture-instance', deadline_at: new Date(Date.now() + 180000).toISOString(), options: [{ id: 'yes', text: 'Да' }, { id: 'no', text: 'Не' }], draft: null } })
    // No requests, attempts or answers reach the user's backend.
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      if (!path.startsWith('/api/')) return route.continue()
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (method === 'GET') {
        const data = { '/api/auth/me': auth.user, '/api/v1/groups': [], '/api/v1/assignments': assignments, '/api/v1/attempts': [], '/api/v1/results': [] }
        if (Object.hasOwn(data, path)) return respond(data[path])
        const preflight = path.match(/^\/api\/v1\/assignments\/(67|68)\/preflight$/)
        if (preflight) return respond({ ...assignments.find(a => a.id === Number(preflight[1])), question_count: 1, total_seconds: 180, instructions: '', fullscreen_exempt: false })
        if (path === '/api/v1/attempts/401/state') return respond(state())
      }
      if (method === 'POST' && path === '/api/v1/assignments/resolve-code') {
        const body = request.postDataJSON()
        lookups.push(body)
        return body.code === 'JKLMNPQR' ? respond({ id: 68, title: assignments[1].title }) : respond({ detail: 'Невалиден или отменен код.' }, 400)
      }
      const start = path.match(/^\/api\/v1\/assignments\/(67|68)\/attempts$/)
      if (method === 'POST' && start) {
        const body = request.postDataJSON(), assignment = Number(start[1])
        starts.push({ assignment, ...body })
        if (assignment !== 68 || body.code !== 'JKLMNPQR') return respond({ detail: rateLimited ? 'Твърде много грешни кодове. Опитайте след 5 минути.' : 'Невалиден или отменен код.' }, rateLimited ? 429 : 400)
        assert.equal(body.fullscreenActive, true)
        assert.equal(body.visible, true)
        return respond(state())
      }
      if (method === 'PUT' && path === '/api/v1/attempts/401/questions/501/draft' || method === 'POST' && path === '/api/v1/attempts/401/events') return respond(state())
      errors.push(`${method} ${path}`)
      return respond({}, 404)
    })
    await page.goto(frontend)
    await page.getByRole('button', { name: 'Моите тестове', exact: true }).click()
    const table = page.getByRole('table', { name: 'Възложени тестове', exact: true })
    const row = id => table.locator('tbody tr').nth(assignments.findIndex(assignment => assignment.id === id))
    await row(67).getByText(assignments[0].title, { exact: true }).waitFor()
    await row(68).getByText(assignments[1].title, { exact: true }).waitFor()
    assert.equal(await page.getByText('JKLMNPQR', { exact: true }).count(), 0)
    await row(67).getByRole('button', { name: 'Подготовка', exact: true }).click()
    await page.getByRole('heading', { name: 'Подготовка за изпит', exact: true }).waitFor()
    assert.equal(await page.getByText(/Възлагане\s*№/).count(), 0)
    await page.getByLabel('Код за достъп', { exact: true }).fill('ZZZZZZZZ')
    await page.getByRole('button', { name: 'Започни на цял екран', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Кодът не е валиден за този тест' }).waitFor()
    assert.equal(starts.length, 1)
    await page.getByLabel('Код за достъп', { exact: true }).fill('  jklmnpqr  ')
    assert.equal(await page.getByRole('alert').count(), 0)
    await page.getByRole('button', { name: 'Започни на цял екран', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Отворен е тестът за въведения код' }).waitFor()
    assert.equal(await page.getByLabel('Код за достъп', { exact: true }).inputValue(), 'JKLMNPQR')
    assert.equal(await page.getByRole('alert').count(), 0)
    assert.equal(starts.length, 2)
    assert.deepEqual(lookups, [{ code: 'ZZZZZZZZ' }, { code: 'JKLMNPQR' }])
    await page.screenshot({ path: new URL(`assignment-selection-${width}.png`, artifacts).pathname, fullPage: true })
    await page.getByRole('button', { name: 'Започни на цял екран', exact: true }).click()
    await page.getByRole('heading', { name: 'Въпрос от правилното възлагане', exact: true }).waitFor()
    assert.deepEqual(starts.map(start => start.assignment), [67, 67, 68])
    assert.equal(starts[0].idempotencyKey, starts[1].idempotencyKey)
    assert.notEqual(starts[1].idempotencyKey, starts[2].idempotencyKey)
    assert.equal(lookups.length, 2)
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('Passed: invalid codes stay on the selected test; valid codes for another assigned test automatically open its preflight with the code preserved, even after selected-test rate limiting; reviewing the correct preflight consumes no attempt, and starting it retains fullscreen and session isolation. Desktop and mobile-width layouts; API fixtures only.')
} finally {
  await browser.close()
}
