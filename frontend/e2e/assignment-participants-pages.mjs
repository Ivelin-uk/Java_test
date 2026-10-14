import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'participants-page-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false, roleSelectionRequired: false } }
const assignment = { id: 601, teacher_id: 101, title: 'Основи на Java - Средно ниво', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), recipients: 1, recipient_groups: [{ id: 301, name: 'ТЕСТ1' }], individual_recipients: [], max_attempts: 1 }
const members = [{ student_id: 401, name: 'Иван Петров', email: 'ivan@example.test' }, { student_id: 402, name: 'Мария Николова', email: 'maria@example.test' }]
const recipients = [{ ...members[0], canceled: false, attempt_id: null, attempt_number: null, status: null, max_attempts: 1, fullscreen_exempt: false, time_multiplier: 1, accommodation_reason: null }]
const errors = [], requests = []
let failRefresh = false
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  async function openContext(signedIn = true) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    if (signedIn) await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
    await context.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin }, body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      requests.push({ method, path })
      if (method === 'GET') {
        if (path === '/api/v1/assignments/601/monitoring' && failRefresh) { failRefresh = false; return respond({ detail: 'Временно недостъпни участници.' }, 503) }
        const data = { '/api/auth/me': auth.user, '/api/v1/assignments': [assignment], '/api/v1/tests': [], '/api/v1/groups': [], '/api/v1/grading': [], '/api/v1/members': [], '/api/v1/assignments/601/monitoring': recipients, '/api/v1/assignments/601/members': members, '/api/v1/assignments/601/teachers': [], '/api/auth/google/config': { enabled: false, redirect: `${base}/api/auth/google/redirect` } }
        if (Object.hasOwn(data, path)) return respond(data[path])
      }
      if (method === 'POST' && path === '/api/auth/login') return respond(auth)
      errors.push(`Unexpected API: ${method} ${path}`)
      return respond({}, 404)
    })
    const next = await context.newPage()
    next.on('pageerror', error => errors.push(error.message))
    return { context, page: next }
  }
  const first = await openContext(); page = first.page
  const assignments = page.getByRole('table', { name: 'Възлагания', exact: true })
  const participants = page.getByRole('table', { name: 'Получатели на възлагането', exact: true })
  const form = page.getByRole('form', { name: 'Възлагане на тест', exact: true })
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Възлагания', exact: true }).click()
  await form.waitFor(); await assignments.waitFor()
  assert.equal(await participants.count(), 0)
  await assignments.getByRole('button', { name: 'Участници и наблюдение', exact: true }).click()
  await participants.getByText(members[1].email, { exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/assignments/601/participants')
  assert.equal(await assignments.count(), 0)
  assert.equal(await form.count(), 0)
  await page.getByRole('heading', { name: assignment.title, exact: true }).waitFor()
  await page.getByLabel('Брой получатели', { exact: true }).getByText('1', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Към възлаганията', exact: true }).click()
  await assignments.waitFor(); await form.waitFor()
  assert.equal(new URL(page.url()).pathname, '/assignments')
  await assignments.getByRole('button', { name: 'Участници във възлагане №601', exact: true }).click()
  await participants.waitFor()
  await page.goBack(); await assignments.waitFor()
  await page.goForward(); await participants.waitFor()
  await page.reload(); await participants.getByText(members[0].email, { exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/assignments/601/participants')
  assert.equal(await form.count(), 0)
  await page.getByRole('button', { name: 'Табло', exact: true }).click()
  assert.equal(new URL(page.url()).pathname, '/')
  await page.goBack(); await participants.waitFor()
  failRefresh = true
  await page.getByRole('button', { name: 'Обнови', exact: true }).click()
  await page.getByRole('alert').getByText('Временно недостъпни участници.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Обнови', exact: true }).click()
  await page.getByRole('alert').waitFor({ state: 'detached' })
  for (const { theme, width, height } of [{ theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 320, height: 844 }]) {
    await page.setViewportSize({ width, height })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: new URL(`assignment-participants-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  const beforeMissing = requests.length
  await page.goto(`${frontend}/assignments/999/participants`)
  await page.getByRole('alert').getByText('Възлагането не е намерено или нямате достъп до него.', { exact: true }).waitFor()
  assert.equal(await participants.count(), 0)
  assert.equal(requests.slice(beforeMissing).some(request => request.path.includes('/assignments/999/')), false)
  await page.getByRole('button', { name: 'Към възлаганията', exact: true }).click(); await assignments.waitFor()
  const direct = await openContext(); page = direct.page
  const beforeDirect = requests.length
  await page.goto(`${frontend}/assignments/601/participants`)
  await page.getByRole('table', { name: 'Получатели на възлагането', exact: true }).waitFor()
  assert.equal(requests.slice(beforeDirect).some(request => ['/api/v1/tests', '/api/v1/groups'].includes(request.path)), false)
  const loggedOut = await openContext(false); page = loggedOut.page
  await page.goto(`${frontend}/assignments/601/participants`)
  await page.getByRole('button', { name: 'Влез', exact: true }).waitFor()
  assert.equal(await page.getByRole('table', { name: 'Получатели на възлагането', exact: true }).count(), 0)
  await page.getByLabel('Имейл', { exact: true }).fill(auth.user.email)
  await page.getByLabel('Парола', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Влез', exact: true }).click()
  await page.getByRole('table', { name: 'Получатели на възлагането', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/assignments/601/participants')
  assert.deepEqual(errors, [])
  console.log('Passed: dedicated participants page, action/count links, original creation form unchanged, back/forward, reload and direct links, login return, refresh retry, missing/private assignments, desktop/mobile and both themes. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('assignment-participants-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  await browser.close()
}
