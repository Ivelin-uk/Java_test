import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const student = { token: 'matching-student-fixture', user: { id: 105, name: 'Ученик', email: 'matching@example.test', role: 'STUDENT', active: true, passwordChangeRequired: false } }
const teacher = { token: 'matching-teacher-fixture', user: { ...student.user, id: 106, name: 'Учител', role: 'TEACHER' } }
const assignment = { id: 305, title: 'Свързване на столици', starts_at: new Date(Date.now() - 60000).toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), max_attempts: 2, canceled: false }
const left = [{ id: 'left-bg', text: 'България' }, { id: 'left-fr', text: 'Франция' }, { id: 'left-de', text: 'Германия' }]
const right = [{ id: 'right-de', text: 'Берлин' }, { id: 'right-bg', text: 'София' }, { id: 'right-fr', text: 'Париж' }]
const solution = [{ leftId: 'left-bg', rightId: 'right-bg' }, { leftId: 'left-fr', rightId: 'right-fr' }, { leftId: 'left-de', rightId: 'right-de' }]
const wrongAnswer = { optionIds: [], text: '', matches: [{ leftId: 'left-bg', rightId: 'right-fr' }, { leftId: 'left-fr', rightId: 'right-bg' }] }
const question = { type: 'MATCHING', text: 'Свържи държавите с техните столици.', options: [], acceptedAnswers: [], criteria: '', explanation: 'Столицата на България е София.', difficulty: 'MEDIUM', points: 3, timeSeconds: 180, matchingPairs: [{ left: 'България', right: 'София' }, { left: 'Франция', right: 'Париж' }, { left: 'Германия', right: 'Берлин' }] }
const reviewRow = { id: 505, status: 'answered', maximum_points: 3, automatic_points: 0, final_points: 0, reviewed: true, answer_json: JSON.stringify(wrongAnswer), draft_json: JSON.stringify(wrongAnswer), teacher_comment: null, override_reason: null, opened_at: null, deadline_at: null, closed_at: null, definition_json: JSON.stringify({ question, options: [], matchingLeft: left, matchingRight: right, matchingSolution: solution }) }
const result = { id: 4050, attempt_id: 405, assignment_id: assignment.id, title: assignment.title, attempt_number: 1, revision_number: 1, points: 0, maximum_points: 3, percentage: 0, grade: '2', outcome: 'failed', review_available: true }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const errors = []

