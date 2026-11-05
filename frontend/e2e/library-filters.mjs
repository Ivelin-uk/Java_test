import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'library-filter-fixture', user: { id: 101, name: 'Учител', email: 'library-filters@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const makeTest = (id, title, subject, level, count, difficulties) => ({
  id, title, subject, level, public_number: String(123456789000 + id), owner_id: 101, status: 'published', shared: false, mobile_allowed: false,
  updated_at: '2026-11-05T12:00:00Z', question_count: count, total_time_seconds: count * 60,
  definition_json: JSON.stringify({ title, subject, level, description: '', instructions: '', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50,
    questions: Array.from({ length: count }, (_, index) => ({ type: 'SINGLE_CHOICE', text: `Въпрос ${index + 1}`, difficulty: difficulties[index % difficulties.length], points: 1, timeSeconds: 60,
      options: [{ text: 'Да', correct: true }, { text: 'Не', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: '' })) }),
})
const tests = [
  makeTest(201, 'Алгебра — основи', 'Математика', '8', 5, ['EASY']),
  makeTest(202, 'Алгебра — упражнения', 'Математика', '8', 5, ['MEDIUM']),
  makeTest(203, 'Алгебра — задачи', 'Математика', '9', 10, ['HARD']),
  makeTest(204, 'Геометрия', 'Математика', '8', 5, ['EASY', 'HARD']),
  makeTest(205, 'Алгебра в биологията', 'Биология', '8', 5, ['EASY']),
  makeTest(206, 'Лексика', 'Английски език', '', 3, ['VERY_HARD']),
  makeTest(207, 'Механика', 'Физика', 'B2', 2, ['MEDIUM']),
  { ...makeTest(208, 'Стар запис', '', '', 0, ['EASY']), definition_json: '{invalid json' },
]
// Older list responses provide these fields only inside definition_json.
delete tests[6].subject
delete tests[6].level
const copy = makeTest(209, 'Внесен тест', 'Английски език', '12', 1, ['EASY'])
const importNumber = '987654321098'
const errors = [], imports = []
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' })
  await context.addInitScript(value => {
    localStorage.setItem('quicktest.auth', JSON.stringify(value))
    localStorage.setItem('quicktest.theme', 'light')
    history.replaceState({ examaiView: 'tests' }, '')
  }, auth)
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), method = request.method(), path = new URL(request.url()).pathname
    const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (method === 'GET') {
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/v1/tests') return respond(tests)
      if (path === '/api/v1/subjects') return respond(['Математика', 'Биология', 'Английски език', 'Физика'].map(name => ({ name, preset: true })))
      if (['/api/v1/subjects/topics', '/api/v1/subjects/topics/personal', '/api/v1/groups', '/api/v1/assignments', '/api/v1/grading'].includes(path)) return respond([])
      const test = tests.find(test => path === `/api/v1/tests/${test.id}`)
      if (test) return respond(test)
    }
    if (method === 'POST' && path === '/api/v1/tests/import') {
      imports.push(request.postDataJSON())
      if (!tests.some(test => test.id === copy.id)) tests.push(copy)
      return respond(copy)
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(frontend)
  const search = page.getByRole('search', { name: 'Търсене в библиотеката', exact: true })
  const query = search.locator('input[type="search"]')
  const subject = search.getByLabel('Филтрирай по дисциплина', { exact: true })
  const topic = search.getByRole('combobox', { name: 'Филтрирай по тема', exact: true })
  const grade = search.getByLabel('Филтрирай по клас', { exact: true })
  const count = search.getByLabel('Филтрирай по брой въпроси', { exact: true })
  const difficulty = search.getByLabel('Филтрирай по трудност', { exact: true })
  const reset = search.getByRole('button', { name: 'Изчисти търсенето', exact: true })
  const library = page.getByRole('table', { name: 'Тестове', exact: true })
  const libraryTab = page.getByRole('tab', { name: 'Моите тестове', exact: true })
  const importTab = page.getByRole('tab', { name: 'Добави от учител', exact: true })
  const visibleNumbers = () => library.locator('tbody tr .ws-test-number code').allTextContents()
  async function expectTests(ids) {
    await page.waitForFunction(({ expected, selector }) => {
      const actual = [...document.querySelectorAll(selector)].map(node => node.textContent)
      return JSON.stringify(actual) === JSON.stringify(expected)
    }, { expected: ids.map(id => String(123456789000 + id)), selector: '.ws-library-table tbody .ws-test-number code' })
    assert.deepEqual(await visibleNumbers(), ids.map(id => String(123456789000 + id)))
  }
  async function expectReset() {
    for (const field of [query, subject, topic, grade, count, difficulty]) assert.equal(await field.inputValue(), '')
  }
  await library.waitFor()
  await expectTests([201, 202, 203, 204, 205, 206, 207, 208])
  assert.equal(await reset.isDisabled(), true)

  await query.fill('  АЛГЕБРА  ')
  await expectTests([201, 202, 203, 205])
  await query.fill('789202')
  await expectTests([202])
  await reset.click()
  await subject.selectOption('subject:математика')
  await expectTests([201, 202, 203, 204])
  await reset.click()
  await topic.fill('  АЛГЕБРА  ')
  await expectTests([201, 202, 203, 205])
  await reset.click()
  await grade.selectOption('8')
  await expectTests([201, 202, 204, 205])
  await reset.click()
  await grade.selectOption('unassigned')
  await expectTests([206, 208])
  await reset.click()
  await count.fill('5')
  await expectTests([201, 202, 204, 205])
  await reset.click()
  for (const [value, ids] of [['EASY', [201, 205]], ['MEDIUM', [202, 207]], ['HARD', [203]], ['VERY_HARD', [206]], ['MIXED', [204]]]) {
    await difficulty.selectOption(value)
    await expectTests(ids)
  }
  await reset.click()
  await subject.selectOption('subject:физика')
  await grade.selectOption('B2')
  await difficulty.selectOption('MEDIUM')
  await expectTests([207])
  await reset.click()

  // Filters combine, rather than replacing the text search or one another.
  await subject.selectOption('subject:математика')
  await topic.fill('алгебра')
  await grade.selectOption('8')
  await count.fill('5')
  await difficulty.selectOption('MEDIUM')
  await query.fill('789202')
  await expectTests([202])
  await count.fill('10')
  await expectTests([])
  assert.equal(await search.getByRole('status').innerText(), '0 от 8 теста')
  await reset.click()
  await expectReset()
  await expectTests([201, 202, 203, 204, 205, 206, 207, 208])

  await topic.fill('Алгебра')
  await subject.selectOption('subject:биология')
  assert.equal(await topic.inputValue(), '', 'Changing discipline must clear the previous topic')
  await expectTests([205])
  await reset.click()
  await subject.selectOption('subject:математика')
  await topic.fill('Геометрия')
  await grade.selectOption('8')
  await count.fill('5')
  await difficulty.selectOption('MIXED')
  await query.fill('Геометрия')
  await expectTests([204])
  await importTab.click()
  await libraryTab.click()
  assert.deepEqual(await Promise.all([query, subject, topic, grade, count, difficulty].map(field => field.inputValue())), ['Геометрия', 'subject:математика', 'Геометрия', '8', '5', 'MIXED'])
  await expectTests([204])

  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 })
      await search.scrollIntoViewIfNeeded()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme} ${width}: page must not overflow horizontally`)
      assert.equal(await search.locator('input,select,button').evaluateAll(controls => controls.filter(control => control.checkVisibility()).every(control => {
        const box = control.getBoundingClientRect()
        return box.left >= 0 && box.right <= innerWidth
      })), true, `${theme} ${width}: every filter must fit the viewport`)
      await page.screenshot({ path: new URL(`library-filters-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
    }
  }

  // Successful import clears every filter so the newly added copy is visible.
  await importTab.click()
  const form = page.getByRole('form', { name: 'Добавяне на тест по номер', exact: true })
  await form.getByLabel('Номер на тест', { exact: true }).fill(importNumber)
  await form.getByRole('button', { name: 'Добави по номер', exact: true }).click()
  await page.getByText('Тестът е добавен в твоята библиотека.', { exact: true }).waitFor()
  await libraryTab.and(page.locator('[aria-selected="true"]')).waitFor()
  await expectReset()
  await expectTests([201, 202, 203, 204, 205, 206, 207, 208, 209])
  assert.deepEqual(imports, [{ number: importNumber }])
  assert.deepEqual(errors, [])
  console.log('Passed: discipline/topic/grade/question-count/difficulty filters, combined name/number search, mixed difficulty, legacy metadata, malformed definitions, no results/reset, subsection persistence, import reset, light/dark desktop and 390/320 layouts. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('library-filters-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  await browser.close()
}
