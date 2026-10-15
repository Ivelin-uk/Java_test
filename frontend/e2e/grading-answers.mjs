import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'grading-answers-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const student = { id: 102, name: 'Review Student', email: 'student@example.test' }
const answer = (optionIds = [], text = '') => JSON.stringify({ optionIds, text })
const options = [{ id: 'a', text: 'Имунна система', correct: true }, { id: 'b', text: 'Дихателна система', correct: false }, { id: 'c', text: 'Храносмилателна система', correct: false }]
const multiple = options.map(o => ({ ...o, correct: o.id !== 'b' }))
const question = (number, { type = 'SINGLE_CHOICE', automatic = 3, final = automatic, reviewed = final !== null, submitted = answer(['a']), draft = null, choices = options, criteria = '', imageId } = {}) => ({
  id: 600 + number, status: submitted ? 'answered' : 'timed_out', maximum_points: 3, automatic_points: automatic, final_points: final, reviewed, answer_json: submitted, draft_json: draft, teacher_comment: '', override_reason: '',
  opened_at: '2026-10-15T17:41:59Z', deadline_at: '2026-10-15T17:42:34Z', closed_at: '2026-10-15T17:42:00Z',
  definition_json: JSON.stringify({ question: { type, text: `Коя система в човешкото тяло отговаря за защита срещу патогени и болести? (${number})`, difficulty: 'MEDIUM', points: 3, timeSeconds: 35, acceptedAnswers: type === 'SHORT_ANSWER' && !criteria ? ['бял дроб'] : [], criteria, imageId }, options: choices }),
})
const questions = [
  question(1),
  question(2, { automatic: 0, submitted: answer(['b']), imageId: 501 }),
  question(3, { type: 'MULTIPLE_CHOICE', choices: multiple, submitted: answer(['a']), automatic: 0 }),
  question(4, { type: 'MULTIPLE_CHOICE', choices: multiple, submitted: answer(['a', 'c']) }),
  question(5, { type: 'MULTIPLE_CHOICE', choices: multiple, submitted: answer(['a', 'b']), automatic: 0 }),
  question(6, { type: 'TRUE_FALSE', choices: [{ id: 'a', text: 'Вярно', correct: true }, { id: 'b', text: 'Невярно', correct: false }] }),
  question(7, { submitted: null, draft: answer(['a']), automatic: 0 }),
  question(8, { submitted: answer(), automatic: 0 }),
  question(9, { type: 'SHORT_ANSWER', choices: [], submitted: answer([], '  БЯЛ ДРОБ  ') }),
  question(10, { type: 'SHORT_ANSWER', choices: [], submitted: answer([], 'сърце'), automatic: 0 }),
  question(11, { type: 'OPEN_ANSWER', choices: [], submitted: answer([], 'Отговор на ученика с дълъг текст.\n<script>window.fixtureXss = true</script>'), automatic: null, criteria: 'Коректно обяснение на функциите на системата.' }),
  question(12, { type: 'OPEN_ANSWER', choices: [], submitted: answer([], 'Частично обяснение.'), automatic: null, final: 1.5, criteria: 'Обосновка и пример.' }),
  question(13, { type: 'SHORT_ANSWER', choices: [], submitted: answer([], 'Ръчно проверен текст.'), automatic: null, final: 3, criteria: 'Ръчна проверка без предварително зададен отговор.' }),
  question(14, { type: 'OPEN_ANSWER', choices: [], submitted: answer([], '   '), automatic: null, final: 0, criteria: 'Обосновка.' }),
]
const attempt = { id: 301, assignment_id: 201, title: 'Биология: човешкото тяло', student_name: student.name, attempt_number: 1, status: 'pending_review', submitted_at: '2026-10-15T17:42:00Z' }
const errors = [], requests = []
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const imageBytes = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 640, 400)
    ctx.strokeStyle = '#23836b'; ctx.lineWidth = 6; ctx.strokeRect(200, 50, 240, 300)
    ctx.fillStyle = '#245dcc'; ctx.beginPath(); ctx.arc(320, 180, 55, 0, Math.PI * 2); ctx.fill()
    return canvas.toDataURL('image/png').split(',')[1]
  }), 'base64')
  await page.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    requests.push({ method, path })
    if (method === 'GET') {
      if (path === '/api/v1/files/501') return route.fulfill({ status: 200, contentType: 'image/png', body: imageBytes })
      const data = { '/api/auth/me': auth.user, '/api/v1/groups': [], '/api/v1/assignments': [], '/api/v1/grading': [attempt], '/api/v1/attempts/301/review': { attempt, student, questions, events: [], revisions: [] } }
      if (Object.hasOwn(data, path)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data[path]) })
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return route.fulfill({ status: 404 })
  })
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Проверка', exact: true }).click()
  await page.getByRole('button', { name: student.name, exact: true }).click()
  const card = n => page.getByRole('article', { name: `Въпрос ${n}`, exact: true })
  const verdict = n => card(n).locator('.ws-review-verdict')
  const choice = (n, text) => card(n).getByRole('listitem').filter({ has: page.getByText(text, { exact: true }) })
  await card(14).waitFor()
  assert.equal(await page.getByRole('article').count(), questions.length)
  assert.equal(await verdict(1).textContent(), 'Верен отговор')
  assert.equal(await verdict(2).textContent(), 'Грешен отговор')
  assert.equal(await choice(1, 'Имунна система').getAttribute('data-result'), 'selected-correct')
  assert.equal(await choice(2, 'Дихателна система').getAttribute('data-result'), 'selected-wrong')
  assert.equal(await choice(2, 'Имунна система').getAttribute('data-result'), 'missed')
  assert.equal(await choice(2, 'Храносмилателна система').getAttribute('data-result'), 'neutral')
  assert.equal(await choice(2, 'Дихателна система').getByText('Избран от ученика · грешен', { exact: true }).count(), 1)
  assert.equal(await verdict(3).textContent(), 'Грешен отговор')
  assert.equal(await choice(3, 'Имунна система').getAttribute('data-result'), 'selected-correct')
  assert.equal(await choice(3, 'Храносмилателна система').getAttribute('data-result'), 'missed')
  assert.equal(await verdict(4).textContent(), 'Верен отговор')
  assert.equal(await card(4).locator('[data-selected="true"]').count(), 2)
  assert.equal(await card(5).locator('.ws-review-choice-selected-correct').count(), 1)
  assert.equal(await card(5).locator('.ws-review-choice-selected-wrong').count(), 1)
  assert.equal(await card(5).locator('.ws-review-choice-missed').count(), 1)
  assert.equal(await verdict(6).textContent(), 'Верен отговор')
  assert.equal(await verdict(7).textContent(), 'Без отговор')
  assert.equal(await card(7).locator('[data-selected="true"]').count(), 0)
  await card(7).getByText('Запазена чернова', { exact: true }).click()
  assert.equal(await card(7).getByText('Няма окончателен отговор.', { exact: true }).isVisible(), true)
  assert.equal(await card(7).locator('[data-selected="true"]').count(), 0)
  assert.equal(await card(8).getByText('Предаден е празен отговор.', { exact: true }).isVisible(), true)
  assert.equal(await verdict(9).textContent(), 'Верен отговор')
  assert.equal(await verdict(10).textContent(), 'Грешен отговор')
  assert.equal(await verdict(11).textContent(), 'За ръчна проверка')
  assert.equal(await card(11).locator('.ws-review-text-answer').textContent(), 'Отговор на ученика с дълъг текст.\n<script>window.fixtureXss = true</script>')
  assert.equal(await card(11).locator('script').count(), 0)
  assert.equal(await page.evaluate(() => window.fixtureXss), undefined)
  assert.equal(await verdict(12).textContent(), 'Частични точки')
  assert.equal(await verdict(13).textContent(), 'Пълни точки')
  assert.equal(await verdict(14).textContent(), 'Без отговор')
  const picture = card(2).getByRole('img', { name: 'Изображение към въпроса', exact: true })
  await picture.waitFor()
  assert.equal(await picture.evaluate(img => img.complete && img.naturalWidth === 640), true)
  for (const { theme, width, height } of [{ theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 1440, height: 1000 }, { theme: 'light', width: 390, height: 844 }, { theme: 'dark', width: 320, height: 844 }]) {
    await page.setViewportSize({ width, height })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.locator('.ws-review-question').evaluateAll(cards => cards.every((element, i) => {
      const bounds = element.getBoundingClientRect(), style = getComputedStyle(element)
      return bounds.left >= 0 && bounds.right <= innerWidth && style.borderTopStyle === 'solid' && style.borderRadius === '8px' && element.scrollWidth <= element.clientWidth && (!i || bounds.top >= cards[i - 1].getBoundingClientRect().bottom + 16)
    })), true)
    for (const [number, text, variable] of [[1, 'Имунна система', '--success-bg'], [2, 'Дихателна система', '--danger-bg'], [2, 'Имунна система', '--warning-bg']]) {
      assert.equal(await choice(number, text).evaluate((element, variable) => {
        const sample = document.createElement('span'); sample.style.backgroundColor = `var(${variable})`; document.body.append(sample)
        const matches = getComputedStyle(element).backgroundColor === getComputedStyle(sample).backgroundColor
        sample.remove(); return matches
      }, variable), true)
    }
    assert.equal(await page.locator('.ws-review-choice').evaluateAll(rows => rows.every(row => [...row.querySelectorAll('span')].every(span => {
      const bounds = span.getBoundingClientRect(), parent = row.getBoundingClientRect()
      return bounds.left >= parent.left && bounds.right <= parent.right && bounds.bottom <= parent.bottom
    }))), true)
    await card(2).screenshot({ path: new URL(`grading-answers-${theme}-${width}.png`, artifacts).pathname })
    await card(3).screenshot({ path: new URL(`grading-multiple-${theme}-${width}.png`, artifacts).pathname })
  }
  assert.equal(requests.every(request => request.method === 'GET'), true)
  assert.deepEqual(errors, [])
  console.log('Passed: separated numbered question containers, selected correct/wrong/missed options, multiple-choice combinations, true/false, unsubmitted drafts and empty answers, authoritative short-answer scores, pending/partial/manual grading, escaped text, image rendering, distinct state colors and desktop/mobile layout in both themes. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('grading-answers-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally { await browser.close() }
