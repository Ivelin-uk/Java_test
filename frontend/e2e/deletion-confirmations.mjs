import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'deletion-confirmation-fixture', user: { id: 101, name: 'Confirmation Teacher', email: 'confirmations@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const question = text => ({ type: 'SINGLE_CHOICE', text, difficulty: 'MEDIUM', points: 1, timeSeconds: 60, options: [{ text: 'First option', correct: true }, { text: 'Second option', correct: false }, { text: 'Third option', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: '' })
const definition = { title: 'Confirmation test', description: '', subject: 'Java', level: '12', instructions: '', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, questions: [question('First question'), question('Second question')] }
const test = { id: 201, title: definition.title, owner_id: auth.user.id, status: 'published', shared: false, definition_json: JSON.stringify(definition), updated_at: new Date().toISOString(), question_count: 2, total_time_seconds: 120 }
const assignment = { id: 301, teacher_id: auth.user.id, title: definition.title, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), recipients: 1, max_attempts: 1 }
const colleague = { teacher_id: 102, name: 'Shared Teacher' }
const student = { id: 103, name: 'Confirmation Student', email: 'confirmation-student@example.test' }
const attempt = { id: 501, assignment_id: assignment.id, title: definition.title, student_name: student.name, attempt_number: 1, status: 'pending_review', submitted_at: new Date().toISOString() }
const mutations = []
const errors = []
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => { errors.push(`Unexpected browser dialog: ${dialog.type()}`); void dialog.dismiss() })
  let shared = [colleague]
  let codeActive = true
  let assignmentVisible = true
  let rejectDeletion = true
  let releaseDeletion, markDeletionStarted
  const deletionGate = new Promise(resolve => { releaseDeletion = resolve })
  const deletionStarted = new Promise(resolve => { markDeletionStarted = resolve })
  await page.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      const data = {
        '/api/auth/me': auth.user,
        '/api/v1/tests': [test],
        [`/api/v1/tests/${test.id}`]: test,
        [`/api/v1/tests/${test.id}/versions`]: [{ id: 202, version_number: 1, title: test.title }],
        '/api/v1/assignments': assignmentVisible ? [assignment] : [],
        '/api/v1/groups': [],
        '/api/v1/members': [],
        [`/api/v1/assignments/${assignment.id}/monitoring`]: [],
        [`/api/v1/assignments/${assignment.id}/members`]: [],
        [`/api/v1/assignments/${assignment.id}/teachers`]: shared,
        '/api/v1/grading': [attempt],
        [`/api/v1/attempts/${attempt.id}/review`]: { attempt, student, questions: [], events: [], revisions: [] },
      }
      if (Object.hasOwn(data, path)) return respond(data[path])
    } else {
      mutations.push({ method, path, body: request.postDataJSON() })
      if (method === 'DELETE' && path === `/api/v1/assignments/${assignment.id}/code`) codeActive = false
      else if (method === 'POST' && path === `/api/v1/assignments/${assignment.id}/code/rotate`) {
        codeActive = true
        return respond({ code: 'DELETE2345' })
      }
      else if (method === 'DELETE' && path === `/api/v1/assignments/${assignment.id}`) {
        if (rejectDeletion) return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'Временно недостъпен сървър. Опитайте отново.' }) })
        markDeletionStarted()
        await deletionGate
        assignmentVisible = false
      }
      else if (method === 'PUT' && path === `/api/v1/assignments/${assignment.id}/teachers/${colleague.teacher_id}`) shared = []
      else if (method === 'POST' && path === `/api/v1/attempts/${attempt.id}/void`) attempt.status = 'voided'
      else errors.push(`Unexpected mutation: ${method} ${path}`)
      return route.fulfill({ status: 204 })
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return route.fulfill({ status: 404 })
  })

  async function cancellation(trigger, title, unchanged) {
    const before = mutations.length
    const dialog = page.getByRole('dialog', { name: title, exact: true })
    await trigger.click()
    await dialog.waitFor()
    assert.equal(await dialog.evaluate(element => element.matches(':modal')), true)
    assert.equal(await dialog.getByRole('button', { name: 'Отказ', exact: true }).evaluate(element => element === document.activeElement), true)
    await unchanged()
    await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true)
    await unchanged()
    await trigger.click()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await unchanged()
    assert.equal(mutations.length, before)
    return dialog
  }

  await page.goto(frontend)
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  const questions = page.locator('.ws-editor > .ws-question')
  await questions.first().getByLabel('Текст', { exact: true }).waitFor()
  const optionDialog = await cancellation(questions.first().getByRole('button', { name: 'Премахни опция', exact: true }).nth(2), 'Премахване на опция', async () => assert.equal(await questions.first().locator('.ws-option-editor').count(), 3))
  await questions.first().getByRole('button', { name: 'Премахни опция', exact: true }).nth(2).click()
  await optionDialog.getByRole('button', { name: 'Премахни', exact: true }).click()
  await optionDialog.waitFor({ state: 'detached' })
  assert.deepEqual(await questions.first().locator('.ws-option-editor input:not([type=radio])').evaluateAll(elements => elements.map(element => element.value)), ['First option', 'Second option'])
  const questionDialog = await cancellation(questions.first().getByRole('button', { name: 'Изтрий въпрос', exact: true }), 'Изтриване на въпрос', async () => assert.equal(await questions.count(), 2))
  for (const { theme, width, height } of [{ theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 390, height: 844 }]) {
    await page.setViewportSize({ width, height })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    await questions.first().getByRole('button', { name: 'Изтрий въпрос', exact: true }).click()
    assert.equal(await questionDialog.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && element.scrollWidth <= element.clientWidth }), true)
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab')
      assert.equal(await questionDialog.evaluate(element => document.activeElement === document.body || element.contains(document.activeElement)), true)
    }
    await page.screenshot({ path: new URL(`delete-confirmation-${theme}-${width}.png`, artifacts).pathname })
    await page.keyboard.press('Escape')
    await questionDialog.waitFor({ state: 'detached' })
  }
  await questions.first().getByRole('button', { name: 'Изтрий въпрос', exact: true }).click()
  await questionDialog.getByRole('button', { name: 'Изтрий', exact: true }).click()
  await questionDialog.waitFor({ state: 'detached' })
  assert.equal(await questions.count(), 1)
  assert.equal(await questions.first().getByLabel('Текст', { exact: true }).inputValue(), 'Second question')
  assert.equal(mutations.length, 0)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Възлагания', exact: true }).click()
  await page.getByRole('button', { name: 'Наблюдение', exact: true }).click()
  const accessDialog = await cancellation(page.getByRole('button', { name: 'Отнеми достъпа до възлагането', exact: true }), 'Отнемане на достъп', async () => assert.equal(shared.length, 1))
  await page.getByRole('button', { name: 'Отнеми достъпа до възлагането', exact: true }).click()
  await accessDialog.getByRole('button', { name: 'Отнеми достъпа', exact: true }).click()
  await accessDialog.waitFor({ state: 'detached' })
  assert.equal(shared.length, 0)
  assert.deepEqual(mutations.at(-1), { method: 'PUT', path: `/api/v1/assignments/${assignment.id}/teachers/${colleague.teacher_id}`, body: { shared: false } })

  const codeDialog = await cancellation(page.getByRole('button', { name: 'Отмени кода', exact: true }), 'Отмяна на код за достъп', async () => assert.equal(codeActive, true))
  await page.getByRole('button', { name: 'Отмени кода', exact: true }).click()
  await codeDialog.getByRole('button', { name: 'Отмени кода', exact: true }).click()
  await codeDialog.waitFor({ state: 'detached' })
  assert.equal(codeActive, false)
  assert.equal(mutations.at(-1).method, 'DELETE')

  await page.getByRole('button', { name: 'Проверка', exact: true }).click()
  await page.getByRole('button', { name: student.name, exact: true }).click()
  const voidDialog = await cancellation(page.getByRole('button', { name: 'Анулирай опита с причина', exact: true }), 'Анулиране на опит', async () => assert.equal(attempt.status, 'pending_review'))
  await page.getByRole('button', { name: 'Анулирай опита с причина', exact: true }).click()
  assert.equal(await voidDialog.getByRole('button', { name: 'Анулирай опита', exact: true }).isDisabled(), true)
  await voidDialog.getByLabel('Причина за анулиране', { exact: true }).fill('   ')
  assert.equal(await voidDialog.getByRole('button', { name: 'Анулирай опита', exact: true }).isDisabled(), true)
  await voidDialog.getByLabel('Причина за анулиране', { exact: true }).fill('  Duplicate attempt  ')
  await voidDialog.getByRole('button', { name: 'Анулирай опита', exact: true }).click()
  await voidDialog.waitFor({ state: 'detached' })
  assert.equal(attempt.status, 'voided')
  assert.deepEqual(mutations.at(-1), { method: 'POST', path: `/api/v1/attempts/${attempt.id}/void`, body: { reason: 'Duplicate attempt' } })
  assert.equal(await page.getByRole('button', { name: 'Анулирай опита с причина', exact: true }).isDisabled(), true)
  assert.equal(mutations.length, 3)

  assignment.teacher_id = colleague.teacher_id
  await page.getByRole('button', { name: 'Възлагания', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Изтрий възлагането', exact: true }).count(), 0)
  assignment.teacher_id = auth.user.id
  await page.reload()
  await page.getByRole('button', { name: 'Възлагания', exact: true }).click()
  await page.getByRole('button', { name: 'Нов код', exact: true }).click()
  await page.locator('.ws-code output').getByText('DELETE2345', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Наблюдение', exact: true }).click()
  await page.locator('.ws-monitor').waitFor()
  const remove = page.getByRole('button', { name: 'Изтрий възлагането', exact: true })
  const unchanged = async () => {
    assert.equal(assignmentVisible, true)
    assert.equal(await page.locator('.ws-section > .ws-table-wrap tbody tr').count(), 1)
    assert.equal(await page.locator('.ws-code output').textContent(), 'DELETE2345')
    assert.equal(await page.locator('.ws-monitor').count(), 1)
  }
  const removeDialog = await cancellation(remove, 'Изтриване на възлагане', unchanged)
  for (const { theme, width, height } of [{ theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 320, height: 740 }]) {
    await page.setViewportSize({ width, height })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    await remove.click()
    assert.equal(await removeDialog.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && element.scrollWidth <= element.clientWidth }), true)
    await page.screenshot({ path: new URL(`assignment-deletion-${theme}-${width}.png`, artifacts).pathname })
    await page.keyboard.press('Escape')
    await removeDialog.waitFor({ state: 'detached' })
    await unchanged()
  }
  await remove.click()
  await removeDialog.getByRole('button', { name: 'Изтрий възлагането', exact: true }).click()
  await removeDialog.getByRole('alert').waitFor()
  assert.equal(await removeDialog.getByRole('alert').textContent(), 'Временно недостъпен сървър. Опитайте отново.')
  await unchanged()
  rejectDeletion = false
  await removeDialog.getByRole('button', { name: 'Изтрий възлагането', exact: true }).evaluate(button => { button.click(); button.click() })
  await deletionStarted
  assert.equal(await removeDialog.getByRole('button', { name: 'Отказ', exact: true }).isDisabled(), true)
  assert.equal(await removeDialog.getByRole('button', { name: 'Изчакване...', exact: true }).isDisabled(), true)
  await page.keyboard.press('Escape')
  assert.equal(await removeDialog.isVisible(), true)
  assert.equal(mutations.filter(mutation => mutation.method === 'DELETE' && mutation.path === `/api/v1/assignments/${assignment.id}`).length, 2)
  releaseDeletion()
  await removeDialog.waitFor({ state: 'detached' })
  assert.equal(assignmentVisible, false)
  assert.equal(await page.locator('.ws-section > .ws-table-wrap tbody tr').count(), 0)
  assert.equal(await page.locator('.ws-code').count(), 0)
  assert.equal(await page.locator('.ws-monitor').count(), 0)
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: test.title, exact: true }).waitFor()
  await page.getByRole('button', { name: 'Възлагания', exact: true }).click()
  assert.equal(await page.locator('.ws-section > .ws-table-wrap tbody tr').count(), 0)
  assert.deepEqual(errors, [])
  console.log('Passed: question/option removal, code revocation, teacher access removal, attempt voiding, owner-only assignment deletion, server-error retry, busy/double-click guard, code/monitor cleanup, source-test preservation, cancel/Escape/focus, desktop/mobile and both themes. API fixtures only; no real data changed.')
} finally {
  await browser.close()
}