try {
  for (const scenario of [{ width: 1280, theme: 'light' }, { width: 320, theme: 'dark' }]) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: 960 }, colorScheme: scenario.theme })
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem('quicktest.auth', JSON.stringify(auth)); localStorage.setItem('quicktest.theme', theme) }, { auth: student, theme: scenario.theme })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    let started = false, current = 0, status = 'in_progress', draft = null, released = false
    const drafts = [], answers = []
    function state() {
      return { id: 405, assignment_id: assignment.id, status, server_now: new Date().toISOString(), question_number: current + 1, question_count: 2, question: status === 'in_progress' ? { id: current === 0 ? 505 : 506, type: 'MATCHING', text: current === 0 ? question.text : 'Свържи блокчетата от втория въпрос.', options: [], matchingLeft: left, matchingRight: right, maximum_points: 3, time_seconds: 180, status: 'open', open_instance: `matching-${current}`, opened_at: new Date().toISOString(), deadline_at: new Date(Date.now() + 180000).toISOString(), draft } : null }
    }
    // All API traffic is mocked, including writes and intentionally overcomplete review payloads.
    await context.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      if (!path.startsWith('/api/')) return route.continue()
      const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (method === 'GET') {
        const data = {
          '/api/auth/me': student.user, '/api/v1/groups': [], '/api/v1/assignments': [assignment], '/api/v1/results': [result],
          '/api/v1/attempts': started ? [{ id: 405, assignment_id: assignment.id, title: assignment.title, attempt_number: 1, status, submitted_at: null }] : [],
          [`/api/v1/assignments/${assignment.id}/preflight`]: { ...assignment, total_seconds: 360, question_count: 2, instructions: '', fullscreen_exempt: true },
          '/api/v1/attempts/405/state': state(),
          '/api/v1/results/405': { ...result, details: { questions: [reviewRow], gradeOverridden: false, outcomeOverridden: false, correctAnswersVisible: released } },
        }
        if (Object.hasOwn(data, path)) return respond(data[path])
      }
      if (method === 'POST' && path === `/api/v1/assignments/${assignment.id}/attempts`) { started = true; return respond(state()) }
      if (method === 'PUT' && /\/attempts\/405\/questions\/\d+\/draft$/.test(path)) { draft = request.postDataJSON().answer; drafts.push(draft); return respond(state()) }
      if (method === 'POST' && /\/attempts\/405\/questions\/\d+\/answer$/.test(path)) {
        const body = request.postDataJSON()
        assert.equal(body.openInstance, `matching-${current}`)
        answers.push(body.answer); current++; draft = null
        if (current === 2) status = 'pending_review'
        return respond(state())
      }
      if (method === 'POST' && path === '/api/v1/attempts/405/events') return respond(state())
      errors.push(`Unexpected API: ${method} ${path}`)
      return route.fulfill({ status: 404 })
    })
    try {
      await page.goto(frontend)
      await page.getByRole('navigation', { name: 'Основна навигация' }).getByRole('button', { name: 'Моите тестове', exact: true }).click()
      await page.getByRole('button', { name: 'Подготовка', exact: true }).click()
      await page.getByLabel('Код за достъп', { exact: true }).fill('ABCDEFGH')
      await page.getByRole('button', { name: 'Започни теста', exact: true }).click()
      const block = (side, text) => page.getByRole('button', { name: new RegExp(`^${side} блокче: ${text}(?:\\.|$)`) })
      const connect = async (from, to) => { await block('Ляво', from).click(); await block('Дясно', to).click() }
      await page.getByRole('heading', { name: question.text, exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: /блокче:/ }).count(), 6)
      await block('Ляво', 'България').focus(); await page.keyboard.press('Enter')
      assert.equal(await block('Ляво', 'България').getAttribute('aria-pressed'), 'true')
      await block('Дясно', 'София').focus(); await page.keyboard.press('Space')
      await connect('Франция', 'Париж')
      // Reusing a right block removes its previous link, maintaining a one-to-one answer.
      await connect('Германия', 'Париж')
      assert.equal(await page.getByRole('button', { name: 'Премахни връзка 2', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Премахни връзка 3', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('.matching-progress')?.textContent.startsWith('Свързани двойки: 1 / 3'))
      await page.waitForTimeout(500)
      assert.deepEqual(drafts.at(-1), { optionIds: [], text: '', matches: [solution[0]] })
      assert.equal(await page.locator('.matching-lines path').count(), 1)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: new URL(`matching-exam-${scenario.theme}-${scenario.width}.png`, artifacts).pathname, fullPage: true })
      // A reload resumes the same protected session and restores its saved partial matching answer.
      await page.reload()
      await page.getByRole('button', { name: 'Продължи', exact: true }).click()
      await page.getByRole('heading', { name: question.text, exact: true }).waitFor()
      await page.getByRole('button', { name: 'Премахни връзка 1', exact: true }).waitFor()
      await connect('Франция', 'Париж'); await connect('Германия', 'Берлин')
      await page.getByRole('button', { name: 'Потвърди отговора', exact: true }).click()
      await page.getByRole('heading', { name: 'Свържи блокчетата от втория въпрос.', exact: true }).waitFor()
      assert.deepEqual(answers[0], { optionIds: [], text: '', matches: solution })
      assert.equal(await page.getByRole('button', { name: /^Премахни връзка/ }).count(), 0)
      assert.equal(await page.locator('.matching-lines path').count(), 0)
      await page.getByRole('button', { name: 'Потвърди отговора', exact: true }).click()
      assert.deepEqual(answers[1], { optionIds: [], text: '' })

      await page.goto(`${frontend}/results/405`)
      const article = page.getByRole('article', { name: 'Въпрос 1', exact: true })
      await article.getByRole('heading', { name: 'Твоят отговор', exact: true }).waitFor()
      assert.equal(await article.locator('.matching-answer-list > li').count(), 3)
      assert.equal(await article.getByRole('heading', { name: 'Верен отговор / критерии', exact: true }).count(), 0)
      assert.equal(await article.getByText(question.explanation, { exact: true }).count(), 0)
      assert.equal(await article.locator('.matching-answer-list .is-correct, .matching-answer-list .is-incorrect').count(), 0)
      released = true
      await page.reload()
      await article.getByRole('heading', { name: 'Верен отговор / критерии', exact: true }).waitFor()
      assert.equal(await article.locator('.result-review-student-answer .matching-answer-list > li.is-incorrect').count(), 3)
      const correct = article.getByRole('region', { name: 'Верен отговор за въпрос 1', exact: true })
      assert.equal(await correct.locator('.matching-answer-list > li').count(), 3)
      await article.getByText(question.explanation, { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: new URL(`matching-result-${scenario.theme}-${scenario.width}.png`, artifacts).pathname, fullPage: true })
    } catch (error) {
      await page.screenshot({ path: new URL(`matching-exam-failure-${scenario.width}.png`, artifacts).pathname, fullPage: true })
      throw error
    } finally { await context.close() }
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } })
  await context.addInitScript(auth => localStorage.setItem('quicktest.auth', JSON.stringify(auth)), teacher)
  const page = await context.newPage()
    page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    if (!path.startsWith('/api/')) return route.continue()
      const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      const attempt = { id: 405, assignment_id: assignment.id, title: assignment.title, attempt_number: 1, student_name: student.user.name, status: 'pending_review', submitted_at: new Date().toISOString() }
      const data = { '/api/auth/me': teacher.user, '/api/v1/groups': [], '/api/v1/assignments': [], '/api/v1/grading': [attempt], '/api/v1/attempts/405/review': { attempt, student: student.user, questions: [reviewRow], events: [], revisions: [] } }
      if (Object.hasOwn(data, path)) return respond(data[path])
    }
    errors.push(`Unexpected teacher API: ${method} ${path}`)
    return route.fulfill({ status: 404 })
  })
  try {
    await page.goto(frontend)
    await page.getByRole('navigation', { name: 'Основна навигация' }).getByRole('button', { name: 'Проверка', exact: true }).click()
    await page.getByRole('button', { name: 'Ръчна проверка', exact: true }).click()
    await page.getByRole('heading', { name: 'Верни връзки', exact: true }).waitFor()
    assert.equal(await page.locator('.ws-review-answer .matching-answer-list > li.is-incorrect').count(), 3)
    await page.getByText('Запазена чернова', { exact: true }).click()
    assert.equal(await page.locator('.ws-review-details .matching-answer-list > li').count(), 3)
    assert.equal(await page.getByText('Грешен отговор', { exact: true }).count(), 1)
  } finally { await context.close() }
  assert.deepEqual(errors, [])
  console.log('Passed: matching blocks click/keyboard, one-to-one rematching/clear, SVG connections, saved partial draft recovery, submitted matches and question reset; student release gating with overcomplete payloads; teacher submitted/draft/solution display; mobile/desktop and light/dark. All API traffic mocked.')
} finally { await browser.close() }
