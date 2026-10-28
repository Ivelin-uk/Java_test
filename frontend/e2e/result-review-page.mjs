import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const auth = { token: 'result-review-fixture', user: { id: 102, name: 'Мария Иванова', email: 'review@example.test', role: 'STUDENT', active: true, passwordChangeRequired: false } }
const title = 'Основи на програмирането — преглед'
const permissionMessage = 'Учителят не е разрешил преглед на теста и отговорите за този опит.'
const deadlineMessage = 'Верните отговори ще бъдат достъпни след крайния срок на възлагането.'
const secretExplanation = 'Обяснение само след срока: конструкторът създава обекта.'
const secretAccepted = 'Ключова дума само след срока: наследяване'
const secretCriteria = 'Критерий само след срока: сравни капсулация и полиморфизъм.'
const comment = 'Коментар от учителя: посочи и конкретен пример.'
const summary = { id: 4010, attempt_id: 401, assignment_id: 201, title, attempt_number: 1, revision_number: 1, points: 6, maximum_points: 14, percentage: 42.86, grade: '3', outcome: 'failed', published_at: '2026-10-23T08:15:46Z', review_available: true }
const attempt = { id: 401, assignment_id: 201, title, attempt_number: 1, status: 'finalized', submitted_at: '2026-10-23T08:15:34Z' }
const option = (id, text, correct = false) => ({ id, text, correct })
function question(id, text, { type = 'SINGLE_CHOICE', points = 2, awarded = 0, options = [], answer = null, explanation = secretExplanation, acceptedAnswers = [], criteria = '', teacherComment = null } = {}) {
  return {
    id, status: answer === null ? 'unanswered' : 'answered', maximum_points: points, automatic_points: null, final_points: awarded, reviewed: true,
    answer_json: answer === null ? null : JSON.stringify(answer), draft_json: JSON.stringify({ optionIds: [], text: 'Скрита чернова, която не е предадена.' }),
    teacher_comment: teacherComment, override_reason: null, opened_at: null, deadline_at: null, closed_at: null,
    definition_json: JSON.stringify({ question: { type, text, difficulty: 'MEDIUM', points, timeSeconds: 60, acceptedAnswers, criteria, explanation, options: [], caseInsensitive: true, collapseWhitespace: true }, options }),
  }
}
const questions = [
  question(501, 'Коя стойност е логическа?', { options: [option('q1-a', 'Числото 42'), option('q1-b', 'Стойността true', true)], answer: { optionIds: ['q1-a'], text: '' }, teacherComment: comment }),
  question(502, 'Кой тип пази текст?', { awarded: 2, options: [option('q2-a', 'int'), option('q2-b', 'string', true)], answer: { optionIds: ['q2-b'], text: '' } }),
  question(503, 'Маркирай ключовите думи.', { type: 'MULTIPLE_CHOICE', points: 3, awarded: 1, options: [option('q3-a', 'console'), option('q3-b', 'class', true), option('q3-c', 'public', true), option('q3-d', 'пример')], answer: { optionIds: ['q3-a', 'q3-b'], text: '' } }),
  question(504, 'Назови връзка между класове.', { type: 'SHORT_ANSWER', awarded: 2, answer: { optionIds: [], text: 'Моят кратък отговор е наследяване.' }, acceptedAnswers: [secretAccepted] }),
  question(505, 'Обясни принципите на обектното програмиране.', { type: 'OPEN_ANSWER', points: 3, awarded: 1, answer: { optionIds: [], text: 'Първи ред на свободния отговор.\nВтори ред с конкретен пример.' }, criteria: secretCriteria }),
  question(506, 'Дай пример за интерфейс.', { type: 'OPEN_ANSWER', points: 1, explanation: '', criteria: 'Примерен интерфейс: Runnable.' }),
  question(507, 'Всяка променлива има тип.', { type: 'TRUE_FALSE', points: 1, options: [option('q7-a', 'Вярно', true), option('q7-b', 'Невярно')], answer: { optionIds: [], text: '' }, explanation: '' }),
]
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const errors = [], writes = []
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page

