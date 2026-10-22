import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'assignment-duplicate-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const tests = [201, 202].map((id, index) => ({ id, title: index ? 'Геометрия' : 'Алгебра', status: 'published', owner_id: 101, question_count: 1, total_time_seconds: 60 }))
const groups = ['12А', '12Б', '12В'].map((name, index) => ({ id: 301 + index, name, subject: 'Математика' }))
const existing = { id: 601, assessment_id: 201, version_id: 401, teacher_id: 101, title: 'Предишно име на теста', starts_at: '2026-01-01T10:00:00Z', ends_at: '2026-01-01T11:00:00Z', recipients: 2, max_attempts: 1, access_code: null, recipient_groups: [groups[0], groups[2]] }
const assignments = [existing], writes = [], errors = []
let conflict = false
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      const data = { '/api/auth/me': auth.user, '/api/v1/tests': tests, '/api/v1/groups': groups, '/api/v1/assignments': assignments }
      if (Object.hasOwn(data, path)) return respond(data[path])
      const match = path.match(/^\/api\/v1\/tests\/(201|202)\/versions$/)
      if (match) return respond([{ id: Number(match[1]) + 300, version_number: 2 }])
    }
    if (method === 'POST' && path === '/api/v1/assignments') {
      const body = request.postDataJSON()
      writes.push(body)
      if (conflict) return respond({ detail: 'Тестът вече е възложен на група „12В“. Променете съществуващото възлагане.' }, 409)
      assignments.push({ ...existing, id: 601 + assignments.length, assessment_id: body.versionId - 300, version_id: body.versionId, starts_at: body.startsAt, ends_at: body.endsAt, recipient_groups: groups.filter(group => body.groupIds.includes(group.id)) })
      return respond({ id: assignments.at(-1).id })
    }
    errors.push(`${method} ${path}`)
    return respond({}, 404)
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${frontend}/assignments`)
  const form = page.getByRole('form', { name: 'Възлагане на тест', exact: true })
  const testPicker = form.getByRole('combobox', { name: 'Тест', exact: true })
  const groupPicker = form.getByRole('combobox', { name: 'Търси групи', exact: true })
  const assign = form.getByRole('button', { name: 'Възложи', exact: true })
  const options = page.getByRole('listbox', { name: 'Групи', exact: true })
  const option = index => options.getByRole('option', { name: groups[index].name, exact: true })
  async function selectTest(index) {
    const response = page.waitForResponse(`${base}/api/v1/tests/${tests[index].id}/versions`)
    await testPicker.fill(tests[index].title)
    await page.getByRole('listbox', { name: 'Тестове за възлагане' }).getByRole('option').click()
    await response
  }
  await page.getByRole('table', { name: 'Възлагания', exact: true }).getByText(existing.title, { exact: true }).waitFor()
  // Choosing groups first must still reject a duplicate once a test is selected.
  await groupPicker.click(); await option(0).click(); await selectTest(0)
  await form.getByRole('alert').getByText('Тестът вече е възложен на: 12А. Променете съществуващото възлагане.', { exact: true }).waitFor()
  assert.equal(await assign.isDisabled(), true)
  await form.evaluate(element => element.requestSubmit())
  assert.equal(writes.length, 0)
  await form.getByRole('button', { name: 'Премахни: 12А', exact: true }).click()
  await groupPicker.click()
  assert.equal(await option(0).isDisabled(), true)
  assert.equal(await option(2).isDisabled(), true)
  assert.equal(await option(1).isEnabled(), true)
  await option(0).getByText('Вече е възложен', { exact: true }).waitFor()
  await option(0).evaluate(element => element.click())
  await form.getByText('Избрани: 0', { exact: true }).waitFor()
  assert.equal(await groupPicker.getAttribute('aria-activedescendant'), await option(1).getAttribute('id'))
  await groupPicker.press('ArrowDown'); await groupPicker.press('ArrowUp'); await groupPicker.press('Enter')
  await form.getByText('Избрани: 1', { exact: true }).waitFor()
  await form.getByRole('button', { name: 'Премахни: 12Б', exact: true }).waitFor()
  assert.equal(await assign.isEnabled(), true)
  // A different library test remains assignable to the same groups.
  await selectTest(1); await groupPicker.click(); await option(0).click()
  await assign.click(); await page.getByText('Възлагането е създадено.', { exact: true }).waitFor()
  assert.deepEqual(writes[0].groupIds, [302, 301])
  assert.equal(await assign.isDisabled(), true)
  await selectTest(0)
  await form.getByRole('button', { name: 'Премахни: 12А', exact: true }).click()
  await assign.click(); await page.getByText('Възлагането е създадено.', { exact: true }).waitFor()
  assert.deepEqual(writes[1].groupIds, [302])
  assert.equal(await assign.isDisabled(), true)
  await form.getByRole('button', { name: 'Премахни: 12Б', exact: true }).click()
  await groupPicker.click()
  for (let i = 0; i < groups.length; i++) assert.equal(await option(i).isDisabled(), true)
  await groupPicker.press('ArrowDown'); await groupPicker.press('Enter')
  assert.equal(await groupPicker.getAttribute('aria-activedescendant'), null)
  await form.getByText('Избрани: 0', { exact: true }).waitFor()
  assert.equal(writes.length, 2)
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await groupPicker.scrollIntoViewIfNeeded()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: new URL(`assignment-duplicates-${width}.png`, artifacts).pathname, fullPage: true })
  }
  await groupPicker.press('Escape')
  await form.getByRole('button', { name: 'Нулирай формата', exact: true }).click()
  await selectTest(1); await groupPicker.click(); await option(2).click()
  conflict = true
  await assign.click()
  await page.getByRole('alert').getByText('Тестът вече е възложен на група „12В“. Променете съществуващото възлагане.', { exact: true }).waitFor()
  assert.equal(assignments.length, 3)
  assert.equal(writes.length, 3)
  assert.equal(assignments[0], existing)
  assert.deepEqual(errors, [])
  console.log('Passed: library identity across versions/names, disabled assigned groups, mouse and keyboard guards, all-disabled list, groups selected before test, other tests/groups allowed, post-save prevention, server conflict fallback, reset and responsive layouts. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('assignment-duplicates-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally { await browser.close() }
