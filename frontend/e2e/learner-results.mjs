import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'learner-results-fixture', user: { id: 101, name: 'Student', email: 'student@example.test', role: 'STUDENT', active: true, passwordChangeRequired: false } }
const title = 'Средно ниво тест по C# програмиране'
const now = Date.parse('2026-10-19T14:00:00Z')
const assignments = [
  { id: 301, title, teacher_name: 'Г-жа Мария Николова', starts_at: new Date(now - 60000).toISOString(), ends_at: new Date(now + 3600000).toISOString(), max_attempts: 6, canceled: false },
  { id: 302, title, teacher_name: 'Г-н Георги Петров', starts_at: new Date(now - 3600000).toISOString(), ends_at: new Date(now).toISOString(), max_attempts: 6, canceled: false },
  { id: 303, title: 'Предстоящ тест', starts_at: new Date(now + 60000).toISOString(), ends_at: new Date(now + 120000).toISOString(), max_attempts: 1, canceled: false },
  { id: 304, title: 'Отменен тест', starts_at: new Date(now - 60000).toISOString(), ends_at: new Date(now + 3600000).toISOString(), max_attempts: 1, canceled: true },
]
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const errors = []
try {
  for (const viewport of [{ width: 1440, height: 1000, theme: 'dark' }, { width: 1440, height: 1000, theme: 'light' }, { width: 390, height: 844, theme: 'light' }, { width: 320, height: 844, theme: 'dark' }]) {
    const context = await browser.newContext({ viewport, colorScheme: viewport.theme })
    await context.addInitScript(auth => localStorage.setItem('quicktest.auth', JSON.stringify(auth)), auth)
    const page = await context.newPage()
    await page.clock.install({ time: new Date(now) });await page.clock.pauseAt(new Date(now + 1000))
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
        const data = { '/api/auth/me': auth.user, '/api/v1/groups': [], '/api/v1/assignments': assignments, '/api/v1/attempts': empty ? [] : attempts, '/api/v1/results': empty ? [] : results }
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
      const assigned = page.getByRole('table', { name: 'Възложени тестове', exact: true })
      const availability = assigned.locator('tbody tr')
      for (const position of [0, 1]) {
        const firstCell = availability.nth(position).getByRole('cell').first()
        assert.equal(await firstCell.getByText(title, { exact: true }).count(), 1)
        assert.equal(await firstCell.getByText(`Възложил: ${assignments[position].teacher_name}`, { exact: true }).count(), 1)
      }
      assert.equal(await availability.nth(2).locator('.ws-assignment-teacher').count(), 0)
      for (const [position, status, token] of [[0, 'Активен', 'success'], [1, 'Срокът е изтекъл', 'danger'], [2, 'Предстоящ', 'warning'], [3, 'Отменен', 'muted']]) {
        const assignment = availability.nth(position)
        assert.equal(await assignment.getByText(status, { exact: true }).count(), 1)
        const colorsMatch = () => assignment.evaluate((element, token) => {
          const sample = document.createElement('span');sample.style.backgroundColor = `var(--${token === 'muted' ? 'subtle' : token + '-bg'})`;sample.style.color = `var(--${token})`;document.body.append(sample)
          const expected = getComputedStyle(sample), cell = getComputedStyle(element.querySelector('td')), status = getComputedStyle(element.querySelector('.ws-assignment-availability'))
          const matches = cell.backgroundColor === expected.backgroundColor && status.color === expected.color
          sample.remove();return matches
        }, token)
        assert.equal(await colorsMatch(), true)
        await assignment.hover();assert.equal(await colorsMatch(), true)
      }
      assert.equal(await availability.nth(1).getByRole('button').isDisabled(), true)
      assert.equal(await availability.nth(3).getByRole('button').isDisabled(), true)
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
      const failed = table.getByRole('row').filter({ hasText: '9.00%' })
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
      assert.equal(await failed.locator('.ws-attempt-status .lucide-circle-x').count(), 1)
      assert.equal(await first.locator('.ws-attempt-status .lucide-circle-check').count(), 1)
      const pendingColors = await colors(waiting), failedColors = await colors(failed), passedColors = await colors(first)
      const danger = await page.evaluate(() => {
        const sample = document.createElement('span')
        sample.style.cssText = 'background: var(--danger-bg); color: var(--danger)'
        document.body.append(sample)
        const style = getComputedStyle(sample)
        const value = { background: style.backgroundColor, color: style.color }
        sample.remove()
        return value
      })
      assert.equal(failedColors.background, danger.background)
      assert.equal(failedColors.color, danger.color)
      assert.equal(await failed.locator('.ws-attempt-outcome').evaluate(element => getComputedStyle(element).color), danger.color)
      assert.notEqual(failedColors.background, passedColors.background)
      assert.notEqual(failedColors.color, passedColors.color)
      assert.notEqual(pendingColors.background, failedColors.background)
      assert.notEqual(pendingColors.background, passedColors.background)
      assert(pendingColors.contrast >= 4.5); assert(failedColors.contrast >= 4.5); assert(passedColors.contrast >= 4.5)
      await waiting.hover()
      assert.deepEqual(await colors(waiting), pendingColors)
      await failed.hover()
      assert.deepEqual(await colors(failed), failedColors)
      await first.hover()
      assert.deepEqual(await colors(first), passedColors)
      for (const status of ['В процес', 'Анулиран']) assert.equal(await table.getByRole('row').filter({ hasText: status }).getAttribute('class'), null)
      assert.equal(await page.getByText('99.00%', { exact: true }).count(), 0)
      assert.equal(await page.getByText('100.00%', { exact: true }).count(), 0)
      assert.equal(await best.evaluate((element, selector) => !!(element.compareDocumentPosition(document.querySelector(selector)) & Node.DOCUMENT_POSITION_FOLLOWING), 'table[aria-label="Опити и резултати"]'), true)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      const size = await table.evaluate(element => ({ table: element.scrollWidth, container: element.parentElement.clientWidth, viewport: innerWidth }))
      if (viewport.width < 760) assert(size.table > size.container)
      const box = await primary.boundingBox(), score = await primary.locator('.ws-best-score').boundingBox()
      assert(score.x >= box.x && score.x + score.width <= box.x + box.width + 1)
      await page.screenshot({ path: new URL(`learner-results-${viewport.theme}-${viewport.width}.png`, artifacts).pathname, fullPage: true })
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
      assert.equal(await table.locator('.ws-attempt-failed').count(), 0)
      results.push({ ...result(407, '95.00', '6', 2), outcome: 'failed' })
      await page.getByRole('button', { name: 'Обнови', exact: true }).click()
      await secondary.getByText(/Неуспешен/).waitFor()
      assert.equal(await secondary.locator('.ws-best-score-failed > strong').count(), 1)
      assert.equal(await secondary.locator('.ws-best-score > strong').evaluate(element => getComputedStyle(element).color), danger.color)
      assert.equal(await row(302, 1).getAttribute('class'), 'ws-attempt-finalized ws-attempt-failed')
      await page.screenshot({ path: new URL(`learner-results-failed-best-${viewport.theme}-${viewport.width}.png`, artifacts).pathname, fullPage: true })
      results.push(result(407, '95.00', '6', 3))
      await page.getByRole('button', { name: 'Обнови', exact: true }).click()
      await secondary.getByText(/Успешен/).waitFor()
      assert.equal(await secondary.locator('.ws-best-score-failed').count(), 0)
      assert.equal(await table.locator('.ws-attempt-failed').count(), 0)
      empty = true
      await page.getByRole('button', { name: 'Обнови', exact: true }).click()
      await best.getByText('Няма публикувани резултати.', { exact: true }).waitFor()
      await page.getByText('Няма започнати опити.', { exact: true }).waitFor()
      assert.equal(await table.getByRole('row').count(), 1)
      const scheduled = availability.nth(2)
      await page.clock.runFor(58000)
      assert.equal(await scheduled.getByText('Предстоящ', { exact: true }).count(), 1)
      await page.clock.runFor(1000)
      await scheduled.getByText('Активен', { exact: true }).waitFor()
      await page.clock.runFor(59000)
      assert.equal(await scheduled.getByText('Активен', { exact: true }).count(), 1)
      await page.clock.runFor(1000)
      await scheduled.getByText('Срокът е изтекъл', { exact: true }).waitFor()
      assert.equal(await scheduled.getByRole('button').isDisabled(), true)
    } catch (error) {
      await page.screenshot({ path: new URL(`learner-results-${viewport.theme}-${viewport.width}-failure.png`, artifacts).pathname, fullPage: true })
      throw error
    } finally { await context.close() }
  }
  assert.deepEqual(errors, [])
  console.log('Passed: active/expired/upcoming/canceled assignment colors and labels, automatic transitions at start/deadline without reload, single attempt/result table, best percentage per assignment, numeric ordering, latest corrections, pending and voided exclusion, tie breaking, refresh and empty states, result previews and release policy, pending/failed/passed colors and icons, outcome overrides, failed best score, hover preservation, accessible contrast, desktop/mobile and light/dark themes. API fixtures only.')
} finally { await browser.close() }
