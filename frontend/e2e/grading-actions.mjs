import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const teacher = { token: 'grading-actions-teacher', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true } }
const student = { token: 'grading-actions-student', user: { id: 102, name: 'Student', email: 'student@example.test', role: 'STUDENT', active: true } }
const activeUntil = new Date(Date.now() + 3600000).toISOString()
const attempt = (id, date, patch = {}) => ({ id, assignment_id: 201, student_id: 1000 + id, student_name: `Ученик ${id}`, title: 'Биология', attempt_number: 1, status: 'finalized', submitted_at: date, access_code: 'ABCD1234', max_attempts: 1, attempts_used: 1, active_attempts: 0, recipient_canceled: false, group_assignment: true, assignment_ends_at: activeUntil, result_email_status: 'queued', ...patch })
const attempts = [
  attempt(401, '2026-10-14T21:00:00Z', { result_outcome: 'failed', ai_status: 'completed' }), // Sofia: Oct 15 00:00
  attempt(402, '2026-10-15T20:59:59Z', { max_attempts: 2, result_outcome: 'passed' }), // Sofia: Oct 15 23:59
  attempt(403, '2026-10-15T21:00:00Z', { active_attempts: 1 }), // Sofia: Oct 16 00:00
  attempt(404, '2026-10-16T10:00:00Z', { assignment_ends_at: '2026-10-17T00:00:00Z' }),
  attempt(405, '2026-10-16T11:00:00Z', { recipient_canceled: true, access_code: null }),
  attempt(406, '2026-10-16T12:00:00Z', { status: 'pending_review', group_assignment: false }),
  attempt(407, null, { status: 'voided', group_assignment: false, result_outcome: 'passed' }),
]
const errors = [], writes = []
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page, releaseExtra
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Sofia' })
  await context.addInitScript(auth => {
    localStorage.setItem('quicktest.auth', JSON.stringify(auth))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedCode = value } } })
  }, teacher)
  page = await context.newPage();page.on('pageerror', error => errors.push(error.message))
  let emailMode = 'queued', extraSeen
  const extraCalled = new Promise(resolve => { extraSeen = resolve }), extraGate = new Promise(resolve => { releaseExtra = resolve })
  await page.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      const data = { '/api/auth/me': teacher.user, '/api/v1/groups': [], '/api/v1/assignments': [], '/api/v1/grading': attempts }
      if (Object.hasOwn(data, path)) return respond(data[path])
    }
    if (method === 'POST') {
      writes.push(path)
      if (path === '/api/v1/assignments/201/recipients/1401/extra-attempt') { extraSeen();await extraGate;attempts[0].max_attempts = 2;return respond({ maxAttempts: 2, remainingAttempts: 1, granted: true }) }
      if (path === '/api/v1/attempts/401/result-email') {
        if (emailMode === 'uncertain') return respond({ detail: 'Статусът на предишното изпращане е неясен.' }, 409)
        attempts[0].result_email_status = emailMode === 'sent' ? 'sent' : 'queued'
        return respond({ id: 801, status: attempts[0].result_email_status, adapter: emailMode === 'local' ? 'local' : 'resend' })
      }
    }
    errors.push(`Unexpected API: ${method} ${path}`);return route.fulfill({ status: 404 })
  })
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Проверка', exact: true }).click()
  const table = page.getByRole('table', { name: 'Проверка на опити', exact: true })
  const rows = table.locator('tbody tr'), row = id => rows.filter({ has: page.getByRole('button', { name: `Ученик ${id}`, exact: true }) })
  await row(407).waitFor()
  assert.equal(await rows.count(), 7)
  assert.equal(await row(401).getAttribute('class'), 'ws-attempt-failed')
  assert.equal(await row(401).getByText('Неуспешен', { exact: true }).count(), 1)
  assert.equal(await row(402).getAttribute('class'), 'ws-attempt-finalized')
  assert.equal(await row(402).getByText('Успешен', { exact: true }).count(), 1)
  assert.equal(await row(403).getAttribute('class'), '') // No outcome supplied by an older API.
  assert.equal(await row(406).getAttribute('class'), 'ws-attempt-pending')
  assert.equal(await row(407).getAttribute('class'), '') // A voided result never shows success.
  attempts[0].result_outcome = 'passed'
  await page.getByRole('button', { name: 'Обнови проверките', exact: true }).click()
  await row(401).getByText('Успешен', { exact: true }).waitFor()
  assert.equal(await row(401).getAttribute('class'), 'ws-attempt-finalized')
  attempts[0].result_outcome = 'failed'
  await page.getByRole('button', { name: 'Обнови проверките', exact: true }).click()
  await row(401).getByText('Неуспешен', { exact: true }).waitFor()
  assert.equal(await row(401).getAttribute('class'), 'ws-attempt-failed')
  await page.getByLabel('Предадени от', { exact: true }).fill('2026-10-15')
  await page.getByLabel('Предадени до', { exact: true }).fill('2026-10-15')
  assert.equal(await rows.count(), 2);assert.equal(await row(401).count(), 1);assert.equal(await row(402).count(), 1)
  await page.getByRole('button', { name: 'Обнови проверките', exact: true }).click()
  assert.equal(await page.getByLabel('Предадени до', { exact: true }).inputValue(), '2026-10-15')
  await page.getByLabel('Предадени от', { exact: true }).fill('2026-10-17')
  await page.getByRole('alert').filter({ hasText: 'Началната дата' }).waitFor()
  await page.getByRole('button', { name: 'Изчисти филтъра', exact: true }).click()
  await page.getByLabel('Предадени до', { exact: true }).fill('2026-10-13')
  await page.getByText('Няма опити за избрания период.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Изчисти филтъра', exact: true }).click()
  await row(401).getByRole('button', { name: 'Копирай кода', exact: true }).click()
  assert.equal(await page.evaluate(() => window.copiedCode), 'ABCD1234')
  assert.equal(await row(405).getByText('Няма активен код', { exact: true }).count(), 1)
  for (const id of [402, 403, 404, 405]) assert.equal(await row(id).getByRole('button', { name: 'Още един опит', exact: true }).isDisabled(), true)
  assert.equal(await row(406).getByRole('button', { name: 'Още един опит', exact: true }).count(), 0)
  const extra = row(401).getByRole('button', { name: 'Още един опит', exact: true })
  await extra.click();await extraCalled
  assert.equal(await extra.isDisabled(), true)
  await extra.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  assert.equal(writes.filter(path => path.includes('extra-attempt')).length, 1)
  releaseExtra()
  await row(401).getByText('Разрешен е още един опит на ученика.', { exact: true }).waitFor()
  assert.equal(await extra.isDisabled(), true)
  const email = row(401).getByRole('button', { name: 'Изпрати резултата', exact: true })
  await email.click()
  await row(401).getByText('Резултатът и линкът за преглед са в опашката за имейл.', { exact: true }).waitFor()
  emailMode = 'sent';await email.click()
  await row(401).getByText('Резултатът вече е изпратен към имейл услугата.', { exact: true }).waitFor()
  emailMode = 'local';await email.click()
  await row(401).getByText('Резултатът е в локалната тестова поща. Реален имейл не е изпратен.', { exact: true }).waitFor()
  emailMode = 'uncertain';await email.click()
  await row(401).getByRole('alert').waitFor()
  assert.equal(await row(406).getByRole('button', { name: 'Изпрати резултата', exact: true }).count(), 0)
  assert.equal(await row(407).getByRole('button', { name: 'Изпрати резултата', exact: true }).count(), 0)
  for (const [theme, width] of [['light', 1440], ['dark', 390], ['light', 320]]) {
    await page.setViewportSize({ width, height: 1000 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    for (const [id, token] of [[401, 'danger'], [402, 'success'], [406, 'warning']]) {
      assert.equal(await row(id).evaluate((element, token) => {
        const sample = document.createElement('span'); sample.style.backgroundColor = `var(--${token}-bg)`; sample.style.color = `var(--${token})`; element.append(sample)
        const expected = getComputedStyle(sample), cell = getComputedStyle(element.querySelector('td')), status = getComputedStyle(element.querySelector('.ws-attempt-status'))
        const matches = cell.backgroundColor === expected.backgroundColor && status.color === expected.color
        sample.remove(); return matches
      }, token), true)
    }
    assert.equal(await row(401).locator('.ws-ai-graded').evaluate(element => {
      const sample = document.createElement('span'); sample.style.color = 'var(--muted)'; element.append(sample)
      const matches = getComputedStyle(element).color === getComputedStyle(sample).color
      sample.remove(); return matches
    }), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: new URL(`grading-actions-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  await context.close()

  // Email links survive both password sign-in and the Google handoff. Arbitrary
  // return URLs are never accepted, and result contents still require the API.
  for (const google of [false, true]) {
    const learner = await browser.newContext()
    if (google) await learner.addInitScript(() => sessionStorage.setItem('examai.resultReturn', '/results/401'))
    page = await learner.newPage();page.on('pageerror', error => errors.push(error.message))
    await page.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (path === '/api/auth/google/config') return respond({ enabled: false, redirect: `${base}/api/auth/google/redirect` })
      if (path === '/api/auth/login' || path === '/api/auth/google/exchange') return respond(student)
      if (path === '/api/auth/me') return respond(student.user)
      if (['/api/v1/assignments', '/api/v1/attempts', '/api/v1/results', '/api/v1/groups'].includes(path)) return respond([])
      if (path === '/api/v1/results/401') return respond({ grade: '5', outcome: 'passed', attempt_id: 401, details: null })
      errors.push(`Unexpected learner API: ${path}`);return route.fulfill({ status: 404 })
    })
    await page.goto(google ? `${frontend}/#google_handoff=fixture` : `${frontend}/results/401`)
    if (!google) {
      await page.getByLabel('Имейл', { exact: true }).fill('student@example.test')
      await page.getByLabel('Парола', { exact: true }).fill('fixture-password')
      await page.getByRole('button', { name: 'Влез', exact: true }).click()
    }
    await page.getByRole('heading', { name: 'Оценка 5 · Успешен', exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/results/401')
    await page.getByText('Подробните отговори ще бъдат достъпни след края на разрешения период.', { exact: true }).waitFor()
    await learner.close()
  }
  assert.deepEqual(errors, [])
  console.log('Passed: latest passed/failed outcome colors, neutral unknown/voided results, pending warning and neutral AI label in both themes, corrected outcomes after refresh, inclusive Sofia date filtering, clear/invalid/empty ranges, refresh retention, code display/copy, student-specific extra attempt and duplicate guard, expired/removed/active/remaining restrictions, email queued/sent/local/error states, password/Google result links and release policy, responsive themes. API fixtures only; no emails sent.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('grading-actions-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  releaseExtra?.();await browser.close()
}
