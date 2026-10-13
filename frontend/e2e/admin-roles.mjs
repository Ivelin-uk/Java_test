import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const subscription = { paid: false, paidUntil: null, paidAt: null, active: false }
const user = (id, name, role) => ({ id, name, email: `account-${id}@example.test`, role, active: true, passwordChangeRequired: false, roleSelectionRequired: false, subscription: { ...subscription }, allowedMethods: [], subscriptionMethods: [] })
const admin = user(1, 'Administrator', 'ADMIN')
const target = user(2, 'Test Learner', 'STUDENT')
const pending = { ...user(3, 'Pending Account', 'STUDENT'), roleSelectionRequired: true }
const users = [admin, target, pending]
const auth = { token: 'admin-role-fixture', user: admin }
const requests = [], errors = [], audit = []
let page, releaseSave, selfRevoked = false, failNext = true, saveGate = Promise.resolve()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin }, body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (path === '/api/auth/google/config') return respond({ enabled: false, redirect: `${base}/api/auth/google/redirect` })
    if (path === '/api/auth/me') return selfRevoked ? respond({ detail: 'Invalid token' }, 401) : respond(admin)
    if (path === '/api/admin/users' && method === 'GET') return respond(users)
    if (path === '/api/admin/permissions') return respond([])
    if (path === '/api/admin/audit') return respond(audit)
    const match = path.match(/^\/api\/admin\/users\/(\d+)\/role$/)
    if (match && method === 'PUT') {
      assert.equal(request.headers().authorization, `Bearer ${auth.token}`)
      const payload = request.postDataJSON()
      assert.deepEqual(Object.keys(payload), ['role'])
      const account = users.find(item => item.id === Number(match[1]))
      requests.push({ id: account.id, ...payload })
      if (failNext) { failNext = false; return respond({ detail: 'Временно недостъпен сървър.' }, 503) }
      if (account.role === 'ADMIN' && payload.role !== 'ADMIN' && users.filter(item => item.role === 'ADMIN' && item.active).length === 1) {
        return respond({ detail: 'Трябва да остане поне един активен администратор.' }, 409)
      }
      await saveGate
      const before = account.role
      account.role = payload.role
      account.roleSelectionRequired = false
      audit.unshift({ id: audit.length + 1, actorEmail: admin.email, targetEmail: account.email, action: 'USER_ROLE_CHANGED', details: `${before} -> ${account.role}`, createdAt: new Date().toISOString() })
      if (account.id === admin.id) selfRevoked = true
      return respond(account)
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(frontend)
  const open = account => page.getByRole('button', { name: `Смени ролята на ${account.email}`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Смяна на роля', exact: true })
  const role = dialog.getByRole('combobox', { name: 'Нова роля', exact: true })
  const save = dialog.getByRole('button', { name: 'Запази', exact: true })

  await open(target)
  await dialog.waitFor()
  assert.equal(await role.inputValue(), 'STUDENT')
  assert.equal(await role.evaluate(element => element === document.activeElement), true)
  assert.equal(await save.isDisabled(), true)
  assert.deepEqual(await role.locator('option').evaluateAll(items => items.map(item => item.value)), ['ADMIN', 'TEACHER', 'STUDENT'])
  await role.selectOption('TEACHER')
  await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
  assert.deepEqual(requests, [])
  await open(target)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(requests, [])

  await open(target)
  await role.selectOption('TEACHER')
  await save.click()
  await dialog.getByRole('alert').getByText('Временно недостъпен сървър.', { exact: true }).waitFor()
  assert.equal(await role.inputValue(), 'TEACHER')
  assert.equal(await save.isDisabled(), false)
  saveGate = new Promise(resolve => { releaseSave = resolve })
  await save.click()
  await dialog.getByRole('button', { name: 'Запазване...', exact: true }).waitFor()
  assert.equal(await role.isDisabled(), true)
  assert.equal(await dialog.getByRole('button', { name: 'Отказ', exact: true }).isDisabled(), true)
  await page.keyboard.press('Escape')
  assert.equal(await dialog.isVisible(), true)
  assert.equal(requests.length, 2)
  releaseSave()
  saveGate = Promise.resolve()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('status').filter({ hasText: 'Ролята на Test Learner' }).waitFor()
  assert.equal(target.role, 'TEACHER')
  assert.equal(await page.locator('.users-table tr').filter({ hasText: target.email }).locator('.role-cell').innerText(), 'Учител')

  for (const next of ['ADMIN', 'STUDENT']) {
    await open(target)
    await role.selectOption(next)
    await save.click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(target.role, next)
  }
  await page.getByRole('tab', { name: 'Журнал', exact: true }).click()
  await page.getByRole('cell', { name: 'ADMIN -> STUDENT', exact: true }).waitFor()
  assert.equal(await page.locator('.data-table tbody tr').filter({ hasText: 'Смяна на роля' }).count(), 3)
  await page.getByRole('tab', { name: /Потребители/ }).click()
  await page.getByRole('combobox', { name: 'Филтър по роля', exact: true }).selectOption('STUDENT')
  assert.equal(await page.getByRole('button', { name: `Смени ролята на ${admin.email}`, exact: true }).count(), 0)
  await page.getByRole('combobox', { name: 'Филтър по роля', exact: true }).selectOption('')
  await open(pending)
  assert.equal(await save.isDisabled(), false)
  await save.click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(pending.roleSelectionRequired, false)

  await open(admin)
  await role.selectOption('TEACHER')
  await save.click()
  await dialog.getByRole('alert').getByText('Трябва да остане поне един активен администратор.', { exact: true }).waitFor()
  assert.equal(admin.role, 'ADMIN')
  assert.equal(await role.inputValue(), 'TEACHER')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })

  for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    await open(target)
    await role.selectOption('TEACHER')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight
        && element.scrollWidth <= element.clientWidth
        && [...element.querySelectorAll('button, select, p')].every(child => {
          const childBounds = child.getBoundingClientRect()
          return childBounds.left >= bounds.left && childBounds.right <= bounds.right && childBounds.bottom <= bounds.bottom
        })
    }), true)
    await page.screenshot({ path: new URL(`admin-role-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
    await page.keyboard.press('Escape')
  }

  users.push(user(4, 'Second Administrator', 'ADMIN'))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Обнови', exact: true }).click()
  await open(admin)
  await dialog.getByText('Променяте собствената си роля и ще бъдете изведени от профила.', { exact: true }).waitFor()
  await role.selectOption('TEACHER')
  await save.click()
  await page.getByRole('button', { name: 'Влез', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('quicktest.auth')), null)
  assert.equal(await page.getByRole('navigation', { name: 'Основна навигация' }).count(), 0)
  assert.deepEqual(errors, [])
  console.log('Passed: explicit admin role action, all roles, cancellation, unchanged-role guard, pending onboarding, retry, busy controls, audit, filters, last-admin error, self-demotion logout, desktop/mobile in light/dark themes. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('admin-role-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  releaseSave?.()
  await browser.close()
}
