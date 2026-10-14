import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'assignment-dates-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const test = { id: 201, title: 'Основи на Java', status: 'published', owner_id: 101, shared: false }
const group = { id: 301, name: '12А', subject: 'Java', description: '' }
const errors = [], submissions = [], assignments = []
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Sofia' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      const data = { '/api/auth/me': auth.user, '/api/v1/groups': [group], '/api/v1/assignments': assignments, '/api/v1/grading': [], '/api/v1/tests': [test], '/api/v1/tests/201/versions': [{ id: 202, version_number: 1 }] }
      if (Object.hasOwn(data, path)) return respond(data[path])
    }
    if (method === 'POST' && path === '/api/v1/assignments') {
      const body = request.postDataJSON(), id = 601 + submissions.length
      submissions.push(body)
      assignments.push({ id, teacher_id: 101, title: test.title, starts_at: body.startsAt, ends_at: body.endsAt, max_attempts: 1, recipients: 1, recipient_groups: [group] })
      return respond({ id, recipients: 1 })
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return route.fulfill({ status: 404 })
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${frontend}/assignments`)
  const form = page.getByRole('form', { name: 'Възлагане на тест', exact: true })
  const start = form.getByLabel('Начало', { exact: true }), end = form.getByLabel('Краен срок', { exact: true })
  const alert = form.getByRole('alert')
  const assign = form.getByRole('button', { name: 'Възложи', exact: true })
  await form.getByRole('combobox', { name: 'Тест', exact: true }).fill(test.title)
  await page.getByRole('listbox', { name: 'Тестове за възлагане' }).getByRole('option').click()
  await form.getByRole('combobox', { name: 'Търси групи', exact: true }).click()
  await page.getByRole('listbox', { name: 'Групи', exact: true }).getByRole('option', { name: group.name, exact: true }).click()
  for (const [from, until] of [
    ['2098-10-14T10:00', '2098-10-14T10:00'],
    ['2098-10-14T10:01', '2098-10-14T10:00'],
    ['2098-10-15T09:00', '2098-10-14T10:00'],
    ['2099-01-01T00:00', '2098-12-31T23:59'],
  ]) {
    await start.fill(from); await end.fill(until)
    await alert.getByText('Крайният срок трябва да е след началото.', { exact: true }).waitFor()
    for (const input of [start, end]) {
      assert.equal(await input.getAttribute('aria-invalid'), 'true')
      assert.equal(await input.getAttribute('aria-describedby'), await alert.getAttribute('id'))
    }
    assert.equal(await start.inputValue(), from)
    assert.equal(await end.inputValue(), until)
    await assign.click()
    assert.equal(await end.evaluate(element => element === document.activeElement), true)
    await form.evaluate(element => element.requestSubmit())
    assert.equal(submissions.length, 0)
  }
  await start.fill('2098-10-14T10:00'); await end.fill('2098-10-14T10:01')
  assert.equal(await alert.count(), 0)
  assert.equal(await start.getAttribute('max'), '2098-10-14T10:00')
  assert.equal(await end.getAttribute('min'), '2098-10-14T10:01')
  for (const input of [start, end]) {
    assert.equal(await input.getAttribute('aria-invalid'), 'false')
    assert.equal(await input.getAttribute('aria-describedby'), null)
    assert.equal(await input.evaluate(element => element.validity.valid), true)
  }
  await start.fill(''); await assign.click()
  await page.getByRole('alert').getByText('Попълнете началната дата и час.', { exact: true }).waitFor()
  assert.equal(await end.getAttribute('min'), null)
  await start.fill('2098-10-14T10:00'); await end.fill(''); await assign.click()
  await page.getByRole('alert').getByText('Попълнете крайната дата и час.', { exact: true }).waitFor()
  assert.equal(await start.getAttribute('max'), null)
  assert.equal(submissions.length, 0)
  for (const [from, until] of [
    ['2098-10-14T10:00', '2098-10-14T10:01'],
    ['2098-01-31T23:59', '2098-02-01T00:00'],
    ['2098-12-31T23:59', '2099-01-01T00:00'],
  ]) {
    await start.fill(from); await end.fill(until)
    assert.equal(await alert.count(), 0)
    assert.equal(await start.getAttribute('max'), from)
    assert.equal(await end.getAttribute('min'), until)
    const expected = await page.evaluate(([from, until]) => ({ startsAt: new Date(from).toISOString(), endsAt: new Date(until).toISOString() }), [from, until])
    const pending = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/assignments')
    await assign.click()
    const submitted = (await pending).postDataJSON()
    assert.equal(submitted.startsAt, expected.startsAt)
    assert.equal(submitted.endsAt, expected.endsAt)
    assert(new Date(submitted.startsAt) < new Date(submitted.endsAt))
    await page.getByText('Възлагането е създадено.', { exact: true }).waitFor()
  }
  assert.equal(submissions.length, 3)
  await start.fill('2098-10-14T10:00'); await end.fill('2098-10-14T09:59')
  for (const { theme, width, height } of [{ theme: 'dark', width: 1440, height: 1000 }, { theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 320, height: 844 }]) {
    await page.setViewportSize({ width, height })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    await alert.scrollIntoViewIfNeeded()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await alert.evaluate(element => element.scrollWidth <= element.clientWidth), true)
    await page.screenshot({ path: new URL(`assignment-dates-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log('Passed: immediate strict date ordering, equal/reversed dates blocked without requests, calendar limits, accessible errors and focus, correction, required fields, one-minute/month/year boundaries, UTC payload, desktop/mobile and both themes. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('assignment-dates-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  await browser.close()
}
