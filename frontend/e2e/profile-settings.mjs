import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const errors = []
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  async function fixture(role) {
    let auth = { token: `profile-${role}`, user: { id: 101, name: 'ExamAI User', email: 'login@example.test', role, active: true, passwordChangeRequired: false, roleSelectionRequired: false, subscription: { active: false, paid: false, paidUntil: null, paidAt: null }, allowedMethods: [], subscriptionMethods: [] } }
    let password = 'current-password123', address = 'notifications@example.test', pendingEmail, failVerify = true
    let emailGate = Promise.resolve(), passwordGate = Promise.resolve(), releaseEmail, releasePassword
    const requests = []
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.addInitScript(value => { if (!localStorage.getItem('quicktest.auth')) localStorage.setItem('quicktest.auth', JSON.stringify(value)) }, auth)
    await context.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin }, body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      requests.push({ method, path, authorization: request.headers().authorization, ...(method === 'POST' ? { body: request.postDataJSON() } : {}) })
      if (request.headers().authorization !== `Bearer ${auth.token}`) return respond({ detail: 'Невалидна сесия.' }, 401)
      if (method === 'GET') {
        if (path === '/api/auth/me') return respond(auth.user)
        if (path === '/api/auth/google/config') return respond({ enabled: false, redirect: `${base}/api/auth/google/redirect` })
        if (path === '/api/v1/profile/identities') return respond([])
        if (path === '/api/v1/profile/notification-email') return respond({ email: address, verified_at: new Date().toISOString() })
        if (path === '/api/v1/billing') return respond({ plan: 'free', status: 'free', currentPeriod: null, paidThrough: null, cancelAtPeriodEnd: false, mode: 'unconfigured', checkoutAvailable: false, portalAvailable: false, limits: { groups: 1, activeAssignments: 5, aiCredits: 10 }, usage: { groups: 1, activeAssignments: 2, aiCredits: 3 }, plans: { free: { groups: 1, activeAssignments: 5, aiCredits: 10 }, pro: { groups: 20, activeAssignments: 100, aiCredits: 100 } }, prices: { month: { available: false }, year: { available: false } } })
        if (['/api/v1/assignments', '/api/v1/groups', '/api/v1/grading', '/api/v1/results', '/api/admin/users', '/api/admin/teacher-billing', '/api/admin/permissions', '/api/admin/audit'].includes(path)) return respond([])
      }
      if (method === 'POST' && path === '/api/v1/profile/notification-email') {
        const body = request.postDataJSON()
        if (body.password !== password) return respond({ detail: 'Текущата парола е неправилна.' }, 403)
        await emailGate
        pendingEmail = body.email
        return respond(null)
      }
      if (method === 'POST' && path === '/api/v1/profile/notification-email/verify') {
        assert.deepEqual(request.postDataJSON(), { token: 'email-verification-fixture' })
        if (failVerify) { failVerify = false; return respond({ detail: 'Временно недостъпно потвърждение.' }, 503) }
        address = pendingEmail
        return respond(null)
      }
      if (method === 'POST' && path === '/api/auth/password') {
        const body = request.postDataJSON()
        if (body.currentPassword !== password) return respond({ detail: 'Текущата парола е неправилна.' }, 400)
        if (body.newPassword === password) return respond({ detail: 'Новата парола трябва да е различна.' }, 400)
        await passwordGate
        password = body.newPassword
        auth = { ...auth, token: `${auth.token}-renewed` }
        return respond(auth)
      }
      errors.push(`Unexpected API: ${method} ${path}`)
      return respond({}, 404)
    })
    const next = await context.newPage()
    next.on('pageerror', error => errors.push(error.message))
    return { context, page: next, requests, holdEmail() { emailGate = new Promise(resolve => { releaseEmail = resolve }) }, holdPassword() { passwordGate = new Promise(resolve => { releasePassword = resolve }) }, releaseEmail() { releaseEmail?.() }, releasePassword() { releasePassword?.() } }
  }
  for (const role of ['TEACHER', 'STUDENT', 'ADMIN']) {
    const current = await fixture(role); page = current.page
    const writes = path => current.requests.filter(request => request.method === 'POST' && request.path === path)
    const passwordPath = '/api/auth/password', emailPath = '/api/v1/profile/notification-email'
    await page.goto(frontend)
    await page.getByRole('navigation', { name: 'Основна навигация' }).getByRole('button', { name: 'Профил', exact: true }).click()
    const profile = page.getByRole('region', { name: 'Моят профил', exact: true })
    const emailForm = profile.getByRole('form', { name: 'Смяна на имейл за известия', exact: true }), passwordForm = profile.getByRole('form', { name: 'Смяна на парола', exact: true })
    const email = emailForm.getByLabel('Нов адрес', { exact: true }), emailPassword = emailForm.getByLabel('Текуща парола', { exact: true })
    const oldPassword = passwordForm.getByLabel('Текуща парола', { exact: true }), newPassword = passwordForm.getByLabel('Нова парола', { exact: true }), confirm = passwordForm.getByLabel('Повторете новата парола', { exact: true })
    const saveEmail = emailForm.getByRole('button', { name: 'Потвърди адреса', exact: true }), savePassword = passwordForm.getByRole('button', { name: 'Смени паролата', exact: true })
    await emailForm.getByText('notifications@example.test · Потвърден', { exact: true }).waitFor()
    assert.equal(await profile.getByRole('form').count(), 2)
    assert.equal(await profile.getByRole('table').count(), 0)
    await profile.getByText('Google входът не е конфигуриран.', { exact: true }).waitFor()
    assert.equal(await profile.getByRole('button', { name: 'Свържи Google', exact: true }).count(), 0)
    assert.equal(await profile.getByText(/Изход от всички сесии|Локална тестова/).count(), 0)
    assert.equal(await email.inputValue(), 'notifications@example.test')
    assert.equal(await oldPassword.getAttribute('autocomplete'), 'current-password')
    for (const input of [newPassword, confirm]) assert.equal(await input.getAttribute('autocomplete'), 'new-password')
    if (role === 'TEACHER') {
      await email.fill('invalid-address'); await emailPassword.fill('current-password123'); await saveEmail.click()
      assert.equal(writes(emailPath).length, 0)
      await email.fill('new-notifications@example.test'); await emailPassword.fill('incorrect-password'); await saveEmail.click()
      await emailForm.getByRole('alert').getByText('Текущата парола е неправилна.', { exact: true }).waitFor()
      assert.equal(await oldPassword.inputValue(), '')
      await oldPassword.fill('password-form-draft')
      await emailPassword.fill('current-password123')
      current.holdEmail()
      const emailRequest = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === emailPath)
      await saveEmail.click(); await emailRequest
      for (const input of [email, emailPassword, oldPassword, newPassword, confirm, saveEmail, savePassword]) assert.equal(await input.isDisabled(), true)
      await emailForm.evaluate(element => element.requestSubmit())
      await passwordForm.evaluate(element => element.requestSubmit())
      assert.equal(writes(emailPath).length, 2)
      assert.equal(writes(passwordPath).length, 0)
      current.releaseEmail()
      await page.getByRole('status').getByText('Изпратено е потвърждение до новия адрес.', { exact: true }).waitFor()
      assert.equal(await emailPassword.inputValue(), '')
      assert.equal(await oldPassword.inputValue(), 'password-form-draft')
      assert.equal(writes(emailPath).at(-1).body.email, 'new-notifications@example.test')
      await page.goto(`${frontend}/verify-email?token=email-verification-fixture`)
      await page.getByRole('heading', { name: 'Потвърждение на имейл', exact: true }).waitFor()
      assert.equal(await page.getByRole('form').count(), 0)
      const verify = page.getByRole('button', { name: 'Потвърди имейла', exact: true })
      await verify.click()
      await page.getByRole('alert').getByText('Временно недостъпно потвърждение.', { exact: true }).waitFor()
      await verify.click()
      await page.getByRole('status').getByText('Имейлът е потвърден.', { exact: true }).waitFor()
      assert.equal(new URL(page.url()).search, '')
      assert.equal(await verify.count(), 0)
      await page.getByRole('button', { name: 'Към профила', exact: true }).click()
      await emailForm.getByText('new-notifications@example.test · Потвърден', { exact: true }).waitFor()
      assert.equal(await email.inputValue(), 'new-notifications@example.test')
      await oldPassword.fill('current-password123'); await newPassword.fill('new-password123'); await confirm.fill('different-password123'); await savePassword.click()
      await passwordForm.getByRole('alert').getByText('Паролите не съвпадат.', { exact: true }).waitFor()
      assert.equal(writes(passwordPath).length, 0)
      await newPassword.fill('short'); await confirm.fill('short'); await savePassword.click()
      assert.equal(writes(passwordPath).length, 0)
      await oldPassword.fill('incorrect-password'); await newPassword.fill('new-password123'); await confirm.fill('new-password123'); await savePassword.click()
      await passwordForm.getByRole('alert').getByText('Текущата парола е неправилна.', { exact: true }).waitFor()
      assert.equal(await newPassword.inputValue(), 'new-password123')
      await oldPassword.fill('current-password123')
      current.holdPassword()
      const passwordRequest = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === passwordPath)
      await savePassword.click(); await passwordRequest
      for (const input of [email, emailPassword, oldPassword, newPassword, confirm, saveEmail, savePassword]) assert.equal(await input.isDisabled(), true)
      await passwordForm.evaluate(element => element.requestSubmit())
      assert.equal(writes(passwordPath).length, 2)
      current.releasePassword()
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('quicktest.auth')).token.endsWith('-renewed'))
      await passwordForm.waitFor()
      for (const input of [oldPassword, newPassword, confirm]) assert.equal(await input.inputValue(), '')
      assert.deepEqual(writes(passwordPath).at(-1).body, { currentPassword: 'current-password123', newPassword: 'new-password123' })
      await page.reload(); await passwordForm.waitFor()
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('quicktest.auth')).token), 'profile-TEACHER-renewed')
      await emailForm.getByText('new-notifications@example.test · Потвърден', { exact: true }).waitFor()
      for (const { theme, width, height } of [{ theme: 'dark', width: 1440, height: 1000 }, { theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 320, height: 844 }]) {
        await page.setViewportSize({ width, height })
        if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        assert.equal(await profile.evaluate(element => [...element.querySelectorAll('form, input, button, p')].every(child => { const bounds = child.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && (child.matches('input') || child.scrollWidth <= child.clientWidth) })), true)
        await page.screenshot({ path: new URL(`profile-settings-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
      }
      await page.goto(`${frontend}/verify-email`)
      await page.getByRole('alert').getByText('Липсва линк за потвърждение на имейла.', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Потвърди имейла', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Към профила', exact: true }).click(); await passwordForm.waitFor()
    }
    assert.equal(current.requests.some(request => ['/api/v1/profile/mailbox', '/api/v1/profile/google/link', '/api/auth/logout-all'].includes(request.path)), false)
    current.releaseEmail(); current.releasePassword()
    await current.context.close()
  }
  assert.deepEqual(errors, [])
  console.log('Passed: password/email settings for all roles, disabled Google provider status, independent credentials, validation/retry, pending and duplicate-submit guards, password token renewal/persistence, notification-email verification links/retry, desktop/mobile and both themes. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('profile-settings-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  await browser.close()
}
