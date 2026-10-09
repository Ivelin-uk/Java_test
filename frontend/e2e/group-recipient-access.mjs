import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'group-access-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const member = (student_id, name) => ({ student_id, name, email: `student-${student_id}@example.test` })
const members = [member(401, 'Иван Петров'), member(402, 'Мария Николова'), member(403, 'Георги Иванов')]
const outside = member(404, 'Ученик извън групата')
const assignment = { id: 601, teacher_id: auth.user.id, title: 'Групов тест', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), recipients: 2, recipient_groups: [{ id: 301, name: '12A' }], individual_recipients: [], max_attempts: 1 }
const row = (member, status, attempt_id) => ({ ...member, canceled: false, attempt_id, attempt_number: attempt_id ? 1 : null, status, max_attempts: 1, fullscreen_exempt: false, time_multiplier: 1, accommodation_reason: null })
const recipients = [row(members[0], 'in_progress', 701), row(members[1], 'finalized', 702)]
const mutations = [], errors = []
let failRemoval = true, releaseRemoval
const removalGate = new Promise(resolve => { releaseRemoval = resolve })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => { errors.push('Unexpected native browser dialog'); void dialog.dismiss() })
  await page.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      const data = { '/api/auth/me': auth.user, '/api/v1/assignments': [assignment], '/api/v1/tests': [], '/api/v1/groups': [], '/api/v1/grading': [],
        '/api/v1/members': [...members, outside].map(member => ({ user_id: member.student_id, name: member.name, email: member.email, roles_json: '["STUDENT"]', status: 'active' })),
        [`/api/v1/assignments/${assignment.id}/monitoring`]: recipients,
        [`/api/v1/assignments/${assignment.id}/members`]: members,
        [`/api/v1/assignments/${assignment.id}/teachers`]: [],
      }
      if (Object.hasOwn(data, path)) return respond(data[path])
    }
    if (method === 'DELETE' && path.startsWith(`/api/v1/assignments/${assignment.id}/recipients/`)) {
      mutations.push({ method, path })
      if (failRemoval) { failRemoval = false; return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'Временно недостъпен сървър.' }) }) }
      await removalGate
      const recipient = recipients.find(row => row.student_id === Number(path.split('/').at(-1)))
      recipient.canceled = true
      if (recipient.status === 'in_progress') recipient.status = 'voided'
      assignment.recipients = recipients.filter(row => !row.canceled).length
      return route.fulfill({ status: 204 })
    }
    if (method === 'POST' && path === `/api/v1/assignments/${assignment.id}/recipients`) {
      const body = request.postDataJSON()
      mutations.push({ method, path, body })
      assert(members.some(member => member.student_id === body.userId))
      const existing = recipients.find(row => row.student_id === body.userId)
      if (existing) { existing.canceled = false; existing.max_attempts = Math.max(existing.max_attempts, 2) }
      else recipients.push(row(members.find(member => member.student_id === body.userId), null, null))
      assignment.recipients = recipients.filter(row => !row.canceled).length
      return route.fulfill({ status: 204 })
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return route.fulfill({ status: 404 })
  })
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Възлагания', exact: true }).click()
  const assignments = page.getByRole('table', { name: 'Възлагания', exact: true })
  await assignments.getByRole('button', { name: 'Наблюдение', exact: true }).click()
  const table = page.getByRole('table', { name: 'Получатели на възлагането', exact: true })
  const studentRow = member => table.locator('tbody tr').filter({ hasText: member.email })
  await studentRow(members[2]).getByText('Не е възложен', { exact: true }).waitFor()
  assert.equal(await page.getByText(outside.name, { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Добави получател', exact: true }).count(), 0)
  const search = page.getByRole('searchbox', { name: 'Търси член на групата', exact: true })
  await search.fill(`  ${members[1].email.toUpperCase()}  `)
  assert.equal(await table.locator('tbody tr').count(), 1)
  await search.fill(outside.name); await page.getByText('Няма намерени резултати.', { exact: true }).waitFor()
  await search.fill('')
  const remove = page.getByRole('button', { name: `Премахни възлагането за ${members[0].name}`, exact: true })
  await remove.click()
  const removal = page.getByRole('dialog', { name: 'Премахване на възлагане за ученик', exact: true })
  assert.equal(await removal.evaluate(element => element.matches(':modal')), true)
  assert.equal(await removal.getByRole('button', { name: 'Отказ', exact: true }).evaluate(element => element === document.activeElement), true)
  await page.keyboard.press('Escape'); await removal.waitFor({ state: 'detached' })
  assert.equal(mutations.length, 0)
  assert.equal(await remove.evaluate(element => element === document.activeElement), true)
  await remove.click(); await removal.getByRole('button', { name: 'Отказ', exact: true }).click()
  assert.equal(mutations.length, 0)
  await remove.click(); await removal.getByRole('button', { name: 'Премахни възлагането', exact: true }).click()
  await removal.getByRole('alert').getByText('Временно недостъпен сървър.', { exact: true }).waitFor()
  assert.equal(recipients[0].canceled, false)
  await removal.getByRole('button', { name: 'Премахни възлагането', exact: true }).click()
  await removal.getByRole('button', { name: 'Изчакване...', exact: true }).waitFor()
  await removal.getByRole('button', { name: 'Изчакване...', exact: true }).evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  assert.equal(mutations.length, 2)
  releaseRemoval(); await removal.waitFor({ state: 'detached' })
  await studentRow(members[0]).getByText('Премахнат', { exact: true }).waitFor()
  await studentRow(members[0]).getByText('Анулиран', { exact: true }).waitFor()
  await assignments.locator('tbody td').nth(4).getByText('1', { exact: true }).waitFor()
  await page.getByRole('button', { name: `Премахни възлагането за ${members[1].name}`, exact: true }).click()
  await removal.getByRole('button', { name: 'Премахни възлагането', exact: true }).click(); await removal.waitFor({ state: 'detached' })
  await assignments.locator('tbody td').nth(4).getByText('0', { exact: true }).waitFor()
  await assignments.getByText('Група: 12A', { exact: true }).waitFor()
  await studentRow(members[1]).getByText('Публикуван резултат', { exact: true }).waitFor()
  const reassign = page.getByRole('dialog', { name: 'Повторно възлагане на ученик', exact: true })
  await page.getByRole('button', { name: `Възложи отново на ${members[0].name}`, exact: true }).click()
  await reassign.getByRole('button', { name: 'Отказ', exact: true }).click()
  assert.equal(mutations.length, 3)
  await page.getByRole('button', { name: `Възложи отново на ${members[0].name}`, exact: true }).click()
  await reassign.getByRole('button', { name: 'Възложи теста', exact: true }).click(); await reassign.waitFor({ state: 'detached' })
  await studentRow(members[0]).getByText('Възложен', { exact: true }).waitFor()
  await studentRow(members[0]).getByText('1/2', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: `Възложи отново на ${members[0].name}`, exact: true }).count(), 0)
  await page.getByRole('button', { name: `Възложи теста на ${members[2].name}`, exact: true }).click()
  await reassign.getByRole('button', { name: 'Възложи теста', exact: true }).click(); await reassign.waitFor({ state: 'detached' })
  await studentRow(members[2]).getByText('Възложен', { exact: true }).waitFor()
  await studentRow(members[2]).getByText('0/1', { exact: true }).waitFor()
  assert.equal(assignment.recipients, 2)
  assert.equal(await assignments.locator('tbody tr').count(), 1)
  assert.equal(mutations.filter(value => value.method === 'POST').length, 2)
  for (const { theme, width, height } of [{ theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 320, height: 844 }]) {
    await page.setViewportSize({ width, height })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await table.evaluate(element => element.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: new URL(`group-recipients-${theme}-${width}.png`, artifacts).pathname })
    await page.getByRole('button', { name: `Възложи отново на ${members[1].name}`, exact: true }).click()
    assert.equal(await reassign.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && element.scrollWidth <= element.clientWidth }), true)
    await page.screenshot({ path: new URL(`group-recipients-dialog-${theme}-${width}.png`, artifacts).pathname })
    await page.keyboard.press('Escape'); await reassign.waitFor({ state: 'detached' })
  }
  recipients.find(row => row.student_id === members[2].student_id).max_attempts = 3
  await page.reload(); await page.getByRole('button', { name: 'Възлагания', exact: true }).click()
  await assignments.getByRole('button', { name: 'Наблюдение', exact: true }).click()
  await studentRow(members[0]).getByText('1/2', { exact: true }).waitFor()
  await studentRow(members[2]).getByText('0/3', { exact: true }).waitFor()
  await studentRow(members[1]).getByText('Премахнат', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Passed: group-only member controls/search, outsider exclusion, removal/restore confirmation and retry, busy guard, active-attempt voiding, preserved result status, one extra attempt, later group members, active count including zero, group source preserved, no new assignment, reload persistence, desktop/mobile and both themes. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('group-recipients-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  releaseRemoval()
  await browser.close()
}
