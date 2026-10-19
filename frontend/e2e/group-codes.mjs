import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const group = { id: 201, name: 'Биология', subject: 'Човешкото тяло', description: 'Подготовка за изпит', join_code: 'ABCD2345' }
const teacher = { token: 'group-code-teacher', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true } }
const student = { token: 'group-code-student', user: { id: 102, name: 'Student', email: 'student@example.test', role: 'STUDENT', active: true } }
const artifacts = new URL('../../.artifacts/', import.meta.url), errors = []
await mkdir(artifacts, { recursive: true })
let created = false, joined = false, failRotation = true, rotations = 0, releaseRotation
const rotationGate = new Promise(resolve => { releaseRotation = resolve })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const button = (page, name) => page.getByRole('button', { name, exact: true })
async function pageFor(auth) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(value => {
    localStorage.setItem('quicktest.auth', JSON.stringify(value))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async code => { window.copiedGroupCode = code } } })
  }, auth)
  const page = await context.newPage();page.on('pageerror', error => errors.push(error.message))
  await page.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method(), teaching = auth.user.role === 'TEACHER'
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    const { join_code: _, ...studentGroup } = group
    if (method === 'GET') {
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/v1/groups') return respond(teaching ? created ? [group] : [] : joined ? [studentGroup] : [])
      if (['/api/v1/assignments', '/api/v1/grading', '/api/v1/results', '/api/v1/attempts', '/api/v1/members'].includes(path)) return respond([])
      if (path === '/api/v1/groups/201/members') return respond(joined ? [{ user_id: student.user.id, name: student.user.name, email: student.user.email, active: true }] : [])
      if (path === '/api/v1/groups/201/summary') return respond({ group: studentGroup, teachers: [{ name: teacher.user.name }], assignments: [] })
    }
    if (method === 'POST') {
      const body = request.postDataJSON()
      if (path === '/api/v1/groups' && teaching) { assert.deepEqual(body, { name: group.name, subject: group.subject, description: group.description });created = true;return respond(group) }
      if (path === '/api/v1/groups/201/code/rotate' && teaching) {
        rotations++
        if (failRotation) return respond({ detail: 'Неуспешна смяна на кода.' }, 503)
        assert.equal(body.currentCode, group.join_code)
        await rotationGate;group.join_code = 'EFGH6789';return respond({ code: group.join_code })
      }
      if (path === '/api/v1/groups/join' && !teaching) {
        if (body.code !== group.join_code) return respond({ detail: 'Невалиден код за група или групата е премахната.' }, 400)
        const alreadyMember = joined;joined = true;return respond({ id: group.id, name: group.name, alreadyMember })
      }
    }
    errors.push(`${method} ${path}`);return respond({}, 404)
  })
  await page.goto(frontend);await button(page, 'Групи').click()
  return page
}
try {
  const teacherPage = await pageFor(teacher)
  assert.equal(await teacherPage.getByLabel('Код за група', { exact: true }).count(), 0)
  await button(teacherPage, 'Създай група').click()
  const dialog = teacherPage.getByRole('dialog', { name: 'Създаване на група', exact: true })
  for (const [name, value] of [['Име', group.name], ['Дисциплина', group.subject], ['Описание', group.description]]) await dialog.getByLabel(name, { exact: true }).fill(value)
  await button(dialog, 'Създай група').click()
  const code = teacherPage.getByLabel('Код за присъединяване', { exact: true })
  await code.waitFor();assert.equal(await code.textContent(), group.join_code)
  await button(teacherPage, 'Копирай кода за групата').click()
  assert.equal(await teacherPage.evaluate(() => window.copiedGroupCode), group.join_code)
  await button(teacherPage, group.name).click()
  await teacherPage.getByRole('heading', { name: 'Код за присъединяване', exact: true }).waitFor()
  await button(teacherPage, 'Копирай кода за групата').click()
  assert.equal(await teacherPage.evaluate(() => window.copiedGroupCode), group.join_code)
  const previous = group.join_code, rotate = button(teacherPage, 'Нов код')
  await teacherPage.getByLabel('Име', { exact: true }).fill('Незаписана промяна')
  await rotate.click()
  await teacherPage.getByRole('alert').getByText('Неуспешна смяна на кода.', { exact: true }).waitFor()
  assert.equal(await code.textContent(), previous)
  failRotation = false
  const requested = teacherPage.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/groups/201/code/rotate')
  await rotate.click();await requested
  assert.equal(await rotate.isDisabled(), true)
  await rotate.evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  assert.equal(rotations, 2)
  releaseRotation()
  await teacherPage.getByText('Кодът е променен. Старият код вече не е валиден.', { exact: true }).waitFor()
  assert.equal(await code.textContent(), group.join_code)
  assert.notEqual(group.join_code, previous)
  assert.equal(await teacherPage.getByLabel('Име', { exact: true }).inputValue(), 'Незаписана промяна')
  await teacherPage.getByLabel('Име', { exact: true }).fill(group.name)
  await button(teacherPage, 'Копирай кода за групата').click()
  assert.equal(await teacherPage.evaluate(() => window.copiedGroupCode), group.join_code)
  await teacherPage.screenshot({ path: new URL('group-code-teacher.png', artifacts).pathname, fullPage: true })
  const page = await pageFor(student), input = page.getByLabel('Код за група', { exact: true }), submit = button(page, 'Присъедини се')
  assert.equal(await submit.isDisabled(), true)
  await input.fill('BADCODE1');await submit.click()
  await page.getByRole('alert').getByText('Невалиден код за група или групата е премахната.', { exact: true }).waitFor()
  assert.equal(await input.inputValue(), 'BADCODE1')
  await input.fill(previous);await submit.click()
  await page.getByRole('alert').getByText('Невалиден код за група или групата е премахната.', { exact: true }).waitFor()
  await input.fill(group.join_code.toLowerCase());assert.equal(await input.inputValue(), group.join_code)
  await submit.click();await button(page, group.name).waitFor()
  await input.fill(group.join_code);await submit.click()
  await page.getByText(`Вече си в групата „${group.name}“.`, { exact: true }).waitFor()
  assert.equal(await page.getByRole('table', { name: 'Групи', exact: true }).locator('tbody tr').count(), 1)
  assert.equal(await input.inputValue(), '')
  assert.equal(await page.getByLabel('Код за присъединяване', { exact: true }).count(), 0)
  assert.equal(await button(page, 'Създай група').count(), 0)
  assert.equal(await button(page, 'Нов код').count(), 0)
  for (const [theme, width] of [['light', 1440], ['dark', 390], ['light', 320]]) {
    await page.setViewportSize({ width, height: 900 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await button(page, theme === 'dark' ? 'Тъмна тема' : 'Светла тема').click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: new URL(`group-code-student-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  await page.reload();await button(page, 'Групи').click();await button(page, group.name).click()
  await page.getByRole('heading', { name: group.name, exact: true }).waitFor()
  assert.equal(await button(page, 'Запази').count(), 0)
  await button(teacherPage, 'Към групите').click();await button(teacherPage, group.name).click()
  await teacherPage.getByRole('cell', { name: student.user.email, exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Passed: group code generation and copy, teacher code rotation with failure/retry and duplicate guard, unsaved fields preserved, copying the replacement code, old-code rejection, student code entry, uppercase input, idempotent membership, persistence after refresh, teacher participant list, student read-only access, responsive light/dark layouts. API fixtures only.')
} finally { releaseRotation();await browser.close() }
