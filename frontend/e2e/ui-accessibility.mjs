import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { chooseTestCreation } from './helpers/test-creation.mjs'

// Isolated UI fixtures: this audit never reads or writes production application data.
const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const now = Date.now(), starts = new Date(now - 3600000).toISOString(), ends = new Date(now + 86400000).toISOString()
const question = { type: 'SINGLE_CHOICE', text: 'Коя стойност е логическа?', difficulty: 'MEDIUM', points: 1, timeSeconds: 60, options: [{ text: 'true', correct: true }, { text: '42', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'Логическите стойности са true и false.' }
const definition = { title: 'Основи на програмирането', description: 'Подготвителен тест за следващия учебен час.', subject: 'Информатика', level: '10', instructions: 'Прочети внимателно всеки въпрос.', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, questions: [question], additionalInformation: '' }
const test = { id: 201, owner_id: 101, public_number: '123456789012', title: definition.title, subject: definition.subject, level: '10', status: 'published', shared: false, mobile_allowed: false, question_count: 1, total_time_seconds: 60, updated_at: starts, definition_json: JSON.stringify(definition) }
const group = { id: 301, name: '10. А клас', description: 'Програмиране и информационни технологии', subject: 'Информатика', join_code: 'ABC12345', participant_count: 2, teacher_name: 'Мария Иванова' }
const assignment = { id: 601, assessment_id: 201, teacher_id: 101, teacher_name: 'Мария Иванова', title: definition.title, starts_at: starts, ends_at: ends, max_attempts: 3, recipients: 2, recipient_groups: [{ id: 301, name: group.name }], individual_recipients: [], access_code: 'ABC12345', mobile_allowed: false }
const attempt = { id: 701, assignment_id: 601, student_id: 102, student_name: 'Иван Петров', title: definition.title, attempt_number: 1, status: 'finalized', submitted_at: starts, groups: [{ id: 301, name: group.name }], result_correct_answers: 1, result_question_count: 1, result_percentage: 100, result_outcome: 'passed', ai_status: null, max_attempts: 3, attempts_used: 1, assignment_ends_at: ends }
const result = { id: 801, attempt_id: 701, assignment_id: 601, title: definition.title, points: 1, maximum_points: 1, percentage: 100, grade: '6', outcome: 'passed', attempt_number: 1, revision_number: 1, published_at: starts, review_available: true }
const reviewQuestion = { id: 901, status: 'answered', definition_json: JSON.stringify({ question, options: [{ id: 'a', text: 'true', correct: true }, { id: 'b', text: '42', correct: false }] }), maximum_points: 1, automatic_points: 1, final_points: 1, reviewed: true, draft_json: null, answer_json: JSON.stringify({ optionIds: ['a'], text: '' }), teacher_comment: 'Отлично!', override_reason: null, opened_at: starts, deadline_at: ends, closed_at: starts }
const billing = { plan: 'free', status: 'free', currentPeriod: null, paidThrough: null, cancelAtPeriodEnd: false, mode: 'unconfigured', checkoutAvailable: false, portalAvailable: false, prices: { month: { available: false, amountMinor: 800, currency: 'eur' }, year: { available: false } }, limits: { groups: 1, activeAssignments: 5, aiCredits: 10 }, usage: { groups: 1, activeAssignments: 1, aiCredits: 2 }, plans: { free: { groups: 1, activeAssignments: 5, aiCredits: 10 }, pro: { groups: 20, activeAssignments: 100, aiCredits: 100 } } }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const errors = [], measurements = [], failures = []
let page

async function createPage(role, theme) {
  const auth = role ? { token: `ui-audit-${role}`, user: { id: role === 'STUDENT' ? 102 : 101, name: role === 'STUDENT' ? 'Иван Петров' : 'Мария Иванова', email: 'audit@example.test', role, active: true, passwordChangeRequired: false, roleSelectionRequired: false } } : null
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', colorScheme: theme })
  await context.addInitScript(({ auth, theme }) => { if (auth) localStorage.setItem('quicktest.auth', JSON.stringify(auth)); localStorage.setItem('quicktest.theme', theme) }, { auth, theme })
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
    const respond = data => route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(data) })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const data = {
      '/api/auth/me': auth?.user,
      '/api/auth/google/config': { enabled: true, redirect: 'https://accounts.google.com/o/oauth2/v2/auth' },
      '/api/v1/groups': [group], '/api/v1/assignments': [assignment], '/api/v1/tests': [test],
      '/api/v1/tests/201': test, '/api/v1/tests/201/versions': [{ id: 401, version_number: 1, title: definition.title, published_at: starts }],
      '/api/v1/grading': [attempt], '/api/v1/attempts': [attempt], '/api/v1/results': [result],
      '/api/v1/results/701': { ...result, details: { questions: [reviewQuestion], gradeOverridden: false, outcomeOverridden: false, correctAnswersVisible: true } },
      '/api/v1/profile/notification-email': { email: auth?.user.email, verified_at: starts }, '/api/v1/profile/identities': [],
      '/api/v1/billing': billing, '/api/v1/billing/payments': [],
      '/api/v1/subjects': [{ name: 'Информатика', preset: true }], '/api/v1/subjects/topics': [definition.title], '/api/v1/subjects/topics/personal': [],
      '/api/v1/members': [], '/api/v1/groups/301/members': [],
      '/api/v1/assignments/601/preflight': { id: 601, title: definition.title, instructions: definition.instructions, starts_at: starts, ends_at: ends, question_count: 1, total_seconds: 60, max_attempts: 3, fullscreen_exempt: true, mobile_allowed: false },
      '/api/admin/users': [{ ...auth?.user, id: 101, subscription: { paid: false, paidUntil: null }, notificationEmail: 'audit@example.test', notificationEmailVerifiedAt: starts }],
      '/api/admin/permissions': [], '/api/admin/audit': [], '/api/admin/teacher-billing': [], '/api/admin/subjects': [],
    }
    if (request.method() === 'GET' && Object.hasOwn(data, path)) return respond(data[path])
    errors.push(`Unexpected API: ${request.method()} ${path}`)
    return route.fulfill({ status: 404, headers, contentType: 'application/json', body: '{}' })
  })
  const next = await context.newPage()
  next.on('pageerror', error => errors.push(error.message))
  await next.goto(frontend)
  return { context, page: next }
}

