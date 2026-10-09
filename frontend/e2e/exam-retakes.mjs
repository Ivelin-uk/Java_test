import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'exam-retakes-fixture', user: { id: 101, name: 'Student', email: 'student@example.test', role: 'STUDENT', active: true, passwordChangeRequired: false } }
const assignment = { id: 301, title: 'Тест с три опита', starts_at: new Date(Date.now() - 60000).toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), max_attempts: 3, canceled: false }
const storageKey = `examai.exam.${auth.user.id}.${assignment.id}`
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const errors = []
try {
  for (const scenario of [{ name: 'desktop', width: 1440, strict: true }, { name: 'mobile', width: 390 }, { name: 'legacy-cache', width: 1280, legacy: true }, { name: 'lost-start', width: 390, lostStart: true }, { name: 'transfer', width: 1280, transfer: true }]) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: 900 } })
    const saved = { token: 'a'.repeat(43), browserId: 'examai-tab-original-browser', startKey: 'original-start-key', attemptId: 401 }
    await context.addInitScript(({ auth, storageKey, saved, legacy, transfer }) => {
      localStorage.setItem('quicktest.auth', JSON.stringify(auth))
      if ((legacy || transfer) && !sessionStorage.getItem('retake-fixture-initialized')) {
        window.name = legacy ? saved.browserId : 'examai-tab-different-browser'
        sessionStorage.setItem(storageKey, JSON.stringify(saved))
        sessionStorage.setItem(`${storageKey}.events`, '[]')
        sessionStorage.setItem('retake-fixture-initialized', 'true')
      }
    }, { auth, storageKey, saved, legacy: !!scenario.legacy, transfer: !!scenario.transfer })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const attempts = [], starts = [], transfers = []
    let failedStart = false
    function createAttempt(session) {
      const value = { id: 401 + attempts.length, assignment_id: assignment.id, title: assignment.title, attempt_number: attempts.length + 1, status: 'in_progress', started_at: new Date().toISOString(), submitted_at: null, session, deadline: Date.now() + 180000 }
      attempts.push(value)
      return value
    }
    if (scenario.legacy || scenario.transfer) {
      const initial = createAttempt(saved)
      if (scenario.legacy) { initial.status = 'finalized'; initial.submitted_at = new Date().toISOString() }
    }
    function state(attempt) {
      return { ...attempt, session: undefined, server_now: new Date().toISOString(), question_number: 1, question_count: 1, question: attempt.status === 'in_progress' ? { id: 500 + attempt.id, text: `Въпрос за опит ${attempt.attempt_number}`, type: 'SINGLE_CHOICE', status: 'open', maximum_points: 1, time_seconds: 180, open_instance: `instance-${attempt.id}`, deadline_at: new Date(attempt.deadline).toISOString(), options: [{ id: 'yes', text: 'Да' }, { id: 'no', text: 'Не' }], draft: null } : null }
    }
    function results() {
      return attempts.filter(a => a.status === 'finalized').map(a => ({ id: a.id, attempt_id: a.id, assignment_id: assignment.id, title: assignment.title, attempt_number: a.attempt_number, revision_number: 1, points: 1, maximum_points: 1, percentage: 100, grade: '6', outcome: 'passed' }))
    }
    await page.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
      const reject = (status, detail) => route.fulfill({ status, contentType: 'application/problem+json', body: JSON.stringify({ detail }) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (method === 'GET') {
        const data = { '/api/auth/me': auth.user, '/api/v1/assignments': [assignment], '/api/v1/attempts': attempts.map(a => ({ ...a, session: undefined })), '/api/v1/results': results(), [`/api/v1/assignments/${assignment.id}/preflight`]: { ...assignment, total_seconds: 180, question_count: 1, instructions: '', fullscreen_exempt: !scenario.strict } }
        if (Object.hasOwn(data, path)) return respond(data[path])
      }
      if (method === 'POST' && path === `/api/v1/assignments/${assignment.id}/attempts`) {
        const body = request.postDataJSON()
        starts.push(body)
        const existing = attempts.find(a => a.session.startKey === body.idempotencyKey)
        if (existing) return respond(state(existing))
        if (body.code !== 'ABCDEFGH') return reject(400, 'Невалиден или отменен код.')
        if (attempts.some(a => a.status === 'in_progress')) return reject(409, 'Има активен опит.')
        if (attempts.length >= assignment.max_attempts) return reject(409, 'Няма оставащи опити.')
        assert.equal(body.visible, true)
        if (scenario.strict) assert.equal(body.fullscreenActive, true)
        const attempt = createAttempt({ token: body.sessionToken, browserId: body.browserId, startKey: body.idempotencyKey, attemptId: 401 + attempts.length })
        if (scenario.lostStart && !failedStart) { failedStart = true; return reject(503, 'Отговорът от сървъра е прекъснат.') }
        return respond(state(attempt))
      }
      const match = path.match(/^\/api\/v1\/attempts\/(\d+)\/(.+)$/)
      if (match) {
        const attempt = attempts.find(a => a.id === Number(match[1]))
        assert(attempt)
        if (method === 'POST' && match[2] === 'session/transfer') {
          const body = request.postDataJSON()
          assert.equal(body.password, 'password123')
          transfers.push(body)
          attempt.session = { ...attempt.session, token: body.session.sessionToken, browserId: body.session.browserId }
          return respond(state(attempt))
        }
        if (request.headers()['x-exam-session'] !== attempt.session.token || request.headers()['x-exam-browser'] !== attempt.session.browserId) return reject(409, 'Опитът е отворен в друга сесия. Използвайте защитено прехвърляне.')
        if (method === 'POST' && /questions\/\d+\/answer$/.test(match[2])) { attempt.status = 'pending_review'; attempt.submitted_at = new Date().toISOString() }
        if (match[2] === 'state' || match[2] === 'events' || /questions\/\d+\/(answer|draft)$/.test(match[2])) return respond(state(attempt))
      }
      errors.push(`Unexpected API: ${method} ${path}`)
      return reject(404, 'Неочаквана заявка.')
    })
    try {
      await page.goto(frontend)
      await page.getByRole('button', { name: 'Моите тестове', exact: true }).click()
      for (let number = attempts.length && !scenario.transfer ? 2 : 1; number <= 3; number++) {
        await page.getByRole('button', { name: scenario.transfer && number === 1 ? 'Продължи' : 'Подготовка', exact: true }).click()
        if (scenario.transfer && number === 1) {
          await page.getByLabel('Парола за прехвърляне на сесията', { exact: true }).fill('password123')
          await page.getByRole('button', { name: 'Прехвърли без промяна на сроковете', exact: true }).click()
          assert.equal(transfers.length, 1)
          assert.equal(attempts.length, 1)
        } else {
          await page.getByRole('heading', { name: 'Подготовка за изпит', exact: true }).waitFor({ timeout: 5000 })
          const start = page.getByRole('button', { name: 'Започни на цял екран', exact: true })
          assert.equal(await start.isDisabled(), true)
          await page.getByLabel('Код за достъп', { exact: true }).fill('ABCDEFGH')
          await start.click()
          if (scenario.lostStart && number === 1) {
            await page.getByRole('alert').getByText('Отговорът от сървъра е прекъснат.', { exact: true }).waitFor()
            await start.click()
            assert.equal(starts[0].idempotencyKey, starts[1].idempotencyKey)
            assert.equal(attempts.length, 1)
          }
        }
        await page.getByRole('heading', { name: `Въпрос за опит ${number}`, exact: true }).waitFor()
        if (number === 2) {
          const stored = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey)
          const total = attempts.length
          await page.reload()
          await page.getByRole('button', { name: 'Моите тестове', exact: true }).click()
          await page.getByRole('button', { name: 'Продължи', exact: true }).click()
          if (scenario.strict) await page.getByRole('button', { name: 'Възстанови целия екран', exact: true }).click()
          await page.getByRole('heading', { name: `Въпрос за опит ${number}`, exact: true }).waitFor()
          assert.deepEqual(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey), stored)
          assert.equal(attempts.length, total)
          await page.screenshot({ path: new URL(`retake-${scenario.name}.png`, artifacts).pathname })
        }
        await page.getByRole('radio').first().check()
        await page.getByRole('button', { name: 'Потвърди отговора', exact: true }).click()
        await page.getByRole('heading', { name: 'Опитът е предаден', exact: true }).waitFor()
        if (number === 1) attempts[0].status = 'finalized'
        await page.getByRole('button', { name: 'Моите тестове', exact: true }).click()
        await page.locator('.ws-table').first().getByRole('cell', { name: `${number}/3`, exact: true }).waitFor()
        if (number === 1) await page.getByRole('region', { name: 'Най-високи резултати', exact: true }).getByText('100.00%', { exact: true }).waitFor()
      }
      assert.equal(await page.getByRole('button', { name: 'Няма оставащи опити', exact: true }).isDisabled(), true)
      assert.equal(attempts.length, 3)
      assert.equal(new Set(attempts.map(a => a.session.startKey)).size, 3)
      assert.equal(attempts.filter(a => a.status === 'finalized').length, 1)
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storageKey), null)
      assert.equal(await page.evaluate(key => sessionStorage.getItem(`${key}.events`), storageKey), null)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    } catch (error) {
      await page.screenshot({ path: new URL(`retake-${scenario.name}-failure.png`, artifacts).pathname, fullPage: true })
      throw error
    } finally { await context.close() }
  }
  assert.deepEqual(errors, [])
  console.log('Passed: second and third attempts, fresh start keys, mandatory codes, preserved results, active-attempt resume, lost-start retry, session transfer, legacy cache recovery, exhausted limit, desktop/mobile. API fixtures only.')
} finally { await browser.close() }
