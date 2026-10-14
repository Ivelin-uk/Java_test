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
  async function fixture(role, { empty = false, delayed = false, failed = false } = {}) {
    const auth = { token: `dashboard-${role}`, user: { id: 101, name: 'ExamAI User', email: 'user@example.test', role, active: true, passwordChangeRequired: false, roleSelectionRequired: false } }
    const groups = empty ? [] : [{ id: 301, name: '12А', subject: 'Java', description: '' }, { id: 302, name: '12Б', subject: 'Програмиране', description: '' }]
    const assignments = empty ? [] : [{ id: 601, teacher_id: 101, title: 'Основи на Java - Средно ниво', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), recipients: 2, recipient_groups: [{ id: 301, name: '12А' }], max_attempts: 1 }]
    const attempts = empty ? [] : ['pending_review', 'finalized', 'voided'].map((status, i) => ({ id: 701 + i, assignment_id: 601, title: assignments[0].title, student_name: 'Иван Петров', attempt_number: i + 1, status, submitted_at: new Date().toISOString() }))
    const results = empty ? [] : [{ id: 801, attempt_id: 702, assignment_id: 601, title: assignments[0].title, attempt_number: 2, revision_number: 1, percentage: 80, points: 8, maximum_points: 10, grade: '5', outcome: 'passed' }]
    let release, failGroups = failed
    const gate = delayed ? new Promise(resolve => { release = resolve }) : Promise.resolve()
    const requests = []
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
    await context.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin }, body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      requests.push({ method, path })
      if (method === 'GET') {
        if (path === '/api/v1/groups') {
          await gate
          if (failGroups) return respond({ detail: 'Групите временно не могат да се заредят.' }, 503)
        }
        const data = { '/api/auth/me': auth.user, '/api/v1/groups': groups, '/api/v1/assignments': assignments, '/api/v1/tests': [], '/api/v1/attempts': attempts, '/api/v1/results': results, '/api/v1/grading': attempts }
        if (Object.hasOwn(data, path)) return respond(data[path])
      }
      errors.push(`Unexpected API: ${method} ${path}`)
      return respond({}, 404)
    })
    const next = await context.newPage()
    next.on('pageerror', error => errors.push(error.message))
    return { context, page: next, requests, release: () => release?.(), recover: () => { failGroups = false } }
  }
  const statistics = () => page.getByRole('group', { name: 'Статистика', exact: true })
  const count = title => statistics().getByTitle(title, { exact: true }).locator('strong')
  const waitCount = (title, value) => count(title).getByText(value, { exact: true }).waitFor()
  const dashboard = () => page.getByRole('navigation', { name: 'Основна навигация' }).getByRole('button', { name: 'Табло', exact: true }).click()
  for (const role of ['TEACHER', 'STUDENT']) {
    const current = await fixture(role); page = current.page
    await page.goto(frontend)
    const assignmentTitle = role === 'TEACHER' ? 'Към възлаганията' : 'Към моите тестове'
    const recordTitle = role === 'TEACHER' ? 'Към проверките' : 'Към резултатите'
    await waitCount('Към групите', '2')
    await waitCount(assignmentTitle, '1')
    await waitCount(recordTitle, '1')
    assert.equal(await statistics().getByRole('button').count(), 3)
    assert.equal(await statistics().getByTitle(recordTitle).getAttribute('aria-busy'), 'false')
    await statistics().getByTitle('Към групите').focus()
    await page.keyboard.press('Enter')
    await page.getByRole('table', { name: 'Групи', exact: true }).getByRole('button', { name: '12А', exact: true }).waitFor()
    await page.goBack(); await statistics().waitFor()
    await page.goForward(); await page.getByRole('heading', { name: 'Групи', exact: true }).waitFor()
    await page.reload(); await page.getByRole('heading', { name: 'Групи', exact: true }).waitFor()
    await dashboard(); await waitCount(assignmentTitle, '1')
    await statistics().getByTitle(assignmentTitle).focus()
    await page.keyboard.press('Space')
    await page.getByRole('table', { name: role === 'TEACHER' ? 'Възлагания' : 'Възложени тестове', exact: true }).waitFor()
    await dashboard(); await waitCount(recordTitle, '1')
    await statistics().getByTitle(recordTitle).click()
    await page.getByRole('table', { name: role === 'TEACHER' ? 'Проверка на опити' : 'Опити и резултати', exact: true }).waitFor()
    await dashboard(); await waitCount('Към групите', '2')
    for (const { theme, width, height } of [{ theme: 'dark', width: 1440, height: 1000 }, { theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 320, height: 844 }]) {
      await page.setViewportSize({ width, height })
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.equal(await statistics().evaluate(element => [...element.querySelectorAll('button')].every(button => {
        const bounds = button.getBoundingClientRect(), label = button.querySelector('span').getBoundingClientRect(), value = button.querySelector('strong').getBoundingClientRect()
        return bounds.left >= 0 && bounds.right <= innerWidth && button.scrollWidth <= button.clientWidth && label.bottom <= value.top && label.right <= bounds.right && value.bottom <= bounds.bottom
      })), true)
      await page.screenshot({ path: new URL(`dashboard-${role.toLowerCase()}-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
    }
    const forbidden = role === 'TEACHER' ? '/api/v1/results' : '/api/v1/grading'
    assert.equal(current.requests.some(request => request.path === forbidden), false)
    assert.equal(current.requests.every(request => request.method === 'GET'), true)
    await current.context.close()
  }
  const loading = await fixture('TEACHER', { delayed: true }); page = loading.page
  await page.goto(frontend)
  await waitCount('Към групите', '-')
  assert.equal(await statistics().getByTitle('Към групите').getAttribute('aria-busy'), 'true')
  await waitCount('Към възлаганията', '1')
  loading.release()
  await waitCount('Към групите', '2')
  await loading.context.close()
  const failure = await fixture('TEACHER', { failed: true }); page = failure.page
  await page.goto(frontend)
  await page.getByRole('alert').getByText('Групите временно не могат да се заредят.', { exact: true }).waitFor()
  assert.equal(await count('Към групите').textContent(), '-')
  await waitCount('Към възлаганията', '1')
  failure.recover()
  await statistics().getByTitle('Към групите').click()
  await page.getByRole('table', { name: 'Групи', exact: true }).getByRole('button', { name: '12А', exact: true }).waitFor()
  await page.goBack(); await waitCount('Към групите', '2')
  assert.equal(await page.getByRole('alert').count(), 0)
  await failure.context.close()
  const empty = await fixture('TEACHER', { empty: true }); page = empty.page
  await page.goto(frontend)
  for (const title of ['Към групите', 'Към възлаганията', 'Към проверките']) await waitCount(title, '0')
  await statistics().getByTitle('Към групите').click()
  await page.getByRole('heading', { name: 'Групи', exact: true }).waitFor()
  await dashboard(); await statistics().getByTitle('Към възлаганията').click()
  await page.getByRole('table', { name: 'Възлагания', exact: true }).waitFor()
  await dashboard(); await statistics().getByTitle('Към проверките').click()
  await page.getByText('Няма опити за проверка.', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Passed: group count, teacher/student metric destinations, keyboard, back/forward/reload, zero counts, loading/error/recovery, desktop/mobile and both themes. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('dashboard-navigation-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  await browser.close()
}
