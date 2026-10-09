import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'grading-limits-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const student = { id: 103, name: 'Test Student', email: 'student@example.test' }
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const errors = []
try {
  for (const viewport of [{ width: 1440, height: 1000, theme: 'dark' }, { width: 390, height: 844, theme: 'light' }]) {
    const context = await browser.newContext({ viewport, colorScheme: viewport.theme })
    await context.addInitScript(auth => localStorage.setItem('quicktest.auth', JSON.stringify(auth)), auth)
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const attempt = { id: 501, assignment_id: 301, title: 'Проверка на Java', student_name: student.name, attempt_number: 1, status: 'pending_review', submitted_at: new Date().toISOString() }
    const questions = [2.5, 5, 1].map((maximum_points, i) => ({ id: 601 + i, maximum_points, automatic_points: i === 2 ? 1 : null, final_points: i === 2 ? 1 : null, reviewed: i === 2, status: 'answered', teacher_comment: '', override_reason: '', answer_json: JSON.stringify({ optionIds: [], text: 'Отговор на ученика.' }), draft_json: null, opened_at: new Date().toISOString(), deadline_at: new Date().toISOString(), closed_at: new Date().toISOString(), definition_json: JSON.stringify({ question: { type: 'OPEN_ANSWER', text: `Въпрос ${i + 1}`, points: maximum_points, criteria: 'Оценяване според отговора.', acceptedAnswers: [] }, options: [] }) }))
    const revisions = [], grades = [], publications = []
    let failPublication = true, releasePublication, markPublication
    const publicationGate = new Promise(resolve => { releasePublication = resolve }), publicationSeen = new Promise(resolve => { markPublication = resolve })
    await page.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
      const reject = (status, detail) => route.fulfill({ status, contentType: 'application/problem+json', body: JSON.stringify({ detail }) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (method === 'GET') {
        const data = { '/api/auth/me': auth.user, '/api/v1/assignments': [], '/api/v1/grading': [attempt], '/api/v1/attempts/501/review': { attempt, student, questions, revisions, events: [] } }
        if (Object.hasOwn(data, path)) return respond(data[path])
      }
      if (method === 'PATCH' && path === '/api/v1/attempts/501/grading') {
        const body = request.postDataJSON(), question = questions.find(q => q.id === body.questionId)
        assert(question); assert(Number.isFinite(body.points)); assert(body.points >= 0 && body.points <= question.maximum_points)
        if (attempt.status === 'finalized') assert(body.reason.trim())
        grades.push(body)
        Object.assign(question, { final_points: body.points, reviewed: true, teacher_comment: body.comment, override_reason: body.reason })
        return respond(null)
      }
      if (method === 'POST' && /^\/api\/v1\/attempts\/501\/(finalize|result-revisions)$/.test(path)) {
        const body = request.postDataJSON()
        publications.push({ path, body })
        assert.equal(Object.hasOwn(body, 'gradeOverride'), false); assert.equal(Object.hasOwn(body, 'outcomeOverride'), false)
        assert(questions.every(q => q.reviewed))
        if (path.endsWith('/finalize')) {
          assert.equal(Object.hasOwn(body, 'reason'), false)
          if (failPublication) { failPublication = false; return reject(503, 'Временно недостъпен сървър.') }
          markPublication(); await publicationGate
        } else assert.equal(body.reason, 'Корекция след повторна проверка.')
        const points = questions.reduce((sum, q) => sum + q.final_points, 0), maximum_points = questions.reduce((sum, q) => sum + q.maximum_points, 0)
        const percentage = points / maximum_points * 100
        const result = { id: 701 + revisions.length, attempt_id: attempt.id, revision_number: revisions.length + 1, points, maximum_points, percentage, grade: percentage >= 90 ? '6' : '5', outcome: 'passed', reason: body.reason ?? '', author_id: auth.user.id, published_at: new Date().toISOString() }
        revisions.push(result); attempt.status = 'finalized'
        return respond(result)
      }
      errors.push(`Unexpected API: ${method} ${path}`)
      return reject(404, 'Неочаквана заявка.')
    })
    try {
      await page.goto(frontend)
      await page.getByRole('button', { name: 'Проверка', exact: true }).click()
      await page.getByRole('button', { name: student.name, exact: true }).click()
      const publication = page.locator('.ws-publication'), confirm = publication.getByRole('button', { name: 'Потвърди', exact: true })
      await confirm.waitFor()
      assert.equal(await publication.locator('input, select, textarea').count(), 0)
      assert.equal(await publication.getByRole('button').count(), 1)
      assert.equal(await confirm.isDisabled(), true)
      const manual = page.locator('.ws-question').first(), second = page.locator('.ws-question').nth(1)
      const points = manual.getByLabel('Финални точки', { exact: true }), save = manual.getByRole('button', { name: 'Запази проверката', exact: true })
      assert.equal(await points.getAttribute('min'), '0'); assert.equal(await points.getAttribute('max'), '2.5')
      await points.fill('22'); assert.equal(await points.inputValue(), '2.5')
      await points.fill('-1'); assert.equal(await points.inputValue(), '0')
      await points.fill(''); assert.equal(await save.isDisabled(), true)
      await points.pressSequentially('1.25'); assert.equal(await points.inputValue(), '1.25')
      await points.fill('1.12345'); await save.click()
      assert.equal(await points.evaluate(element => element.validity.stepMismatch), true)
      assert.equal(grades.length, 0)
      await points.fill('1.2345'); await save.click()
      await page.getByText(/Чака проверка · .* · 1 непроверени отговора/).waitFor()
      assert.equal(grades[0].points, 1.2345)
      assert.equal(await confirm.isDisabled(), true)
      await second.getByLabel('Финални точки', { exact: true }).fill('0')
      await second.getByRole('button', { name: 'Запази проверката', exact: true }).click()
      await page.getByText(/Чака проверка · .* · 0 непроверени отговора/).waitFor()
      assert.equal(grades[1].points, 0)
      await second.getByLabel('Финални точки', { exact: true }).fill('22')
      assert.equal(await second.getByLabel('Финални точки', { exact: true }).inputValue(), '5')
      await second.getByLabel('Финални точки', { exact: true }).press('ArrowUp')
      assert.equal(await second.getByLabel('Финални точки', { exact: true }).inputValue(), '5')
      await second.getByRole('button', { name: 'Запази проверката', exact: true }).click()
      await page.getByText('Чака проверка · 7.2345 / 8.5 точки · 0 непроверени отговора', { exact: true }).waitFor()
      assert.equal(await confirm.isEnabled(), true)
      await page.screenshot({ path: new URL(`grading-limits-${viewport.width}.png`, artifacts).pathname, fullPage: true })
      await confirm.click()
      const dialog = page.getByRole('dialog', { name: 'Публикуване на резултат', exact: true })
      assert.equal(await dialog.evaluate(element => element.matches(':modal')), true)
      assert.equal(await dialog.locator('input, select, textarea').count(), 0)
      await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
      assert.equal(publications.length, 0)
      assert.equal(await confirm.evaluate(element => element === document.activeElement), true)
      await confirm.click()
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.equal(publications.length, 0)
      await confirm.click()
      await dialog.getByRole('button', { name: 'Потвърди', exact: true }).click()
      await dialog.getByRole('alert').getByText('Временно недостъпен сървър.', { exact: true }).waitFor()
      await dialog.getByRole('button', { name: 'Потвърди', exact: true }).click()
      await publicationSeen
      assert.equal(await dialog.getByRole('button', { name: 'Потвърди', exact: true }).isDisabled(), true)
      await page.keyboard.press('Escape')
      assert.equal(await dialog.evaluate(element => element.matches(':modal')), true)
      assert.equal(publications.length, 2)
      assert.equal(publications[0].body.idempotencyKey, publications[1].body.idempotencyKey)
      releasePublication()
      await page.getByRole('heading', { name: 'Нова резултатна ревизия', exact: true }).waitFor()
      assert.equal(revisions.length, 1)
      await points.fill('22'); assert.equal(await points.inputValue(), '2.5')
      await manual.getByLabel('Причина за корекция', { exact: true }).fill('Повторна проверка на отговора.')
      await save.click()
      await page.getByText('Публикуван резултат · 8.5 / 8.5 точки · 0 непроверени отговора', { exact: true }).waitFor()
      await confirm.click()
      const correction = page.getByRole('dialog', { name: 'Публикуване на корекция', exact: true })
      const publishCorrection = correction.getByRole('button', { name: 'Потвърди', exact: true })
      assert.equal(await correction.evaluate(element => { const box = element.getBoundingClientRect(); return element.matches(':modal') && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && element.scrollWidth <= element.clientWidth }), true)
      assert.equal(await publishCorrection.isDisabled(), true)
      await correction.getByLabel('Причина за корекция', { exact: true }).fill('   ')
      assert.equal(await publishCorrection.isDisabled(), true)
      await correction.getByLabel('Причина за корекция', { exact: true }).fill('  Корекция след повторна проверка.  ')
      for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); assert.equal(await correction.evaluate(element => document.activeElement === document.body || element.contains(document.activeElement)), true) }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: new URL(`grading-correction-${viewport.width}.png`, artifacts).pathname })
      await publishCorrection.click()
      await correction.waitFor({ state: 'detached' })
      assert.equal(revisions.length, 2); assert.equal(revisions[1].grade, '6')
      assert.notEqual(publications[1].body.idempotencyKey, publications[2].body.idempotencyKey)
      assert.equal(await publication.locator('input, select, textarea').count(), 0)
    } catch (error) {
      await page.screenshot({ path: new URL(`grading-limits-${viewport.width}-failure.png`, artifacts).pathname, fullPage: true })
      throw error
    } finally { releasePublication(); await context.close() }
  }
  assert.deepEqual(errors, [])
  console.log('Passed: confirm-only publication, per-question point caps, zero/decimal/max values, empty and precision validation, saved grades, publication cancellation/retry, derived results, correction reasons and history, desktop/mobile. API fixtures only.')
} finally { await browser.close() }
