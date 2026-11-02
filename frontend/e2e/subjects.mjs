import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'subject-fixture', user: { id: 101, name: 'Учител по предмети', email: 'subjects@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const question = { type: 'SINGLE_CHOICE', text: 'Колко е 2 + 2?', difficulty: 'EASY', points: 1, timeSeconds: 60, options: [{ text: '4', correct: true }, { text: '5', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: '' }
const definition = (title, subject) => ({ title, subject, description: '', level: '', instructions: '', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, questions: [question] })
let tests = [['Първи тест', 'Математика'], ['Втори тест', 'МАТЕМАТИКА'], ['Стар тест', 'Авиация'], ['Тест без предмет', '']].map(([title, subject], index) => ({ id: index + 1, title, subject, owner_id: 101, public_number: String(123456789100 + index), status: 'published', shared: false, question_count: 1, total_time_seconds: 60, updated_at: '2026-11-02T10:00:00Z', definition_json: JSON.stringify(definition(title, subject)) }))
let subjects = ['Математика', 'Английски език', 'Авиация'].map(name => ({ name, preset: name !== 'Авиация' }))
const errors = [], creations = [], writes = [], generationRequests = [], topicQueries = []
let generated
let failCatalog = true, failCreate = true
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
  await context.addInitScript(value => { localStorage.setItem('quicktest.auth', JSON.stringify(value)); history.replaceState({ examaiView: 'tests' }, '') }, auth)
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (/In HTML|cannot be a descendant|hydration error/.test(message.text())) errors.push(message.text()) })
  await page.route(`${base}/api/**`, async route => {
    const request = route.request(), method = request.method(), path = new URL(request.url()).pathname
    const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    assert.equal(request.headers().authorization, `Bearer ${auth.token}`)
    if (path === '/api/auth/me') return respond(auth.user)
    if (path === '/api/v1/subjects/topics') {
      const query = new URL(request.url()).searchParams
      const subject = query.get('subject'), level = query.get('level')
      topicQueries.push({ subject, level })
      return respond(subject === 'Математика' ? ['Уравнения', 'Дроби'] : subject === 'Английски език' ? ['Граматика'] : [])
    }
    if (path === '/api/v1/ai/test-generations' && method === 'POST') {
      const body = request.postDataJSON(); generationRequests.push(body)
      generated = { ...definition(body.topic, body.subject), level: body.level, questions: Array.from({ length: body.questionCount }, () => ({ ...question })) }
      return respond({ id: 301, status: 'queued', result_json: null, error_message: null })
    }
    if (path === '/api/v1/ai/test-generations/301') return respond({ id: 301, status: 'completed', result_json: JSON.stringify({ definition: generated }), error_message: null })
    if (path === '/api/v1/subjects') {
      if (method === 'GET') {
        if (failCatalog) return respond({ detail: 'Temporary catalog failure' }, 503)
        return respond(subjects)
      }
      const body = request.postDataJSON(); creations.push(body)
      if (failCreate) { failCreate = false; return respond({ detail: 'Временна грешка. Опитайте отново.' }, 503) }
      const name = body.name.normalize('NFKC').trim().replace(/\s+/g, ' ')
      let subject = subjects.find(value => value.name.toLocaleLowerCase('bg') === name.toLocaleLowerCase('bg'))
      if (!subject) { subject = { name, preset: false }; subjects.push(subject) }
      return respond(subject)
    }
    if (path === '/api/v1/tests' && method === 'GET') return respond(tests)
    const match = path.match(/^\/api\/v1\/tests\/(\d+)(\/publish)?$/)
    if (match) {
      const id = Number(match[1]), test = tests.find(test => test.id === id)
      if (method === 'GET') return respond(test)
      writes.push({ method, path })
      if (method === 'PUT') {
        const value = request.postDataJSON()
        const next = { ...test, title: value.title, subject: value.subject, level: value.level, definition_json: JSON.stringify(value) }
        tests = tests.map(test => test.id === id ? next : test)
        return respond(next)
      }
      if (match[2]) return respond({ id: id + 100, version_number: 2 })
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  await page.goto(frontend)
  const library = page.getByRole('table', { name: 'Тестове', exact: true })
  const filter = page.getByLabel('Филтрирай по дисциплина', { exact: true })
  await library.getByRole('button', { name: 'Първи тест', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Зареди дисциплините', exact: true }).waitFor()
  failCatalog = false
  await page.getByRole('button', { name: 'Зареди дисциплините', exact: true }).click()
  await filter.getByRole('option', { name: 'Английски език (0)', exact: true }).waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'С AI', exact: true }).click()
  let creator = page.getByRole('region', { name: 'Създаване на тест с AI', exact: true })
  assert.equal(await creator.getByLabel('Тема', { exact: true }).isDisabled(), true)
  assert.equal(await creator.getByLabel('Клас', { exact: true }).isDisabled(), true)
  await creator.getByLabel('Дисциплина', { exact: true }).selectOption('Математика')
  await creator.getByLabel('Клас', { exact: true }).selectOption('7')
  await creator.locator('datalist option[value="Уравнения"]').waitFor({ state: 'attached' })
  await creator.getByLabel('Тема', { exact: true }).fill('Уравнения')
  await creator.getByLabel('Дисциплина', { exact: true }).selectOption('Английски език')
  assert.equal(await creator.getByLabel('Тема', { exact: true }).inputValue(), '')
  await creator.locator('datalist option[value="Граматика"]').waitFor({ state: 'attached' })
  assert.equal(await creator.locator('datalist option[value="Уравнения"]').count(), 0)
  await creator.getByLabel('Дисциплина', { exact: true }).selectOption('Математика')
  await creator.getByLabel('Тема', { exact: true }).fill('Уравнения')
  await creator.getByRole('button', { name: 'Генерирай', exact: true }).click()
  let generatedSettings = page.getByRole('group', { name: 'Настройки на теста', exact: true })
  await generatedSettings.waitFor()
  assert.equal(generationRequests.at(-1).level, '7')
  assert.equal(generationRequests.at(-1).subject, 'Математика')
  assert.equal(await generatedSettings.getByLabel('Клас', { exact: true }).inputValue(), '7')
  assert.equal(await generatedSettings.getByLabel('Тема', { exact: true }).inputValue(), 'Уравнения')
  assert.ok(topicQueries.some(query => query.subject === 'Английски език' && query.level === '7'))
  await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await filter.selectOption('subject:математика')
  assert.equal(await library.locator('tbody tr').count(), 2)
  const search = page.getByRole('search').locator('input[type=search]')
  await search.fill('първи')
  assert.equal(await library.locator('tbody tr').count(), 1)
  await page.getByRole('button', { name: 'Изчисти търсенето', exact: true }).click()
  assert.equal(await library.locator('tbody tr').count(), 2)
  await filter.selectOption('unassigned')
  await library.getByRole('button', { name: 'Тест без предмет', exact: true }).waitFor()
  assert.equal(await library.locator('tbody tr').count(), 1)
  await page.getByRole('button', { name: 'Добави дисциплина', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Нова дисциплина', exact: true })
  assert.equal(await dialog.getByRole('button', { name: 'Добави дисциплина', exact: true }).isDisabled(), true)
  await dialog.getByLabel('Име на дисциплината', { exact: true }).fill('  Авиационни   системи  ')
  await dialog.getByRole('button', { name: 'Добави дисциплина', exact: true }).click()
  await dialog.getByRole('alert').getByText('Временна грешка. Опитайте отново.').waitFor()
  await dialog.getByRole('button', { name: 'Добави дисциплина', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await filter.inputValue(), 'subject:авиационни системи')
  assert.equal(creations.at(-1).name, 'Авиационни системи')
  await page.getByRole('button', { name: 'Ръчен тест', exact: true }).click()
  let settings = page.getByRole('group', { name: 'Настройки на теста', exact: true })
  assert.equal(await settings.getByLabel('Дисциплина', { exact: true }).inputValue(), 'Авиационни системи')
  await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await page.getByRole('button', { name: 'С AI', exact: true }).click()
  let ai = page.getByRole('region', { name: 'Създаване на тест с AI', exact: true })
  assert.equal(await ai.getByLabel('Дисциплина', { exact: true }).inputValue(), 'Авиационни системи')
  await ai.getByRole('button', { name: 'Добави дисциплина', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Нова дисциплина', exact: true })
  await dialog.getByLabel('Име на дисциплината', { exact: true }).fill('Електроника')
  await dialog.getByRole('button', { name: 'Добави дисциплина', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await ai.getByLabel('Дисциплина', { exact: true }).inputValue(), 'Електроника')
  assert.equal(writes.length, 0, 'Creating a subject inside the AI form must not submit the parent form')
  await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await filter.selectOption('subject:математика')
  const row = library.getByRole('row').filter({ has: page.getByRole('button', { name: 'Първи тест', exact: true }) })
  await row.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  settings = page.getByRole('group', { name: 'Настройки на теста', exact: true })
  await settings.getByLabel('Дисциплина', { exact: true }).selectOption('Английски език')
  await settings.getByLabel('Клас', { exact: true }).selectOption('8')
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await library.getByRole('button', { name: 'Първи тест', exact: true }).waitFor()
  assert.equal(await filter.inputValue(), 'subject:английски език')
  assert.equal(await library.locator('tbody tr').count(), 1)
  assert.deepEqual(writes, [{ method: 'PUT', path: '/api/v1/tests/1' }, { method: 'POST', path: '/api/v1/tests/1/publish' }])
  assert.equal(JSON.parse(tests[0].definition_json).subject, 'Английски език')
  assert.equal(JSON.parse(tests[0].definition_json).level, '8')
  await library.getByText('8. клас', { exact: true }).waitFor()
  await page.reload()
  await filter.getByRole('option', { name: 'Електроника (0)', exact: true }).waitFor({ state: 'attached' })
  await filter.selectOption('subject:авиация')
  await library.getByRole('button', { name: 'Стар тест', exact: true }).waitFor()
  await filter.selectOption('')
  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await library.scrollIntoViewIfNeeded()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: new URL(`subjects-library-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
    }
  }
  await page.getByRole('button', { name: 'С AI', exact: true }).click()
  ai = page.getByRole('region', { name: 'Създаване на тест с AI', exact: true })
  await ai.getByRole('button', { name: 'Добави дисциплина', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Нова дисциплина', exact: true })
  await dialog.getByLabel('Име на дисциплината', { exact: true }).fill('Нова дисциплина за професионално образование')
  await page.screenshot({ path: new URL('subjects-dialog-mobile.png', artifacts).pathname, fullPage: true })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  console.log('Passed: catalog retry, case-insensitive subject filters with search, unassigned/legacy tests, persistent creation, failed-create retry, manual and AI selection, nested-form safety, edit/save/publish, dark/light desktop/mobile, dialog Escape. API fixtures only.')
} catch (error) {
  if (page) await page.screenshot({ path: new URL('subjects-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally { await browser.close() }
