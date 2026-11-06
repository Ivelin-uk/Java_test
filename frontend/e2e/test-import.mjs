import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { chooseTestCreation } from './helpers/test-creation.mjs'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'test-import-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const definition = { title: 'Споделена алгебра', description: 'Запазена версия от друг учител', subject: 'Математика', level: '8', instructions: '', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, questions: [{ type: 'SINGLE_CHOICE', text: 'Колко е 2 + 2?', difficulty: 'EASY', points: 1, timeSeconds: 30, options: [{ text: '4', correct: true }, { text: '5', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'Събиране' }], additionalInformation: '' }
const own = { id: 201, public_number: '123456789012', owner_id: 101, title: 'Мой тест', status: 'published', shared: false, mobile_allowed: false, updated_at: '2026-10-22T10:00:00Z', question_count: 1, total_time_seconds: 30, definition_json: JSON.stringify({ ...definition, title: 'Мой тест' }) }
const source = { ...own, id: 301, public_number: '987654321098', owner_id: 102, title: definition.title, definition_json: JSON.stringify(definition) }
const copy = { ...source, id: 202, public_number: '234567890123', owner_id: 101 }
const tests = [own], mutations = [], mobileMutations = [], previewRequests = [], errors = []
let importGate = Promise.resolve(), releaseImport
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.addInitScript(value => {
    localStorage.setItem('quicktest.auth', JSON.stringify(value))
    localStorage.setItem('quicktest.theme', 'light')
    window.copiedNumber = ''
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async number => { window.copiedNumber = number } } })
  }, auth)
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (['/api/v1/subjects', '/api/v1/subjects/topics', '/api/v1/subjects/topics/personal'].includes(path) && method === 'GET') return respond([])
    if (method === 'GET') {
      const data = { '/api/auth/me': auth.user, '/api/v1/tests': tests, '/api/v1/groups': [], '/api/v1/assignments': [], '/api/v1/grading': [] }
      if (Object.hasOwn(data, path)) return respond(data[path])
      const test = tests.find(test => path === `/api/v1/tests/${test.id}`)
      if (test) { previewRequests.push(test.id); return respond(test) }
    }
    if (method === 'PUT') {
      const test = tests.find(test => path === `/api/v1/tests/${test.id}/mobile-mode`)
      if (test) {
        const body = request.postDataJSON()
        mobileMutations.push({ id: test.id, ...body })
        test.mobile_allowed = body.mobileAllowed
        return respond({})
      }
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
  const libraryTab = page.getByRole('tab', { name: 'Моите тестове', exact: true })
  const importTab = page.getByRole('tab', { name: 'Добави от учител', exact: true })
  const form = page.getByRole('form', { name: 'Добавяне на тест по номер' })
  const number = form.getByLabel('Номер на тест', { exact: true })
  const submit = form.getByRole('button', { name: 'Добави по номер', exact: true })
  const preview = page.getByRole('region', { name: 'Избран тест' })
  const searchInput = page.getByRole('search', { name: 'Търсене в библиотеката', exact: true }).locator('input[type="search"]')
  async function assertSelectedTab(selected) {
    await (selected === 'library' ? libraryTab : importTab).and(page.locator('[aria-selected="true"]')).waitFor()
    for (const [name, tab] of [['library', libraryTab], ['import', importTab]]) {
      const active = name === selected
      assert.equal(await tab.getAttribute('aria-selected'), String(active))
      assert.equal(await tab.getAttribute('tabindex'), active ? '0' : '-1')
      const panelId = await tab.getAttribute('aria-controls')
      assert.ok(panelId, 'Every subsection tab must identify its panel')
      const panel = page.locator(`[id=${JSON.stringify(panelId)}]`)
      await panel.waitFor({ state: active ? 'visible' : 'hidden' })
      if (active) {
        assert.equal(await panel.getAttribute('role'), 'tabpanel')
        assert.equal(await panel.getAttribute('aria-labelledby'), await tab.getAttribute('id'))
      }
    }
  }
  await library.getByText(own.public_number, { exact: true }).waitFor()
  await assertSelectedTab('library')
  assert.equal(await libraryTab.locator('.ws-library-tab-count').innerText(), '1')
  assert.equal(await form.count(), 0, 'Import must have a separate subsection')
  await libraryTab.focus()
  for (const [key, selected, focused] of [
    ['ArrowRight', 'import', importTab],
    ['Home', 'library', libraryTab],
    ['End', 'import', importTab],
    ['ArrowLeft', 'library', libraryTab],
  ]) {
    await page.keyboard.press(key)
    await assertSelectedTab(selected)
    assert.equal(await focused.evaluate(element => element === document.activeElement), true)
  }
  await searchInput.fill(own.title)
  await importTab.click()
  await assertSelectedTab('import')
  assert.equal(await library.count(), 0)
  await libraryTab.click()
  await assertSelectedTab('library')
  assert.equal(await searchInput.inputValue(), own.title, 'Switching subsections must preserve the library search')
  await searchInput.fill('')
  const ownRow = library.getByRole('row').filter({ has: page.getByRole('button', { name: own.title, exact: true }) })
  const mobileSwitch = ownRow.getByRole('checkbox', { name: `Разреши решаване от телефон: ${own.title}`, exact: true })
  assert.equal(await mobileSwitch.isChecked(), false)
  const mobileResponse = page.waitForResponse(response => response.request().method() === 'PUT' && response.url() === `${base}/api/v1/tests/${own.id}/mobile-mode`)
  await ownRow.locator('.ws-library-mobile').click({ position: { x: 30, y: 18 } })
  await mobileResponse
  await page.getByText('Настройката за телефон е приложена към всички възлагания.', { exact: true }).waitFor()
  assert.equal(await mobileSwitch.isChecked(), true, 'Clicking the visible mobile switch track must update its state')
  assert.deepEqual(mobileMutations, [{ id: own.id, mobileAllowed: true }])
  assert.deepEqual(previewRequests, [], 'Mobile switch clicks must not fetch a test preview')
  assert.equal(await library.locator('tr[aria-selected="true"]').count(), 0)
  assert.equal(await preview.count(), 0)
  await library.getByRole('button', { name: `Копирай номера на тест ${own.title}`, exact: true }).click()
  await page.getByText('Номерът е копиран.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.copiedNumber), own.public_number)
  assert.equal(await preview.count(), 0)
  assert.equal(mutations.length, 0)
  await importTab.click()
  await assertSelectedTab('import')
  assert.equal(await submit.isDisabled(), true)
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
  await assertSelectedTab('library')
  await library.getByText(copy.public_number, { exact: true }).waitFor()
  await preview.getByText(definition.questions[0].text, { exact: true }).waitFor()
  assert.equal(await preview.getByRole('button', { name: 'Редактирай теста', exact: true }).isEnabled(), true)
  assert.equal(await library.getByText(source.public_number, { exact: true }).count(), 0)
  assert.equal(await library.locator('tbody tr').count(), 2)
  assert.equal(await libraryTab.locator('.ws-library-tab-count').innerText(), '2')
  await importTab.click()
  await assertSelectedTab('import')
  assert.equal(await number.inputValue(), '', 'Successful import must clear the number field')
  await number.fill(source.public_number); await number.press('Enter')
  await page.getByText('Тестът е добавен в твоята библиотека.', { exact: true }).waitFor()
  await assertSelectedTab('library')
  assert.equal(await library.locator('tbody tr').count(), 2)
  assert.equal(await libraryTab.locator('.ws-library-tab-count').innerText(), '2')
  assert.equal(mutations.length, 3)
  await preview.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  assert.equal(await page.getByLabel('Тема', { exact: true }).inputValue(), copy.title)
  await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await assertSelectedTab('library')
  await page.reload()
  await library.getByText(copy.public_number, { exact: true }).waitFor()
  await assertSelectedTab('library')
  await library.getByRole('button', { name: copy.title, exact: true }).click()
  await preview.getByText(definition.questions[0].text, { exact: true }).waitFor()
  await importTab.click()
  await chooseTestCreation(page, 'manual')
  await page.getByLabel('Тема', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await assertSelectedTab('library')
  await importTab.click()
  await chooseTestCreation(page, 'ai')
  await page.getByRole('heading', { name: 'Създаване на тест с AI', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await assertSelectedTab('library')
  await library.getByRole('button', { name: copy.title, exact: true }).click()
  await preview.getByText(definition.questions[0].text, { exact: true }).waitFor()
  for (const [theme, width] of ['light', 'dark'].flatMap(theme => [1440, 390, 320].map(width => [theme, width]))) {
    await page.setViewportSize({ width, height: 1000 })
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
      await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    }
    await libraryTab.click()
    await assertSelectedTab('library')
    await library.scrollIntoViewIfNeeded()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    if (width > 760) assert.equal(await library.locator('tbody tr').evaluateAll(rows => rows.every(row => row.getBoundingClientRect().height < 150)), true)
    else assert.equal(await library.locator('tbody tr').evaluateAll(rows => rows.every(row => {
      const box = row.getBoundingClientRect()
      return box.left >= 0 && box.right <= innerWidth && [...row.cells].every(cell => cell.getAttribute('data-label'))
    })), true, 'Mobile cards must fit the viewport and label every field')
    await page.screenshot({ path: new URL(`test-library-tabs-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
    await importTab.click()
    await assertSelectedTab('import')
    await form.scrollIntoViewIfNeeded()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await submit.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.height >= 32 }), true)
    await page.screenshot({ path: new URL(`test-import-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  assert.equal(source.owner_id, 102)
  assert.equal(copy.owner_id, 101)
  assert.equal(copy.status, 'published')
  assert.deepEqual(errors, [])
  console.log('Passed: accessible subsection tabs and keyboard navigation, preserved search, mobile switch without preview selection, test counts/numbers, copy button, input validation, unavailable number/retry, busy and double-submit guards, import navigation/preview/editing, duplicate import, reload, light/dark desktop and mobile layouts. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('test-import-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  releaseImport?.()
  await browser.close()
}
