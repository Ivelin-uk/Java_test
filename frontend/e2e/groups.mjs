import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const stamp = Date.now()
async function request(path, auth, method = 'GET', data) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
  const text = await response.text()
  return { status: response.status, data: text ? JSON.parse(text) : null }
}
async function account(kind, role) {
  const result = await request('/api/auth/register', null, 'POST', { name: `Group ${kind}`, email: `group-${kind}-${stamp}@example.test`, password: 'test-password-123', role })
  assert.equal(result.status, 200)
  return result.data
}
const teacher = await account('teacher', 'TEACHER')
const outsider = await account('outsider', 'TEACHER')
const student = await account('student', 'STUDENT')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const errors = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), teacher)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Групи', exact: true }).click()
  const original = `Group ${stamp}`, renamed = `Updated ${stamp}`
  await page.getByLabel('Име', { exact: true }).fill(original)
  await page.getByRole('button', { name: 'Създай група', exact: true }).click()
  await page.getByRole('button', { name: original, exact: true }).waitFor()
  const group = (await request('/api/v1/groups', teacher)).data.find(g => g.name === original)
  assert.equal((await request(`/api/v1/groups/${group.id}/members`, teacher, 'POST', { userId: student.user.id })).status, 200)
  assert.equal((await request(`/api/v1/groups/${group.id}`, outsider, 'DELETE')).status, 403)
  assert.equal((await request(`/api/v1/groups/${group.id}`, student, 'DELETE')).status, 403)
  const row = () => page.getByRole('row').filter({ has: page.getByRole('button', { name: original, exact: true }) })
  await row().getByRole('button', { name: 'Редактирай групата', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Редактиране на група' })
  await dialog.getByLabel('Име', { exact: true }).fill(renamed)
  await dialog.getByLabel('Дисциплина', { exact: true }).fill('Java')
  await dialog.getByLabel('Учебна година', { exact: true }).fill('2027/2028')
  await dialog.getByLabel('Клас / курс', { exact: true }).fill('12')
  await dialog.getByLabel('Описание', { exact: true }).fill('Updated description')
  await dialog.getByRole('button', { name: 'Запази', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  const updated = () => page.getByRole('row').filter({ has: page.getByRole('button', { name: renamed, exact: true }) })
  await updated().getByText('Java', { exact: true }).waitFor()
  await updated().getByRole('button', { name: 'Изтрий групата', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Изтриване на група' })
  await dialog.waitFor()
  assert.equal((await request('/api/v1/groups', teacher)).data.some(g => g.id === group.id), true)
  await page.screenshot({ path: new URL('group-delete-desktop.png', artifacts).pathname })
  await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
  await updated().getByRole('button', { name: 'Изтрий групата', exact: true }).click()
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  await page.setViewportSize({ width: 390, height: 844 })
  await updated().getByRole('button', { name: 'Редактирай групата', exact: true }).click()
  await page.getByRole('dialog', { name: 'Редактиране на група' }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: new URL('group-edit-mobile.png', artifacts).pathname })
  await page.getByRole('dialog').getByRole('button', { name: 'Отказ', exact: true }).click()
  await updated().getByRole('button', { name: 'Изтрий групата', exact: true }).click()
  await dialog.getByRole('button', { name: 'Изтрий', exact: true }).click()
  await page.getByText('Групата е изтрита.', { exact: true }).waitFor()
  assert.equal((await request('/api/v1/groups', teacher)).data.some(g => g.id === group.id), false)
  assert.equal((await request('/api/v1/groups', student)).data.some(g => g.id === group.id), false)
  assert.equal((await request(`/api/v1/groups/${group.id}/members`, teacher)).status, 404)
  await page.reload()
  await page.getByRole('button', { name: 'Групи', exact: true }).click()
  await page.getByText('Няма записи.', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Passed: group editing, deletion confirmation, cancel/Escape, teacher authorization, student visibility, persistence, desktop/mobile modals.')
} finally {
  await browser.close()
}
