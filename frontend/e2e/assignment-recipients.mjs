import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'assignment-recipients-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const test = { id: 201, title: 'Java recipient test', status: 'published', owner_id: auth.user.id, shared: false, question_count: 1, total_time_seconds: 60 }
const groups = [{ id: 301, name: '12A - Софтуерно инженерство', subject: 'Програмиране' }, { id: 302, name: '11Б - Математика', subject: 'Алгебра' }, ...Array.from({ length: 14 }, (_, index) => ({ id: 303 + index, name: `Допълнителна група ${index + 1}`, subject: 'Учебна дисциплина' }))]
const mutations = [], errors = [], assignments = []
let failNext = true, releasePost
const postGate = new Promise(resolve => { releasePost = resolve })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      const data = { '/api/auth/me': auth.user, '/api/v1/tests': [test], [`/api/v1/tests/${test.id}/versions`]: [{ id: 202, version_number: 1 }], '/api/v1/groups': groups, '/api/v1/members': [], '/api/v1/assignments': assignments, '/api/v1/grading': [] }
      if (Object.hasOwn(data, path)) return respond(data[path])
    }
    if (method === 'POST' && path === '/api/v1/assignments') {
      const body = request.postDataJSON()
      mutations.push(body)
      assert.equal(Object.hasOwn(body, 'studentIds'), false)
      assert(body.groupIds.length > 0)
      if (failNext) { failNext = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Temporary assignment failure.' }) }) }
      await postGate
      const id = 601 + assignments.length
      assignments.push({ id, teacher_id: auth.user.id, title: test.title, starts_at: body.startsAt, ends_at: body.endsAt, recipients: 2, max_attempts: body.maxAttempts,
        recipient_groups: groups.filter(group => body.groupIds.includes(group.id)).map(({ id, name }) => ({ id, name })), individual_recipients: [],
      })
      return respond({ id, code: 'TEST-CODE' })
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return route.fulfill({ status: 404 })
  })
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Възлагания', exact: true }).click()
  const form = page.getByRole('form', { name: 'Възлагане на тест', exact: true })
  const picker = form.getByRole('group', { name: 'Групи', exact: true })
  const search = picker.getByRole('searchbox', { name: 'Търси групи', exact: true })
  const assign = form.getByRole('button', { name: 'Възложи', exact: true })
  const table = page.getByRole('table', { name: 'Възлагания', exact: true }), rows = table.locator('tbody tr')
  const start = form.getByLabel('Начало', { exact: true }), end = form.getByLabel('Краен срок', { exact: true }), attempts = form.getByLabel('Опити', { exact: true })
  const validStart = await start.inputValue(), validEnd = await end.inputValue()
  assert.equal(await form.getByRole('group', { name: 'Индивидуални получатели', exact: true }).count(), 0)
  await picker.getByRole('checkbox', { name: groups[0].name, exact: true }).check()
  await assign.click()
  await page.getByRole('alert').getByText('Изберете тест за възлагане.', { exact: true }).waitFor()
  const testPicker = form.getByRole('combobox', { name: 'Тест', exact: true })
  assert.equal(await testPicker.getAttribute('aria-invalid'), 'true')
  assert.equal(await testPicker.evaluate(element => element === document.activeElement), true)
  assert.equal(mutations.length, 0)
  await testPicker.fill(test.title)
  await page.getByRole('listbox', { name: 'Тестове за възлагане' }).getByRole('option').click()
  await page.locator('.ws-feedback .spin').waitFor({ state: 'detached' })
  await picker.getByRole('checkbox', { name: groups[0].name, exact: true }).uncheck()
  await assign.click()
  await page.getByRole('alert').getByText('Изберете поне една група.', { exact: true }).waitFor()
  await search.fill('  ПРОГРАМИРАНЕ  ')
  assert.equal(await picker.getByRole('checkbox').count(), 1)
  await picker.getByRole('checkbox', { name: groups[0].name, exact: true }).check()
  await search.fill('Missing group')
  await picker.getByText('Няма намерени резултати.', { exact: true }).waitFor()
  await picker.getByRole('status').getByText('Избрани: 1', { exact: true }).waitFor()
  await search.press('Enter')
  assert.equal(mutations.length, 0)
  for (const [field, value, message] of [[start, '', 'Попълнете началната дата и час.'], [end, '', 'Попълнете крайната дата и час.'], [end, validStart, 'Крайният срок трябва да е след началото.'], [attempts, '0', 'Броят опити трябва да е цяло число от 1 до 20.'], [attempts, '21', 'Броят опити трябва да е цяло число от 1 до 20.'], [attempts, '1.5', 'Броят опити трябва да е цяло число от 1 до 20.']]) {
    await field.fill(value); await assign.click()
    await page.getByRole('alert').getByText(message, { exact: true }).waitFor()
    assert.equal(mutations.length, 0)
    await start.fill(validStart); await end.fill(validEnd); await attempts.fill('1')
  }
  await start.fill('2020-01-01T08:00'); await end.fill('2020-01-01T09:00'); await assign.click()
  await page.getByRole('alert').getByText('Крайният срок трябва да е в бъдещето.', { exact: true }).waitFor()
  await start.fill(validStart); await end.fill(validEnd)
  assert.equal(await picker.locator('input:required').count(), 0)
  await assign.click()
  await page.getByRole('alert').getByText('Temporary assignment failure.', { exact: true }).waitFor()
  assert.deepEqual(mutations[0].groupIds, [groups[0].id])
  assert.equal(await search.inputValue(), 'Missing group')
  await assign.click()
  await page.getByText('Изчакване...', { exact: true }).waitFor()
  for (const control of [search, start, end, attempts, assign]) assert.equal(await control.isDisabled(), true)
  await form.evaluate(element => element.requestSubmit())
  assert.equal(mutations.length, 2)
  assert.deepEqual(mutations[1], mutations[0])
  releasePost()
  await page.getByText('Възлагането е създадено.', { exact: true }).waitFor()
  await rows.first().getByText(`Група: ${groups[0].name}`, { exact: true }).waitFor()
  await search.fill('АЛГЕБРА'); await picker.getByRole('checkbox', { name: groups[1].name, exact: true }).check()
  await assign.click()
  await rows.nth(1).getByText(`Групи: ${groups[0].name}, ${groups[1].name}`, { exact: true }).waitFor()
  assert.deepEqual(mutations.at(-1).groupIds, [groups[0].id, groups[1].id])
  await picker.getByRole('button', { name: 'Изчисти търсенето: Групи', exact: true }).click()
  assert.equal(await search.evaluate(element => element === document.activeElement), true)
  for (const group of groups.slice(0, 2)) assert.equal(await picker.getByRole('checkbox', { name: group.name, exact: true }).isChecked(), true)
  for (const { theme, width, height } of [{ theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 320, height: 844 }]) {
    await page.setViewportSize({ width, height })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await form.evaluate(element => [...element.querySelectorAll('input,button')].every(control => { const bounds = control.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth })), true)
    assert.equal(await picker.locator('.ws-recipient-options').evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight > element.clientHeight), true)
    await page.screenshot({ path: new URL(`assignment-recipients-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
    await table.evaluate(element => element.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: new URL(`assignment-audience-${theme}-${width}.png`, artifacts).pathname })
  }
  assert.equal(mutations.length, 3)
  await page.reload(); await page.getByRole('button', { name: 'Възлагания', exact: true }).click()
  await rows.nth(1).getByText(`Групи: ${groups[0].name}, ${groups[1].name}`, { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Passed: group-only assignments, no individual selection or payload, single/multiple group labels, reload persistence, group search, hidden selections retained, Bulgarian validation, failure/retry, pending controls, no duplicate submit, responsive layout and both themes. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('assignment-recipients-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  releasePost()
  await browser.close()
}
