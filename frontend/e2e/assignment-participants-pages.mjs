import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'participants-page-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false, roleSelectionRequired: false } }
const assignment = { id: 601, teacher_id: 101, title: 'Основи на Java - Средно ниво', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), recipients: 1, recipient_groups: [{ id: 301, name: 'ТЕСТ1' }], individual_recipients: [], max_attempts: 1, access_code: 'ABCD2345' }
const members = [{ student_id: 401, name: 'Иван Петров', email: 'ivan@example.test' }, { student_id: 402, name: 'Мария Николова', email: 'maria@example.test' }]
const additionalMember = { student_id: 403, name: 'Георги Иванов', email: 'georgi@example.test' }
const directory = [...members, additionalMember].map(member => ({ user_id: member.student_id, name: member.name, email: member.email, roles_json: '["STUDENT"]', status: 'active' }))
const recipients = [{ ...members[0], canceled: false, attempt_id: null, attempt_number: null, status: null, max_attempts: 1, fullscreen_exempt: false, time_multiplier: 1, accommodation_reason: null }]
const errors = [], requests = []
let failRefresh = false, monitoringUnavailable = false, failMemberAddition = true
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  async function openContext(signedIn = true) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    if (signedIn) await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
    await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedAssignmentCode = value } } }))
    await context.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin }, body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      requests.push({ method, path })
      if (method === 'GET') {
        if (path === '/api/v1/assignments/601/monitoring' && (failRefresh || monitoringUnavailable)) { failRefresh = false; return respond({ detail: 'Временно недостъпни участници.' }, 503) }
        const data = { '/api/auth/me': auth.user, '/api/v1/assignments': [assignment], '/api/v1/tests': [], '/api/v1/groups': [], '/api/v1/grading': [], '/api/v1/members': directory, '/api/v1/groups/301/members': members.map(member => ({ ...member, user_id: member.student_id, active: true })), '/api/v1/assignments/601/monitoring': recipients, '/api/v1/assignments/601/members': members, '/api/v1/assignments/601/teachers': [], '/api/auth/google/config': { enabled: false, redirect: `${base}/api/auth/google/redirect` } }
        if (Object.hasOwn(data, path)) return respond(data[path])
      }
      if (method === 'POST' && path === '/api/auth/login') return respond(auth)
      if (method === 'POST' && path === '/api/v1/groups/301/members') {
        assert.deepEqual(request.postDataJSON(), { userId: additionalMember.student_id })
        if (failMemberAddition) { failMemberAddition = false; return respond({ detail: 'Временно не може да се добави ученикът.' }, 503) }
        members.push(additionalMember)
        recipients.push({ ...recipients[0], ...additionalMember, attempt_id: null, attempt_number: null, status: null })
        assignment.recipients = 2
        return respond({})
      }
      if (method === 'DELETE' && path === '/api/v1/groups/301/members/403') {
        members.splice(members.findIndex(member => member.student_id === 403), 1)
        recipients.find(member => member.student_id === 403).canceled = true
        assignment.recipients = 1
        return respond({})
      }
      errors.push(`Unexpected API: ${method} ${path}`)
      return respond({}, 404)
    })
    const next = await context.newPage()
    next.on('pageerror', error => errors.push(error.message))
    return { context, page: next }
  }
  const first = await openContext(); page = first.page
  const assignments = page.getByRole('table', { name: 'Възлагания', exact: true })
  const participants = page.getByRole('table', { name: 'Получатели на възлагането', exact: true })
  const form = page.getByRole('form', { name: 'Възлагане на тест', exact: true })
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Възлагания', exact: true }).click()
  await form.waitFor(); await assignments.waitFor()
  assert.equal(await participants.count(), 0)
  await assignments.getByRole('button', { name: 'Участници и наблюдение', exact: true }).click()
  await participants.getByText(members[1].email, { exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/assignments/601/participants')
  assert.equal(await assignments.count(), 0)
  assert.equal(await form.count(), 0)
  await page.getByRole('heading', { name: assignment.title, exact: true }).waitFor()
  await page.getByLabel('Брой получатели', { exact: true }).getByText('1', { exact: true }).waitFor()
  const studentRow = participants.locator('tbody tr').filter({ hasText: members[0].email })
  const search = page.getByRole('searchbox', { name: 'Търси член на групата', exact: true })
  await search.fill(members[0].email)
  let navigations = 0
  const navigation = frame => { if (frame === page.mainFrame()) navigations++ }
  page.on('framenavigated', navigation)
  for (const [status, text] of [['in_progress', 'В процес'], ['pending_review', 'Чака проверка'], ['finalized', 'Публикуван резултат']]) {
    Object.assign(recipients[0], { attempt_id: 701, attempt_number: 1, status })
    await studentRow.getByText(text, { exact: true }).waitFor({ timeout: 6000 })
    assert.equal(await search.inputValue(), members[0].email)
  }
  assert.equal(navigations, 0)
  assert.equal(new URL(page.url()).pathname, '/assignments/601/participants')
  monitoringUnavailable = true
  await page.getByRole('alert').getByText('Временно недостъпни участници.', { exact: true }).waitFor({ timeout: 6000 })
  await studentRow.getByText('Публикуван резултат', { exact: true }).waitFor()
  monitoringUnavailable = false
  Object.assign(recipients[0], { attempt_id: null, attempt_number: null, status: null })
  await studentRow.getByText('Не е започнал', { exact: true }).waitFor({ timeout: 6000 })
  await page.getByRole('alert').waitFor({ state: 'detached' })
  assert.equal(navigations, 0)
  page.off('framenavigated', navigation)
  await search.fill('')
  assert.equal(await page.getByRole('combobox', { name: 'Сподели с учител', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Разреши достъп', exact: true }).count(), 0)
  await page.getByLabel('Код за достъп', { exact: true }).getByText(assignment.access_code, { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Копирай кода за достъп', exact: true }).click()
  assert.equal(await page.evaluate(() => window.copiedAssignmentCode), assignment.access_code)
  const manageGroup = page.getByRole('button', { name: 'Участници в ТЕСТ1', exact: true })
  const groupDialog = page.getByRole('dialog', { name: 'Участници в групата', exact: true })
  await manageGroup.click()
  await groupDialog.getByRole('combobox', { name: 'Търси ученици', exact: true }).fill(additionalMember.email)
  await groupDialog.getByRole('listbox', { name: 'Ученици', exact: true }).getByRole('option').click()
  await groupDialog.getByRole('button', { name: 'Добави', exact: true }).click()
  await groupDialog.getByRole('alert').getByText('Временно не може да се добави ученикът.', { exact: true }).waitFor()
  assert.equal(members.length, 2)
  await groupDialog.getByRole('button', { name: 'Добави', exact: true }).click()
  await groupDialog.getByRole('cell', { name: additionalMember.email, exact: true }).waitFor()
  await groupDialog.getByRole('button', { name: 'Затвори', exact: true }).click()
  await participants.getByText(additionalMember.email, { exact: true }).waitFor()
  await page.getByLabel('Брой получатели', { exact: true }).getByText('2', { exact: true }).waitFor()
  await manageGroup.click()
  const addedRow = groupDialog.getByRole('row').filter({ hasText: additionalMember.email })
  await addedRow.getByRole('button', { name: 'Премахни от групата', exact: true }).click()
  const removeMember = page.getByRole('dialog', { name: 'Премахване на ученик от група', exact: true })
  await removeMember.getByRole('button', { name: 'Отказ', exact: true }).click()
  assert.equal(members.length, 3)
  await addedRow.getByRole('button', { name: 'Премахни от групата', exact: true }).click()
  await removeMember.getByRole('button', { name: 'Премахни', exact: true }).click()
  await removeMember.waitFor({ state: 'detached' })
  assert.equal(await groupDialog.getByRole('cell', { name: additionalMember.email, exact: true }).count(), 0)
  await groupDialog.getByRole('button', { name: 'Затвори', exact: true }).click()
  await participants.getByRole('row').filter({ hasText: additionalMember.email }).getByText('Премахнат', { exact: true }).waitFor()
  await page.getByLabel('Брой получатели', { exact: true }).getByText('1', { exact: true }).waitFor()
  recipients.pop()
  await page.getByRole('button', { name: 'Към възлаганията', exact: true }).click()
  await assignments.waitFor(); await form.waitFor()
  assert.equal(new URL(page.url()).pathname, '/assignments')
  await assignments.getByRole('button', { name: `Участници: ${assignment.title}`, exact: true }).click()
  await participants.waitFor()
  await page.goBack(); await assignments.waitFor()
  await page.goForward(); await participants.waitFor()
  await page.reload(); await participants.getByText(members[0].email, { exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/assignments/601/participants')
  assert.equal(await form.count(), 0)
  await page.getByRole('button', { name: 'Табло', exact: true }).click()
  assert.equal(new URL(page.url()).pathname, '/')
  await page.goBack(); await participants.waitFor()
  failRefresh = true
  await page.getByRole('button', { name: 'Обнови', exact: true }).click()
  await page.getByRole('alert').getByText('Временно недостъпни участници.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Обнови', exact: true }).click()
  await page.getByRole('alert').waitFor({ state: 'detached' })
  for (const { theme, width, height } of [{ theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 320, height: 844 }]) {
    await page.setViewportSize({ width, height })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: new URL(`assignment-participants-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
    await manageGroup.click()
    await groupDialog.getByText(members[0].email, { exact: true }).waitFor()
    assert.equal(await groupDialog.evaluate(element => element.scrollWidth <= element.clientWidth), true)
    await groupDialog.getByRole('button', { name: 'Затвори прозореца', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: new URL(`assignment-group-members-${theme}-${width}.png`, artifacts).pathname })
    await groupDialog.getByRole('button', { name: 'Затвори прозореца', exact: true }).click()
    await groupDialog.waitFor({ state: 'detached' })
  }
  const beforeMissing = requests.length
  await page.goto(`${frontend}/assignments/999/participants`)
  await page.getByRole('alert').getByText('Възлагането не е намерено или нямате достъп до него.', { exact: true }).waitFor()
  assert.equal(await participants.count(), 0)
  assert.equal(requests.slice(beforeMissing).some(request => request.path.includes('/assignments/999/')), false)
  await page.getByRole('button', { name: 'Към възлаганията', exact: true }).click(); await assignments.waitFor()
  const direct = await openContext(); page = direct.page
  const beforeDirect = requests.length
  await page.goto(`${frontend}/assignments/601/participants`)
  await page.getByRole('table', { name: 'Получатели на възлагането', exact: true }).waitFor()
  assert.equal(requests.slice(beforeDirect).some(request => ['/api/v1/tests', '/api/v1/groups'].includes(request.path)), false)
  const loggedOut = await openContext(false); page = loggedOut.page
  await page.goto(`${frontend}/assignments/601/participants`)
  await page.getByRole('button', { name: 'Влез', exact: true }).waitFor()
  assert.equal(await page.getByRole('table', { name: 'Получатели на възлагането', exact: true }).count(), 0)
  await page.getByLabel('Имейл', { exact: true }).fill(auth.user.email)
  await page.getByLabel('Парола', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Влез', exact: true }).click()
  await page.getByRole('table', { name: 'Получатели на възлагането', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/assignments/601/participants')
  assert.deepEqual(errors, [])
  console.log('Passed: access-code display/copy, teacher sharing removed, group-member add/error retry/removal confirmation with synchronized recipients, automatic status transitions, search preserved, polling failure/recovery, dedicated participants page, navigation/direct links/login return, manual refresh, missing/private assignments, desktop/mobile and both themes. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('assignment-participants-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  await browser.close()
}
