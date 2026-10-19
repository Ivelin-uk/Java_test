import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const profile = (token, role) => ({ token, user: { id: role === 'TEACHER' ? 101 : 102, name: 'Google account', email: 'google@example.test', role, active: true, passwordChangeRequired: false, roleSelectionRequired: false } })
const teacher = profile('google-teacher-fixture', 'TEACHER'), student = profile('google-student-fixture', 'STUDENT')
const local = { ...teacher, token: 'local-fixture' }
const errors = [], exchanges = [], redirects = [], links = []
let enabled = true, releaseExchange, exchangeGate = Promise.resolve(), releaseLink, linkGate = Promise.resolve()
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  async function openContext(auth) {
    let googleLinked = false, pendingLink = false
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    if (auth) await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
    await context.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin }, body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (path === '/api/auth/google/config') return respond({ enabled, redirect: `${base}/api/auth/google/redirect` })
      if (path === '/api/auth/google/redirect') {
        redirects.push(new URL(request.url()))
        pendingLink = new URL(request.url()).searchParams.has('link')
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>OAuth redirect fixture</title>' })
      }
      if (path === '/api/auth/google/exchange') {
        const body = request.postDataJSON(); exchanges.push(body)
        await exchangeGate
        if (body.token === 'expired-fixture') return respond({ detail: 'Изтекла или използвана идентификация.' }, 410)
        if (pendingLink) { googleLinked = true; pendingLink = false }
        return respond(body.token === 'student-fixture' ? student : teacher)
      }
      if (path === '/api/v1/profile/notification-email') return respond({ email: local.user.email, verified_at: new Date().toISOString() })
      if (path === '/api/v1/profile/identities') return respond(googleLinked ? [{ provider: 'google', linked_at: new Date().toISOString() }] : [])
      if (path === '/api/v1/profile/google/link') {
        const body = request.postDataJSON(); links.push(body)
        assert.deepEqual(Object.keys(body), ['password'])
        assert.equal(request.headers().authorization, `Bearer ${local.token}`)
        if (body.password !== 'password123') return respond({ detail: 'Текущата парола е неправилна.' }, 403)
        await linkGate
        return respond({ url: `${base}/api/auth/google/redirect?link=profile-link-fixture` })
      }
      if (path === '/api/auth/me') return respond(request.headers().authorization === `Bearer ${student.token}` ? student.user : teacher.user)
      if (path === '/api/auth/login') return respond(local)
      if (['/api/v1/groups', '/api/v1/assignments', '/api/v1/grading', '/api/v1/results'].includes(path)) return respond([])
      errors.push(`Unexpected API: ${method} ${path}`)
      return respond({}, 404)
    })
    const next = await context.newPage()
    next.on('pageerror', error => errors.push(error.message))
    return { context, page: next }
  }
  const first = await openContext(); page = first.page
  await page.goto(frontend)
  const login = page.getByRole('button', { name: 'Влез с Google', exact: true })
  await login.waitFor()
  await login.click()
  await page.waitForURL(`${base}/api/auth/google/redirect`)
  assert.equal(redirects.at(-1).search, '')
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  for (const name of ['Име', 'Фамилия', 'Имейл', 'Парола']) await page.getByLabel(name, { exact: true }).fill('')
  await page.getByRole('button', { name: 'Регистрация с Google', exact: true }).click()
  await page.waitForURL(`${base}/api/auth/google/redirect`)
  assert.equal(redirects.at(-1).search, '')
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  for (const { theme, width, height } of [{ theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 320, height: 844 }]) {
    await page.setViewportSize({ width, height })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    const button = page.getByRole('button', { name: 'Регистрация с Google', exact: true })
    await button.scrollIntoViewIfNeeded()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await button.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return element.scrollWidth <= element.clientWidth && [...element.children].every(child => {
        const childBounds = child.getBoundingClientRect()
        return childBounds.left >= bounds.left && childBounds.right <= bounds.right && childBounds.top >= bounds.top && childBounds.bottom <= bounds.bottom
      })
    }), true)
    assert.equal(await button.locator('img').evaluate(element => element.complete && element.naturalWidth > 0), true)
    await page.screenshot({ path: new URL(`google-register-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  enabled = false
  await page.goto(frontend)
  assert.equal(await login.isDisabled(), true)
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Регистрация с Google', exact: true }).isDisabled(), true)
  enabled = true
  exchangeGate = new Promise(resolve => { releaseExchange = resolve })
  await page.goto(`${frontend}/?return=fixture#google_handoff=teacher-fixture`)
  await page.getByRole('status').getByText('Влизане с Google...', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).hash, '')
  assert.equal(new URL(page.url()).search, '?return=fixture')
  releaseExchange()
  await page.getByRole('button', { name: 'Тестове', exact: true }).waitFor()
  assert.deepEqual(exchanges, [{ token: 'teacher-fixture' }])
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('quicktest.auth')).token), teacher.token)
  await page.reload()
  await page.getByRole('button', { name: 'Тестове', exact: true }).waitFor()
  assert.equal(exchanges.length, 1)
  await first.context.close()

  const second = await openContext(); page = second.page
  await page.goto(`${frontend}/#google_handoff=student-fixture`)
  await page.getByRole('button', { name: 'Моите тестове', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Тестове', exact: true }).count(), 0)
  assert.equal(exchanges.filter(value => value.token === 'student-fixture').length, 1)
  await second.context.close()

  const failure = await openContext(); page = failure.page
  const message = 'Влезте с парола и свържете Google от профила си.'
  await page.goto(`${frontend}/#google_error=${encodeURIComponent(message)}`)
  await page.getByRole('alert').getByText(message, { exact: true }).waitFor()
  assert.equal(new URL(page.url()).hash, '')
  assert.equal(exchanges.length, 2)
  await page.getByRole('button', { name: 'Забравена парола', exact: true }).click()
  await page.getByRole('heading', { name: 'Възстановяване на достъпа', exact: true }).waitFor()
  assert.equal(await page.getByRole('alert').count(), 0)
  // A provider callback loads a new document, not a same-page hash navigation.
  await page.goto('about:blank')
  await page.goto(`${frontend}/#google_handoff=expired-fixture`)
  await page.getByRole('alert').getByText('Изтекла или използвана идентификация.', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).hash, '')
  assert.equal(exchanges.filter(value => value.token === 'expired-fixture').length, 1)
  await page.getByLabel('Имейл', { exact: true }).fill(local.user.email)
  await page.getByLabel('Парола', { exact: true }).fill('password123')
  await page.getByRole('button', { name: 'Влез', exact: true }).click()
  await page.getByRole('button', { name: 'Тестове', exact: true }).waitFor()
  assert.equal(await page.getByRole('alert').count(), 0)
  await failure.context.close()

  const linked = await openContext(local); page = linked.page
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Профил', exact: true }).click()
  const connection = page.getByRole('region', { name: 'Вход с Google', exact: true })
  const linkForm = connection.getByRole('form', { name: 'Свързване с Google', exact: true })
  const password = linkForm.getByLabel('Парола за ExamAI', { exact: true })
  const link = linkForm.getByRole('button', { name: 'Свържи Google', exact: true })
  await linkForm.waitFor()
  assert.equal(await link.isDisabled(), true)
  await password.fill('wrong-password')
  await link.click()
  await connection.getByRole('alert').getByText('Текущата парола е неправилна.', { exact: true }).waitFor()
  assert.equal(links.length, 1)
  for (const { theme, width } of [{ theme: 'light', width: 1440 }, { theme: 'dark', width: 390 }, { theme: 'light', width: 320 }]) {
    await page.setViewportSize({ width, height: 1000 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: new URL(`google-profile-link-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  await password.fill('password123')
  linkGate = new Promise(resolve => { releaseLink = resolve })
  const linkingRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/profile/google/link' && request.method() === 'POST')
  await link.click(); await linkingRequest
  for (const control of await page.locator('form input, form button').all()) assert.equal(await control.isDisabled(), true)
  await linkForm.evaluate(form => form.requestSubmit())
  assert.equal(links.length, 2)
  releaseLink()
  await page.waitForURL(`${base}/api/auth/google/redirect?link=profile-link-fixture`)
  assert.equal(redirects.at(-1).searchParams.get('link'), 'profile-link-fixture')
  await page.goto(`${frontend}/#google_handoff=teacher-fixture`)
  await page.getByRole('button', { name: 'Тестове', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('quicktest.auth')).token), teacher.token)
  assert.equal(exchanges.filter(value => value.token === 'teacher-fixture').length, 2)
  await page.getByRole('button', { name: 'Профил', exact: true }).click()
  await connection.getByRole('status').getByText('Google е свързан с профила ви. Можете да влизате с „Влез с Google“.', { exact: true }).waitFor()
  assert.equal(await linkForm.count(), 0)
  assert.deepEqual(errors, [])
  console.log('Passed: Google login/register redirects without default role, no local form requirement, single-use handoff under StrictMode, persisted sessions, profile linking, error/retry, disabled provider, official image and desktop/mobile themes. API fixtures only; no Google account contacted.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('google-auth-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  releaseExchange?.()
  releaseLink?.()
  await browser.close()
}
