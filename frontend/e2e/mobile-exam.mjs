import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const artifacts = new URL('../../.artifacts/', import.meta.url)
const teacher = { token: 'mobile-teacher-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const student = { token: 'mobile-student-fixture', user: { id: 102, name: 'Student', email: 'student@example.test', role: 'STUDENT', active: true, passwordChangeRequired: false } }
const mobileUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const assignment = { id: 301, teacher_id: teacher.user.id, assessment_id: 201, title: 'Мобилни упражнения', starts_at: new Date(Date.now() - 60000).toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), max_attempts: 1, canceled: false, mobile_allowed: false, recipients: 1, access_code: 'ABCDEFGH', recipient_groups: [{ id: 401, name: '12А' }] }
const definitions = [
  { id: 501, text: 'Коя дума създава обект в Java?', type: 'SINGLE_CHOICE', options: [{ id: 'new', text: 'new' }, { id: 'class', text: 'class' }] },
  { id: 502, text: 'За какво служи класът?', type: 'OPEN_ANSWER', options: [] },
]
const errors = []
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page

async function contextFor(auth, { width = 1440, theme = 'light', mobile = false, unsupported = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Europe/Sofia', ...(mobile ? { userAgent: mobileUserAgent, isMobile: true, hasTouch: true } : {}) })
  await context.addInitScript(({ auth, theme, unsupported }) => {
    localStorage.setItem('quicktest.auth', JSON.stringify(auth))
    localStorage.setItem('quicktest.theme', theme)
    const fetch = window.fetch.bind(window)
    window.__examFetches = []
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new URL(url, location.href).pathname.endsWith('/events')) {
        window.__examFetches.push({ keepalive: init?.keepalive ?? input.keepalive ?? false, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null })
      }
      return fetch(input, init)
    }
    if (unsupported) {
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false })
      Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: undefined })
    }
  }, { auth, theme, unsupported })
  return context
}

async function intercept(context, handler) {
  // Every API request is intercepted. These tests never modify the user's database.
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    if (!path.startsWith('/api/')) return route.continue()
    const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
    const respond = (data, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (await handler({ request, path, method, respond })) return
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({ detail: 'Unexpected fixture API' }, 404)
  })
}

async function openPage(context, path = '') {
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${frontend}${path}`)
  return page
}

async function screenshot(name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: page must fit the viewport`)
  await page.screenshot({ path: new URL(`${name}.png`, artifacts).pathname, fullPage: true })
}