try {
  for (const viewport of [{ width: 1440, height: 1000, theme: 'dark' }, { width: 1440, height: 1000, theme: 'light' }, { width: 390, height: 844, theme: 'light' }, { width: 320, height: 844, theme: 'dark' }]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: viewport.theme })
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem('quicktest.auth', JSON.stringify(auth)); localStorage.setItem('quicktest.theme', theme) }, { auth, theme: viewport.theme })
    let permitted = true, solutionsVisible = true, missingMetadata = false, failNext = 0, holdNext = false, releaseRequest
    const requests = []
    // Every API request is fulfilled locally; fixture sessions never touch real accounts/results.
    await context.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      if (!path.startsWith('/api/')) return route.continue()
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      requests.push(`${method} ${path}`)
      if (method !== 'GET') { writes.push(`${method} ${path}`); return respond({ detail: 'Writes are forbidden in this fixture.' }, 405) }
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/v1/groups' || path === '/api/v1/assignments') return respond([])
      if (path === '/api/v1/attempts') return respond([attempt])
      if (path === '/api/v1/results') return respond([{ ...summary, ...(missingMetadata ? { points: 14, percentage: 100, grade: '6', review_available: false } : {}) }])
      if (path === '/api/v1/results/401') {
        if (holdNext) { holdNext = false; await new Promise(resolve => { releaseRequest = resolve }) }
        if (failNext) { const status = failNext; return respond({ detail: status === 403 ? 'Нямате достъп до този резултат.' : 'Резултатът временно не е достъпен. Опитайте отново.' }, status) }
        const value = { ...summary, review_available: permitted, details: { correctAnswersVisible: solutionsVisible, gradeOverridden: false, outcomeOverridden: false, questions } }
        if (missingMetadata) { delete value.title; delete value.attempt_number }
        // Deliberately retain secret solution fields even when hidden: the view must enforce its release flags too.
        return respond(value)
      }
      errors.push(`Unexpected API: ${method} ${path}`)
      return respond({ detail: 'Unexpected API' }, 404)
    })
    page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const heading = () => page.getByRole('heading', { name: 'Преглед на теста', exact: true })
    const card = number => page.getByRole('article', { name: `Въпрос ${number}`, exact: true })
    const answer = number => card(number).getByRole('heading', { name: 'Твоят отговор', exact: true })
    async function assertDedicatedPage() {
      await heading().waitFor()
      assert.equal(await page.getByRole('table', { name: 'Възложени тестове', exact: true }).count(), 0)
      assert.equal(await page.getByRole('table', { name: 'Опити и резултати', exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Към моите тестове', exact: true }).count(), 1)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    }
    async function assertReleasedAnswers() {
      await card(7).waitFor()
      assert.equal(await page.getByRole('article', { name: /^Въпрос \d+$/ }).count(), 7)
      for (let number = 1; number <= 7; number++) {
        assert.equal(await answer(number).count(), number <= 5 ? 1 : 0)
        assert.equal(await card(number).getByRole('heading', { name: 'Верен отговор / критерии', exact: true }).count(), 1)
        assert.equal(await card(number).getByRole('heading', { name: 'Обяснение', exact: true }).count(), number <= 5 ? 1 : 0)
      }
      const chosenWrong = card(1).getByRole('listitem').filter({ hasText: 'Числото 42' })
      await chosenWrong.getByText('Твоят избор', { exact: true }).waitFor()
      assert.equal(await chosenWrong.getByText('Неверен избор', { exact: true }).count(), 1)
      assert.equal(await chosenWrong.getByText('Верен отговор', { exact: true }).count(), 0)
      assert.equal(await card(1).locator('.result-review-options li.is-incorrect').filter({ hasText: 'Числото 42' }).evaluate(element => {
        const sample = document.createElement('span'); sample.style.outline = '2px solid var(--danger)'; document.body.append(sample)
        const expected = getComputedStyle(sample).outlineColor; sample.remove()
        const outline = getComputedStyle(element)
        return outline.outlineStyle === 'solid' && outline.outlineWidth === '2px' && outline.outlineColor === expected
      }), true, 'A wrong student choice must have a visible red outline')
      const missed = card(1).locator('.result-review-options li.is-correct').filter({ hasText: 'Стойността true' })
      assert.equal(await missed.getByText('Верен отговор', { exact: true }).count(), 1)
      assert.equal(await missed.getByText('Не е избран', { exact: true }).count(), 1)
      assert.equal(await missed.evaluate(element => {
        const sample = document.createElement('span'); sample.style.outline = '2px solid var(--success)'; document.body.append(sample)
        const expected = getComputedStyle(sample).outlineColor; sample.remove()
        const outline = getComputedStyle(element)
        return outline.outlineStyle === 'solid' && outline.outlineWidth === '2px' && outline.outlineColor === expected
      }), true, 'A correct answer must have a visible green outline')
      const chosenCorrect = card(2).locator('.result-review-options li.is-correct').filter({ hasText: 'string' })
      assert.equal(await chosenCorrect.getByText('Твоят избор', { exact: true }).count(), 1)
      assert.equal(await chosenCorrect.getByText('Верен отговор', { exact: true }).count(), 1)
      assert.equal(await chosenCorrect.evaluate(element => {
        const sample = document.createElement('span'); sample.style.outline = '2px solid var(--success)'; document.body.append(sample)
        const expected = getComputedStyle(sample).outlineColor; sample.remove()
        const outline = getComputedStyle(element)
        return outline.outlineStyle === 'solid' && outline.outlineWidth === '2px' && outline.outlineColor === expected
      }), true, 'A correct student choice must have a visible green outline')
      for (const [number, token] of [[1, '--danger'], [2, '--success']]) {
        const studentAnswer = card(number).locator('.result-review-student-answer')
        assert.equal(await studentAnswer.evaluate((element, token) => {
          const sample = document.createElement('span'); sample.style.color = `var(${token})`; document.body.append(sample)
          const expected = getComputedStyle(sample).color; sample.remove()
          return getComputedStyle(element).borderTopColor === expected
            && getComputedStyle(element.querySelector('li')).color === expected
        }, token), true, 'The submitted answer must use its correct/incorrect color too')
      }
      assert.equal(await card(3).getByText('Твоят избор', { exact: true }).count(), 2)
      assert.equal(await card(3).locator('.result-review-selected-answers > li.is-correct').filter({ hasText: 'class' }).count(), 1)
      assert.equal(await card(3).locator('.result-review-selected-answers > li.is-incorrect').filter({ hasText: 'console' }).count(), 1)
      assert.equal(await card(3).getByRole('listitem').filter({ hasText: 'public' }).getByText('Не е избран', { exact: true }).count(), 1)
      await card(3).getByText('Частични точки', { exact: true }).waitFor()
      await card(3).getByText('1 / 3 точки', { exact: true }).waitFor()
      await card(2).getByText('Пълен брой точки', { exact: true }).waitFor()
      await card(1).getByText('Без точки', { exact: true }).waitFor()
      await card(4).getByText('Моят кратък отговор е наследяване.', { exact: true }).waitFor()
      await card(4).getByText(secretAccepted, { exact: true }).waitFor()
      await card(5).getByText('Първи ред на свободния отговор.\nВтори ред с конкретен пример.', { exact: true }).waitFor()
      await card(5).getByText(secretCriteria, { exact: true }).waitFor()
      for (const number of [6, 7]) {
        await card(number).getByText('Без предаден отговор', { exact: true }).waitFor()
        assert.equal(await card(number).locator('.result-review-options, .result-review-student-answer, .result-review-explanation').count(), 0, 'An unanswered question must show only the correct answer')
        assert.equal(await card(number).locator('.result-review-answer').count(), 1)
        assert.equal(await card(number).getByText('Няма предаден отговор', { exact: true }).count(), 0)
        assert.equal(await card(number).getByText('Празен отговор', { exact: true }).count(), 0)
      }
      await card(6).getByText('Примерен интерфейс: Runnable.', { exact: true }).waitFor()
      await card(7).getByRole('listitem').getByText('Вярно', { exact: true }).waitFor()
      assert.equal(await card(7).getByText('Невярно', { exact: true }).count(), 0)
      await card(1).getByText(comment, { exact: true }).waitFor()
      assert.equal(await page.getByText('Скрита чернова, която не е предадена.', { exact: true }).count(), 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    }
    try {
      await page.goto(frontend)
      await page.getByRole('navigation', { name: 'Основна навигация', exact: true }).getByRole('button', { name: 'Моите тестове', exact: true }).click()
      await page.getByRole('tab', { name: 'Резултати', exact: true }).click()
      const table = page.getByRole('table', { name: 'Опити и резултати', exact: true })
      await table.getByRole('button', { name: 'Преглед на резултата', exact: true }).click()
      await page.waitForURL(`${frontend}/results/401`)
      await assertDedicatedPage()
      await assertReleasedAnswers()
      await page.screenshot({ path: new URL(`result-review-${viewport.theme}-${viewport.width}.png`, artifacts).pathname, fullPage: true })
      await card(1).screenshot({ path: new URL(`result-review-question-${viewport.theme}-${viewport.width}.png`, artifacts).pathname })
      await card(2).screenshot({ path: new URL(`result-review-correct-${viewport.theme}-${viewport.width}.png`, artifacts).pathname })
      await card(7).screenshot({ path: new URL(`result-review-unanswered-${viewport.theme}-${viewport.width}.png`, artifacts).pathname })

      await page.getByRole('button', { name: 'Към моите тестове', exact: true }).click()
      await table.waitFor()
      assert.equal(new URL(page.url()).pathname, '/')
      assert.equal(await heading().count(), 0)
      await page.goBack()
      await page.waitForURL(`${frontend}/results/401`)
      await assertReleasedAnswers()
      await page.goForward()
      await table.waitFor()
      await table.getByRole('button', { name: 'Преглед на резултата', exact: true }).click()
      await assertReleasedAnswers()

      requests.length = 0
      await page.reload()
      await assertReleasedAnswers()
      assert(requests.includes('GET /api/v1/results/401'))
      assert(requests.every(request => request === 'GET /api/auth/me' || request === 'GET /api/v1/results/401'), `Deep link fetched unrelated list data: ${requests.join(', ')}`)
      await assertDedicatedPage()

      solutionsVisible = false
      await page.reload()
      await card(7).waitFor()
      await page.getByText(deadlineMessage, { exact: true }).waitFor()
      for (const value of [secretExplanation, secretAccepted, secretCriteria]) assert.equal(await page.getByText(value, { exact: true }).count(), 0)
      for (const name of ['Верен отговор / критерии', 'Обяснение']) assert.equal(await page.getByRole('heading', { name, exact: true }).count(), 0)
      for (const marker of ['Верен отговор', 'Неверен избор', 'Не е избран']) assert.equal(await page.getByText(marker, { exact: true }).count(), 0)
      assert.equal(await card(3).getByText('Твоят избор', { exact: true }).count(), 2)
      await card(5).getByText('Първи ред на свободния отговор.\nВтори ред с конкретен пример.', { exact: true }).waitFor()
      assert.equal(await card(1).getByText(comment, { exact: true }).count(), 0)
      assert.equal(await page.locator('.result-review-options .is-correct, .result-review-options .is-incorrect').count(), 0)
      assert.equal(await page.locator('.result-review-student-answer.is-full, .result-review-student-answer.is-zero, .result-review-student-answer.is-partial, .result-review-selected-answers .is-correct, .result-review-selected-answers .is-incorrect').count(), 0)
      await card(6).getByText('Няма предаден отговор', { exact: true }).waitFor()
      await card(7).getByText('Празен отговор', { exact: true }).waitFor()
      assert.equal(await card(7).getByRole('region', { name: 'Възможни отговори за въпрос 7', exact: true }).count(), 1)
      assert.equal(await card(6).getByText('Примерен интерфейс: Runnable.', { exact: true }).count(), 0)
      await assertDedicatedPage()
      await page.screenshot({ path: new URL(`result-review-before-deadline-${viewport.theme}-${viewport.width}.png`, artifacts).pathname, fullPage: true })

      permitted = false
      solutionsVisible = true
      await page.reload()
      await page.getByText(permissionMessage, { exact: true }).waitFor()
      await assertDedicatedPage()
      assert.equal(await page.getByRole('article', { name: /^Въпрос \d+$/ }).count(), 0)
      for (const value of ['Коя стойност е логическа?', secretExplanation, secretAccepted, secretCriteria, comment]) assert.equal(await page.getByText(value, { exact: true }).count(), 0)
      assert.equal(await page.getByRole('heading', { name: 'Твоят отговор', exact: true }).count(), 0)

      permitted = true
      failNext = 503
      await page.reload()
      await page.getByRole('alert').getByText('Резултатът временно не е достъпен. Опитайте отново.', { exact: true }).waitFor()
      assert.equal(await page.getByRole('article', { name: /^Въпрос \d+$/ }).count(), 0)
      holdNext = true
      const retryRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/results/401')
      const retry = page.getByRole('button', { name: 'Опитай отново', exact: true })
      failNext = 0
      await retry.click()
      await retryRequest
      assert.equal(await retry.isDisabled(), true)
      releaseRequest()
      await assertReleasedAnswers()

      failNext = 403
      await page.reload()
      await page.getByRole('alert').getByText('Нямате достъп до този резултат.', { exact: true }).waitFor()
      assert.equal(await page.getByRole('article', { name: /^Въпрос \d+$/ }).count(), 0)
      failNext = 0
      await page.getByRole('button', { name: 'Опитай отново', exact: true }).click()
      await assertReleasedAnswers()

      missingMetadata = true
      requests.length = 0
      await page.reload()
      await page.getByText(title, { exact: true }).waitFor()
      await page.getByText('Опит 1', { exact: true }).waitFor()
      await assertReleasedAnswers()
      assert(requests.includes('GET /api/v1/results'))
      assert(!requests.includes('GET /api/v1/assignments') && !requests.includes('GET /api/v1/attempts'))
      assert.equal(await page.getByText('100.00%', { exact: true }).count(), 0)
      await page.getByText('42.86%', { exact: true }).waitFor()
    } catch (error) {
      if (!page.isClosed()) await page.screenshot({ path: new URL(`result-review-${viewport.theme}-${viewport.width}-failure.png`, artifacts).pathname, fullPage: true })
      throw error
    } finally { await context.close() }
  }
  assert.deepEqual(writes, [])
  assert.deepEqual(errors, [])
  console.log('Passed: dedicated result route, list navigation, reload/deep link, browser back/forward, released correct/incorrect choice and submitted-answer colors, mixed selections and partial points, solution-only unanswered/blank questions, short/open criteria and explanations, teacher comment, strict permission/deadline gating including overcomplete payloads, read-only fixtures, metadata fallback, API failure/retry, responsive desktop/mobile and both themes.')
} catch (error) {
  console.error('Fixture API/page errors:', errors, 'Unexpected writes:', writes)
  throw error
} finally { await browser.close() }
