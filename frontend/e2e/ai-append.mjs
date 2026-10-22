import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'ai-append-fixture', user: { id: 101, name: 'AI Teacher', email: 'append@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const question = text => ({ type: 'SINGLE_CHOICE', text, difficulty: 'EASY', points: 1, timeSeconds: 30, options: [{ text: 'Yes', correct: true }, { text: 'No', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'Original explanation' })
const emptyQuestion = (overrides = {}) => ({ ...question(''), difficulty: 'MEDIUM', timeSeconds: 60, options: [{ text: '', correct: true }, { text: '', correct: false }], explanation: '', ...overrides })
const original = { title: 'Biology original', description: 'Original description', subject: 'Biology', level: '12', instructions: 'Original instructions', language: 'bg', gradingScale: 'percentage', passThreshold: 70, additionalInformation: 'Original teacher context', questions: [{ ...question('Original first question'), imageId: 501 }, { ...question('Original second question'), type: 'SHORT_ANSWER', difficulty: 'MEDIUM', timeSeconds: 45, options: [], acceptedAnswers: ['bone'] }] }
const added = [{ ...question('New illustrated true/false question'), type: 'TRUE_FALSE', difficulty: 'HARD', timeSeconds: 120, imageId: 502 }, { ...question('New open question'), type: 'OPEN_ANSWER', difficulty: 'MEDIUM', points: 3, timeSeconds: 60, options: [], criteria: 'Explain the organ function.' }]
let stored = { id: 201, owner_id: auth.user.id, title: original.title, status: 'published', shared: false, definition_json: JSON.stringify(original), updated_at: new Date().toISOString() }
const mutations = [], errors = [], jobs = new Map()
let failPoll = true, failRetry = true
let nextQuestions = [question('Another new question')]
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const imageBytes = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 320, 200)
    ctx.strokeStyle = '#23836b'; ctx.lineWidth = 6; ctx.strokeRect(70, 40, 180, 120)
    return canvas.toDataURL('image/png').split(',')[1]
  }), 'base64')
  const jobResponse = job => ({ id: job.id, status: job.status, result_json: job.status === 'completed' ? JSON.stringify({ definition: { ...original, title: job.request.topic, subject: job.request.subject, additionalInformation: job.request.additionalInformation, questions: job.questions } }) : null, error_message: job.status === 'failed' ? 'Image generation failed.' : null })
  await page.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    const fail = detail => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail }) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/v1/tests') return respond([{ ...stored, question_count: JSON.parse(stored.definition_json).questions.length, total_time_seconds: 75 }])
      if (path === `/api/v1/tests/${stored.id}`) return respond(stored)
      if (['/api/v1/groups', '/api/v1/assignments', '/api/v1/grading'].includes(path)) return respond([])
      if (['/api/v1/files/501', '/api/v1/files/502'].includes(path)) return route.fulfill({ status: 200, contentType: 'image/png', body: imageBytes })
      const match = path.match(/^\/api\/v1\/ai\/test-generations\/(\d+)$/)
      if (match) {
        if (failPoll) { failPoll = false; await new Promise(resolve => setTimeout(resolve, 3000)); return fail('Polling unavailable.') }
        return respond(jobResponse(jobs.get(Number(match[1]))))
      }
    } else {
      mutations.push({ path, method, body: request.postData() ? request.postDataJSON() : null })
      if (method === 'POST' && path === '/api/v1/ai/test-generations') {
        const id = 301 + jobs.size
        const job = { id, status: id === 301 ? 'queued' : 'completed', request: request.postDataJSON(), questions: id === 301 ? added : structuredClone(nextQuestions) }
        jobs.set(id, job)
        return respond({ ...jobResponse(job), status: 'queued', result_json: null })
      }
      if (method === 'POST' && path === '/api/v1/ai/test-generations/301/retry') {
        if (failRetry) { failRetry = false; return fail('Retry unavailable.') }
        jobs.get(301).status = 'queued'
        return respond(jobResponse(jobs.get(301)))
      }
      if (method === 'POST' && path === '/api/v1/tests') {
        const definition = request.postDataJSON()
        stored = { ...stored, id: 401, title: definition.title, status: 'draft', definition_json: JSON.stringify(definition) }
        return respond(stored)
      }
      if (method === 'PUT' && path === `/api/v1/tests/${stored.id}`) {
        const definition = request.postDataJSON()
        stored = { ...stored, title: definition.title, status: 'draft', definition_json: JSON.stringify(definition) }
        return respond(stored)
      }
      if (method === 'POST' && path === `/api/v1/tests/${stored.id}/publish`) { stored.status = 'published'; return respond({ id: 202 }) }
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return route.fulfill({ status: 404 })
  })
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  const settings = page.getByRole('group', { name: 'Настройки на теста', exact: true })
  const additions = page.getByRole('region', { name: 'Добавяне на въпроси', exact: true })
  const form = page.getByRole('form', { name: 'Добавяне на въпроси с AI', exact: true })
  const generate = form.getByRole('button', { name: 'Генерирай', exact: true })
  const close = form.getByRole('button', { name: 'Затвори AI настройките', exact: true })
  assert.equal(await form.count(), 0)
  await settings.getByRole('button', { name: 'Добави с AI', exact: true }).click()
  assert.equal(await form.getByLabel('Тема', { exact: true }).inputValue(), original.title)
  assert.equal(await form.getByLabel('Дисциплина', { exact: true }).inputValue(), original.subject)
  assert.equal(await form.getByLabel('Допълнителна информация за теста', { exact: true }).inputValue(), original.additionalInformation)
  assert.equal(await form.getByRole('checkbox', { name: 'С изображения', exact: true }).isChecked(), false)
  await close.click()
  assert.equal(await form.count(), 0)
  assert.equal(await settings.getByRole('button', { name: 'Добави с AI', exact: true }).evaluate(button => button === document.activeElement), true)
  assert.deepEqual(mutations, [])
  await additions.getByRole('button', { name: 'С AI', exact: true }).click()
  await form.getByLabel('Въпроси', { exact: true }).fill('0')
  assert.equal(await generate.isDisabled(), true)
  await form.getByLabel('Въпроси', { exact: true }).fill('21')
  assert.equal(await generate.isDisabled(), true)
  await form.getByLabel('Въпроси', { exact: true }).fill('2')
  await form.getByRole('checkbox', { name: 'Един верен отговор', exact: true }).uncheck()
  await form.getByRole('checkbox', { name: 'Кратък текст', exact: true }).uncheck()
  assert.equal(await generate.isDisabled(), true)
  await form.getByRole('checkbox', { name: 'Вярно / невярно', exact: true }).check()
  await form.getByRole('checkbox', { name: 'Свободен отговор', exact: true }).check()
  await form.getByRole('checkbox', { name: 'С изображения', exact: true }).check()
  await form.getByLabel('Въпроси с изображение', { exact: true }).fill('0')
  assert.equal(await generate.isDisabled(), true)
  await form.getByLabel('Въпроси с изображение', { exact: true }).fill('1')
  await form.getByLabel('Трудност', { exact: true }).selectOption('MIXED')
  assert.equal(await generate.isDisabled(), true)
  await form.getByLabel('Трудни', { exact: true }).fill('1')
  await form.getByLabel('Тема', { exact: true }).fill('  Human body diagrams  ')
  await form.getByLabel('Дисциплина', { exact: true }).fill('Biology review')
  await form.getByLabel('Допълнителна информация за теста', { exact: true }).fill('  New questions about organ functions.  ')
  assert.equal(await generate.isEnabled(), true)
  assert.equal(await form.getByRole('checkbox', { name: 'С изображения', exact: true }).isEnabled(), true)
  for (const { theme, width } of [{ theme: 'light', width: 1440 }, { theme: 'dark', width: 1440 }, { theme: 'light', width: 390 }, { theme: 'dark', width: 320 }]) {
    await page.setViewportSize({ width, height: 1000 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await form.evaluate(element => [...element.querySelectorAll('input,select,textarea,button')].every(control => { const bounds = control.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth })), true)
    await form.screenshot({ path: new URL(`ai-append-${theme}-${width}.png`, artifacts).pathname })
  }
  await generate.click()
  await form.getByRole('button', { name: 'Генериране...', exact: true }).waitFor()
  assert.equal(await close.isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Запази теста', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Запази', exact: true }).isDisabled(), true)
  assert.equal(await form.getByLabel('Тема', { exact: true }).isDisabled(), true)
  assert.equal(await form.getByRole('checkbox', { name: 'С изображения', exact: true }).isDisabled(), true)
  await form.evaluate(element => element.requestSubmit())
  assert.equal(mutations.filter(request => request.path === '/api/v1/ai/test-generations').length, 1)
  const payload = mutations[0].body
  assert.equal(payload.topic, 'Human body diagrams')
  assert.equal(payload.subject, 'Biology review')
  assert.equal(payload.level, original.level)
  assert.equal(payload.language, original.language)
  assert.equal(payload.questionCount, 2)
  assert.equal(payload.difficulty, 'MIXED')
  assert.deepEqual(payload.difficultyCounts, { EASY: 0, MEDIUM: 1, HARD: 1, VERY_HARD: 0 })
  assert.deepEqual(payload.questionTypes, ['TRUE_FALSE', 'OPEN_ANSWER'])
  assert.equal(payload.imageCount, 1)
  assert.equal(payload.additionalInformation, 'New questions about organ functions.')
  for (const q of original.questions) assert.ok(payload.sourceText.includes(q.text))
  await additions.getByText('Не може да се провери AI заявката. Изчаква се връзка със сървъра.', { exact: true }).waitFor()
  jobs.get(301).status = 'failed'
  await additions.getByText('Image generation failed.', { exact: true }).waitFor()
  assert.equal(await page.locator('.ws-question').count(), original.questions.length)
  await form.getByRole('button', { name: 'Повтори', exact: true }).click()
  await additions.getByText('Retry unavailable.', { exact: true }).waitFor()
  assert.equal(await form.getByLabel('Тема', { exact: true }).inputValue(), '  Human body diagrams  ')
  await form.getByRole('button', { name: 'Повтори', exact: true }).click()
  await form.getByRole('button', { name: 'Генериране...', exact: true }).waitFor()
  jobs.get(301).status = 'completed'
  await form.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.ws-question').count(), 4)
  assert.equal(await settings.getByLabel('Тема', { exact: true }).inputValue(), original.title)
  assert.equal(await settings.getByLabel('Дисциплина', { exact: true }).inputValue(), original.subject)
  assert.equal(await settings.getByLabel('Допълнителна информация за теста', { exact: true }).inputValue(), original.additionalInformation)
  assert.equal(await settings.getByLabel('Въпроси с изображение', { exact: true }).inputValue(), '2')
  assert.deepEqual(JSON.parse(stored.definition_json), original)
  await settings.getByRole('button', { name: 'Добави с AI', exact: true }).click()
  assert.equal(await form.getByLabel('Въпроси', { exact: true }).inputValue(), '1')
  assert.equal(await form.getByRole('checkbox', { name: 'С изображения', exact: true }).isChecked(), false)
  for (const name of ['Кратък текст', 'Вярно / невярно', 'Свободен отговор']) await form.getByRole('checkbox', { name, exact: true }).uncheck()
  await form.getByLabel('Трудност', { exact: true }).selectOption('EASY')
  await generate.click()
  await form.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.ws-question').count(), 5)
  assert.equal(mutations.filter(request => request.path === '/api/v1/ai/test-generations').length, 2)
  assert.equal(mutations.filter(request => request.method === 'PUT').length, 0)
  await page.getByRole('button', { name: 'Запази', exact: true }).click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  const saved = JSON.parse(stored.definition_json)
  assert.deepEqual(saved, { ...original, questions: [...original.questions, ...added, question('Another new question')] })
  assert.equal(stored.id, 201)
  assert.equal(stored.status, 'published')
  assert.equal(mutations.filter(request => request.method === 'PUT' && request.path === '/api/v1/tests/201').length, 1)
  await page.reload()
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  await settings.waitFor()
  assert.equal(await page.locator('.ws-question').count(), 5)

  // The initial empty question in a manual test must be filled, not left before an appended question.
  await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await page.getByRole('button', { name: 'Ръчен тест', exact: true }).click()
  await settings.getByLabel('Тема', { exact: true }).fill('Manual test filled with AI')
  await settings.getByLabel('Дисциплина', { exact: true }).fill('Biology')
  const firstQuestion = page.locator('.ws-question').first()
  await firstQuestion.getByLabel('Точки', { exact: true }).fill('4')
  await firstQuestion.getByLabel('Секунди за въпрос 1', { exact: true }).fill('15')
  nextQuestions = [question('AI filled the initial manual question')]
  await settings.getByRole('button', { name: 'Добави с AI', exact: true }).click()
  assert.equal(await form.getByLabel('Въпроси', { exact: true }).inputValue(), '1')
  await form.getByRole('heading', { name: 'Попълване на празни въпроси с AI', exact: true }).waitFor()
  await generate.click()
  await form.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.ws-question').count(), 1)
  assert.equal(await firstQuestion.getByLabel('Текст', { exact: true }).innerText(), nextQuestions[0].text)
  assert.equal(await firstQuestion.getByLabel('Точки', { exact: true }).inputValue(), '4')
  assert.equal(await firstQuestion.getByLabel('Минути за въпрос 1', { exact: true }).inputValue(), '1')
  assert.equal(await firstQuestion.getByLabel('Секунди за въпрос 1', { exact: true }).inputValue(), '15')
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  assert.deepEqual(JSON.parse(stored.definition_json).questions, [{ ...nextQuestions[0], points: 4, timeSeconds: 75 }])
  assert.equal(stored.status, 'published')

  // Empty formatted prompts and default true/false answers count as empty slots, even between authored questions.
  const mixed = { ...original, questions: [original.questions[0], emptyQuestion({ text: '<!--examai-rich-text:v1--><p><strong> </strong><br></p>', points: 5, timeSeconds: 91 }), original.questions[1], emptyQuestion({ type: 'TRUE_FALSE', options: [{ text: 'Вярно', correct: true }, { text: 'Невярно', correct: false }], points: 2, timeSeconds: 47 })] }
  stored.definition_json = JSON.stringify(mixed)
  nextQuestions = [question('Fill the first gap'), { ...question('Fill the second gap'), type: 'TRUE_FALSE' }]
  await page.reload()
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  await additions.getByRole('button', { name: 'С AI', exact: true }).click()
  assert.equal(await form.getByLabel('Въпроси', { exact: true }).inputValue(), '2')
  assert.equal(await form.getByRole('checkbox', { name: 'Вярно / невярно', exact: true }).isChecked(), true)
  assert.equal(await form.getByRole('checkbox', { name: 'Кратък текст', exact: true }).isChecked(), false)
  await generate.click()
  await form.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.ws-question').count(), mixed.questions.length)
  assert.deepEqual(await page.locator('.ws-question').getByLabel('Текст', { exact: true }).allInnerTexts(), [original.questions[0].text, nextQuestions[0].text, original.questions[1].text, nextQuestions[1].text])
  await page.getByRole('button', { name: 'Запази', exact: true }).click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  assert.deepEqual(JSON.parse(stored.definition_json), { ...mixed, questions: [original.questions[0], { ...nextQuestions[0], points: 5, timeSeconds: 91 }, original.questions[1], { ...nextQuestions[1], points: 2, timeSeconds: 47 }] })

  // Preserve questions that already have content, including answers or an image without a prompt.
  const partial = { ...original, questions: [emptyQuestion({ options: [{ text: 'Teacher answer', correct: true }, { text: '', correct: false }] }), emptyQuestion({ explanation: 'Teacher explanation' }), emptyQuestion({ imageId: 501 }), emptyQuestion({ type: 'SHORT_ANSWER', options: [], acceptedAnswers: ['Teacher answer'] }), emptyQuestion({ type: 'OPEN_ANSWER', options: [], criteria: 'Teacher criteria' }), emptyQuestion({ text: '<!--examai-rich-text:v1--><p><span data-type="inline-math" data-latex="x^2"></span></p>' }), emptyQuestion(), emptyQuestion(), emptyQuestion()] }
  stored.definition_json = JSON.stringify(partial)
  nextQuestions = [question('Fill only the first empty slot'), question('Fill only the second empty slot')]
  await page.reload()
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  await settings.getByRole('button', { name: 'Добави с AI', exact: true }).click()
  assert.equal(await form.getByLabel('Въпроси', { exact: true }).inputValue(), '3')
  await form.getByLabel('Въпроси', { exact: true }).fill('2')
  await generate.click()
  await form.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.ws-question').count(), partial.questions.length)
  assert.equal(await page.locator('.ws-question').nth(0).getByLabel('Опция 1', { exact: true }).inputValue(), 'Teacher answer')
  assert.equal(await page.locator('.ws-question').nth(1).getByLabel('Обяснение след разрешен преглед').inputValue(), 'Teacher explanation')
  assert.equal(await page.locator('.ws-question').nth(2).locator('.ws-question-media').count(), 1)
  assert.equal(await page.locator('.ws-question').nth(3).getByLabel('Допустими отговори (по един на ред)').inputValue(), 'Teacher answer')
  assert.equal(await page.locator('.ws-question').nth(4).getByLabel('Критерии за ръчна проверка').inputValue(), 'Teacher criteria')
  assert.equal(await page.locator('.ws-question').nth(5).locator('[data-type="inline-math"]').count(), 1)
  assert.equal(await page.locator('.ws-question').nth(6).getByLabel('Текст', { exact: true }).innerText(), nextQuestions[0].text)
  assert.equal(await page.locator('.ws-question').nth(7).getByLabel('Текст', { exact: true }).innerText(), nextQuestions[1].text)
  assert.equal((await page.locator('.ws-question').nth(8).getByLabel('Текст', { exact: true }).innerText()).trim(), '')

  // A larger request fills the remaining slot and appends only the surplus.
  nextQuestions = [question('Fill the remaining gap'), question('Append the surplus')]
  await additions.getByRole('button', { name: 'С AI', exact: true }).click()
  assert.equal(await form.getByLabel('Въпроси', { exact: true }).inputValue(), '1')
  await form.getByLabel('Въпроси', { exact: true }).fill('2')
  await generate.click()
  await form.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.ws-question').count(), partial.questions.length + 1)
  assert.equal(await page.locator('.ws-question').nth(8).getByLabel('Текст', { exact: true }).innerText(), nextQuestions[0].text)
  assert.equal(await page.locator('.ws-question').nth(9).getByLabel('Текст', { exact: true }).innerText(), nextQuestions[1].text)

  const nearLimit = { ...original, questions: Array.from({ length: 99 }, (_, i) => question(`Limit question ${i + 1}`)) }
  stored.definition_json = JSON.stringify(nearLimit)
  await page.reload()
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  await settings.getByRole('button', { name: 'Добави с AI', exact: true }).click()
  assert.equal(await form.getByLabel('Въпроси', { exact: true }).getAttribute('max'), '1')
  await form.getByLabel('Въпроси', { exact: true }).fill('2')
  assert.equal(await generate.isDisabled(), true)
  await close.click()
  await additions.getByRole('button', { name: 'Ръчно', exact: true }).click()
  assert.equal(await page.locator('.ws-question').count(), 100)
  assert.equal(await additions.getByRole('button', { name: 'Ръчно', exact: true }).isDisabled(), true)
  assert.equal(await settings.getByRole('button', { name: 'Добави с AI', exact: true }).isEnabled(), true)
  assert.equal(await additions.getByRole('button', { name: 'С AI', exact: true }).isEnabled(), true)
  nextQuestions = [question('Fill the hundredth question')]
  await settings.getByRole('button', { name: 'Добави с AI', exact: true }).click()
  assert.equal(await form.getByLabel('Въпроси', { exact: true }).getAttribute('max'), '1')
  await form.getByLabel('Въпроси', { exact: true }).fill('2')
  assert.equal(await generate.isDisabled(), true)
  await form.getByLabel('Въпроси', { exact: true }).fill('1')
  await generate.click()
  await form.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.ws-question').count(), 100)
  assert.equal(await page.locator('.ws-question').last().getByLabel('Текст', { exact: true }).innerText(), nextQuestions[0].text)
  assert.equal(await settings.getByRole('button', { name: 'Добави с AI', exact: true }).isDisabled(), true)
  assert.equal(await additions.getByRole('button', { name: 'С AI', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Запази', exact: true }).click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  assert.deepEqual(JSON.parse(stored.definition_json), { ...nearLimit, questions: [...nearLimit.questions, { ...nextQuestions[0], timeSeconds: 60 }] })
  assert.deepEqual(errors, [])
  console.log('Passed: AI fills empty manual questions in place, preserves partial content, authored questions, metadata, points and timing, appends only surplus, works at the 100-question cap, and supports configurable additions, polling failure/retry, save/reopen, desktop/mobile and both themes. API fixtures only.')
} finally {
  await browser.close()
}
