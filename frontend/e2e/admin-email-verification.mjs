import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const account = (id, name, overrides = {}) => ({ id, name, email: `account-${id}@example.test`, role: 'STUDENT', active: true, passwordChangeRequired: false, roleSelectionRequired: false, subscription: { paid: false, paidUntil: null, paidAt: null, active: false }, allowedMethods: [], subscriptionMethods: [], emailVerifiedAt: null, notificationEmail: `notifications-${id}@example.test`, notificationEmailVerifiedAt: null, ...overrides })
const admin = account(1, 'Administrator', { role: 'ADMIN', emailVerifiedAt: '2026-11-21T18:00:00Z', notificationEmailVerifiedAt: '2026-11-21T18:00:00Z' })
const target = account(2, 'Test Learner'), stale = account(3, 'Changed Address')
const inactive = account(4, 'Inactive Learner', { active: false }), unknown = account(5, 'Unknown State', { notificationEmailVerifiedAt: undefined })
const users = [admin, target, stale, inactive, unknown]
const auth = { token: 'admin-email-fixture', user: admin }
const requests = [], errors = [], audit = []
let page, releaseSave, failNext = true, staleNext = true, saveGate = Promise.resolve()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin }, body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (path === '/api/auth/google/config') return respond({ enabled: false })
    if (path === '/api/auth/me') return respond(admin)
    if (path === '/api/admin/users' && method === 'GET') return respond(users)
    if (path === '/api/admin/teacher-billing' || path === '/api/admin/teacher-billing/payments' || path === '/api/admin/permissions') return respond([])
    if (path === '/api/admin/audit') return respond(audit)
    const match = path.match(/^\/api\/admin\/users\/(\d+)\/verify-email$/)
    if (match && method === 'POST') {
      assert.equal(request.headers().authorization, `Bearer ${auth.token}`)
      const payload = request.postDataJSON(), user = users.find(item => item.id === Number(match[1]))
      assert.deepEqual(payload, { email: user.notificationEmail })
      requests.push({ id: user.id, ...payload })
      if (user.id === target.id && failNext) { failNext = false; return respond({ detail: 'Временно недостъпен сървър.' }, 503) }
      if (user.id === stale.id && staleNext) { staleNext = false; user.notificationEmail = 'new-address@example.test'; return respond({ detail: 'Имейлът за известия е променен. Обновете профила.' }, 409) }
      await saveGate
      user.notificationEmailVerifiedAt = '2026-11-21T19:00:00Z'
      audit.unshift({ id: audit.length + 1, actorEmail: admin.email, targetEmail: user.email, action: 'EMAIL_VERIFIED_BY_ADMIN', details: `Потвърден имейл: ${user.notificationEmail}`, createdAt: user.notificationEmailVerifiedAt })
      return respond(user)
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(frontend)
  const button = user => page.getByRole('button', { name: `Потвърди имейла на ${user.notificationEmail}`, exact: true })
  const dialog = page.getByRole('dialog', { name: 'Потвърждаване на имейл от администратор', exact: true })
  const confirm = dialog.getByRole('button', { name: 'Потвърди имейла', exact: true })
  await button(target).waitFor()
  for (const user of [admin, inactive, unknown]) assert.equal(await button(user).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: `Изпрати потвърждение на ${target.notificationEmail}`, exact: true }).isEnabled(), true)

  await button(target).click()
  await dialog.getByText(target.name, { exact: true }).waitFor()
  await dialog.getByText(target.notificationEmail, { exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Отказ', exact: true }).evaluate(element => element === document.activeElement), true)
  await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
  assert.deepEqual(requests, [])
  await button(target).click()
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(requests, [])

  await button(target).click()
  await confirm.click()
  await dialog.getByRole('alert').getByText('Временно недостъпен сървър.', { exact: true }).waitFor()
  assert.equal(await confirm.isEnabled(), true)
  assert.equal(target.notificationEmailVerifiedAt, null)
  saveGate = new Promise(resolve => { releaseSave = resolve })
  await confirm.click()
  await dialog.getByRole('button', { name: 'Потвърждаване…', exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Отказ', exact: true }).isDisabled(), true)
  await page.keyboard.press('Escape')
  assert.equal(await dialog.isVisible(), true)
  await dialog.getByRole('button', { name: 'Потвърждаване…', exact: true }).evaluate(element => { element.click(); element.click() })
  assert.equal(requests.length, 2)
  releaseSave(); saveGate = Promise.resolve()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('status').filter({ hasText: `Имейлът ${target.notificationEmail} е потвърден от администратор.` }).waitFor()
  assert.equal(await button(target).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: `Изпрати потвърждение на ${target.notificationEmail}`, exact: true }).isDisabled(), true)
  await page.locator('.users-table tr').filter({ hasText: target.email }).getByText('Потвърден за известия', { exact: true }).waitFor()
  await page.getByRole('tab', { name: 'Журнал', exact: true }).click()
  await page.getByRole('cell', { name: /Имейл, потвърден от администратор/ }).waitFor()
  assert.equal(audit.length, 1)
  await page.getByRole('tab', { name: /Потребители/ }).click()

  await button(stale).click()
  await confirm.click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('alert').getByText('Имейлът за известия е променен. Обновете профила.', { exact: true }).waitFor()
  assert.equal(stale.notificationEmailVerifiedAt, null)
  await button(stale).click()
  await dialog.getByText('new-address@example.test', { exact: true }).waitFor()
  await page.keyboard.press('Escape')

  for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    await button(stale).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && element.scrollWidth <= element.clientWidth
    }), true)
    await page.screenshot({ path: new URL(`admin-email-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
    await page.keyboard.press('Escape')
  }
  await button(stale).click()
  await confirm.click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await button(stale).isDisabled(), true)
  assert.equal(audit.length, 2)
  assert.deepEqual(errors, [])
  console.log('Passed: direct admin email confirmation, exact notification address, cancellation, retry, busy duplicate guard, stale address refresh, disabled states, audit, desktop/mobile light/dark layouts. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('admin-email-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  releaseSave?.()
  await browser.close()
}
