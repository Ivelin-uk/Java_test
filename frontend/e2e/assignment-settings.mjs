import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const auth = { token: 'assignment-settings-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const test = { id: 201, title: 'Нов тест за автоматична проверка', status: 'published', owner_id: 101, shared: false }
const group = { id: 301, name: '12А', subject: 'Java' }
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  for (const { width, theme } of [{ width: 1440, theme: 'light' }, { width: 390, theme: 'dark' }, { width: 320, theme: 'light' }]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem('quicktest.auth', JSON.stringify(auth)); localStorage.setItem('quicktest.theme', theme) }, { auth, theme })
    const assignments = [601, 602].map(id => ({ id, assessment_id: 401, teacher_id: 101, title: 'Вече възложен тест', starts_at: '2098-10-14T07:00:00Z', ends_at: '2098-10-14T08:00:00Z', recipients: 1, recipient_groups: [group], access_code: 'ABCD2345', shuffle_questions: true, shuffle_options: false, answers_after_deadline: true, auto_ai_grading: false }))
    const errors = [], saves = [], creations = []
    let failNext = false, holdSave = false, releaseSave
    // Every API request is local; no real assignment, AI call or publication occurs.
    await context.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      if (!path.startsWith('/api/')) return route.continue()
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (method === 'GET') {
        const data = { '/api/auth/me': auth.user, '/api/v1/tests': [test], '/api/v1/groups': [group], '/api/v1/assignments': assignments, '/api/v1/tests/201/versions': [{ id: 202, version_number: 1 }] }
        if (Object.hasOwn(data, path)) return respond(data[path])
      }
      const settings = path.match(/^\/api\/v1\/assignments\/(601|602)\/settings$/)
      if (method === 'PUT' && settings) {
        const value = request.postDataJSON(), id = Number(settings[1])
        saves.push({ id, ...value })
        if (failNext) { failNext = false; return respond({ detail: 'Настройките временно не могат да се запазят.' }, 503) }
        if (holdSave) { holdSave = false; await new Promise(resolve => { releaseSave = resolve }) }
        Object.assign(assignments.find(row => row.id === id), { shuffle_questions: value.shuffleQuestions, shuffle_options: value.shuffleOptions, answers_after_deadline: value.answersAfterDeadline, auto_ai_grading: value.autoAiGrading })
        return route.fulfill({ status: 200, body: '' })
      }
      if (method === 'POST' && path === '/api/v1/assignments') {
        const value = request.postDataJSON(); creations.push(value)
        assignments.push({ ...assignments[0], id: 603, assessment_id: test.id, title: test.title, starts_at: value.startsAt, ends_at: value.endsAt, shuffle_questions: value.shuffleQuestions, shuffle_options: value.shuffleOptions, answers_after_deadline: value.answersAfterDeadline, auto_ai_grading: value.autoAiGrading })
        return respond({ id: 603, recipients: 1 })
      }
      errors.push(`${method} ${path}`)
      return respond({}, 404)
    })
    page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${frontend}/assignments`)
    const form = page.getByRole('form', { name: 'Възлагане на тест', exact: true })
    const table = page.getByRole('table', { name: 'Възлагания', exact: true })
    const first = table.locator('tbody tr').first(), second = table.locator('tbody tr').nth(1)
    const edit = first.getByRole('button', { name: 'Настройки: Вече възложен тест', exact: true })
    const dialog = page.getByRole('dialog', { name: 'Настройки на възлагането', exact: true })
    const ai = dialog.getByRole('checkbox', { name: 'Автоматична проверка с AI', exact: true })
    const save = dialog.getByRole('button', { name: 'Запази настройките', exact: true })
    await edit.click()
    assert.equal(await dialog.getByRole('checkbox').count(), 4)
    assert.equal(await dialog.getByLabel('Разбъркай въпросите', { exact: true }).isChecked(), true)
    assert.equal(await dialog.getByLabel('Разбъркай опциите', { exact: true }).isChecked(), false)
    assert.equal(await dialog.getByLabel('Верни отговори след срока', { exact: true }).isChecked(), true)
    assert.equal(await ai.isChecked(), false)
    await ai.check(); await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
    assert.equal(saves.length, 0)
    assert.equal(await edit.evaluate(element => element === document.activeElement), true)
    await edit.click(); assert.equal(await ai.isChecked(), false)
    await ai.check(); failNext = true; await save.click()
    await dialog.getByRole('alert').getByText('Настройките временно не могат да се запазят.', { exact: true }).waitFor()
    assert.equal(await ai.isChecked(), true)
    assert.equal(assignments[0].auto_ai_grading, false)
    holdSave = true
    const pending = page.waitForRequest(request => request.method() === 'PUT')
    await save.click(); await pending
    assert.equal(await dialog.getAttribute('aria-busy'), 'true')
    assert.equal(await ai.isDisabled(), true)
    assert.equal(await dialog.getByRole('button', { name: 'Отказ', exact: true }).isDisabled(), true)
    await dialog.locator('form').evaluate(element => { element.requestSubmit(); element.requestSubmit() })
    await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true)
    assert.equal(saves.length, 2)
    releaseSave(); await dialog.waitFor({ state: 'hidden' })
    await first.getByText('AI: автоматична проверка', { exact: true }).waitFor()
    await second.getByText('AI: ръчна заявка', { exact: true }).waitFor()
    assert.deepEqual(saves[1], { id: 601, shuffleQuestions: true, shuffleOptions: false, answersAfterDeadline: true, autoAiGrading: true })
    await page.reload(); await edit.click(); assert.equal(await ai.isChecked(), true)
    await dialog.getByLabel('Разбъркай въпросите', { exact: true }).uncheck()
    await dialog.getByLabel('Разбъркай опциите', { exact: true }).check()
    await dialog.getByLabel('Верни отговори след срока', { exact: true }).uncheck()
    await save.click(); await dialog.waitFor({ state: 'hidden' }); await edit.click()
    assert.equal(await dialog.getByLabel('Разбъркай въпросите', { exact: true }).isChecked(), false)
    assert.equal(await dialog.getByLabel('Разбъркай опциите', { exact: true }).isChecked(), true)
    assert.equal(await dialog.getByLabel('Верни отговори след срока', { exact: true }).isChecked(), false)
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true)
    await dialog.screenshot({ path: new URL(`assignment-settings-${theme}-${width}.png`, artifacts).pathname })
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await form.getByLabel('Автоматична проверка с AI', { exact: true }).isChecked(), false)
    await form.getByRole('combobox', { name: 'Тест', exact: true }).fill(test.title)
    await page.getByRole('listbox', { name: 'Тестове за възлагане', exact: true }).getByRole('option').click()
    await form.getByRole('combobox', { name: 'Търси групи', exact: true }).click()
    await page.getByRole('listbox', { name: 'Групи', exact: true }).getByRole('option', { name: group.name, exact: true }).click()
    await form.getByLabel('Начало', { exact: true }).fill('2098-10-14T10:00')
    await form.getByLabel('Краен срок', { exact: true }).fill('2098-10-14T11:00')
    await form.getByLabel('Автоматична проверка с AI', { exact: true }).check()
    await form.getByRole('button', { name: 'Възложи', exact: true }).click()
    await table.getByText(test.title, { exact: true }).waitFor()
    assert.equal(creations.length, 1); assert.equal(creations[0].autoAiGrading, true)
    await form.getByRole('button', { name: 'Нулирай формата', exact: true }).click()
    assert.equal(await form.getByLabel('Автоматична проверка с AI', { exact: true }).isChecked(), false)
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('Passed: four assignment settings, persisted per-row editing, cancel/Escape and focus, save failure/retry, duplicate-submit protection, unrelated assignment unchanged, automatic AI opt-in creation and reset, desktop/mobile and both themes. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('assignment-settings-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally { await browser.close() }
