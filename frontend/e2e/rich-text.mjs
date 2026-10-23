import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const prefix = '<!--examai-rich-text:v1-->'
const teacher = { token: 'rich-teacher-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true } }
const student = { token: 'rich-student-fixture', user: { id: 102, name: 'Student', email: 'student@example.test', role: 'STUDENT', active: true } }
const question = text => ({ type: 'SINGLE_CHOICE', text, difficulty: 'MEDIUM', points: 1, timeSeconds: 180, options: [{ text: '3', correct: true }, { text: '9', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: '' })
const definition = text => ({ title: 'Форматиран тест', subject: 'Математика', description: '', instructions: '', level: '', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, questions: [question(text)] })
const rows = new Map()
const row = (id, value) => ({ id, owner_id: teacher.user.id, title: value.title, question_count: value.questions.length, total_time_seconds: 180, status: 'published', updated_at: new Date().toISOString(), definition_json: JSON.stringify(value) })
rows.set(201, row(201, { ...definition('x < 3 и <strong>буквален текст</strong>'), title: 'Стар въпрос' }))
const attack = `${prefix}<p style="position:fixed;text-align:center;background:url(https://invalid.test/a)"><strong>Безопасен въпрос</strong><img src="x" onerror="window.richXss=true"><script>window.richXss=true</script><a href="javascript:alert(1)">текст</a><span data-type="inline-math" data-latex="\\href{javascript:alert(1)}{x}"></span></p><svg onload="window.richXss=true"></svg>`
rows.set(202, row(202, { ...definition(attack), title: 'Безопасно показване' }))
const assignment = { id: 301, title: 'Форматиран тест', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), max_attempts: 2, canceled: false }
const attempt = { id: 401, assignment_id: 301, title: assignment.title, student_name: student.user.name, attempt_number: 1, status: 'finalized', submitted_at: new Date().toISOString() }
const result = { review_available: true, id: 701, attempt_id: 401, assignment_id: 301, attempt_number: 1, title: assignment.title, revision_number: 1, points: 1, maximum_points: 1, percentage: 100, grade: '6', outcome: 'passed', published_at: new Date().toISOString() }
const errors = [], mutations = [], externalRequests = []
let saved
const reviewQuestion = () => ({ id: 501, status: 'answered', maximum_points: 1, automatic_points: 1, final_points: 1, reviewed: true, answer_json: JSON.stringify({ optionIds: ['a'], text: '' }), definition_json: JSON.stringify({ question: saved.questions[0], options: [{ id: 'a', text: '3', correct: true }, { id: 'b', text: '9', correct: false }] }) })
const examState = () => ({ id: 401, assignment_id: 301, status: 'in_progress', question_number: 1, question_count: 1, server_now: new Date().toISOString(), question: { ...saved.questions[0], id: 501, status: 'open', maximum_points: 1, time_seconds: 180, open_instance: 'rich-instance', deadline_at: new Date(Date.now() + 180000).toISOString(), options: [{ id: 'a', text: '3' }, { id: 'b', text: '9' }] } })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page

async function session(auth) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  const current = await context.newPage()
  current.on('pageerror', error => errors.push(error.message))
  current.on('request', request => { if (!request.url().startsWith(frontend) && !request.url().startsWith(base) && !request.url().startsWith('data:')) externalRequests.push(request.url()) })
  await current.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      const data = { '/api/auth/me': auth.user, '/api/v1/groups': [], '/api/v1/assignments': [assignment], '/api/v1/grading': saved ? [attempt] : [], '/api/v1/attempts': [attempt], '/api/v1/results': [result], '/api/v1/tests': [...rows.values()], '/api/v1/assignments/301/preflight': { ...assignment, total_seconds: 180, question_count: 1, instructions: '', fullscreen_exempt: true } }
      if (Object.hasOwn(data, path)) return respond(data[path])
      if (/^\/api\/v1\/tests\/\d+$/.test(path)) return respond(rows.get(Number(path.split('/').at(-1))))
      if (path === '/api/v1/attempts/401/review') return respond({ attempt, student: student.user, questions: [reviewQuestion()], events: [], revisions: [] })
      if (path === '/api/v1/results/401') return respond({ ...result, details: { correctAnswersVisible: true, questions: [reviewQuestion()], gradeOverridden: false, outcomeOverridden: false } })
      if (path === '/api/v1/attempts/401/state') return respond(examState())
    }
    if (method !== 'GET') mutations.push({ path, method, data: request.postDataJSON() })
    if (method === 'POST' && path === '/api/v1/tests') {
      saved = request.postDataJSON(); rows.set(203, row(203, saved)); return respond(rows.get(203))
    }
    if (method === 'PUT' && path === '/api/v1/tests/203') { saved = request.postDataJSON(); rows.set(203, row(203, saved)); return respond(rows.get(203)) }
    if (method === 'POST' && path === '/api/v1/tests/203/publish') return respond({ id: 601 })
    if (method === 'POST' && path === '/api/v1/ai/test-generations') return respond({ id: 801, status: 'failed', error_message: 'Fixture: generation intentionally stopped.' })
    if (method === 'POST' && path === '/api/v1/assignments/301/attempts') return respond(examState())
    if (method === 'POST' && path === '/api/v1/attempts/401/events') return respond(examState())
    errors.push(`Unexpected API: ${method} ${path}`)
    return route.fulfill({ status: 404 })
  })
  return { context, page: current }
}

