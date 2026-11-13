import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const auth = { token: 'assignment-tabs-fixture', user: { id: 101, name: 'Teacher', email: 'tabs@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const test = { id: 201, title: 'Основи на Java', status: 'published', owner_id: 101, shared: false, question_count: 5, total_time_seconds: 300 }
const groups = [{ id: 301, name: '12А', subject: 'Java' }, { id: 302, name: '12Б', subject: 'Програмиране' }]
const existing = { id: 601, assessment_id: test.id, teacher_id: 101, title: test.title, starts_at: '2098-10-14T07:00:00Z', ends_at: '2098-10-14T08:00:00Z', max_attempts: 1, recipients: 1, access_code: 'ABCD2345', recipient_groups: [groups[0]] }
const assignments = [existing], submissions = [], errors = []
const titles = ['Тест и групи', 'Период и опити', 'Начин на решаване']
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Sofia', reducedMotion: 'reduce' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    if (!path.startsWith('/api/')) return route.continue()
    const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (method === 'GET') {
      const data = { '/api/auth/me': auth.user, '/api/v1/tests': [test], '/api/v1/groups': groups, '/api/v1/assignments': assignments, '/api/v1/tests/201/versions': [{ id: 401, version_number: 2 }] }
      if (Object.hasOwn(data, path)) return respond(data[path])
    }
    if (method === 'POST' && path === '/api/v1/assignments') {
      const body = request.postDataJSON()
      submissions.push(body)
      const created = { ...existing, id: 602, starts_at: body.startsAt, ends_at: body.endsAt, max_attempts: body.maxAttempts, recipient_groups: groups.filter(group => body.groupIds.includes(group.id)) }
      assignments.push(created)
      return respond(created)
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${frontend}/assignments`)
  const form = page.getByRole('form', { name: 'Възлагане на тест', exact: true })
  const tabs = form.getByRole('tablist', { name: 'Стъпки на възлагането', exact: true })
  const tab = index => tabs.getByRole('tab', { name: titles[index], exact: true })
  const next = form.getByRole('button', { name: 'Напред', exact: true })
  const back = form.getByRole('button', { name: 'Назад', exact: true })
  const assign = form.getByRole('button', { name: 'Възложи', exact: true })
  const reset = form.getByRole('button', { name: 'Нулирай формата', exact: true })
  const testPicker = form.getByRole('combobox', { name: 'Тест', exact: true })
  const groupPicker = form.getByRole('combobox', { name: 'Търси групи', exact: true })
  const start = form.getByLabel('Начало', { exact: true }), end = form.getByLabel('Краен срок', { exact: true }), attempts = form.getByLabel('Опити', { exact: true })
  const shuffleQ = form.getByLabel('Разбъркай въпросите', { exact: true }), shuffleA = form.getByLabel('Разбъркай опциите', { exact: true }), answers = form.getByLabel('Верни отговори след срока', { exact: true })
  async function active(index, focused = false) {
    assert.equal(await tab(index).getAttribute('aria-selected'), 'true')
    assert.equal(await tab(index).getAttribute('tabindex'), '0')
    assert.equal(await form.getByRole('tabpanel').count(), 1)
    await form.getByRole('tabpanel', { name: titles[index], exact: true }).waitFor()
    assert.equal(await form.locator('[role="tabpanel"]').count(), 3, 'Hidden panels stay mounted to preserve input state')
    for (let other = 0; other < titles.length; other++) {
      if (other === index) continue
      assert.equal(await tab(other).getAttribute('aria-selected'), 'false')
      assert.equal(await tab(other).getAttribute('tabindex'), '-1')
    }
    if (focused) assert.equal(await tab(index).evaluate(element => element === document.activeElement), true)
  }
  await active(0)
  assert.equal(await assign.count(), 0)
  assert.equal(await next.getAttribute('type'), 'button')
  await tab(0).focus()
  await tab(0).press('ArrowRight'); await active(1, true)
  await tab(1).press('End'); await active(2, true)
  assert.equal(await assign.count(), 1)
  await tab(2).press('Home'); await active(0, true)
  await tab(0).press('ArrowLeft'); await active(2, true)
  await tab(2).press('ArrowDown'); await active(0, true)
  assert.equal(await page.getByRole('alert').count(), 0, 'Tab navigation alone does not validate or submit the form')
  assert.equal(submissions.length, 0)

  // Missing data on another tab is revealed and focused when the final action validates.
  await tab(2).click(); await assign.click()
  await active(0)
  await page.getByRole('alert').getByText('Изберете тест за възлагане.', { exact: true }).waitFor()
  assert.equal(await testPicker.evaluate(element => element === document.activeElement), true)
  const versionResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/tests/201/versions')
  await testPicker.fill(test.title)
  await page.getByRole('listbox', { name: 'Тестове за възлагане', exact: true }).getByRole('option').click()
  await versionResponse
  await groupPicker.click()
  const groupOptions = page.getByRole('listbox', { name: 'Групи', exact: true })
  assert.equal(await groupOptions.getByRole('option', { name: groups[0].name, exact: true }).isDisabled(), true)
  await groupOptions.getByRole('option', { name: groups[1].name, exact: true }).click()
  await groupPicker.press('Escape')
  await next.click(); await active(1)
  await start.fill('2098-10-14T10:00'); await end.fill('2098-10-14T12:30'); await attempts.fill('3')
  await next.click(); await active(2)
  await shuffleQ.uncheck(); await shuffleA.check(); await answers.uncheck()
  await back.click(); await active(1)
  assert.equal(await start.inputValue(), '2098-10-14T10:00')
  assert.equal(await end.inputValue(), '2098-10-14T12:30')
  assert.equal(await attempts.inputValue(), '3')
  await tab(0).click(); await active(0)
  assert.equal(await testPicker.inputValue(), test.title)
  await form.getByRole('button', { name: 'Премахни: 12Б', exact: true }).waitFor()
  await tab(2).click()
  assert.equal(await shuffleQ.isChecked(), false)
  assert.equal(await shuffleA.isChecked(), true)
  assert.equal(await answers.isChecked(), false)

  for (const { width, theme } of [{ width: 1440, theme: 'light' }, { width: 1440, theme: 'dark' }, { width: 390, theme: 'light' }, { width: 320, theme: 'dark' }]) {
    await page.setViewportSize({ width, height: 1000 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    await tab(0).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await tabs.evaluate(element => [...element.querySelectorAll('[role="tab"]')].every(button => { const bounds = button.getBoundingClientRect(); return bounds.width >= 44 && bounds.height >= 44 && bounds.left >= 0 && bounds.right <= innerWidth })), true)
    await page.screenshot({ path: new URL(`assignment-tabs-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await tab(1).click()
  await end.fill('2098-10-14T09:59')
  await tab(2).click(); await assign.click()
  await active(1)
  assert.equal(await end.evaluate(element => element === document.activeElement), true)
  assert.equal(submissions.length, 0)
  await end.fill('2098-10-14T12:30'); await attempts.fill('0')
  await tab(2).click(); await assign.click()
  await active(1)
  assert.equal(await attempts.evaluate(element => element === document.activeElement), true)
  assert.equal(submissions.length, 0)
  await attempts.fill('3')
  await tab(2).click(); await assign.click()
  await page.getByText('Възлагането е създадено.', { exact: true }).waitFor()
  assert.equal(submissions.length, 1)
  assert.deepEqual(submissions[0], { versionId: 401, groupIds: [302], startsAt: '2098-10-14T07:00:00.000Z', endsAt: '2098-10-14T09:30:00.000Z', maxAttempts: 3, shuffleQuestions: false, shuffleOptions: true, answersAfterDeadline: false, mobileAllowed: false, autoAiGrading: false })
  await tab(0).click()
  assert.equal(await testPicker.inputValue(), test.title)
  await form.getByText('Избрани: 0', { exact: true }).waitFor()
  await tab(2).click(); await reset.click(); await active(0)
  assert.equal(await testPicker.inputValue(), '')
  assert.equal(await groupPicker.inputValue(), '')
  await tab(1).click()
  assert.equal(await attempts.inputValue(), '1')
  await tab(2).click()
  assert.equal(await shuffleQ.isChecked(), true)
  assert.equal(await shuffleA.isChecked(), false)
  assert.equal(await answers.isChecked(), true)
  assert.equal(submissions.length, 1)
  assert.deepEqual(errors, [])
  console.log('Passed: assignment tab semantics and arrow/Home/End keyboard navigation; Back/Next and free switching preserve test/audience/dates/settings; final validation reveals/focuses hidden invalid fields; exact submission payload; reset returns first tab; disabled duplicate group; responsive desktop/mobile light/dark tabs. All API traffic mocked.')
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: new URL('assignment-tabs-failure.png', artifacts).pathname, fullPage: true })
    console.error('Fixture page:', (await page.locator('body').innerText()).slice(0, 2000), 'Browser errors:', errors)
  }
  throw error
} finally { await browser.close() }
