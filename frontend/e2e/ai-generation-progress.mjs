import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { mockSubjectCatalog } from './helpers/subjects.mjs'
import { chooseTestCreation } from './helpers/test-creation.mjs'

// All API requests are isolated fixtures. This test never writes to a real backend.
const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'ai-progress-fixture', user: { id: 101, name: 'Progress Teacher', email: 'progress@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const question = (text, overrides = {}) => ({ type: 'SINGLE_CHOICE', text, difficulty: 'MEDIUM', points: 1, timeSeconds: 60, options: [{ text: 'Correct answer', correct: true }, { text: 'Other answer', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'Generated explanation', ...overrides })
const definition = { title: 'Progressive AI test', description: 'Generated description', subject: 'Java', level: '', instructions: 'Keep every generated question.', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, additionalInformation: 'Preserve this context.', questions: Array.from({ length: 10 }, (_, index) => question(`Generated question ${index + 1}: explain the result of this example.`, { points: index + 1, timeSeconds: 30 + index })) }
const authored = { ...definition, title: 'Authored test with a gap', level: '12', gradingScale: 'percentage', passThreshold: 70, questions: [question('Authored first question', { points: 4, timeSeconds: 75 }), question('', { points: 3, timeSeconds: 91, options: [{ text: '', correct: true }, { text: '', correct: false }], explanation: '' }), question('Authored last question', { criteria: 'Keep teacher criteria.', explanation: 'Keep teacher explanation.' })] }
const additions = [question('AI fills the empty slot'), question('AI appends a second question'), question('AI appends a third question')]
const errors = [], mutations = []
let stored = null, status = 'queued', generationPosts = 0, polls = 0
let releasePost
const postGate = new Promise(resolve => { releasePost = resolve })
const job = (id, state, generated = definition) => ({ id, status: state, result_json: state === 'completed' ? JSON.stringify({ definition: generated }) : null, error_message: state === 'failed' ? 'Generation failed; retry this request.' : null })
const row = value => ({ id: 201, owner_id: auth.user.id, title: value.title, status: 'published', shared: false, definition_json: JSON.stringify(value), question_count: value.questions.length, total_time_seconds: value.questions.reduce((total, item) => total + item.timeSeconds, 0), updated_at: new Date().toISOString() })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })
  await context.addInitScript(value => {
    localStorage.setItem('quicktest.auth', JSON.stringify(value))
    window.__aiScrollCalls = []
    const nativeScroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (options) { window.__aiScrollCalls.push(options); return nativeScroll.call(this, options) }
    const nativeWindowScroll = window.scrollTo.bind(window)
    window.scrollTo = (...args) => { window.__aiScrollCalls.push(args[0]); return nativeWindowScroll(...args) }
  }, auth)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/v1/tests') return respond(stored ? [stored] : [])
      if (path === '/api/v1/tests/201') return respond(stored)
      if (['/api/v1/groups', '/api/v1/assignments', '/api/v1/grading', '/api/v1/subjects/topics/personal'].includes(path)) return respond([])
      if (path === '/api/v1/ai/test-generations/301') { polls++; return respond(job(301, status)) }
    } else {
      mutations.push({ path, method, body: request.postData() ? request.postDataJSON() : null })
      if (method === 'POST' && path === '/api/v1/ai/test-generations') {
        generationPosts++
        if (generationPosts === 1) { await postGate; return respond(job(301, status)) }
        // A fast job may already be completed in the original POST response.
        return respond(job(302, 'completed', { ...authored, questions: additions }))
      }
      if (method === 'POST' && path === '/api/v1/ai/test-generations/301/retry') { status = 'running'; return respond(job(301, status)) }
      if (['POST', 'PUT'].includes(method) && ['/api/v1/tests', '/api/v1/tests/201'].includes(path)) { stored = row(request.postDataJSON()); return respond(stored) }
      if (method === 'POST' && path === '/api/v1/tests/201/publish') return respond({ id: 202 })
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return route.fulfill({ status: 404 })
  })
  await mockSubjectCatalog(page, frontend)
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await chooseTestCreation(page, 'ai')
  const creator = page.getByRole('region', { name: 'Създаване на тест с AI', exact: true })
  await creator.getByLabel('Дисциплина', { exact: true }).fill('Java')
  await creator.getByRole('option', { name: 'Java', exact: true }).click()
  await creator.getByLabel('Тема', { exact: true }).fill(definition.title)
  await creator.getByLabel('Въпроси', { exact: true }).fill(String(definition.questions.length))
  await creator.getByLabel('Допълнителна информация за теста', { exact: true }).fill(definition.additionalInformation)
  await creator.getByRole('button', { name: 'Генерирай', exact: true }).click()
  const progress = page.getByRole('region', { name: 'Зареждане на AI теста', exact: true })
  await progress.getByRole('status').getByText('Изпращане на AI заявката…', { exact: true }).waitFor()
  await page.waitForFunction(() => { const rect = document.querySelector('.ws-ai-progress')?.getBoundingClientRect(); return rect && rect.top >= 0 && rect.top < innerHeight && rect.bottom > 0 })
  await page.screenshot({ path: new URL('ai-progress-loading-desktop.png', artifacts).pathname })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => {
    const progress = document.querySelector('.ws-ai-progress')?.getBoundingClientRect()
    const nav = document.querySelector('.ws-nav')?.getBoundingClientRect()
    return progress && nav && progress.top >= nav.bottom + 8 && progress.bottom <= innerHeight
  })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: new URL('ai-progress-loading-mobile.png', artifacts).pathname })
  await page.setViewportSize({ width: 1280, height: 800 })
  assert.equal(await creator.getByRole('button', { name: 'Към библиотеката', exact: true }).isDisabled(), true)
  assert.equal(await page.locator('.ws-question').count(), 0)
  await creator.locator('form.ws-ai-create-form').evaluate(form => form.requestSubmit())
  assert.equal(generationPosts, 1)
  releasePost()
  await progress.getByText('AI заявката е на опашка…', { exact: true }).waitFor()
  status = 'running'
  await page.waitForFunction(() => document.querySelector('.ws-ai-progress')?.textContent.includes('AI подготвя теста'))
  assert.equal(await page.locator('.ws-question').count(), 0)
  status = 'failed'
  await page.getByRole('alert').getByText('Generation failed; retry this request.', { exact: true }).waitFor()
  await creator.getByRole('button', { name: 'Повтори', exact: true }).click()
  await progress.waitFor()
  const count = page.getByRole('progressbar', { name: 'Показани AI въпроси', exact: true })
  status = 'completed'
  await page.waitForFunction(() => document.querySelectorAll('.ws-question').length === 1)
  assert.equal(await count.evaluate(element => element.max), definition.questions.length)
  assert.equal(await count.evaluate(element => element.value), 1)
  const save = page.getByRole('button', { name: 'Запази теста', exact: true })
  assert.equal(await save.isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Към библиотеката', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Добави с AI', exact: true }).isDisabled(), true)
  await page.waitForFunction(() => scrollY > 100)
  await page.waitForFunction(() => document.querySelectorAll('.ws-question').length >= 3)
  await page.waitForFunction(() => {
    const questions = document.querySelectorAll('.ws-question')
    const card = questions[questions.length - 1]
    const last = card?.getBoundingClientRect()
    const progress = document.querySelector('.ws-ai-progress')?.getBoundingClientRect()
    return last && progress && last.top >= progress.bottom && last.top < innerHeight && card.querySelector('[contenteditable]')?.textContent.trim() && Number(getComputedStyle(card).opacity) > 0.99
  })
  await page.screenshot({ path: new URL('ai-progress-revealing-desktop.png', artifacts).pathname })
  await page.mouse.move(900, 350)
  await page.mouse.wheel(0, -1000)
  const follow = page.getByRole('button', { name: 'Следвай новите въпроси', exact: true })
  await follow.waitFor()
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  const pausedCount = await page.locator('.ws-question').count()
  await page.waitForFunction(value => document.querySelectorAll('.ws-question').length >= value + 2, pausedCount)
  assert.ok(await page.evaluate(() => scrollY < 10), 'Wheel scrolling pauses automatic following')
  assert.ok(await page.locator('.ws-question').count() < definition.questions.length)
  await follow.click()
  const resumedCount = await page.locator('.ws-question').count()
  await page.waitForFunction(value => document.querySelectorAll('.ws-question').length > value, resumedCount)
  await page.waitForFunction(() => { const questions = document.querySelectorAll('.ws-question'); const last = questions[questions.length - 1]?.getBoundingClientRect(); return last && last.top < innerHeight && last.bottom > 0 })
  await page.waitForFunction(value => document.querySelectorAll('.ws-question').length === value, definition.questions.length)
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Запази теста')?.disabled)
  assert.deepEqual(await page.locator('.ws-question').getByLabel('Текст', { exact: true }).allInnerTexts(), definition.questions.map(item => item.text))
  assert.equal(generationPosts, 1, 'Revealing questions must not create additional AI requests')
  await page.screenshot({ path: new URL('ai-progress-complete.png', artifacts).pathname })
  await save.click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  assert.deepEqual(JSON.parse(stored.definition_json), definition)
  assert.ok(polls >= 2)

  // Existing authored questions and an empty slot survive immediate completion.
  stored = row(authored)
  await page.reload()
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  const settings = page.getByRole('group', { name: 'Настройки на теста', exact: true })
  await settings.getByRole('button', { name: 'Добави с AI', exact: true }).click()
  const append = page.getByRole('form', { name: 'Добавяне на въпроси с AI', exact: true })
  await append.getByLabel('Въпроси', { exact: true }).fill(String(additions.length))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => { window.__aiScrollCalls = [] })
  await append.getByRole('button', { name: 'Генерирай', exact: true }).click()
  await count.waitFor()
  assert.equal(await count.evaluate(element => element.max), additions.length)
  assert.equal(await page.getByRole('button', { name: 'Запази теста', exact: true }).isDisabled(), true)
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Запази теста')?.disabled)
  const expected = { ...authored, questions: [authored.questions[0], { ...additions[0], points: authored.questions[1].points, timeSeconds: authored.questions[1].timeSeconds }, authored.questions[2], ...additions.slice(1)] }
  assert.equal(await page.locator('.ws-question').count(), expected.questions.length)
  assert.deepEqual(await page.locator('.ws-question').getByLabel('Текст', { exact: true }).allInnerTexts(), expected.questions.map(item => item.text))
  assert.equal(generationPosts, 2)
  assert.equal(await page.evaluate(() => window.__aiScrollCalls.some(call => call?.behavior === 'smooth')), false, 'Reduced-motion users receive instant scrolling')
  assert.ok(await page.evaluate(() => window.__aiScrollCalls.length > 0))
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  assert.deepEqual(JSON.parse(stored.definition_json), expected)
  assert.equal(mutations.filter(request => ['/api/v1/tests', '/api/v1/tests/201'].includes(request.path) && ['POST', 'PUT'].includes(request.method)).length, 2)
  assert.deepEqual(errors, [])
  console.log('Passed: immediate loading, queued/running/failure/retry, gradual reveal, real follow scrolling with pause/resume, locked actions, complete saved payload, immediate-completed append, authored data preservation and reduced motion. API fixtures only.')
} finally {
  releasePost()
  await browser.close()
}