async function teacherSettings() {
  const context = await contextFor(teacher)
  const groups = [{ id: 401, name: '12А', subject: 'Java' }, { id: 402, name: '12Б', subject: 'Java' }, { id: 403, name: '12В', subject: 'Java' }]
  const tests = [{ id: 202, title: 'Основи на Java', status: 'published', owner_id: teacher.user.id, shared: false, mobile_allowed: false, question_count: 2, total_time_seconds: 120 }]
  const assignments = [{ ...assignment, assessment_id: tests[0].id }], creates = [], saves = []
  let failSave = false
  await intercept(context, async ({ request, path, method, respond }) => {
    if (method === 'GET') {
      const data = { '/api/auth/me': teacher.user, '/api/v1/groups': groups, '/api/v1/tests': tests, '/api/v1/grading': [], '/api/v1/assignments': assignments, '/api/v1/tests/202/versions': [{ id: 212, version_number: 1 }] }
      if (Object.hasOwn(data, path)) { await respond(data[path]); return true }
    }
    if (method === 'POST' && path === '/api/v1/assignments') {
      const body = request.postDataJSON()
      assert.equal(typeof body.mobileAllowed, 'boolean')
      assert.equal(body.mobileAllowed, tests[0].mobile_allowed, 'New assignments inherit the test setting')
      creates.push(body)
      assignments.push({ ...assignment, id: 301 + creates.length, assessment_id: tests[0].id, title: tests[0].title, mobile_allowed: body.mobileAllowed, recipient_groups: groups.filter(group => body.groupIds.includes(group.id)), starts_at: body.startsAt, ends_at: body.endsAt })
      await respond({ id: assignments.at(-1).id }); return true
    }
    if (method === 'PUT' && path === '/api/v1/tests/202/mobile-mode') {
      const body = request.postDataJSON()
      assert.deepEqual(Object.keys(body), ['mobileAllowed'])
      tests[0].mobile_allowed = body.mobileAllowed
      assignments.filter(row => row.assessment_id === tests[0].id).forEach(row => { row.mobile_allowed = body.mobileAllowed })
      saves.push(body)
      await respond({}); return true
    }
    if (method === 'PUT' && path === '/api/v1/assignments/301/mobile-mode') {
      const body = request.postDataJSON()
      assert.deepEqual(Object.keys(body), ['mobileAllowed'])
      assert.equal(typeof body.mobileAllowed, 'boolean')
      saves.push(body)
      if (failSave) { failSave = false; await respond({ detail: 'Има активен опит. Опитайте отново след приключването му.' }, 409); return true }
      tests[0].mobile_allowed = body.mobileAllowed
      assignments.filter(row => row.assessment_id === tests[0].id).forEach(row => { row.mobile_allowed = body.mobileAllowed })
      await respond(assignments[0]); return true
    }
    return false
  })
  try {
    await openPage(context, '/assignments')
    const form = page.getByRole('form', { name: 'Възлагане на тест', exact: true })
    for (const [position, index] of [1, 2].entries()) {
      if (position) await form.getByRole('button', { name: 'Нулирай формата', exact: true }).click()
      await form.getByRole('combobox', { name: 'Тест', exact: true }).fill(tests[0].title)
      await page.getByRole('listbox', { name: 'Тестове за възлагане' }).getByRole('option').click()
      await form.getByText(/Решаване от телефон: не е разрешено/).waitFor()
      await form.getByRole('combobox', { name: 'Търси групи', exact: true }).fill(groups[index].name)
      await page.getByRole('listbox', { name: 'Групи', exact: true }).getByRole('option', { name: groups[index].name, exact: true }).click()
      const request = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/assignments')
      await form.getByRole('button', { name: 'Възложи', exact: true }).click()
      await request
      await page.getByText('Възлагането е създадено.', { exact: true }).last().waitFor()
      assert.equal(creates[position].mobileAllowed, false)
    }
    await page.getByRole('navigation', { name: 'Основна навигация', exact: true }).getByRole('button', { name: 'Тестове', exact: true }).click()
    const testPermission = page.getByRole('checkbox', { name: `Разреши решаване от телефон: ${tests[0].title}`, exact: true })
    assert.equal(await testPermission.isChecked(), false)
    const testUpdate = page.waitForRequest(request => request.method() === 'PUT' && new URL(request.url()).pathname === '/api/v1/tests/202/mobile-mode')
    await testPermission.click()
    await testUpdate
    await page.waitForFunction(() => document.querySelector('input[aria-label^="Разреши решаване от телефон:"]')?.checked)
    assert.equal(tests[0].mobile_allowed, true)
    assert(assignments.filter(row => row.assessment_id === tests[0].id).every(row => row.mobile_allowed), 'Enabling from the test list updates every existing assignment')
    await page.getByRole('navigation', { name: 'Основна навигация', exact: true }).getByRole('button', { name: 'Възлагания', exact: true }).click()
    const edit = page.getByRole('button', { name: `Мобилен режим: ${assignment.title}`, exact: true })
    const dialog = page.getByRole('dialog', { name: 'Мобилен режим', exact: true })
    const allow = dialog.getByLabel('Разреши решаване от телефон', { exact: true })
    const save = dialog.getByRole('button', { name: 'Запази режима', exact: true })
    await edit.click(); assert.equal(await allow.isChecked(), true)
    const savesBeforeCancel = saves.length
    await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
    assert.equal(saves.length, savesBeforeCancel)
    await edit.click(); assert.equal(await allow.isChecked(), true)
    await allow.uncheck(); failSave = true; await save.click()
    await dialog.getByRole('alert').getByText('Има активен опит. Опитайте отново след приключването му.', { exact: true }).waitFor()
    assert.equal(await allow.isChecked(), false, 'Server refusal must preserve the teacher selection for retry')
    await save.click(); await dialog.waitFor({ state: 'hidden' })
    await page.reload(); await edit.click(); assert.equal(await allow.isChecked(), false)
    for (const width of [320, 390]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true)
      await screenshot(`mobile-setting-${theme}-${width}`)
    }
    await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
    assert.deepEqual(saves, [{ mobileAllowed: true }, { mobileAllowed: false }, { mobileAllowed: false }])
    assert(assignments.filter(row => row.assessment_id === tests[0].id).every(row => !row.mobile_allowed), 'Changing the setting from an assignment also updates all assignments of that test')
  } finally { await context.close() }
}

