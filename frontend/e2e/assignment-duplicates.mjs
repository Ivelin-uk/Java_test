import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const auth = { token: 'assignment-duplicate-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const tests = ['Алгебра', 'Геометрия', 'Анализ'].map((title, index) => ({ id: 201 + index, title, status: 'published', owner_id: 101, question_count: 1, total_time_seconds: 60 }))
const groups = ['12А', '12Б', '12В'].map((name, index) => ({ id: 301 + index, name, subject: 'Математика' }))
const existing = { id: 601, assessment_id: 201, version_id: 401, teacher_id: 101, title: 'Предишно име на теста', starts_at: '2026-01-01T10:00:00Z', ends_at: '2026-01-01T11:00:00Z', recipients: 2, max_attempts: 1, access_code: null, recipient_groups: [groups[0], groups[2]] }
const assignments = [existing], writes = [], scheduleWrites = [], errors = []
let conflict = false, unavailable = false, locked = false, assignmentReads = 0
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'Europe/Sofia' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    if (!path.startsWith('/api/')) return route.continue()
    const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (method === 'GET') {
      const data = { '/api/auth/me': auth.user, '/api/v1/tests': tests, '/api/v1/groups': groups, '/api/v1/assignments': assignments }
      if (Object.hasOwn(data, path)) { if (path === '/api/v1/assignments') assignmentReads++; return respond(data[path]) }
      const match = path.match(/^\/api\/v1\/tests\/(201|202|203)\/versions$/)
      if (match) return respond([{ id: Number(match[1]) + 300, version_number: 2 }])
    }
    if (method === 'POST' && path === '/api/v1/assignments') {
      const body = request.postDataJSON()
      writes.push(body)
      if (unavailable) return respond({ detail: 'Възлагането временно не може да бъде създадено.' }, 503)
      if (locked) return respond({ detail: 'Възлагането е временно заключено.' }, 409)
      const created = { ...existing, id: 601 + assignments.length, assessment_id: body.versionId - 300, version_id: body.versionId, title: tests.find(test => test.id === body.versionId - 300).title, starts_at: body.startsAt, ends_at: body.endsAt, recipient_groups: groups.filter(group => body.groupIds.includes(group.id)) }
      assignments.push(created)
      if (conflict) return respond({ detail: 'Тестът вече е възложен на група „12В“. Променете съществуващото възлагане.', code: 'CONFLICT' }, 409)
      return respond({ id: created.id })
    }
    if (method === 'PUT' && /\/api\/v1\/assignments\/\d+\/schedule$/.test(path)) { scheduleWrites.push(request.postDataJSON()); return respond({}) }
    errors.push(`${method} ${path}`)
    return respond({}, 404)
  })
  page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${frontend}/assignments`)
  const form = page.getByRole('form', { name: 'Възлагане на тест', exact: true })
  const testPicker = form.getByRole('combobox', { name: 'Тест', exact: true })
  const groupPicker = form.getByRole('combobox', { name: 'Търси групи', exact: true })
  const assign = form.locator('button[type="submit"]')
  const audienceStep = form.getByRole('tab', { name: 'Тест и групи', exact: true })
  const settingsStep = form.getByRole('tab', { name: 'Начин на решаване', exact: true })
  const options = page.getByRole('listbox', { name: 'Групи', exact: true })
  const option = index => options.getByRole('option', { name: groups[index].name, exact: true })
  const existingSection = form.getByRole('region', { name: 'Съществуващи възлагания на избрания тест', exact: true })
  async function selectTest(index) {
    const response = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/tests/${tests[index].id}/versions`)
    await testPicker.fill(tests[index].title)
    await page.getByRole('listbox', { name: 'Тестове за възлагане' }).getByRole('option').click()
    await response
  }
  async function selectGroup(index) { await groupPicker.click(); await option(index).click() }
  async function selected(count) { await form.getByText(`Избрани: ${count}`, { exact: true }).waitFor() }
  async function noDuplicateAlert() {
    assert.equal(await page.getByRole('alert').filter({ hasText: /Тестът вече е възложен/ }).count(), 0)
  }
  await page.getByRole('table', { name: 'Възлагания', exact: true }).getByText(existing.title, { exact: true }).waitFor()
  // Preselected groups that already have this test move out of the new audience.
  await selectGroup(0); await selectGroup(1); await selectTest(0)
  await selected(1)
  assert.equal(await form.getByRole('button', { name: 'Премахни: 12А', exact: true }).count(), 0)
  await form.getByRole('button', { name: 'Премахни: 12Б', exact: true }).waitFor()
  await existingSection.waitFor()
  await existingSection.getByText(/12А/).first().waitFor()
  await existingSection.getByText(/12В/).first().waitFor()
  await existingSection.getByRole('button', { name: /Участници/ }).first().waitFor()
  await noDuplicateAlert()
  assert.equal(await assign.isEnabled(), true)

  // Existing work is editable directly, without creating another assignment.
  await existingSection.getByRole('button', { name: 'Промени периода за групи: 12А, 12В', exact: true }).click()
  const schedule = page.getByRole('dialog', { name: 'Промени датите', exact: true })
  await schedule.waitFor()
  assert.equal(await schedule.getByLabel('Начало', { exact: true }).inputValue(), '2026-01-01T12:00')
  await schedule.getByRole('button', { name: 'Отказ', exact: true }).click()
  await schedule.waitFor({ state: 'detached' })
  assert.deepEqual(scheduleWrites, [])
  assert.equal(writes.length, 0)
  await groupPicker.click()
  assert.equal(await option(0).isDisabled(), true)
  assert.equal(await option(2).isDisabled(), true)
  assert.equal(await option(1).isEnabled(), true)
  await option(0).getByText('Вече е възложен', { exact: true }).waitFor()
  await option(0).evaluate(element => element.click())
  await selected(1)
  assert.equal(await groupPicker.getAttribute('aria-activedescendant'), await option(1).getAttribute('id'))
  await groupPicker.press('ArrowDown'); await groupPicker.press('ArrowUp'); await groupPicker.press('Enter')
  await selected(0)
  await groupPicker.click(); await groupPicker.press('Enter'); await selected(1)
  await groupPicker.press('Escape')

  for (const { width, theme } of [{ width: 1440, theme: 'light' }, { width: 390, theme: 'light' }, { width: 320, theme: 'dark' }, { width: 1440, theme: 'dark' }]) {
    await page.setViewportSize({ width, height: 1000 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: new URL(`assignment-flow-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await settingsStep.click()
  await assign.click(); await page.getByText('Възлагането е създадено.', { exact: true }).waitFor()
  await audienceStep.click()
  assert.deepEqual(writes[0].groupIds, [302])
  assert.equal(await testPicker.inputValue(), tests[0].title)
  await selected(0)
  assert.equal(await assign.isDisabled(), true)
  await groupPicker.click()
  for (let index = 0; index < groups.length; index++) assert.equal(await option(index).isDisabled(), true)
  await groupPicker.press('ArrowDown'); await groupPicker.press('Enter')
  assert.equal(await groupPicker.getAttribute('aria-activedescendant'), null)
  await selected(0)
  await noDuplicateAlert()
  assert.equal(writes.length, 1)

  // A different library test can still be given to those same groups.
  await selectTest(1); await selectGroup(0); await selectGroup(1)
  await settingsStep.click()
  await assign.click(); await audienceStep.click(); await selected(0)
  assert.deepEqual(writes[1].groupIds, [301, 302])
  assert.equal(await testPicker.inputValue(), tests[1].title)
  assert.equal(await assign.isDisabled(), true)

  // A concurrent assignment refreshes the audience and becomes neutral guidance.
  await audienceStep.click()
  await selectGroup(2)
  conflict = true
  for (const close of await page.getByRole('button', { name: 'Затвори известието', exact: true }).all()) await close.click()
  const readsBeforeConflict = assignmentReads
  await settingsStep.click()
  await assign.click()
  await audienceStep.click()
  await form.getByRole('status').getByText('Списъкът е обновен. Избери друга група или промени съществуващото възлагане.', { exact: true }).waitFor()
  assert.ok(assignmentReads > readsBeforeConflict)
  await selected(0)
  assert.equal(await assign.isDisabled(), true)
  await noDuplicateAlert()
  assert.equal(await page.getByText('Възлагането е създадено.', { exact: true }).count(), 0)
  assert.equal(writes.length, 3)
  assert.equal(assignments.length, 4)
  assert.equal(assignments[0], existing)

  // Real failures keep the audience intact and remain visible for retry.
  conflict = false; unavailable = true
  await settingsStep.click()
  await form.getByRole('button', { name: 'Нулирай формата', exact: true }).click()
  await selectTest(2); await selectGroup(0)
  await settingsStep.click()
  await assign.click()
  await page.getByRole('alert').getByText('Възлагането временно не може да бъде създадено.', { exact: true }).first().waitFor()
  await audienceStep.click()
  await selected(1)
  assert.equal(assignments.length, 4)
  assert.equal(writes.length, 4)
  unavailable = false; locked = true
  await audienceStep.click()
  await settingsStep.click()
  await assign.click()
  await audienceStep.click()
  await page.getByRole('alert').getByText('Възлагането е временно заключено.', { exact: true }).first().waitFor()
  await audienceStep.click()
  await selected(1)
  assert.equal(assignments.length, 4)
  assert.equal(writes.length, 5)
  assert.deepEqual(errors, [])
  console.log('Passed: neutral existing assignments with direct schedule/cancel; preselected duplicate pruning and mixed audience; mouse/keyboard guards; fresh-group submission; success clears selection; concurrent duplicates refresh without red alerts; genuine error recovery; desktop/mobile light/dark. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: new URL('assignment-duplicates-failure.png', artifacts).pathname, fullPage: true })
    console.error('Fixture page:', (await page.locator('body').innerText()).slice(0, 2500), 'Browser errors:', errors)
  }
  throw error
} finally { await browser.close() }
