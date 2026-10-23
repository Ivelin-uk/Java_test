import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'student-groups-fixture', user: { id: 101, name: 'Ученик', email: 'student@example.test', role: 'STUDENT', active: true, roleSelectionRequired: false } }
const groups = [
  { id: 201, name: 'Биология 12А', teacher_name: 'Мария Николова', subject: 'Биология', description: 'Подготовка за изпит', participant_count: 12 },
  { id: 202, name: 'Математика 12Б', teacher_name: 'Георги Петров', subject: 'Математика', description: 'Упражнения', participant_count: 8 },
  { id: 203, name: 'Нова група', teacher_name: 'Елена Иванова', subject: 'Физика', description: '', participant_count: 1 },
]
const now = Date.now(), time = hours => new Date(now + hours * 3600000).toISOString()
const assignment = (id, title, extra = {}) => ({ id, title, teacher_name: groups[0].teacher_name, starts_at: time(-1), ends_at: time(1), max_attempts: 3, ...extra })
const biology = [assignment(301, 'Клетъчна биология'), assignment(302, 'Изтекъл тест', { ends_at: time(-0.5) }), assignment(303, 'Предстоящ тест', { starts_at: time(1), ends_at: time(2) }), assignment(305, 'Незавършен тест')]
const math = [assignment(304, 'Уравнения', { teacher_name: groups[1].teacher_name })]
const attempts = [
  { id: 401, assignment_id: 301, title: biology[0].title, attempt_number: 1, status: 'finalized', submitted_at: time(-0.5) },
  { id: 402, assignment_id: 304, title: math[0].title, attempt_number: 1, status: 'finalized', submitted_at: time(-0.5) },
  { id: 405, assignment_id: 305, title: biology[3].title, attempt_number: 1, status: 'in_progress', submitted_at: null },
]
const result = (id, assignment_id, attempt_id, title, percentage, grade, outcome) => ({ review_available: true, id, assignment_id, attempt_id, title, percentage, points: percentage, maximum_points: 100, grade, outcome, attempt_number: 1, revision_number: 1, published_at: time(-0.25) })
const results = [result(501, 301, 401, biology[0].title, 85, '5', 'passed'), result(502, 304, 402, math[0].title, 40, '2', 'failed')]
const artifacts = new URL('../../.artifacts/', import.meta.url), errors = []
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
try {
  for (const viewport of [{ width: 1440, height: 1000, theme: 'light' }, { width: 1440, height: 1000, theme: 'dark' }, { width: 390, height: 844, theme: 'light' }, { width: 320, height: 844, theme: 'dark' }]) {
    const context = await browser.newContext({ viewport, colorScheme: viewport.theme })
    await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
    const page = await context.newPage(), requests = []
    let failGroup = true
    page.on('pageerror', error => errors.push(error.message))
    await page.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      requests.push({ path, method: request.method() })
      assert.equal(request.headers().authorization, `Bearer ${auth.token}`)
      if (request.method() === 'GET') {
        if (path === '/api/auth/me') return respond(auth.user)
        if (path === '/api/v1/groups') return respond(groups)
        if (path === '/api/v1/assignments') return respond([...biology, ...math])
        if (path === '/api/v1/attempts') return respond(attempts)
        if (path === '/api/v1/results') return respond(results)
        if (path === '/api/v1/results/401') return respond({ ...results[0], reason: 'Проверка по биология' })
        if (path === '/api/v1/groups/201/assignments') {
          if (failGroup) return respond({ detail: 'Временно недостъпни тестове.' }, 503)
          return respond(biology)
        }
        if (path === '/api/v1/groups/202/assignments') return respond(math)
        if (path === '/api/v1/groups/203/assignments') return respond([])
        if (path === '/api/v1/assignments/301/preflight') return respond({ id: 301, title: biology[0].title, instructions: 'Инструкции за теста', starts_at: time(-1), ends_at: time(1), question_count: 1, total_seconds: 60, fullscreen_exempt: true, mobile_validated: true, max_attempts: 3 })
      }
      errors.push(`Unexpected API: ${request.method()} ${path}`)
      return respond({}, 404)
    })
    try {
      await page.goto(frontend)
      await page.getByRole('button', { name: 'Групи', exact: true }).click()
      const table = page.getByRole('table', { name: 'Групи', exact: true })
      const search = page.getByRole('searchbox', { name: 'Търси група', exact: true })
      await table.getByText(groups[0].teacher_name, { exact: true }).waitFor()
      assert.equal(await table.locator('tbody tr').count(), 3)
      await search.fill('  БИОЛОГИЯ  ')
      await page.getByRole('status').getByText('1 от 3 групи', { exact: true }).waitFor()
      assert.equal(await table.locator('tbody tr').count(), 1)
      await search.fill('няма такава група')
      await page.getByText('Няма групи с това име.', { exact: true }).waitFor()
      await search.fill('')
      assert.equal(await table.locator('tbody tr').count(), 3)
      assert.equal(await page.getByLabel('Код за присъединяване', { exact: true }).count(), 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: new URL(`student-groups-${viewport.theme}-${viewport.width}.png`, artifacts).pathname, fullPage: true })
      await table.getByRole('button', { name: groups[0].name, exact: true }).click()
      const group = page.getByRole('region', { name: 'Тестове на групата', exact: true })
      await group.getByText(`Учител: ${groups[0].teacher_name}`, { exact: true }).waitFor()
      await group.getByRole('alert').getByText('Временно недостъпни тестове.', { exact: true }).waitFor()
      failGroup = false
      await group.getByRole('button', { name: 'Обнови', exact: true }).click()
      const assigned = group.getByRole('table', { name: 'Възложени тестове', exact: true })
      await assigned.getByText(biology[0].title, { exact: true }).waitFor()
      assert.equal(await assigned.locator('tbody tr').count(), 4)
      assert.equal(await group.getByText(math[0].title, { exact: true }).count(), 0)
      const history = group.getByRole('table', { name: 'Опити и резултати', exact: true })
      assert.equal(await history.locator('tbody tr').count(), 2)
      const best = group.getByRole('region', { name: 'Най-високи резултати', exact: true })
      await best.getByText('85.00%', { exact: true }).waitFor()
      assert.equal(await best.getByText('40.00%', { exact: true }).count(), 0)
      for (const [title, status, css] of [[biology[0].title, 'Активен', 'active'], [biology[1].title, 'Срокът е изтекъл', 'expired'], [biology[2].title, 'Предстоящ', 'upcoming']]) {
        const row = assigned.getByRole('row').filter({ hasText: title })
        assert.equal(await row.getAttribute('class'), `ws-assignment-${css}`)
        assert.equal(await row.getByText(status, { exact: true }).count(), 1)
      }
      assert.equal(await assigned.getByRole('row').filter({ hasText: biology[1].title }).getByRole('button').isDisabled(), true)
      assert.equal(await assigned.getByRole('row').filter({ hasText: biology[3].title }).getByRole('button', { name: 'Продължи', exact: true }).isEnabled(), true)
      await history.getByRole('button', { name: 'Преглед на резултата', exact: true }).click()
      await page.getByText('Проверка по биология', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Към моите тестове', exact: true }).click()
      await page.getByRole('navigation', { name: 'Основна навигация' }).getByRole('button', { name: 'Групи', exact: true }).click()
      await assigned.getByText(biology[0].title, { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: new URL(`student-group-tests-${viewport.theme}-${viewport.width}.png`, artifacts).pathname, fullPage: true })
      await assigned.getByRole('row').filter({ hasText: biology[0].title }).getByRole('button', { name: 'Подготовка', exact: true }).click()
      await page.getByRole('heading', { name: 'Подготовка за изпит', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Към тестовете', exact: true }).click()
      await group.getByRole('heading', { name: groups[0].name, exact: true }).waitFor()
      await assigned.getByText(biology[0].title, { exact: true }).waitFor()
      await group.getByRole('button', { name: 'Към групите', exact: true }).click()
      await table.getByRole('button', { name: groups[2].name, exact: true }).click()
      await group.getByText('Нямате възложени тестове.', { exact: true }).waitFor()
      assert.equal(await group.locator('.ws-best-result').count(), 0)
      assert.equal(await group.getByRole('table', { name: 'Опити и резултати', exact: true }).locator('tbody tr').count(), 0)
      await group.getByRole('button', { name: 'Към групите', exact: true }).click()
      await table.getByRole('button', { name: groups[1].name, exact: true }).click()
      await group.getByRole('region', { name: 'Най-високи резултати', exact: true }).getByText('40.00%', { exact: true }).waitFor()
      assert.equal(await group.getByText(biology[0].title, { exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Моите тестове', exact: true }).click()
      await page.getByRole('table', { name: 'Възложени тестове', exact: true }).getByText(math[0].title, { exact: true }).waitFor()
      assert.equal(await page.getByRole('table', { name: 'Възложени тестове', exact: true }).locator('tbody tr').count(), 5)
      assert.equal(requests.some(request => request.method !== 'GET'), false)
    } catch (error) {
      await page.screenshot({ path: new URL(`student-groups-failure-${viewport.theme}-${viewport.width}.png`, artifacts).pathname, fullPage: true })
      throw error
    } finally { await context.close() }
  }
  assert.deepEqual(errors, [])
  console.log('Passed: group owners, normalized name search, empty search, group-only assignments/attempts/results, load failure retry, status colors, result preview, preparation and return to group, unassigned group, global My Tests unchanged, desktop/mobile in both themes. API fixtures only.')
} finally { await browser.close() }