async function learnerScenario({ name, width = 390, theme = 'light', mobile = true, allowed = false, permissionUpdatedAfterPreflight = false, exempt = false, strictSupported = false, complete = false, resume = false, leave = 'visibility' }) {
  const context = await contextFor(student, { width, theme, mobile, unsupported: !strictSupported })
  let current = 0, questionStatus = 'open', status = 'in_progress', deadline = Date.now() + 180000
  const starts = [], opens = [], answers = [], events = [], drafts = []
  const selected = { ...assignment, mobile_allowed: allowed, fullscreen_exempt: exempt }
  let mobileMode = resume || mobile && allowed && !exempt
  function state() {
    return { id: 601, assignment_id: selected.id, mobile_mode: mobileMode, status, server_now: new Date().toISOString(), question_number: current + 1, question_count: definitions.length, question: status === 'in_progress' ? { ...definitions[current], status: questionStatus, maximum_points: 1, time_seconds: 180, open_instance: questionStatus === 'open' ? `mobile-instance-${current}` : null, opened_at: questionStatus === 'open' ? new Date(deadline - 180000).toISOString() : null, deadline_at: questionStatus === 'open' ? new Date(deadline).toISOString() : null, draft: drafts[current] ?? null } : null }
  }
  await intercept(context, async ({ request, path, method, respond }) => {
    if (method === 'GET') {
      const data = { '/api/auth/me': student.user, '/api/v1/groups': [], '/api/v1/assignments': [selected], '/api/v1/results': [], '/api/v1/attempts': resume ? [{ id: 601, assignment_id: selected.id, title: selected.title, status: 'in_progress', attempt_number: 1 }] : [], [`/api/v1/assignments/${selected.id}/preflight`]: { ...selected, instructions: '', total_seconds: 360, question_count: definitions.length }, '/api/v1/attempts/601/state': state() }
      if (Object.hasOwn(data, path)) { await respond(data[path]); return true }
    }
    if (method === 'POST' && path === `/api/v1/assignments/${selected.id}/attempts`) {
      const body = request.postDataJSON()
      mobileMode = resume || mobile && selected.mobile_allowed && !exempt
      starts.push(body)
      assert.equal(body.code, 'ABCDEFGH'); assert.equal(body.visible, true)
      assert.equal(body.fullscreenSupported, strictSupported)
      assert.equal(body.fullscreenActive, false, 'Unsupported fullscreen must never be reported as active')
      assert.equal(body.mobileMode, mobile && selected.mobile_allowed && !exempt)
      assert(mobile && selected.mobile_allowed || exempt, `${name}: forbidden start reached the API`)
      await respond(state()); return true
    }
    if (method === 'PUT' && /^\/api\/v1\/attempts\/601\/questions\/\d+\/draft$/.test(path)) {
      const body = request.postDataJSON()
      assert.equal(body.openInstance, `mobile-instance-${current}`)
      drafts[current] = body.answer
      await respond(state()); return true
    }
    if (method === 'POST' && /^\/api\/v1\/attempts\/601\/questions\/\d+\/answer$/.test(path)) {
      const body = request.postDataJSON()
      assert.equal(questionStatus, 'open'); assert.equal(body.openInstance, `mobile-instance-${current}`)
      assert.equal(path, `/api/v1/attempts/601/questions/${definitions[current].id}/answer`)
      answers.push(body); current++; questionStatus = 'pending'
      await respond(state()); return true
    }
    if (method === 'POST' && path === '/api/v1/attempts/601/questions/open') {
      const body = request.postDataJSON()
      assert.equal(body.fullscreenActive, false); assert.equal(body.visible, true)
      assert.equal(questionStatus, 'pending')
      opens.push(body); questionStatus = 'open'; deadline = Date.now() + 180000
      await respond(state()); return true
    }
    if (method === 'POST' && path === '/api/v1/attempts/601/events') {
      const body = request.postDataJSON()
      events.push(body)
      assert.equal(body.questionId, definitions[current].id)
      assert.equal(body.openInstance, `mobile-instance-${current}`)
      if (body.type === 'visibility_hidden') assert.equal(body.visible, false)
      if (body.type === 'fullscreen_exit') assert.equal(body.fullscreen, false)
      if (['visibility_hidden', 'fullscreen_exit'].includes(body.type)) status = 'pending_review'
      await respond(state()); return true
    }
    return false
  })
  try {
    await openPage(context)
    await page.getByRole('navigation', { name: 'Основна навигация', exact: true }).getByRole('button', { name: 'Моите тестове', exact: true }).click()
    await page.getByRole('button', { name: resume ? 'Продължи' : 'Подготовка', exact: true }).click()
    if (!resume) {
    await page.getByRole('heading', { name: 'Подготовка за изпит', exact: true }).waitFor()
    await page.getByLabel('Код за достъп', { exact: true }).fill('ABCDEFGH')
    const canStart = mobile && (allowed || permissionUpdatedAfterPreflight) || exempt
    if (!canStart) {
      assert.equal(await page.getByRole('button', { name: 'Започни теста', exact: true }).count(), 0, 'A narrow desktop viewport must not opt into mobile mode')
      const start = page.getByRole('button', { name: 'Започни на цял екран', exact: true })
      if (await start.isEnabled()) await start.click()
      await page.getByRole('alert').filter({ hasText: mobile ? /учител|разреш/i : /не поддържа/i }).waitFor()
      assert.equal(starts.length, 0, 'Blocked browser must not spend an attempt')
      assert.equal(await page.getByRole('heading', { name: definitions[0].text, exact: true }).count(), 0)
      await screenshot(`mobile-exam-${name}-${theme}-${width}`)
      return
    }
    if (permissionUpdatedAfterPreflight) {
      selected.mobile_allowed = true
      await page.getByRole('button', { name: 'Започни на цял екран', exact: true }).click()
    } else {
      if (mobile && !exempt) await page.locator('.exam-preflight').getByText('Мобилен режим', { exact: true }).waitFor()
      else await page.locator('.exam-preflight').getByText('Индивидуално разрешено изключение от цял екран', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Започни на цял екран', exact: true }).count(), 0)
      await screenshot(`mobile-exam-${name}-preflight-${theme}-${width}`)
      await page.getByRole('button', { name: 'Започни теста', exact: true }).click()
    }
    }
    await page.getByRole('heading', { name: definitions[0].text, exact: true }).waitFor()
    assert.equal(starts.length, resume ? 0 : 1, 'Resuming must use the existing server-approved mode without starting another attempt')
    assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false)
    assert.equal(await page.getByRole('heading', { name: 'Възстановете целия екран', exact: true }).count(), 0)
    await screenshot(`mobile-exam-${name}-question-${theme}-${width}`)
    if (!complete) return
    await page.getByRole('radio', { name: 'new', exact: true }).check()
    await page.getByRole('button', { name: 'Потвърди отговора', exact: true }).click()
    await page.getByRole('heading', { name: definitions[1].text, exact: true }).waitFor()
    assert.equal(answers.length, 1); assert.equal(opens.length, 1)
    assert.deepEqual(answers[0].answer, { optionIds: ['new'], text: '' })
    assert.equal(await page.getByLabel('Отговор', { exact: true }).inputValue(), '')
    assert.equal(await page.getByRole('button', { name: 'Продължи на цял екран', exact: true }).count(), 0)
    if (leave === 'fullscreen') {
      const fullscreenExit = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/events') && request.postDataJSON().type === 'fullscreen_exit')
      await page.evaluate(() => document.dispatchEvent(new Event('fullscreenchange')))
      await fullscreenExit
      await page.getByRole('heading', { name: 'Опитът е предаден', exact: true }).waitFor()
      assert.equal(status, 'pending_review', 'Leaving fullscreen must trigger the current-question sanction in mobile mode')
      const exit = events.find(event => event.type === 'fullscreen_exit')
      assert.equal(exit.questionId, definitions[1].id); assert.equal(exit.openInstance, 'mobile-instance-1')
      return
    }
    assert.equal(await page.getByRole('heading', { name: definitions[1].text, exact: true }).isVisible(), true, 'Absent fullscreen must not hide an approved mobile question')
    assert.equal(status, 'in_progress')
    await screenshot(`mobile-exam-${name}-next-${theme}-${width}`)
    const saved = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith('/questions/502/draft') && response.request().postDataJSON().answer.text === 'Класът описва обекти.')
    await page.getByLabel('Отговор', { exact: true }).fill('Класът описва обекти.')
    await saved
    assert.equal(drafts[1].text, 'Класът описва обекти.')
    const visibility = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/events') && request.postDataJSON().type === 'visibility_hidden')
    await page.evaluate(leave => {
      if (leave === 'pagehide') window.dispatchEvent(new PageTransitionEvent('pagehide'))
      else {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      }
    }, leave)
    await visibility
    await page.getByRole('heading', { name: 'Опитът е предаден', exact: true }).waitFor()
    const hidden = events.find(event => event.type === 'visibility_hidden')
    assert.equal(hidden.questionId, definitions[1].id); assert.equal(hidden.openInstance, 'mobile-instance-1')
    assert.equal(hidden.fullscreen, false)
    if (leave === 'pagehide') {
      const outgoing = await page.evaluate(() => window.__examFetches.filter(request => request.body?.type === 'visibility_hidden'))
      assert(outgoing.some(request => request.keepalive === true && request.body.questionId === 502 && request.body.openInstance === 'mobile-instance-1'), 'Navigation must send the exact-instance visibility event with keepalive enabled')
    }
    assert.equal(status, 'pending_review', 'A saved draft must not suppress the hidden-page sanction')
    assert.equal(starts.length, resume ? 0 : 1)
  } finally { await context.close() }
}

