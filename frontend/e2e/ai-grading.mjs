import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'ai-grading-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const errors = []
try {
  for (const viewport of [{ width: 1440, height: 1000, theme: 'dark' }, { width: 390, height: 844, theme: 'light' }, { width: 320, height: 740, theme: 'dark' }]) {
    const context = await browser.newContext({ viewport, colorScheme: viewport.theme })
    await context.addInitScript(auth => localStorage.setItem('quicktest.auth', JSON.stringify(auth)), auth)
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const attempts = ['pending_review', 'pending_review', 'finalized', 'voided'].map((status, i) => ({ id: 501 + i, assignment_id: 301, title: 'Тест по програмиране с дълго заглавие', student_name: `Student ${i + 1}`, attempt_number: i + 1, status, submitted_at: new Date().toISOString(), ai_status: null, ai_attempts: 0, ai_error: null }))
    const jobs = new Map(), requests = [], reviews = []
    let failFirstStart = true, loseRetryResponse = true, queueError = false, holdProcessing = false
    const student = { id: 102, name: 'Student 2', email: 'student@example.test' }
    await page.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(structuredClone(data)) })
      const reject = (status, detail) => route.fulfill({ status, contentType: 'application/problem+json', body: JSON.stringify({ detail }) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (method === 'GET' && path === '/api/auth/me') return respond(auth.user)
      if (method === 'GET' && path === '/api/v1/assignments') return respond([])
      if (method === 'GET' && path === '/api/v1/grading') {
        if (queueError) return reject(503, 'Временно недостъпна таблица.')
        for (const [id, job] of jobs) {
          if (holdProcessing) continue
          const attempt = attempts.find(a => a.id === id)
          if (job.status === 'queued') { job.status = 'running'; attempt.ai_status = 'running' }
          else if (job.status === 'running') {
            if (id === 502 && job.attempts === 1) { job.status = 'failed'; attempt.ai_status = 'failed'; attempt.ai_error = 'Няма наличен OpenAI API кредит.' }
            else { job.status = 'completed'; attempt.ai_status = 'completed'; attempt.status = 'finalized'; attempt.ai_error = null }
          }
        }
        return respond(attempts)
      }
      if (method === 'GET' && /^\/api\/v1\/attempts\/\d+\/review$/.test(path)) {
        const id = Number(path.split('/')[4]), attempt = attempts.find(a => a.id === id)
        reviews.push(id)
        return respond({ attempt, student: { ...student, name: attempt.student_name }, events: [], revisions: [], questions: [{ id: 601, status: 'answered', maximum_points: 5, automatic_points: null, final_points: null, reviewed: false, answer_json: JSON.stringify({ optionIds: [], text: 'Отговор на ученика.' }), draft_json: null, teacher_comment: '', override_reason: '', opened_at: new Date().toISOString(), deadline_at: new Date().toISOString(), closed_at: new Date().toISOString(), definition_json: JSON.stringify({ question: { type: 'OPEN_ANSWER', text: 'Обяснете наследяването.', criteria: 'Коректно обяснение.', acceptedAnswers: [] }, options: [] }) }] })
      }
      if (method === 'POST' && /^\/api\/v1\/attempts\/\d+\/ai-grading(?:\/retry)?$/.test(path)) {
        const id = Number(path.split('/')[4]), body = request.postDataJSON(), attempt = attempts.find(a => a.id === id)
        requests.push({ id, path, body })
        assert.match(body.requestKey, /^[A-Za-z0-9_-]{8,80}$/)
        if (id === 501 && failFirstStart) { failFirstStart = false; return reject(503, 'Неуспешно стартиране.') }
        const previous = jobs.get(id), retry = path.endsWith('/retry')
        if (retry) assert.equal(previous.status, 'failed')
        const job = { status: 'queued', attempts: (previous?.attempts ?? 0) + 1, error_message: null }
        jobs.set(id, job); attempt.ai_status = job.status; attempt.ai_attempts = job.attempts; attempt.ai_error = null
        if (retry && loseRetryResponse) { loseRetryResponse = false; return reject(503, 'Прекъсната връзка след стартиране.') }
        return respond(job)
      }
      errors.push(`Unexpected API: ${method} ${path}`)
      return reject(404, 'Неочаквана заявка.')
    })
    try {
      await page.goto(frontend)
      await page.getByRole('button', { name: 'Проверка', exact: true }).click()
      const table = page.getByRole('table', { name: 'Проверка на опити', exact: true })
      await table.waitFor()
      const row = n => table.locator('tbody tr').filter({ has: page.getByRole('button', { name: `Student ${n}`, exact: true }) })
      await row(1).getByRole('button', { name: 'AI проверка', exact: true }).waitFor()
      assert.equal(await table.getByRole('button', { name: 'AI проверка', exact: true }).count(), 2)
      assert.equal(await row(3).getByTitle('Преглед и корекция', { exact: true }).count(), 1)
      assert.equal(await row(4).getByRole('button', { name: 'AI проверка', exact: true }).count(), 0)
      await row(2).getByTitle('Ръчна проверка', { exact: true }).click()
      await page.getByLabel('Финални точки', { exact: true }).waitFor()
      assert.deepEqual([...new Set(reviews)], [502]); assert.equal(requests.length, 0)
      await page.getByTitle('Към проверките', { exact: true }).click()
      await table.waitFor()
      await row(1).getByRole('button', { name: 'AI проверка', exact: true }).click()
      await row(1).getByRole('alert').filter({ hasText: 'Неуспешно стартиране.' }).waitFor()
      holdProcessing = true
      await row(1).getByRole('button', { name: 'AI проверка', exact: true }).dblclick()
      await row(1).getByText('AI в опашката', { exact: true }).waitFor()
      assert.equal(requests.filter(r => r.id === 501).length, 2)
      assert.equal(requests[0].body.requestKey, requests[1].body.requestKey)
      assert.equal(await row(1).getByRole('button', { name: 'AI проверка', exact: true }).isDisabled(), true)
      await page.reload()
      await page.getByRole('button', { name: 'Проверка', exact: true }).click()
      await row(1).getByText('AI в опашката', { exact: true }).waitFor()
      holdProcessing = false
      await row(1).getByText('AI проверява', { exact: true }).waitFor()
      await page.screenshot({ path: new URL(`ai-grading-processing-${viewport.width}.png`, artifacts).pathname, fullPage: true })
      await row(1).getByText('AI проверено', { exact: true }).waitFor()
      await row(1).getByText('Публикуван резултат', { exact: true }).waitFor()
      assert.equal(await row(1).getByRole('button', { name: 'AI проверка', exact: true }).count(), 0)
      assert.equal(requests.filter(r => r.id === 501).length, 2)
      await row(2).getByRole('button', { name: 'AI проверка', exact: true }).click()
      await row(2).getByText('Няма наличен OpenAI API кредит.', { exact: true }).waitFor()
      assert.equal(await row(2).getByTitle('Ръчна проверка', { exact: true }).isEnabled(), true)
      await page.screenshot({ path: new URL(`ai-grading-error-${viewport.width}.png`, artifacts).pathname, fullPage: true })
      await row(2).getByRole('button', { name: 'Повтори AI', exact: true }).click()
      await row(2).getByRole('alert').filter({ hasText: 'Прекъсната връзка след стартиране.' }).waitFor()
      await row(2).getByText('AI проверено', { exact: true }).waitFor()
      assert.equal(requests.filter(r => r.id === 502).length, 2)
      assert(requests.at(-1).path.endsWith('/retry'))
      assert.notEqual(requests.at(-1).body.requestKey, requests.at(-2).body.requestKey)
      queueError = true
      await page.getByTitle('Обнови проверките', { exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Временно недостъпна таблица.' }).first().waitFor()
      assert.equal(await table.locator('tbody tr').count(), 4)
      queueError = false
      await page.getByTitle('Обнови проверките', { exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Временно недостъпна таблица.' }).waitFor({ state: 'hidden' })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true)
      assert.equal(await row(1).evaluate(element => {
        const sample = document.createElement('span'); sample.style.backgroundColor = 'var(--success-bg)'; document.body.append(sample)
        const matches = getComputedStyle(element.cells[0]).backgroundColor === getComputedStyle(sample).backgroundColor
        sample.remove(); return matches
      }), true)
      const cells = await table.evaluate(element => [...element.rows].flatMap(r => [...r.cells]).map(cell => ({ width: cell.clientWidth, scroll: cell.scrollWidth })))
      assert(cells.every(cell => cell.scroll <= cell.width + 1))
      if (viewport.width < 500) {
        await table.evaluate(element => { element.parentElement.scrollLeft = element.parentElement.scrollWidth })
        await row(1).getByTitle('Преглед и корекция', { exact: true }).scrollIntoViewIfNeeded()
      }
      await page.screenshot({ path: new URL(`ai-grading-completed-${viewport.width}.png`, artifacts).pathname, fullPage: true })
      console.log(`AI grading ${viewport.width} ${viewport.theme}: manual review, async publish, errors, retries, reload, layout passed`)
    } catch (error) {
      await page.screenshot({ path: new URL(`ai-grading-failure-${viewport.width}.png`, artifacts).pathname, fullPage: true }).catch(() => {})
      throw error
    } finally { await context.close() }
  }
  assert.deepEqual(errors, [])
} finally { await browser.close() }
