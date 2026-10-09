import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'learner-results-fixture', user: { id: 101, name: 'Student', email: 'student@example.test', role: 'STUDENT', active: true, passwordChangeRequired: false } }
const title = 'Средно ниво тест по C# програмиране'
const assignments = [301, 302].map(id => ({ id, title, starts_at: new Date(Date.now() - 60000).toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), max_attempts: 6, canceled: false }))
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const errors = []
try {
  for (const viewport of [{ width: 1440, height: 1000, theme: 'dark' }, { width: 390, height: 844, theme: 'light' }, { width: 320, height: 844, theme: 'dark' }]) {
    const context = await browser.newContext({ viewport, colorScheme: viewport.theme })
    await context.addInitScript(auth => localStorage.setItem('quicktest.auth', JSON.stringify(auth)), auth)
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const attempts = Array.from({ length: 7 }, (_, i) => ({ id: 401 + i, assignment_id: i === 6 ? 302 : 301, title, attempt_number: i === 6 ? 1 : i + 1, status: ['finalized', 'finalized', 'finalized', 'in_progress', 'pending_review', 'voided', 'finalized'][i], submitted_at: i === 3 ? null : new Date(Date.now() - i * 60000).toISOString() })).reverse()
    const result = (id, percentage, grade, revision = 1) => {
      const attempt = attempts.find(a => a.id === id)
      return { id: id * 10 + revision, attempt_id: id, assignment_id: attempt.assignment_id, title, attempt_number: attempt.attempt_number, revision_number: revision, points: Number(percentage), maximum_points: 100, percentage, grade, outcome: Number(percentage) >= 50 ? 'passed' : 'failed', published_at: new Date().toISOString() }
    }
    let results = [result(403, '9.00', '6'), result(401, '100.00', '6'), result(402, '80.00', '3'), result(401, '85.00', '5', 2), result(407, '95.00', '6'), result(406, '100.00', '6'), result(405, '99.00', '6'), result(404, '99.00', '6')]
    let empty = false
    const previews = []
    await page.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (request.method() === 'GET') {
        const data = { '/api/auth/me': auth.user, '/api/v1/assignments': assignments, '/api/v1/attempts': empty ? [] : attempts, '/api/v1/results': empty ? [] : results }
        if (Object.hasOwn(data, path)) return respond(data[path])
        const match = path.match(/^\/api\/v1\/results\/(\d+)$/)
        if (match) {
          const id = Number(match[1]), value = results.filter(r => r.attempt_id === id).sort((a, b) => b.revision_number - a.revision_number)[0]
          previews.push(id)
          return respond({ ...value, ...(id === 407 ? { details: { gradeOverridden: false, outcomeOverridden: false, questions: [{ id: 501, status: 'answered', final_points: 1, maximum_points: 1, answer_json: JSON.stringify({ optionIds: [], text: 'Обектът е инстанция на клас.' }), definition_json: JSON.stringify({ question: { text: 'Какво е обект?', acceptedAnswers: ['Инстанция на клас.'], criteria: '', explanation: 'Обектите се създават от класове.' }, options: [] }) }] } } : {}) })
        }
      }
      errors.push(`Unexpected API: ${request.method()} ${path}`)
      return route.fulfill({ status: 404 })
    })
    try {
      await page.goto(frontend)
      await page.getByRole('button', { name: 'Моите тестове', exact: true }).click()
      const table = page.getByRole('table', { name: 'Опити и резултати', exact: true })
      const best = page.getByRole('region', { name: 'Най-високи резултати', exact: true })
      const primary = best.locator('article').filter({ hasText: 'Възлагане №301' })
      const secondary = best.locator('article').filter({ hasText: 'Възлагане №302' })
      const row = (assignment, number) => table.getByRole('row').filter({ has: page.getByRole('cell', { name: String(number), exact: true }) }).filter({ hasText: assignment === 302 ? '95.00%' : '' })
      await primary.getByText('85.00%', { exact: true }).waitFor()
      await secondary.getByText('95.00%', { exact: true }).waitFor()
      assert.equal(await table.getByRole('row').count(), 8)
      assert.equal(await page.getByRole('table').count(), 2)
      assert.equal(await page.getByRole('heading', { name: 'Публикувани резултати', exact: true }).count(), 0)
      assert.equal(await primary.getByText('Възлагане №301 · Опит 1', { exact: true }).count(), 1)
      assert.equal(await page.getByRole('table', { name: 'Възложени тестове', exact: true }).getByRole('cell', { name: '5 · опит 1', exact: true }).count(), 1)
      const first = table.getByRole('row').filter({ hasText: '85.00%' })
      await first.getByText('Корекция №1', { exact: true }).waitFor()
      assert.equal(await first.getByRole('cell', { name: '85/100', exact: true }).count(), 1)
      for (const status of ['В процес', 'Чака проверка', 'Анулиран']) {
        const pending = table.getByRole('row').filter({ hasText: status })
        assert.equal(await pending.getByRole('cell').count(), 9)
        assert.equal(await pending.getByRole('cell', { name: '-', exact: true }).count(), status === 'В процес' ? 6 : 5)
        assert.equal(await pending.getByRole('button').count(), 0)
      }
      const waiting = table.getByRole('row').filter({ hasText: 'Чака проверка' })
      const reviewed = table.getByRole('row').filter({ hasText: '9.00%' })
      async function colors(row) {
        return row.evaluate(element => {
          const cell = getComputedStyle(element.querySelector('td')), status = getComputedStyle(element.querySelector('.ws-attempt-status'))
          function luminance(color) {
            const rgb = color.match(/\d+/g).slice(0, 3).map(Number).map(value => { const n = value / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4 })
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
          }
          const background = luminance(cell.backgroundColor)
          const contrast = color => { const text = luminance(color); return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05) }
          return { background: cell.backgroundColor, color: status.color, contrast: Math.min(contrast(cell.color), contrast(status.color)) }
        })
      }
      assert.equal(await waiting.locator('.ws-attempt-status svg').count(), 1)
      assert.equal(await reviewed.locator('.ws-attempt-status svg').count(), 1)
      const pendingColors = await colors(waiting), approvedColors = await colors(reviewed)
      assert.notEqual(pendingColors.background, approvedColors.background)
      assert.notEqual(pendingColors.color, approvedColors.color)
      assert(pendingColors.contrast >= 4.5); assert(approvedColors.contrast >= 4.5)
      await waiting.hover()
      assert.deepEqual(await colors(waiting), pendingColors)
      await reviewed.hover()
      assert.deepEqual(await colors(reviewed), approvedColors)
      for (const status of ['В процес', 'Анулиран']) assert.equal(await table.getByRole('row').filter({ hasText: status }).getAttribute('class'), null)
      assert.equal(await page.getByText('99.00%', { exact: true }).count(), 0)
      assert.equal(await page.getByText('100.00%', { exact: true }).count(), 0)
      assert.equal(await best.evaluate((element, selector) => !!(element.compareDocumentPosition(document.querySelector(selector)) & Node.DOCUMENT_POSITION_FOLLOWING), 'table[aria-label="Опити и резултати"]'), true)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      const size = await table.evaluate(element => ({ table: element.scrollWidth, container: element.parentElement.clientWidth, viewport: innerWidth }))
      if (viewport.width < 760) assert(size.table > size.container)
      const box = await primary.boundingBox(), score = await primary.locator('.ws-best-score').boundingBox()
      assert(score.x >= box.x && score.x + score.width <= box.x + box.width + 1)
      await page.screenshot({ path: new URL(`learner-results-${viewport.width}.png`, artifacts).pathname, fullPage: true })
      await first.getByRole('button', { name: 'Преглед на резултата', exact: true }).click()
      await page.getByText('Подробните отговори ще бъдат достъпни след края на разрешения период.', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Затвори резултата', exact: true }).click()
      await row(302, 1).getByRole('button', { name: 'Преглед на резултата', exact: true }).click()
      await page.getByText('Обектът е инстанция на клас.', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Затвори резултата', exact: true }).click()
      assert.deepEqual(previews, [401, 407])
      results.push(result(401, '70.00', '4', 3))
      await page.getByRole('button', { name: 'Обнови', exact: true }).click()
      await primary.getByText('80.00%', { exact: true }).waitFor()
      assert.equal(await primary.getByText('Възлагане №301 · Опит 2', { exact: true }).count(), 1)
      assert.equal(await table.getByText('Корекция №2', { exact: true }).count(), 1)
      attempts.find(a => a.id === 405).status = 'finalized'
      results = results.filter(r => r.attempt_id !== 405).concat(result(405, '90.00', '6'))
      await page.getByRole('button', { name: 'Обнови', exact: true }).click()
      await primary.getByText('90.00%', { exact: true }).waitFor()
      assert.equal(await table.locator('.ws-attempt-pending').count(), 0)
      assert.equal(await table.locator('.ws-attempt-finalized').count(), 5)
      attempts.find(a => a.id === 405).status = 'voided'
      await page.getByRole('button', { name: 'Обнови', exact: true }).click()
      await primary.getByText('80.00%', { exact: true }).waitFor()
      assert.equal(await table.locator('.ws-attempt-finalized').count(), 4)
      results.push(result(403, '80.00', '5', 2))
      await page.getByRole('button', { name: 'Обнови', exact: true }).click()
      await primary.getByText('Възлагане №301 · Опит 3', { exact: true }).waitFor()
      assert.equal(await table.getByRole('row').count(), 8)
      empty = true
      await page.getByRole('button', { name: 'Обнови', exact: true }).click()
      await best.getByText('Няма публикувани резултати.', { exact: true }).waitFor()
      await page.getByText('Няма започнати опити.', { exact: true }).waitFor()
      assert.equal(await table.getByRole('row').count(), 1)
    } catch (error) {
      await page.screenshot({ path: new URL(`learner-results-${viewport.width}-failure.png`, artifacts).pathname, fullPage: true })
      throw error
    } finally { await context.close() }
  }
  assert.deepEqual(errors, [])
  console.log('Passed: single attempt/result table, best percentage per assignment, numeric ordering, latest corrections, pending and voided exclusion, tie breaking, refresh and empty states, result previews and release policy, pending/reviewed colors and icons, hover preservation, accessible contrast, desktop/mobile and light/dark themes. API fixtures only.')
} finally { await browser.close() }
