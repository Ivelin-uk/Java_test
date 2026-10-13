import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const errors = []
let page, releaseSave
try {
  for (const provider of ['password', 'google']) for (const role of ['TEACHER', 'STUDENT']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const auth = { token: `${provider}-${role}-fixture`, user: { id: 101, name: 'New account', email: `${provider}-${role.toLowerCase()}@example.test`, role: 'STUDENT', active: true, passwordChangeRequired: false, roleSelectionRequired: true } }
    const registrations = [], selections = [], exchanges = []
    const retry = provider === 'password' && role === 'TEACHER'
    let failNext = retry, saveGate = Promise.resolve()
    await context.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin }, body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (path === '/api/auth/google/config') return respond({ enabled: true, redirect: `${base}/api/auth/google/redirect` })
      if (path === '/api/auth/register') { registrations.push(request.postDataJSON()); return respond(auth) }
      if (path === '/api/auth/login') return respond(auth)
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/auth/logout') return route.fulfill({ status: 204 })
      if (path === '/api/auth/google/exchange') { exchanges.push(request.postDataJSON()); return respond(auth) }
      if (path === '/api/auth/role') {
        assert.equal(request.headers().authorization, `Bearer ${auth.token}`)
        selections.push(request.postDataJSON())
        if (failNext) { failNext = false; return respond({ detail: 'Временно недостъпен сървър.' }, 503) }
        await saveGate
        auth.user.role = request.postDataJSON().role
        auth.user.roleSelectionRequired = false
        return respond(auth.user)
      }
      if (['/api/v1/assignments', '/api/v1/grading', '/api/v1/results'].includes(path)) {
        if (auth.user.roleSelectionRequired) errors.push('Workspace requested before role selection')
        return respond([])
      }
      errors.push(`Unexpected API: ${method} ${path}`)
      return respond({}, 404)
    })
    page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    if (provider === 'password') {
      await page.goto(frontend)
      await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
      await page.getByLabel('Име', { exact: true }).fill('New')
      await page.getByLabel('Фамилия', { exact: true }).fill('Account')
      await page.getByLabel('Имейл', { exact: true }).fill(auth.user.email)
      await page.getByLabel('Парола', { exact: true }).fill('password123')
      await page.getByRole('button', { name: 'Създай профил', exact: true }).click()
    } else await page.goto(`${frontend}/#google_handoff=new-profile-fixture`)
    const heading = page.getByRole('heading', { name: 'Изберете роля', exact: true })
    await heading.waitFor()
    assert.equal(await page.getByRole('navigation', { name: 'Основна навигация' }).count(), 0)
    const next = page.getByRole('button', { name: 'Продължи', exact: true })
    assert.equal(await next.isDisabled(), true)
    assert.equal(await page.locator('input[name="role"]:checked').count(), 0)
    assert.deepEqual(selections, [])
    if (provider === 'password') {
      assert.equal(registrations.length, 1)
      assert.equal(Object.hasOwn(registrations[0], 'role'), false)
    } else assert.deepEqual(exchanges, [{ token: 'new-profile-fixture' }])
    await page.reload()
    await heading.waitFor()
    assert.equal(await next.isDisabled(), true)
    if (retry) {
      for (const { theme, width, height } of [{ theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 320, height: 844 }]) {
        await page.setViewportSize({ width, height })
        if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        for (const label of ['Учител / асистент', 'Ученик / студент']) {
          const radio = page.getByRole('radio', { name: label, exact: true })
          await radio.scrollIntoViewIfNeeded()
          assert.equal(await radio.evaluate(element => {
            const label = element.closest('label'), bounds = label.getBoundingClientRect()
            return label.scrollWidth <= label.clientWidth && [...label.children].every(child => {
              const childBounds = child.getBoundingClientRect()
              return childBounds.left >= bounds.left && childBounds.right <= bounds.right && childBounds.top >= bounds.top && childBounds.bottom <= bounds.bottom
            })
          }), true)
        }
        assert.equal(await page.locator('.auth-image').evaluate(element => element.complete && element.naturalWidth > 0), true)
        await page.screenshot({ path: new URL(`role-selection-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    const selected = page.getByRole('radio', { name: role === 'TEACHER' ? 'Учител / асистент' : 'Ученик / студент', exact: true })
    await selected.check()
    if (retry) {
      await next.click()
      await page.getByRole('alert').getByText('Временно недостъпен сървър.', { exact: true }).waitFor()
      assert.equal(await selected.isChecked(), true)
      saveGate = new Promise(resolve => { releaseSave = resolve })
      await next.click()
      await page.getByRole('button', { name: 'Запазване...', exact: true }).waitFor()
      assert.equal(await selected.isDisabled(), true)
      assert.equal(selections.length, 2)
      releaseSave()
    } else await next.click()
    const workspace = page.getByRole('button', { name: role === 'TEACHER' ? 'Тестове' : 'Моите тестове', exact: true })
    await workspace.waitFor()
    assert.equal(await heading.count(), 0)
    assert.deepEqual(selections.at(-1), { role })
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('quicktest.auth')).user.roleSelectionRequired === false)
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('quicktest.auth')).user.role), role)
    const selectionCount = selections.length
    await page.reload()
    await workspace.waitFor()
    assert.equal(await heading.count(), 0)
    await page.getByRole('button', { name: 'Изход', exact: true }).click()
    await page.getByLabel('Имейл', { exact: true }).fill(auth.user.email)
    await page.getByLabel('Парола', { exact: true }).fill('password123')
    await page.getByRole('button', { name: 'Влез', exact: true }).click()
    await workspace.waitFor()
    assert.equal(await heading.count(), 0)
    assert.equal(selections.length, selectionCount)
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('Passed: password and Google first registration, both roles, explicit choice, no workspace before selection, reload recovery, failure/retry, pending controls, saved role, returning login without another prompt, desktop/mobile and both themes. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('role-selection-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  releaseSave?.()
  await browser.close()
}