try {
  const author = await session(teacher)
  page = author.page
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: rows.get(201).title, exact: true }).click()
  const preview = page.getByRole('region', { name: 'Избран тест' })
  await preview.getByText('x < 3 и <strong>буквален текст</strong>', { exact: true }).waitFor()
  assert.equal(await preview.locator('strong').count(), 0)
  await page.getByRole('button', { name: 'Безопасно показване', exact: true }).click()
  await preview.getByText('Безопасен въпрос', { exact: true }).waitFor()
  assert.equal(await preview.locator('.question-text').locator('script, img, a, svg, [onerror], [onload]').count(), 0)
  assert.equal(await page.evaluate(() => window.richXss), undefined)
  assert.equal(await preview.locator('.question-text > p').evaluate(element => element.style.cssText), 'text-align: center;')

  await page.getByRole('button', { name: 'Ръчен тест', exact: true }).click()
  await page.getByLabel('Тема', { exact: true }).fill('Форматиран тест')
  const prompt = page.getByRole('textbox', { name: 'Текст', exact: true })
  await prompt.fill('x2')
  await prompt.press('End')
  await prompt.press('Shift+ArrowLeft')
  await page.getByRole('button', { name: 'Горен индекс / степен', exact: true }).click()
  assert.equal(await prompt.locator('sup').innerText(), '2')
  await prompt.press('ControlOrMeta+A')
  for (const label of ['Удебелен (Ctrl+B)', 'Курсив (Ctrl+I)', 'Подчертан (Ctrl+U)']) await page.getByRole('button', { name: label, exact: true }).click()
  assert.equal(await prompt.locator('strong').count() > 0, true)
  assert.equal(await prompt.locator('em').count() > 0, true)
  assert.equal(await prompt.locator('u').count() > 0, true)
  await prompt.press('ArrowRight')
  await page.getByRole('button', { name: 'Формула', exact: true }).click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: 'Корен', exact: true }).click()
  await page.keyboard.type('9')
  await modal.getByText('LaTeX код', { exact: true }).click()
  assert.match(await modal.getByLabel('Код на формулата', { exact: true }).inputValue(), /\\sqrt(?:\{9\}|9)/)
  await modal.getByRole('button', { name: 'Добави формулата', exact: true }).click()
  await prompt.locator('.katex').waitFor()
  await prompt.locator('[data-type="inline-math"]').click()
  await modal.getByText('LaTeX код', { exact: true }).click()
  await modal.getByLabel('Код на формулата', { exact: true }).fill('\\sqrt{9} + \\frac{x^{2}}{2}')
  await modal.getByRole('button', { name: 'Запази формулата', exact: true }).click()
  await modal.waitFor({ state: 'detached' })
  assert.equal(await prompt.locator('[data-type="inline-math"]').getAttribute('data-latex'), '\\sqrt{9} + \\frac{x^{2}}{2}')
  await page.getByLabel('Опция 1', { exact: true }).fill('3')
  await page.getByLabel('Опция 2', { exact: true }).fill('9')
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  assert.equal(saved.questions[0].text.startsWith(prefix), true)
  assert.match(saved.questions[0].text, /<sup>2<\/sup>/)
  assert.match(saved.questions[0].text, /data-latex/)

  await page.reload()
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: 'Форматиран тест', exact: true }).click()
  await preview.locator('.katex').waitFor()
  assert.equal(await preview.locator('sup').innerText(), '2')
  await preview.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  await prompt.locator('.katex').waitFor()
  const beforeCancel = saved.questions[0].text
  await page.getByRole('button', { name: 'Формула', exact: true }).click()
  await modal.getByRole('button', { name: 'Отказ', exact: true }).click()
  assert.equal(await prompt.locator('[data-type="inline-math"]').count(), 1)
  await prompt.fill('')
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Условието на въпрос 1 е празно' }).first().waitFor()
  assert.equal(saved.questions[0].text, beforeCancel)
  await page.getByRole('button', { name: 'Отмени', exact: true }).click()
  await prompt.locator('.katex').waitFor()

  for (const [theme, width] of [['light', 1440], ['dark', 390], ['light', 320]]) {
    await page.setViewportSize({ width, height: 1000 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.locator('.ws-question').screenshot({ path: new URL(`rich-text-${theme}-${width}.png`, artifacts).pathname })
    await page.getByRole('button', { name: 'Формула', exact: true }).click()
    await modal.getByRole('button', { name: 'Още символи и гръцки букви', exact: true }).click()
    assert.equal(await modal.evaluate(element => element.scrollWidth <= element.clientWidth), true)
    await modal.screenshot({ path: new URL(`formula-${theme}-${width}.png`, artifacts).pathname })
    await page.keyboard.press('Escape')
    await modal.waitFor({ state: 'detached' })
  }
  await page.getByRole('button', { name: 'Добави с AI', exact: true }).click()
  await page.getByRole('form', { name: 'Добавяне на въпроси с AI', exact: true }).getByRole('button', { name: 'Генерирай', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Fixture: generation intentionally stopped.' }).first().waitFor()
  const aiContext = mutations.find(request => request.path === '/api/v1/ai/test-generations').data.sourceText
  assert.equal(aiContext.includes(prefix), false)
  assert.equal(aiContext.includes('<strong>'), false)
  assert.equal(aiContext.includes('x^{2}'), true)
  assert.equal(aiContext.includes('\\sqrt{9}'), true)
  await page.getByRole('button', { name: 'Затвори AI настройките', exact: true }).click()
  await prompt.focus()
  await prompt.press('ControlOrMeta+A')
  await prompt.evaluate(element => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/html', '<p class="MsoNormal"><b>Текст от Word</b> и <i>курсив</i><sup>2</sup><img src="https://invalid.test/paste" onerror="window.richXss=true"><script>window.richXss=true</script></p>')
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })
  await prompt.getByText('Текст от Word', { exact: true }).waitFor()
  assert.equal(await prompt.locator('strong').innerText(), 'Текст от Word')
  assert.equal(await prompt.locator('img, script, [onerror]').count(), 0)
  assert.equal(await page.evaluate(() => window.richXss), undefined)
  await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await page.getByRole('button', { name: 'Проверка', exact: true }).click()
  await page.getByRole('button', { name: student.user.name, exact: true }).click()
  await page.locator('.ws-review-question .katex').waitFor()
  assert.equal(await page.locator('.ws-review-question sup').innerText(), '2')
  await author.context.close()

  const learner = await session(student)
  page = learner.page
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Моите тестове', exact: true }).click()
  await page.getByRole('button', { name: 'Преглед на резултата', exact: true }).click()
  await page.getByRole('region', { name: 'Преглед на теста', exact: true }).locator('.katex').waitFor()
  await page.getByRole('button', { name: 'Към моите тестове', exact: true }).click()
  await page.getByRole('button', { name: 'Подготовка', exact: true }).click()
  await page.getByLabel('Код за достъп', { exact: true }).fill('ABCDEFGH')
  await page.getByRole('button', { name: 'Започни на цял екран', exact: true }).click()
  await page.locator('.exam-question .katex').waitFor()
  assert.equal(await page.locator('.exam-question sup').innerText(), '2')
  assert.equal(await page.locator('.exam-question .question-text').textContent().then(value => value.includes(prefix)), false)
  await learner.context.close()
  assert.deepEqual(errors, [])
  assert.deepEqual(externalRequests, [])
  console.log('Passed: plain-text compatibility, formatting and indices, visual roots and editable fractions, save/publish/reload, empty validation and undo, modal cancellation, desktop/mobile themes and keyboard, XSS sanitization and Word paste, readable AI context with exponents, teacher review, learner results and exam rendering. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('rich-text-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  await browser.close()
}
