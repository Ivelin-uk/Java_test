import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'assignment-reset-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const tests = [201, 202].map((id, i) => ({ id, title: i ? 'Обектно-ориентирано програмиране' : 'Основи на Java', status: 'published', owner_id: 101, shared: false, question_count: 1, total_time_seconds: 60 }))
const groups = [{ id: 301, name: '12А', subject: 'Java' }, { id: 302, name: '12Б', subject: 'Програмиране' }]
const existing = { id: 601, teacher_id: 101, title: 'Запазено възлагане', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), recipients: 2, max_attempts: 1, access_code: 'ABCD2345', recipient_groups: groups }
const assignments = [existing], mutations = [], errors = []
let failVersion = false, failPost = false, versionGate = Promise.resolve(), postGate = Promise.resolve(), releaseVersion, releasePost
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Sofia' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      const data = { '/api/auth/me': auth.user, '/api/v1/groups': groups, '/api/v1/assignments': assignments, '/api/v1/grading': [], '/api/v1/tests': tests }
      if (Object.hasOwn(data, path)) return respond(data[path])
      const version = path.match(/^\/api\/v1\/tests\/(201|202)\/versions$/)
      if (version) {
        if (failVersion) { failVersion = false; return respond({ detail: 'Версията временно е недостъпна.' }, 503) }
        if (version[1] === '201') await versionGate
        return respond([{ id: Number(version[1]) + 100, version_number: 1 }])
      }
    }
    if (method === 'POST' && path === '/api/v1/assignments') {
      const body = request.postDataJSON()
      mutations.push({ method, path, body })
      if (failPost) { failPost = false; return respond({ detail: 'Неуспешно възлагане.' }, 503) }
      await postGate
      const id = 601 + assignments.length
      assignments.push({ ...existing, id, title: tests.find(test => test.id + 100 === body.versionId).title, starts_at: body.startsAt, ends_at: body.endsAt })
      return respond({ id })
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${frontend}/assignments`)
  const form = page.getByRole('form', { name: 'Възлагане на тест', exact: true })
  const testPicker = form.getByRole('combobox', { name: 'Тест', exact: true })
  const groupPicker = form.getByRole('combobox', { name: 'Търси групи', exact: true })
  const start = form.getByLabel('Начало', { exact: true }), end = form.getByLabel('Краен срок', { exact: true }), attempts = form.getByLabel('Опити', { exact: true })
  const shuffleQ = form.getByLabel('Разбъркай въпросите', { exact: true }), shuffleA = form.getByLabel('Разбъркай опциите', { exact: true }), answers = form.getByLabel('Верни отговори след срока', { exact: true })
  const reset = form.getByRole('button', { name: 'Нулирай формата', exact: true }), assign = form.getByRole('button', { name: 'Възложи', exact: true })
  const table = page.getByRole('table', { name: 'Възлагания', exact: true })
  async function selectTest(index = 0) {
    await testPicker.fill(tests[index].title)
    await page.getByRole('listbox', { name: 'Тестове за възлагане' }).getByRole('option').click()
  }
  async function selectGroup(index = 0) {
    await groupPicker.fill(groups[index].name)
    await page.getByRole('listbox', { name: 'Групи', exact: true }).getByRole('option', { name: groups[index].name, exact: true }).click()
  }
  async function assertDefaults() {
    assert.equal(await testPicker.inputValue(), '')
    assert.equal(await groupPicker.inputValue(), '')
    assert.equal(await testPicker.getAttribute('aria-expanded'), 'false')
    assert.equal(await groupPicker.getAttribute('aria-expanded'), 'false')
    assert.equal(await form.getByRole('listbox').count(), 0)
    assert.equal(await form.getByRole('list', { name: 'Избрани: Групи', exact: true }).count(), 0)
    await form.getByText('Избрани: 0', { exact: true }).waitFor()
    assert.equal(await attempts.inputValue(), '1')
    assert.equal(await shuffleQ.isChecked(), true)
    assert.equal(await shuffleA.isChecked(), false)
    assert.equal(await answers.isChecked(), true)
    assert.equal(await page.getByRole('alert').count(), 0)
    assert.equal(await form.getByText('Възлагането е създадено.', { exact: true }).count(), 0)
    const times = await form.evaluate(element => ({ start: new Date(element.querySelector('[name="startsAt"]').value).getTime(), end: new Date(element.querySelector('[name="endsAt"]').value).getTime(), now: Date.now() }))
    assert(Math.abs(times.start - times.now) < 60000)
    assert.equal(times.end - times.start, 3600000)
    for (const input of [start, end]) assert.equal(await input.getAttribute('aria-invalid'), 'false')
    await table.getByText(existing.title, { exact: true }).waitFor()
  }
  await table.getByText(existing.title, { exact: true }).waitFor()
  await selectTest(); await selectGroup(); await selectGroup(1)
  await start.fill('2098-10-14T10:00'); await end.fill('2098-10-14T09:59'); await attempts.fill('7')
  await shuffleQ.uncheck(); await shuffleA.check(); await answers.uncheck()
  await testPicker.fill('непознат тест'); await groupPicker.fill('непозната група')
  await reset.click(); await assertDefaults()
  assert.equal(await reset.evaluate(element => element === document.activeElement), true)
  assert.equal(mutations.length, 0)
  await assign.click()
  await page.getByRole('alert').getByText('Изберете тест за възлагане.', { exact: true }).waitFor()
  await reset.focus(); await page.keyboard.press('Enter'); await assertDefaults()
  failVersion = true
  await selectTest()
  await page.getByRole('alert').getByText('Версията временно е недостъпна.', { exact: true }).waitFor()
  await reset.click(); await assertDefaults()
  versionGate = new Promise(resolve => { releaseVersion = resolve })
  const versionRequest = page.waitForRequest(`${base}/api/v1/tests/201/versions`)
  await selectTest(); await versionRequest
  assert.equal(await assign.isDisabled(), true)
  assert.equal(await reset.isDisabled(), false)
  await reset.click(); await assertDefaults()
  await selectTest(1); await selectGroup()
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled)
  const versionResponse = page.waitForResponse(`${base}/api/v1/tests/201/versions`)
  releaseVersion(); await versionResponse
  failPost = true
  await assign.click()
  await page.getByRole('alert').getByText('Неуспешно възлагане.', { exact: true }).waitFor()
  assert.equal(mutations[0].body.versionId, 302)
  assert.equal(mutations[0].body.shuffleQuestions, true)
  await reset.click(); await assertDefaults()
  await selectTest(); await selectGroup()
  postGate = new Promise(resolve => { releasePost = resolve })
  const createRequest = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/assignments')
  await assign.click(); await createRequest
  assert.equal(await reset.isDisabled(), true)
  await form.evaluate(element => element.reset())
  assert.equal(await testPicker.inputValue(), tests[0].title)
  await form.getByText('Избрани: 1', { exact: true }).waitFor()
  releasePost()
  await page.getByText('Възлагането е създадено.', { exact: true }).waitFor()
  assert.equal(await table.locator('tbody tr').count(), 2)
  await reset.click(); await assertDefaults()
  assert.equal(await table.locator('tbody tr').count(), 2)
  assert.deepEqual(assignments[0], existing)
  assert.equal(mutations.length, 2)
  assert.equal(mutations[1].body.shuffleQuestions, true)
  for (const { theme, width, height } of [{ theme: 'dark', width: 1440, height: 1000 }, { theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 320, height: 844 }]) {
    await page.setViewportSize({ width, height })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    await attempts.fill('5'); await shuffleQ.uncheck(); await groupPicker.fill('търсене')
    await reset.click(); await reset.click(); await assertDefaults()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await reset.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.width >= 32 && bounds.height >= 32 && bounds.left >= 0 && bounds.right <= innerWidth }), true)
    await page.screenshot({ path: new URL(`assignment-reset-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  assert.equal(mutations.length, 2)
  assert.deepEqual(errors, [])
  console.log('Passed: complete form reset, picker searches and selections, fresh dates/defaults, validation/version/API/success feedback cleared, stale version isolation, keyboard, pending guard, existing assignments preserved, no reset mutations, desktop/mobile and both themes. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('assignment-reset-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  releaseVersion?.(); releasePost?.()
  await browser.close()
}
