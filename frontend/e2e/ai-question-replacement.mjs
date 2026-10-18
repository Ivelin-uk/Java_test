import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const auth = { token: 'ai-question-replacement-fixture', user: { id: 101, name: 'AI Teacher', email: 'replacement@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const question = text => ({ type: 'SINGLE_CHOICE', text, difficulty: 'EASY', points: 1, timeSeconds: 30, options: [{ text: 'Yes', correct: true }, { text: 'No', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'Original explanation' })
const shortQuestion = text => ({ ...question(text), type: 'SHORT_ANSWER', difficulty: 'HARD', points: 3.5, timeSeconds: 95, options: [], acceptedAnswers: ['immune'], criteria: 'Name the correct system.', caseInsensitive: false, collapseWhitespace: false })
const original = { title: 'Biology original', description: 'Original description', subject: 'Biology', level: '12', instructions: 'Original instructions', language: 'bg', gradingScale: 'percentage', passThreshold: 70, additionalInformation: 'Original teacher context', questions: [{ ...question('Original first question'), imageId: 501 }, { ...shortQuestion('Original second question'), imageId: 502 }, { ...question('Original third question'), points: 2, timeSeconds: 47 }] }
const row = (id, definition) => ({ id, owner_id: auth.user.id, title: definition.title, status: 'published', shared: false, definition_json: JSON.stringify(definition), question_count: definition.questions.length, total_time_seconds: definition.questions.reduce((sum, q) => sum + q.timeSeconds, 0), updated_at: '2026-10-17T12:00:00Z' })
const rows = new Map([[201, row(201, original)]])
const mutations = [], requests = [], errors = [], scenarios = [], jobs = new Map()
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const pendingResponses = []
const scenario = value => { const next = { status: 'completed', questions: [shortQuestion('Candidate question')], ...value }; scenarios.push(next); return next }
const invalidResult = 'AI не върна един валиден въпрос. Опитайте с нова заявка.'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  const imageBytes = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 320, 180)
    ctx.strokeStyle = '#23836b'; ctx.lineWidth = 6; ctx.strokeRect(70, 30, 180, 120)
    return canvas.toDataURL('image/png').split(',')[1]
  }), 'base64')
  const jobResponse = (job, status = job.status) => ({ id: job.id, status, result_json: status === 'completed' ? job.resultJson ?? JSON.stringify({ definition: job.definition ?? { ...original, title: 'Discard generated test metadata', subject: 'Different subject', passThreshold: 5, questions: job.questions } }) : null, error_message: status === 'failed' ? 'AI fixture failure.' : null })
  // Every API request is fulfilled locally, including images and all mutation routes.
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    if (!path.startsWith('/api/')) return route.continue()
    requests.push({ path, method })
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/v1/tests') return respond([...rows.values()])
      const test = path.match(/^\/api\/v1\/tests\/(\d+)$/)
      if (test) return respond(rows.get(Number(test[1])))
      if (['/api/v1/groups', '/api/v1/assignments', '/api/v1/grading'].includes(path)) return respond([])
      if (/^\/api\/v1\/files\/50[123]$/.test(path)) return route.fulfill({ status: 200, contentType: 'image/png', body: imageBytes })
      const match = path.match(/^\/api\/v1\/ai\/test-generations\/(\d+)$/)
      if (match) {
        const job = jobs.get(Number(match[1]))
        if (job) {
          job.pollStarted?.resolve()
          if (job.pollWait) await job.pollWait.promise
          if (job.pollErrors > 0) { job.pollErrors--; return respond({ detail: 'Polling temporarily unavailable.' }, 503) }
          return respond(jobResponse(job))
        }
      }
    } else {
      mutations.push({ path, method, body: request.postData() ? request.postDataJSON() : null })
      if (method === 'POST' && path === '/api/v1/ai/test-generations') {
        const next = scenarios.shift()
        assert.ok(next, 'Every generation needs a queued fixture scenario')
        const job = { ...next, id: 301 + jobs.size, request: request.postDataJSON() }
        jobs.set(job.id, job)
        next.job = job
        if (job.postWait) await job.postWait.promise
        return respond(jobResponse(job, 'queued'))
      }
      const retry = path.match(/^\/api\/v1\/ai\/test-generations\/(\d+)\/retry$/)
      if (method === 'POST' && retry) {
        const job = jobs.get(Number(retry[1]))
        if (job.retryErrors > 0) { job.retryErrors--; return respond({ detail: 'Retry temporarily unavailable.' }, 503) }
        job.status = 'queued'
        return respond(jobResponse(job))
      }
      if (method === 'POST' && path === '/api/v1/tests') {
        const id = 202, definition = request.postDataJSON()
        rows.set(id, { ...row(id, definition), status: 'draft' })
        return respond(rows.get(id))
      }
      const update = path.match(/^\/api\/v1\/tests\/(\d+)$/)
      if (method === 'PUT' && update) {
        const id = Number(update[1]), definition = request.postDataJSON()
        rows.set(id, { ...row(id, definition), status: 'draft' })
        return respond(rows.get(id))
      }
      const publish = path.match(/^\/api\/v1\/tests\/(\d+)\/publish$/)
      if (method === 'POST' && publish) { rows.get(Number(publish[1])).status = 'published'; return respond({ id: 402 }) }
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return route.fulfill({ status: 404 })
  })
  const questions = page.locator('.ws-question')
  const settings = page.getByRole('group', { name: 'Настройки на теста', exact: true })
  const dialog = number => page.getByRole('dialog', { name: `Подмяна на въпрос ${number}`, exact: true })
  const preview = scope => scope.getByRole('region', { name: 'Преглед на новия въпрос', exact: true })
  const testWrites = () => mutations.filter(request => /^\/api\/v1\/tests(?:\/|$)/.test(request.path))
  const generations = () => mutations.filter(request => request.path === '/api/v1/ai/test-generations')
  async function openSaved(id = 201) {
    await page.getByRole('table', { name: 'Тестове', exact: true }).getByRole('row').filter({ hasText: rows.get(id).title }).getByRole('button', { name: 'Редактирай теста', exact: true }).click()
    await settings.waitFor()
  }
  async function openReplacement(number) {
    await page.getByRole('button', { name: `Подмени въпрос ${number} с AI`, exact: true }).click()
    const modal = dialog(number)
    await modal.waitFor()
    assert.equal(await modal.evaluate(element => element.matches(':modal')), true)
    assert.equal(await modal.getByLabel('Въпроси', { exact: true }).inputValue(), '1')
    assert.equal(await modal.getByLabel('Въпроси', { exact: true }).getAttribute('readonly'), '')
    return modal
  }
  async function cancel(modal) {
    await modal.getByRole('button', { name: 'Отказ', exact: true }).click()
    await modal.waitFor({ state: 'detached' })
  }
  async function assertDraft(definition) {
    assert.equal(await questions.count(), definition.questions.length)
    assert.equal(await settings.getByLabel('Тема', { exact: true }).inputValue(), definition.title)
    assert.equal(await settings.getByLabel('Дисциплина', { exact: true }).inputValue(), definition.subject)
    assert.equal(await settings.getByLabel('Допълнителна информация за теста', { exact: true }).inputValue(), definition.additionalInformation)
    for (let index = 0; index < definition.questions.length; index++) {
      const article = questions.nth(index), expected = definition.questions[index]
      assert.equal(await article.getByLabel('Текст', { exact: true }).innerText(), expected.text)
      assert.equal(await article.getByLabel(`Тип на въпрос ${index + 1}`, { exact: true }).inputValue(), expected.type)
      assert.equal(await article.locator('.ws-form-grid select').inputValue(), expected.difficulty)
      assert.equal(Number(await article.getByLabel('Точки', { exact: true }).inputValue()), expected.points)
      assert.equal(Number(await article.getByLabel(`Минути за въпрос ${index + 1}`, { exact: true }).inputValue()) * 60 + Number(await article.getByLabel(`Секунди за въпрос ${index + 1}`, { exact: true }).inputValue()), expected.timeSeconds)
      assert.equal(await article.getByLabel('Обяснение след разрешен преглед').inputValue(), expected.explanation)
      assert.deepEqual(await article.locator('.ws-option-editor').evaluateAll(elements => elements.map(element => ({ text: element.querySelector('input:not([type])').value, correct: element.querySelector('input[type]').checked }))), expected.options)
      if (expected.type === 'SHORT_ANSWER') {
        assert.equal(await article.getByLabel('Допустими отговори (по един на ред)').inputValue(), expected.acceptedAnswers.join('\n'))
        assert.equal(await article.getByRole('checkbox', { name: 'Без разлика малки / главни', exact: true }).isChecked(), expected.caseInsensitive)
        assert.equal(await article.getByRole('checkbox', { name: 'Нормализирай интервали', exact: true }).isChecked(), expected.collapseWhitespace)
      }
      if (['SHORT_ANSWER', 'OPEN_ANSWER'].includes(expected.type)) assert.equal(await article.getByLabel('Критерии за ръчна проверка').inputValue(), expected.criteria)
      assert.equal(await article.locator('.ws-question-media').count(), expected.imageId ? 1 : 0)
    }
  }
  async function generatePreview(modal, next) {
    scenario(next)
    await modal.getByRole('button', { name: 'Генерирай', exact: true }).click()
    await preview(modal).waitFor()
    return preview(modal)
  }
  async function saveAndReopen(id, expected) {
    await page.getByRole('button', { name: 'Запази', exact: true }).click()
    await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
    assert.deepEqual(JSON.parse(rows.get(id).definition_json), expected)
    assert.equal(rows.get(id).status, 'published')
    await page.reload()
    await page.getByRole('button', { name: 'Тестове', exact: true }).click()
    await openSaved(id)
    await assertDraft(expected)
  }

  await page.goto(frontend)
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await openSaved()
  await assertDraft(original)

  // The selected question supplies defaults, and opening/cancelling does no work.
  let modal = await openReplacement(2)
  assert.equal(await modal.getByLabel('Тема', { exact: true }).inputValue(), original.title)
  assert.equal(await modal.getByLabel('Дисциплина', { exact: true }).inputValue(), original.subject)
  assert.equal(await modal.getByLabel('Допълнителна информация за теста', { exact: true }).inputValue(), original.additionalInformation)
  assert.equal(await modal.getByLabel('Трудност', { exact: true }).inputValue(), 'HARD')
  for (const name of ['Един верен отговор', 'Няколко верни', 'Вярно / невярно', 'Свободен отговор']) assert.equal(await modal.getByRole('checkbox', { name, exact: true }).isChecked(), false)
  assert.equal(await modal.getByRole('checkbox', { name: 'Кратък текст', exact: true }).isChecked(), true)
  assert.equal(await modal.getByRole('checkbox', { name: 'С изображения', exact: true }).isChecked(), true)
  assert.equal(await page.getByRole('button', { name: 'Запази теста', exact: true }).isDisabled(), true)
  await cancel(modal)
  assert.deepEqual(mutations, [])
  assert.equal(await page.getByRole('button', { name: 'Подмени въпрос 2 с AI', exact: true }).evaluate(element => element === document.activeElement), true)

  // Verify modal sizing and controls on narrow screens and both application themes.
  for (const { theme, width } of [{ theme: 'light', width: 1440 }, { theme: 'dark', width: 1440 }, { theme: 'light', width: 390 }, { theme: 'dark', width: 320 }]) {
    await page.setViewportSize({ width, height: 900 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    modal = await openReplacement(2)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await modal.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight }), true)
    assert.equal(await modal.evaluate(element => [...element.querySelectorAll('input,select,textarea,button')].filter(control => control.checkVisibility()).every(control => { const bounds = control.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth })), true)
    await modal.screenshot({ path: new URL(`ai-question-replacement-${theme}-${width}.png`, artifacts).pathname })
    await cancel(modal)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })

  // A completed candidate stays a preview until explicitly accepted.
  modal = await openReplacement(2)
  const discarded = { ...shortQuestion('Discarded replacement'), points: 99, timeSeconds: 999 }
  const discardedPreview = await generatePreview(modal, { questions: [discarded] })
  await discardedPreview.getByText(discarded.text, { exact: true }).waitFor()
  assert.equal(await discardedPreview.getByText('immune', { exact: false }).isVisible(), true)
  await assertDraft(original)
  assert.deepEqual(testWrites(), [])
  await cancel(modal)
  await assertDraft(original)

  // Invalid result JSON, wrong count and invalid question shapes cannot be applied.
  for (const next of [{ resultJson: '{' }, { questions: [] }, { questions: [shortQuestion('A'), shortQuestion('B')] }, { questions: [{ type: 'SHORT_ANSWER', text: 'Incomplete result' }] }]) {
    modal = await openReplacement(2)
    scenario(next)
    await modal.getByRole('button', { name: 'Генерирай', exact: true }).click()
    await modal.getByText(invalidResult, { exact: true }).waitFor()
    assert.equal(await preview(modal).count(), 0)
    assert.equal(await modal.getByRole('button', { name: 'Подмени въпроса', exact: true }).count(), 0)
    await cancel(modal)
    await assertDraft(original)
  }

  // Closing during POST and during polling ignores old responses, including a newly opened dialog.
  const postWait = deferred(); pendingResponses.push(postWait)
  scenario({ questions: [shortQuestion('Late POST candidate')], postWait })
  modal = await openReplacement(2)
  let generationCount = generations().length
  const pendingPost = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/ai/test-generations')
  await modal.getByRole('button', { name: 'Генерирай', exact: true }).click()
  await pendingPost
  assert.equal(await modal.getByRole('button', { name: 'Генерирай', exact: true }).isDisabled(), true)
  await modal.getByRole('form', { name: 'Генериране на заместващ въпрос', exact: true }).evaluate(form => form.requestSubmit())
  assert.equal(generations().length, generationCount + 1)
  await cancel(modal)
  modal = await openReplacement(3)
  let lateResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/ai/test-generations')
  postWait.resolve()
  await lateResponse
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await preview(modal).count(), 0)
  assert.equal(await modal.getByLabel('Трудност', { exact: true }).inputValue(), 'EASY')
  await cancel(modal)
  await assertDraft(original)

  const pollWait = deferred(), pollStarted = deferred(); pendingResponses.push(pollWait)
  const latePoll = scenario({ questions: [shortQuestion('Late polling candidate')], pollWait, pollStarted })
  modal = await openReplacement(2)
  await modal.getByRole('button', { name: 'Генерирай', exact: true }).click()
  await pollStarted.promise
  await cancel(modal)
  modal = await openReplacement(1)
  lateResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/ai/test-generations/${latePoll.job.id}`)
  pollWait.resolve()
  await lateResponse
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await preview(modal).count(), 0)
  await cancel(modal)
  await assertDraft(original)

  // Recover polling, retry the same failed job and apply exactly one replacement.
  modal = await openReplacement(2)
  await modal.getByRole('checkbox', { name: 'Кратък текст', exact: true }).uncheck()
  assert.equal(await modal.getByRole('button', { name: 'Генерирай', exact: true }).isDisabled(), true)
  await modal.getByRole('checkbox', { name: 'Вярно / невярно', exact: true }).check()
  await modal.getByRole('checkbox', { name: 'С изображения', exact: true }).uncheck()
  await modal.getByLabel('Трудност', { exact: true }).selectOption('MEDIUM')
  const accepted = { ...question('Accepted replacement without old image'), type: 'TRUE_FALSE', difficulty: 'MEDIUM', points: 99, timeSeconds: 999, explanation: 'Replacement explanation.' }
  const recovery = scenario({ status: 'failed', questions: [accepted], pollErrors: 1, retryErrors: 1 })
  generationCount = generations().length
  await modal.getByRole('button', { name: 'Генерирай', exact: true }).click()
  await modal.getByRole('form', { name: 'Генериране на заместващ въпрос', exact: true }).evaluate(form => form.requestSubmit())
  assert.equal(generations().length, generationCount + 1)
  await modal.getByText('Не може да се провери AI заявката. Проверката ще продължи автоматично.', { exact: true }).waitFor()
  await modal.getByText('AI fixture failure.', { exact: true }).waitFor()
  await modal.getByRole('button', { name: 'Повтори заявката', exact: true }).click()
  await modal.getByText('Retry temporarily unavailable.', { exact: true }).waitFor()
  assert.equal(await modal.getByLabel('Тема', { exact: true }).inputValue(), original.title)
  const retried = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/v1/ai/test-generations/${recovery.job.id}/retry` && response.status() === 200)
  await modal.getByRole('button', { name: 'Повтори заявката', exact: true }).click()
  await retried
  recovery.job.status = 'completed'
  await preview(modal).getByText(accepted.text, { exact: true }).waitFor()
  const payload = recovery.job.request
  assert.equal(payload.questionCount, 1)
  assert.equal(payload.topic, original.title)
  assert.equal(payload.subject, original.subject)
  assert.equal(payload.level, original.level)
  assert.equal(payload.language, original.language)
  assert.equal(payload.difficulty, 'MEDIUM')
  assert.deepEqual(payload.questionTypes, ['TRUE_FALSE'])
  assert.equal(payload.imageCount, 0)
  for (const q of original.questions) assert.ok(payload.sourceText.includes(q.text))
  await assertDraft(original)
  assert.deepEqual(testWrites(), [])
  await modal.getByRole('button', { name: 'Подмени въпроса', exact: true }).click()
  await modal.waitFor({ state: 'detached' })
  const afterFirst = { ...original, questions: original.questions.map((q, index) => index === 1 ? { ...accepted, imageId: null, points: q.points, timeSeconds: q.timeSeconds } : q) }
  await assertDraft(afterFirst)
  assert.deepEqual(JSON.parse(rows.get(201).definition_json), original)

  // A different target can receive a new generated image without changing its score or time.
  modal = await openReplacement(3)
  await modal.getByRole('checkbox', { name: 'С изображения', exact: true }).check()
  const illustrated = { ...question('Accepted illustrated replacement'), imageId: 503, points: 99, timeSeconds: 999 }
  await generatePreview(modal, { questions: [illustrated] })
  await preview(modal).getByRole('img', { name: 'Изображение към въпроса', exact: true }).waitFor()
  await assertDraft(afterFirst)
  await modal.getByRole('button', { name: 'Подмени въпроса', exact: true }).click()
  await modal.waitFor({ state: 'detached' })
  const savedExpected = { ...original, questions: afterFirst.questions.map((q, index) => index === 2 ? { ...illustrated, points: q.points, timeSeconds: q.timeSeconds } : q) }
  await assertDraft(savedExpected)
  assert.deepEqual(testWrites(), [])
  await saveAndReopen(201, savedExpected)
  assert.equal(testWrites().filter(request => request.method === 'PUT').length, 1)

  // Replacement remains available when the existing test already has 100 questions.
  const atLimit = { ...original, title: 'Full manual test', questions: Array.from({ length: 100 }, (_, index) => index === 99 ? shortQuestion('Limit last question') : question(`Limit question ${index + 1}`)) }
  rows.set(201, row(201, atLimit))
  await page.reload()
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await openSaved()
  assert.equal(await settings.getByRole('button', { name: 'Добави с AI', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Подмени въпрос 100 с AI', exact: true }).isEnabled(), true)
  modal = await openReplacement(100)
  const limitReplacement = { ...shortQuestion('Replaced last question at limit'), points: 99, timeSeconds: 999 }
  await generatePreview(modal, { questions: [limitReplacement] })
  await modal.getByRole('button', { name: 'Подмени въпроса', exact: true }).click()
  await modal.waitFor({ state: 'detached' })
  assert.equal(await questions.count(), 100)
  assert.equal(await questions.first().getByLabel('Текст', { exact: true }).innerText(), atLimit.questions[0].text)
  assert.equal(await questions.nth(98).getByLabel('Текст', { exact: true }).innerText(), atLimit.questions[98].text)
  const atLimitExpected = { ...atLimit, questions: atLimit.questions.map((q, index) => index === 99 ? { ...limitReplacement, imageId: null, points: q.points, timeSeconds: q.timeSeconds } : q) }
  await page.getByRole('button', { name: 'Запази', exact: true }).click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  assert.deepEqual(JSON.parse(rows.get(201).definition_json), atLimitExpected)

  // The same interaction works for a newly AI-generated draft before its first save.
  const aiDefinition = { ...original, title: 'AI generated draft', questions: [shortQuestion('AI original first'), question('AI original second')] }
  scenario({ definition: aiDefinition })
  await page.getByRole('button', { name: 'С AI', exact: true }).click()
  const creator = page.getByRole('region', { name: 'Създаване на тест с AI', exact: true })
  await creator.getByLabel('Въпроси', { exact: true }).fill('2')
  await creator.getByRole('button', { name: 'Генерирай', exact: true }).click()
  await creator.waitFor({ state: 'detached' })
  await assertDraft(aiDefinition)
  const writesBeforeAiReplacement = testWrites().length
  modal = await openReplacement(1)
  assert.equal(await modal.getByLabel('Трудност', { exact: true }).inputValue(), 'HARD')
  assert.equal(await modal.getByRole('checkbox', { name: 'Кратък текст', exact: true }).isChecked(), true)
  const aiReplacement = { ...shortQuestion('Replacement inside AI draft'), points: 99, timeSeconds: 999 }
  await generatePreview(modal, { questions: [aiReplacement] })
  await assertDraft(aiDefinition)
  await modal.getByRole('button', { name: 'Подмени въпроса', exact: true }).click()
  await modal.waitFor({ state: 'detached' })
  assert.equal(testWrites().length, writesBeforeAiReplacement)
  const aiExpected = { ...aiDefinition, questions: [{ ...aiReplacement, imageId: null, points: aiDefinition.questions[0].points, timeSeconds: aiDefinition.questions[0].timeSeconds }, aiDefinition.questions[1]] }
  await saveAndReopen(202, aiExpected)
  assert.equal(testWrites().filter(request => request.method === 'POST' && request.path === '/api/v1/tests').length, 1)
  assert.equal(scenarios.length, 0)
  assert.ok(requests.some(request => request.path === '/api/v1/files/503'))
  assert.deepEqual(errors, [])
  console.log('Passed: single-question replacement for saved/manual and AI drafts, selected defaults, explicit preview/apply, cancellation and ignored late responses, malformed-result protection, duplicate-submit guard, polling recovery and retry, preserved sibling questions/test metadata/points/time, image clearing and new images, save/reopen and 100-question limit, responsive light/dark dialogs. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: new URL('ai-question-replacement-failure.png', artifacts).pathname, fullPage: true })
    console.error('Fixture page:', (await page.locator('body').innerText()).slice(0, 1500), 'Browser errors:', errors)
  }
  throw error
} finally {
  for (const pending of pendingResponses) pending.resolve()
  await browser.close()
}
