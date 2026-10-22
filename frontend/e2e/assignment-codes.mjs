import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'assignment-code-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const assignments = [
  { id: 301, title: 'Обектно-ориентирано програмиране с Java', access_code: 'JAVA2345' },
  { id: 302, title: 'Математика: уравнения и неравенства', access_code: null },
].map(item => ({ ...item, teacher_id: auth.user.id, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), max_attempts: 1, recipients: 2, recipient_groups: [{ id: 401, name: '12А' }], individual_recipients: [] }))
const mutations = [], errors = []
let failNext = true, releaseRotation
const rotationGate = new Promise(resolve => { releaseRotation = resolve })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: frontend })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      const data = { '/api/auth/me': auth.user, '/api/v1/assignments': assignments, '/api/v1/tests': [], '/api/v1/groups': [], '/api/v1/grading': [] }
      if (Object.hasOwn(data, path)) return respond(data[path])
    }
    const match = path.match(/^\/api\/v1\/assignments\/(\d+)\/code(?:\/(rotate|send))?$/)
    if (match) {
      const assignment = assignments.find(item => item.id === Number(match[1]))
      mutations.push({ method, path, body: request.postDataJSON() })
      if (method === 'POST' && match[2] === 'rotate') {
        if (failNext) { failNext = false; return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'Временно недостъпен сървър.' }) }) }
        await rotationGate
        assignment.access_code = assignment.access_code ? 'NEXT2345' : 'NEW23456'
        return respond({ code: assignment.access_code })
      }
      if (method === 'POST' && match[2] === 'send') return respond({ queued: 2 })
      if (method === 'DELETE' && !match[2]) { assignment.access_code = null; return route.fulfill({ status: 204 }) }
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return route.fulfill({ status: 404 })
  })
  async function openAssignments() {
    await page.goto(frontend)
    await page.getByRole('button', { name: 'Възлагания', exact: true }).click()
    await page.getByRole('table', { name: 'Възлагания', exact: true }).locator('tbody tr').nth(1).waitFor()
  }
  await openAssignments()
  const table = page.getByRole('table', { name: 'Възлагания', exact: true })
  const first = table.locator('tbody tr').nth(0), second = table.locator('tbody tr').nth(1)
  await table.getByRole('columnheader', { name: 'Код за достъп', exact: true }).waitFor()
  await first.getByText('Възлагане №301', { exact: true }).waitFor()
  await second.getByText('Възлагане №302', { exact: true }).waitFor()
  assert.equal(await first.locator('output').innerText(), 'JAVA2345')
  assert.equal(await second.locator('output').innerText(), '-')
  assert.equal(await second.getByRole('button', { name: 'Копирай кода', exact: true }).isDisabled(), true)
  assert.equal(await second.getByRole('button', { name: 'Изпрати кода по имейл', exact: true }).isDisabled(), true)
  await first.getByRole('button', { name: 'Копирай кода', exact: true }).click()
  await page.getByText('Кодът е копиран.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'JAVA2345')
  const generate = second.getByRole('button', { name: 'Генерирай код', exact: true })
  await generate.click()
  await page.getByRole('alert').getByText('Временно недостъпен сървър.', { exact: true }).waitFor()
  assert.equal(await first.locator('output').innerText(), 'JAVA2345')
  assert.equal(await second.locator('output').innerText(), '-')
  await generate.click()
  await page.getByText('Изчакване...', { exact: true }).waitFor()
  for (const row of [first, second]) {
    assert.equal(await row.locator('.ws-assignment-code button:enabled').count(), 0)
  }
  releaseRotation()
  await second.getByText('NEW23456', { exact: true }).waitFor()
  await page.getByText('Кодът е генериран.', { exact: true }).waitFor()
  assert.equal(await first.locator('output').innerText(), 'JAVA2345')
  await second.getByRole('button', { name: 'Изпрати кода по имейл', exact: true }).click()
  await page.getByText('Известията са добавени в опашката.', { exact: true }).waitFor()
  assert.deepEqual(mutations.at(-1), { method: 'POST', path: '/api/v1/assignments/302/code/send', body: { code: 'NEW23456', channel: 'email' } })
  await openAssignments()
  assert.equal(await second.locator('output').innerText(), 'NEW23456')
  await second.getByRole('button', { name: 'Генерирай нов код', exact: true }).click()
  await second.getByText('NEXT2345', { exact: true }).waitFor()
  await page.getByText('Кодът е генериран.', { exact: true }).waitFor()
  assert.equal(await first.locator('output').innerText(), 'JAVA2345')
  for (const { theme, width, height } of [{ theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 320, height: 844 }]) {
    await page.setViewportSize({ width, height })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    await second.locator('.ws-assignment-code').evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await second.locator('.ws-assignment-code').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      if (bounds.left < 0 || bounds.right > innerWidth || bounds.top < 0 || bounds.bottom > innerHeight) return false
      return [...element.children].every(child => {
        const childBounds = child.getBoundingClientRect()
        return childBounds.left >= bounds.left && childBounds.right <= bounds.right && child.scrollWidth <= child.clientWidth
      })
    }), true)
    await page.screenshot({ path: new URL(`assignment-codes-${theme}-${width}.png`, artifacts).pathname })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await second.getByRole('button', { name: 'Отмени кода', exact: true }).click()
  const revoke = page.getByRole('dialog', { name: 'Отмяна на код за достъп', exact: true })
  await revoke.getByRole('button', { name: 'Отказ', exact: true }).click()
  assert.equal(await second.locator('output').innerText(), 'NEXT2345')
  await second.getByRole('button', { name: 'Отмени кода', exact: true }).click()
  await revoke.getByRole('button', { name: 'Отмени кода', exact: true }).click()
  await revoke.waitFor({ state: 'detached' })
  assert.equal(await second.locator('output').innerText(), '-')
  await openAssignments()
  assert.equal(await second.locator('output').innerText(), '-')
  assert.equal(await first.locator('output').innerText(), 'JAVA2345')
  assert.deepEqual(errors, [])
  console.log('Passed: per-row access codes, legacy generation, failure/retry, pending controls, rotation, clipboard, email, reload persistence, revoke/cancel, desktop/mobile and both themes. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('assignment-codes-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  releaseRotation()
  await browser.close()
}
