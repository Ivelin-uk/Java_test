import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'notifications-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const groups = [{ id: 301, name: '12А', subject: 'Математика', description: '', join_code: 'ABCD2345', participant_count: 0 }]
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const errors = [], writes = []
let failCreate = true, failDelete = true, sequence = 301
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      const data = { '/api/auth/me': auth.user, '/api/auth/google/config': { enabled: false }, '/api/v1/groups': groups, '/api/v1/members': [], '/api/v1/tests': [], '/api/v1/assignments': [], '/api/v1/grading': [] }
      if (Object.hasOwn(data, path)) return respond(data[path])
      if (/^\/api\/v1\/groups\/\d+\/members$/.test(path)) return respond([])
    }
    if (method === 'POST' && path === '/api/auth/logout') return respond({})
    if (method === 'POST' && path === '/api/v1/groups') {
      writes.push({ method, path })
      if (failCreate) return respond({ detail: 'Групата не може да бъде създадена.' }, 409)
      const group = { ...groups[0], ...request.postDataJSON(), id: ++sequence }
      groups.push(group)
      return respond(group)
    }
    const group = path.match(/^\/api\/v1\/groups\/(\d+)$/)
    if (group && ['PUT', 'DELETE'].includes(method)) {
      writes.push({ method, path })
      if (method === 'DELETE') {
        if (failDelete) return respond({ detail: 'Групата не може да бъде изтрита.' }, 409)
        groups.splice(groups.findIndex(value => value.id === Number(group[1])), 1)
      } else Object.assign(groups.find(value => value.id === Number(group[1])), request.postDataJSON())
      return respond({})
    }
    errors.push(`${method} ${path}`)
    return respond({}, 404)
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-10-22T18:32:00Z') })
  await page.clock.pauseAt(new Date('2026-10-22T18:32:01Z'))
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Групи', exact: true }).click()
  const notifications = page.getByRole('list', { name: 'Известия', exact: true })
  const notices = notifications.getByRole('status')
  const createMessage = 'Групата е създадена. Кодът за присъединяване е в таблицата.'
  await page.getByRole('button', { name: 'Създай група', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Създаване на група', exact: true })
  await dialog.getByLabel('Име', { exact: true }).fill('Нова група')
  await dialog.getByRole('button', { name: 'Създай група', exact: true }).click()
  await dialog.getByRole('alert').getByText('Групата не може да бъде създадена.', { exact: true }).waitFor()
  await page.clock.fastForward(7000)
  assert.equal(await notices.count(), 0)
  assert.equal(await dialog.getByRole('alert').isVisible(), true)
  failCreate = false
  await dialog.getByRole('button', { name: 'Създай група', exact: true }).click()
  await notices.getByText(createMessage, { exact: true }).waitFor()
  assert.equal(await page.getByText(createMessage, { exact: true }).count(), 1)
  assert.equal(await notices.first().evaluate(element => element.classList.contains('app-notification-success')), true)
  await notices.first().hover(); await page.clock.fastForward(7000)
  assert.equal(await notices.count(), 1)
  await notices.getByRole('button', { name: 'Затвори известието', exact: true }).focus()
  await page.mouse.move(0, 0); await page.clock.fastForward(7000)
  assert.equal(await notices.count(), 1)
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  assert.equal(await notices.count(), 1)
  await page.clock.fastForward(6100)
  await page.waitForFunction(() => !document.querySelector('.app-notification'))
  await page.getByRole('button', { name: 'Групи', exact: true }).click()
  const table = page.getByRole('table', { name: 'Групи', exact: true })
  await table.getByRole('button', { name: '12А', exact: true }).click()
  const save = page.getByRole('button', { name: 'Запази', exact: true })
  await save.click(); await notices.getByText('Групата е обновена.', { exact: true }).waitFor()
  await save.click()
  assert.equal(await notices.count(), 1)
  await notices.getByRole('button', { name: 'Затвори известието', exact: true }).click()
  assert.equal(await notices.count(), 0)
  await save.click(); await notices.getByText('Групата е обновена.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Към групите', exact: true }).click()
  const row = table.getByRole('row').filter({ has: page.getByRole('button', { name: 'Нова група', exact: true }) })
  await row.getByRole('button', { name: 'Изтрий групата', exact: true }).click()
  const deletion = page.getByRole('dialog', { name: 'Изтриване на група', exact: true })
  await deletion.getByRole('button', { name: 'Отказ', exact: true }).click()
  assert.equal(await notices.count(), 1)
  await row.getByRole('button', { name: 'Изтрий групата', exact: true }).click()
  await deletion.getByRole('button', { name: 'Изтрий', exact: true }).click()
  await deletion.getByRole('alert').getByText('Групата не може да бъде изтрита.', { exact: true }).waitFor()
  assert.equal(await notifications.locator('.app-notification-danger').count(), 0)
  failDelete = false
  await deletion.getByRole('button', { name: 'Изтрий', exact: true }).click()
  const removed = notices.filter({ hasText: 'Групата е изтрита.' })
  await removed.waitFor()
  assert.equal(await removed.evaluate(element => element.classList.contains('app-notification-danger')), true)
  assert.equal(await row.count(), 0)
  for (const { width, theme } of [{ width: 1440, theme: 'light' }, { width: 1440, theme: 'dark' }, { width: 390, theme: 'dark' }, { width: 320, theme: 'light' }]) {
    await page.setViewportSize({ width, height: 1000 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await removed.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight }), true)
    await page.screenshot({ path: new URL(`notifications-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  await page.getByRole('button', { name: 'Изход', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.app-notification'))
  assert.equal(await notifications.count(), 0)
  assert.equal(writes.filter(write => write.method === 'DELETE').length, 2)
  assert.deepEqual(errors, [])
  console.log('Passed: create/edit/delete notices, correct colors, failure/cancel isolation, repeat actions, deduplication, auto-dismiss, hover/focus pause, manual close, navigation persistence, logout clearing and responsive light/dark layouts. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('notifications-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally { await browser.close() }