async function verifyStickyNavigation() {
  const result = await page.locator('.ws-nav').evaluate(async nav => {
    const body = document.querySelector('.ws-body')
    const previousMinHeight = body.style.minHeight
    body.style.minHeight = '200vh'
    window.scrollTo({ top: window.innerHeight, behavior: 'instant' })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const sticky = getComputedStyle(nav)
    const measured = { position: sticky.position, top: nav.getBoundingClientRect().top, offset: parseFloat(sticky.top) }
    window.scrollTo({ top: 0, behavior: 'instant' })
    body.style.minHeight = previousMinHeight
    return measured
  })
  assert.equal(result.position, 'sticky')
  assert.ok(Math.abs(result.top - result.offset) <= 1, `Navigation bar should stay at its top offset while scrolling (top=${result.top}, offset=${result.offset}).`)
}

async function audit(name, theme, { screenshot = true, focus = true } = {}) {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }) })
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.constructor.name === 'CSSTransition').map(animation => animation.finished.catch(() => {}))) })
    const result = await page.evaluate(() => {
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true }); canvas.width = canvas.height = 1
      function rgba(color) { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); const value = [...ctx.getImageData(0, 0, 1, 1).data]; return [value[0], value[1], value[2], value[3] / 255] }
      function blend(top, bottom) { const alpha = top[3] + bottom[3] * (1 - top[3]); return [0, 1, 2].map(i => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha).concat(alpha) }
      function background(element) { const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.unshift(node); return ancestors.reduce((color, node) => blend(rgba(getComputedStyle(node).backgroundColor), color), [255, 255, 255, 1]) }
      function luminance(color) { return color.slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4 }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0) }
      function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
      const visible = node => node.checkVisibility() && getComputedStyle(node).opacity !== '0' && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0
      const text = [], controls = [], placeholders = []
      for (const node of document.querySelectorAll('h1,h2,h3,h4,p,label,legend,th,td,button,a,small,dt,dd,strong,span,input,textarea,select')) {
        if (!visible(node) || node.closest(':disabled,[aria-disabled="true"],.auth-visual,svg')) continue
        const ownText = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent.trim()).join(' ')
        if (!ownText && !node.matches('input,textarea,select')) continue
        const style = getComputedStyle(node)
        // Photos and gradients require visual inspection; this check measures solid surfaces.
        if ([node, ...function* () { for (let p = node.parentElement; p; p = p.parentElement) yield p }()].some(parent => getComputedStyle(parent).backgroundImage !== 'none')) continue
        const bg = background(node), fg = blend(rgba(style.color), bg)
        const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700
        const minimum = large ? 3 : 4.5
        const actual = contrast(fg, bg)
        const label = ownText.slice(0, 70) || node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.tagName
        text.push({ label, ratio: +actual.toFixed(2), minimum, color: style.color, background: bg.slice(0, 3).map(Math.round), tag: node.tagName })
        if (node.matches('input[placeholder],textarea[placeholder]') && node.getAttribute('placeholder')) {
          const placeholder = getComputedStyle(node, '::placeholder'), value = rgba(placeholder.color); value[3] *= Number(placeholder.opacity)
          placeholders.push({ label: node.getAttribute('placeholder'), ratio: +contrast(blend(value, bg), bg).toFixed(2) })
        }
        if (node.matches('input:not([type="checkbox"]):not([type="radio"]),textarea,select')) {
          const border = rgba(style.borderTopColor), adjacent = background(node.parentElement)
          controls.push({ label, ratio: +Math.min(contrast(blend(border, bg), bg), contrast(blend(border, adjacent), adjacent)).toFixed(2), color: style.borderTopColor })
        }
      }
      return { overflow: document.documentElement.scrollWidth > innerWidth, text, controls, placeholders }
    })
    const badText = result.text.filter(value => value.ratio + .005 < value.minimum)
    const badPlaceholders = result.placeholders.filter(value => value.ratio + .005 < 4.5)
    const badControls = result.controls.filter(value => value.ratio + .005 < 3)
    measurements.push({ name, theme, width, ...result })
    if (result.overflow || badText.length || badPlaceholders.length || badControls.length) failures.push({ name, theme, width, overflow: result.overflow, text: badText, placeholders: badPlaceholders, controls: badControls })
    if (screenshot && (width === 1440 || width === 320)) await page.screenshot({ path: new URL(`ui-${name}-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  if (focus) {
    await page.keyboard.press('Tab')
    const dialog = page.getByRole('dialog').filter({ visible: true })
    const target = (await dialog.count() ? dialog : page).locator('button:not(:disabled)').filter({ visible: true }).first()
    await target.focus()
    const ring = await target.evaluate(node => { const style = getComputedStyle(node); return { visible: node.matches(':focus-visible'), outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2, shadow: style.boxShadow !== 'none' } })
    if (!ring.visible || !(ring.outline || ring.shadow)) failures.push({ name, theme, focus: ring })
  }
}

try {
  for (const theme of ['light', 'dark']) {
    let session = await createPage(null, theme); page = session.page
    await page.getByRole('heading', { name: 'Добре дошли', exact: true }).waitFor()
    await audit('auth', theme)
    const google = page.getByRole('button', { name: 'Влез с Google', exact: true })
    if (await google.count()) { await google.hover(); await audit('auth-google-hover', theme, { screenshot: false }) }
    await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
    await audit('registration', theme)
    await session.context.close()

    session = await createPage('TEACHER', theme); page = session.page
    await page.getByRole('heading', { name: 'Моето табло', exact: true }).waitFor()
    await audit('teacher-dashboard', theme)
    const nav = page.getByRole('navigation', { name: 'Основна навигация' })
    await nav.getByRole('button', { name: 'Тестове', exact: true }).click()
    await page.getByRole('table', { name: 'Тестове', exact: true }).waitFor()
    await audit('library', theme)
    await page.getByRole('button', { name: 'Създай тест', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    await audit('creation-dialog', theme)
    await page.getByRole('button', { name: /^Ръчно/ }).click()
    await page.getByLabel('Брой въпроси', { exact: true }).waitFor()
    await audit('manual-editor', theme)
    await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
    await chooseTestCreation(page, 'ai')
    await page.getByRole('heading', { name: 'Създаване на тест с AI', exact: true }).waitFor()
    await audit('ai-editor', theme)
    await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
    for (const [tab, heading, label] of [['Групи', 'Групи', 'groups'], ['Възлагания', 'Възлагания', 'assignments'], ['Проверка', 'Проверка на опити', 'grading'], ['Профил', 'Моят профил', 'profile']]) {
      await nav.getByRole('button', { name: tab, exact: true }).click()
      await page.getByRole('heading', { name: heading, exact: true }).waitFor()
      if (tab === 'Възлагания') await verifyStickyNavigation()
      if (tab === 'Профил') await page.locator('.ws-billing-usage').waitFor()
      await audit(label, theme)
    }
    await session.context.close()

    session = await createPage('STUDENT', theme); page = session.page
    await page.getByRole('heading', { name: 'Моето табло', exact: true }).waitFor()
    await audit('student-dashboard', theme)
    await page.getByRole('navigation').getByRole('button', { name: 'Моите тестове', exact: true }).click()
    await page.getByRole('table', { name: 'Възложени тестове', exact: true }).waitFor()
    await audit('student-tests', theme)
    await page.getByRole('button', { name: 'Подготовка', exact: true }).click()
    await page.getByRole('heading', { name: 'Подготовка за изпит', exact: true }).waitFor()
    await page.getByLabel('Код за достъп', { exact: true }).fill('ABC12345')
    await audit('exam-preflight', theme)
    await page.getByRole('button', { name: 'Към тестовете', exact: true }).click()
    await page.getByRole('tab', { name: 'Резултати', exact: true }).click()
    await audit('student-results', theme)
    await page.getByRole('button', { name: 'Преглед на резултата', exact: true }).click()
    await page.getByRole('heading', { name: 'Преглед на теста', exact: true }).waitFor()
    await page.getByText('Отлично!', { exact: true }).waitFor()
    await audit('result-review', theme)
    await session.context.close()

    session = await createPage('ADMIN', theme); page = session.page
    await page.getByRole('heading', { name: 'Администрация', exact: true }).waitFor()
    await page.getByLabel('Търси потребител', { exact: true }).waitFor()
    await audit('admin', theme)
    await session.context.close()
  }
  assert.deepEqual(errors, [], 'Mocked pages must not request unexpected API endpoints or throw JavaScript errors')
  await writeFile(new URL('ui-accessibility-report.json', artifacts), JSON.stringify({ measurements, failures, errors }, null, 2))
  assert.deepEqual(failures, [], 'UI contrast, focus or responsive checks failed; see .artifacts/ui-accessibility-report.json')
  console.log(`Passed: ${measurements.length} light/dark responsive views; measured text/placeholder and form boundary contrast, keyboard focus, and overflow. API fixtures only.`)
} catch (error) {
  await writeFile(new URL('ui-accessibility-report.json', artifacts), JSON.stringify({ measurements, failures, errors }, null, 2))
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('ui-accessibility-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally { await browser.close() }
