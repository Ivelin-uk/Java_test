import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'test-import-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const definition = { title: 'Споделена алгебра', description: 'Запазена версия от друг учител', subject: 'Математика', level: '8', instructions: '', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, questions: [{ type: 'SINGLE_CHOICE', text: 'Колко е 2 + 2?', difficulty: 'EASY', points: 1, timeSeconds: 30, options: [{ text: '4', correct: true }, { text: '5', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'Събиране' }], additionalInformation: '' }
const own = { id: 201, public_number: '123456789012', owner_id: 101, title: 'Мой тест', status: 'published', shared: false, updated_at: '2026-10-22T10:00:00Z', question_count: 1, total_time_seconds: 30, definition_json: JSON.stringify({ ...definition, title: 'Мой тест' }) }
const source = { ...own, id: 301, public_number: '987654321098', owner_id: 102, title: definition.title, definition_json: JSON.stringify(definition) }
const copy = { ...source, id: 202, public_number: '234567890123', owner_id: 101 }
const tests = [own], mutations = [], errors = []
let importGate = Promise.resolve(), releaseImport
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.addInitScript(value => {
    localStorage.setItem('quicktest.auth', JSON.stringify(value))
    window.copiedNumber = ''
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async number => { window.copiedNumber = number } } })
  }, auth)
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      const data = { '/api/auth/me': auth.user, '/api/v1/tests': tests, '/api/v1/groups': [], '/api/v1/assignments': [], '/api/v1/grading': [] }
      if (Object.hasOwn(data, path)) return respond(data[path])
      const test = tests.find(test => path === `/api/v1/tests/${test.id}`)
      if (test) return respond(test)
    }
    if (method === 'POST' && path === '/api/v1/tests/import') {
      const body = request.postDataJSON()
      mutations.push(body)
      if (body.number !== source.public_number) return respond({ detail: 'Няма достъпен запазен тест с този номер.' }, 400)
      await importGate
      if (!tests.some(test => test.id === copy.id)) tests.push(copy)
      return respond(copy)
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  const library = page.getByRole('table', { name: 'Тестове', exact: true })
  const form = page.getByRole('form', { name: 'Добавяне на тест по номер' })
  const number = form.getByLabel('Номер на тест', { exact: true })
  const submit = form.getByRole('button', { name: 'Добави по номер', exact: true })
  const preview = page.getByRole('region', { name: 'Избран тест' })
  await library.getByText(own.public_number, { exact: true }).waitFor()
  assert.equal(await submit.isDisabled(), true)
  await library.getByRole('button', { name: `Копирай номера на тест ${own.title}`, exact: true }).click()
  await page.getByText('Номерът е копиран.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.copiedNumber), own.public_number)
  assert.equal(await preview.count(), 0)
  assert.equal(mutations.length, 0)
  await number.fill('12abc'); await submit.click()
  await page.getByRole('alert').getByText('Номерът на теста трябва да съдържа 12 цифри.', { exact: true }).waitFor()
  assert.equal(mutations.length, 0)
  await number.fill('111111111111'); await number.press('Enter')
  await page.getByRole('alert').getByText('Няма достъпен запазен тест с този номер.', { exact: true }).waitFor()
  assert.equal(await number.inputValue(), '111111111111')
  assert.equal(tests.length, 1)
  importGate = new Promise(resolve => { releaseImport = resolve })
  await number.fill(` ${source.public_number} `)
  const importRequest = page.waitForRequest(request => request.method() === 'POST' && request.url() === `${base}/api/v1/tests/import`)
  await submit.click(); await importRequest
  assert.equal(await number.isDisabled(), true)
  assert.equal(await submit.isDisabled(), true)
  await form.evaluate(element => { element.requestSubmit(); element.requestSubmit() })
  releaseImport()
  await page.getByText('Тестът е добавен в твоята библиотека.', { exact: true }).waitFor()
  assert.deepEqual(mutations, [{ number: '111111111111' }, { number: source.public_number }])
  assert.equal(await number.inputValue(), '')
  await library.getByText(copy.public_number, { exact: true }).waitFor()
  await preview.getByText(definition.questions[0].text, { exact: true }).waitFor()
  assert.equal(await preview.getByRole('button', { name: 'Редактирай теста', exact: true }).isEnabled(), true)
  assert.equal(await library.getByText(source.public_number, { exact: true }).count(), 0)
  assert.equal(await library.locator('tbody tr').count(), 2)
  await number.fill(source.public_number); await number.press('Enter')
  await page.getByText('Тестът е добавен в твоята библиотека.', { exact: true }).waitFor()
  assert.equal(await library.locator('tbody tr').count(), 2)
  assert.equal(mutations.length, 3)
  await preview.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  assert.equal(await page.getByLabel('Тема', { exact: true }).inputValue(), copy.title)
  await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await page.reload()
  await library.getByText(copy.public_number, { exact: true }).waitFor()
  await library.getByRole('button', { name: copy.title, exact: true }).click()
  await preview.getByText(definition.questions[0].text, { exact: true }).waitFor()
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await form.scrollIntoViewIfNeeded()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await library.locator('tbody tr').evaluateAll(rows => rows.every(row => row.getBoundingClientRect().height < 150)), true)
    assert.equal(await submit.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.height >= 32 }), true)
    await page.screenshot({ path: new URL(`test-import-${width}.png`, artifacts).pathname, fullPage: true })
  }
  assert.equal(source.owner_id, 102)
  assert.equal(copy.owner_id, 101)
  assert.equal(copy.status, 'published')
  assert.deepEqual(errors, [])
  console.log('Passed: test numbers, copy button, input validation, unavailable number/retry, busy and double-submit guards, import preview/editing, duplicate import, reload and desktop/mobile layouts. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('test-import-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  releaseImport?.()
  await browser.close()
}