try {
  await teacherSettings()
  for (const width of [320, 390]) for (const theme of ['light', 'dark']) {
    await learnerScenario({ name: 'approved', width, theme, allowed: true, complete: true })
  }
    await learnerScenario({ name: 'permission-updated-after-preflight', allowed: false, permissionUpdatedAfterPreflight: true })
    await learnerScenario({ name: 'not-allowed', width: 390 })
  await learnerScenario({ name: 'desktop-unsupported', width: 320, mobile: false, allowed: true })
  await learnerScenario({ name: 'individual-exception', width: 390, exempt: true })
  await learnerScenario({ name: 'fullscreen-exit', width: 390, allowed: true, complete: true, leave: 'fullscreen' })
  await learnerScenario({ name: 'pagehide', width: 390, theme: 'dark', allowed: true, complete: true, leave: 'pagehide' })
  await learnerScenario({ name: 'resumed-after-disable', width: 320, theme: 'light', allowed: false, resume: true, complete: true, leave: 'pagehide' })
  assert.deepEqual(errors, [])
  console.log('Passed: test-list mobile permission updates existing assignments and controls future assignment defaults, assignment permission editing/cancel/retry/persistence, mobile start with truthful fullscreen capabilities, server-approved resume after permission disabled, automatic next question, fullscreen-exit and visibility/pagehide sanctions with exact question instances, navigation keepalive, saved drafts do not suppress hiding sanctions, denied phones spend no attempts, narrow unsupported desktop stays blocked, existing individual exception, 320/390px and both themes. API fixtures only.')
} catch (error) {
  console.error('Fixture API/page errors:', errors)
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('mobile-exam-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  await browser.close()
}
