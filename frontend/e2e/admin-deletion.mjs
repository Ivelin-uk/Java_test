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
const target = user(2, 'Deleted Teacher', 'TEACHER')
const remaining = { ...user(3, 'Long Named Learner', 'STUDENT'), email: 'long-learner-address-for-responsive-confirmation-dialog@example.test' }
const users = [admin, target, remaining]
const auth = { token: 'admin-deletion-fixture', user: admin }
const requests = [], errors = [], audit = []
let page, releaseDeletion, deletionGate = Promise.resolve(), rejectDeletion = true, rejectRefresh = false
let userReads = 0, auditReads = 0
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  // Intercept every API URL so this test can never delete an account on a live server.
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
    if (!path.startsWith('/api/')) return route.continue()
    assert.equal(url.origin, new URL(base).origin)
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin }, body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (path === '/api/auth/google/config' && method === 'GET') return respond({ enabled: false, redirect: `${base}/api/auth/google/redirect` })
    if (path === '/api/auth/me' && method === 'GET') return respond(admin)
    if (path === '/api/admin/users' && method === 'GET') {
      userReads++
      return rejectRefresh ? respond({ detail: 'Временно недостъпен списък.' }, 503) : respond(users)
    }
    if (path === '/api/admin/permissions' && method === 'GET') return respond([])
    if (path === '/api/admin/audit' && method === 'GET') { auditReads++; return respond(audit) }
    const match = path.match(/^\/api\/admin\/users\/(\d+)$/)
    if (match && method === 'DELETE') {
      assert.equal(request.headers().authorization, `Bearer ${auth.token}`)
      const payload = request.postDataJSON()
      assert.deepEqual(Object.keys(payload), ['password'])
      const id = Number(match[1])
      assert.notEqual(id, admin.id)
      const account = users.find(item => item.id === id)
      assert.ok(account, 'No repeated deletion after a successful response')
      requests.push({ id, ...payload })
      if (rejectDeletion) return respond({ detail: 'Паролата е неправилна.' }, 403)
      await deletionGate
      users.splice(users.indexOf(account), 1)
      audit.unshift({ id: audit.length + 1, actorEmail: admin.email, targetEmail: account.email, action: 'USER_DELETED', details: 'Профилът и свързаните данни са изтрити.', createdAt: new Date().toISOString() })
      return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin } })
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => { errors.push(`Unexpected browser dialog: ${dialog.type()}`); void dialog.dismiss() })
  await page.goto(frontend)
  const trigger = account => page.getByRole('button', { name: `Изтрий ${account.email}`, exact: true })
  const dialog = page.getByRole('dialog', { name: 'Изтриване на потребител', exact: true })
  const confirm = dialog.getByRole('button', { name: 'Изтрий потребителя', exact: true })
  const cancel = dialog.getByRole('button', { name: 'Отказ', exact: true })
  const password = dialog.getByLabel('Вашата администраторска парола', { exact: true })
  const targetRow = page.locator('.users-table tbody tr').filter({ hasText: target.email })

  assert.equal(await trigger(admin).isDisabled(), true)
  assert.equal(await trigger(admin).getAttribute('title'), 'Не можете да изтриете собствения си профил.')
  await trigger(target).click()
  await dialog.waitFor()
  assert.equal(await dialog.evaluate(element => element.matches(':modal')), true)
  assert.equal(await cancel.evaluate(element => element === document.activeElement), true)
  assert.match(await dialog.innerText(), /собствените тестове и възлагания/)
  assert.match(await dialog.innerText(), /опитите и резултатите/)
  assert.match(await dialog.innerText(), /опитите и резултатите на всички участници/)
  assert.match(await dialog.innerText(), /Административният журнал се запазва/)
  assert.equal(await password.getAttribute('type'), 'password')
  assert.equal(await password.getAttribute('autocomplete'), 'current-password')
  assert.equal(await confirm.isDisabled(), true)
  await password.fill('   ')
  assert.equal(await confirm.isDisabled(), true)
  await password.fill('fixture-password')
  await cancel.click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await trigger(target).evaluate(element => element === document.activeElement), true)
  assert.deepEqual(requests, [])
  assert.equal(await targetRow.count(), 1)
  await trigger(target).click()
  assert.equal(await password.inputValue(), '')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.deepEqual(requests, [])

  for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    await trigger(remaining).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight
        && element.scrollWidth <= element.clientWidth
        && [...element.querySelectorAll('button, input, p')].every(child => {
          const childBounds = child.getBoundingClientRect()
          return childBounds.left >= bounds.left && childBounds.right <= bounds.right && childBounds.bottom <= bounds.bottom
        })
    }), true)
    await page.screenshot({ path: new URL(`admin-deletion-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
  }

  await page.setViewportSize({ width: 1440, height: 1000 })
  await trigger(target).click()
  await password.fill('incorrect-password')
  const readsBefore = { users: userReads, audit: auditReads }
  await confirm.click()
  await dialog.getByRole('alert').getByText('Паролата е неправилна.', { exact: true }).waitFor()
  assert.equal(await targetRow.count(), 1)
  assert.equal(await password.inputValue(), 'incorrect-password')
  assert.equal(await confirm.isDisabled(), false)
  assert.deepEqual({ users: userReads, audit: auditReads }, readsBefore)
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('quicktest.auth')).token), auth.token)

  rejectDeletion = false
  deletionGate = new Promise(resolve => { releaseDeletion = resolve })
  await password.fill('  fixture-password-with-spaces  ')
  await confirm.evaluate(button => { button.click(); button.click() })
  await dialog.getByRole('button', { name: 'Изчакване...', exact: true }).waitFor()
  assert.equal(await password.isDisabled(), true)
  assert.equal(await cancel.isDisabled(), true)
  await page.keyboard.press('Escape')
  assert.equal(await dialog.isVisible(), true)
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1], { id: target.id, password: '  fixture-password-with-spaces  ' })
  assert.deepEqual({ users: userReads, audit: auditReads }, readsBefore)
  releaseDeletion()
  deletionGate = Promise.resolve()
  await dialog.waitFor({ state: 'detached' })
  await page.getByRole('status').filter({ hasText: `Потребителят ${target.email} и свързаните му данни са изтрити.` }).waitFor()
  assert.equal(await targetRow.count(), 0)
  assert.equal(userReads, readsBefore.users + 1)
  assert.equal(auditReads, readsBefore.audit + 1)
  await page.getByRole('tab', { name: 'Журнал', exact: true }).click()
  await page.locator('.data-table tbody tr').filter({ hasText: 'Изтриване на потребител' }).filter({ hasText: target.email }).waitFor()

  // A failed refresh after a completed DELETE must not invite another deletion.
  await page.getByRole('tab', { name: /Потребители/ }).click()
  await trigger(remaining).click()
  await password.fill('fixture-password')
  rejectRefresh = true
  await confirm.click()
  await dialog.waitFor({ state: 'detached' })
  await page.getByRole('alert').getByText('Потребителят е изтрит, но списъкът и журналът не се обновиха. Натиснете „Обнови“.', { exact: true }).waitFor()
  assert.equal(await trigger(remaining).count(), 0)
  assert.equal(requests.length, 3)
  rejectRefresh = false
  await page.getByRole('button', { name: 'Обнови', exact: true }).click()
  await page.getByRole('tab', { name: 'Журнал', exact: true }).click()
  await page.locator('.data-table tbody tr').filter({ hasText: remaining.email }).waitFor()
  assert.equal(await page.locator('.data-table tbody tr').filter({ hasText: 'Изтриване на потребител' }).count(), 2)
  assert.deepEqual(errors, [])
  console.log('Passed: admin deletion confirmation, password requirement, self-delete disabled, cancel/Escape/focus, failed-password retry, exact DELETE body, busy/double-click guard, list/audit refresh only after success, refresh failure recovery, desktop/mobile and both themes. API fixtures only; no real accounts changed.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('admin-deletion-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  releaseDeletion?.()
  await browser.close()
}
