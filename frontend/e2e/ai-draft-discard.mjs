import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { mockSubjectCatalog } from './helpers/subjects.mjs'
import { chooseTestCreation } from './helpers/test-creation.mjs'

// Every API call is a fixture; no existing account, test or generated job is changed.
const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'ai-discard-fixture', user: { id: 101, name: 'Discard Teacher', email: 'discard@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const question = text => ({ type: 'SINGLE_CHOICE', text, difficulty: 'HARD', points: 2, timeSeconds: 90, options: [{ text: 'Correct', correct: true }, { text: 'Other', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'Keep this explanation.' })
const settings = { topic: 'Retained generation topic', subject: 'Java', level: '5', questionCount: 3, difficulty: 'HARD', gradingScale: 'percentage', passThreshold: 65, additionalInformation: 'Keep the original instructions.\nGenerate practical questions.' }
const definitions = []
const errors = [], mutations = []
let stored = null, generationPosts = 0
let releaseUpload, releaseSave
const uploadGate = new Promise(resolve => { releaseUpload = resolve })
const saveGate = new Promise(resolve => { releaseSave = resolve })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const png = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#23836b'; ctx.fillRect(0, 0, 20, 20); return canvas.toDataURL('image/png').split(',')[1] }), 'base64')
  await page.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/v1/tests') return respond(stored ? [stored] : [])
      if (path === '/api/v1/tests/201') return respond(stored)
      if (path === '/api/v1/files/501') return route.fulfill({ status: 200, contentType: 'image/png', body: png })
      if (['/api/v1/groups', '/api/v1/assignments', '/api/v1/grading', '/api/v1/subjects/topics/personal'].includes(path)) return respond([])
    } else {
      mutations.push({ path, method, body: request.postData() ? request.postDataJSON() : null })
      if (method === 'POST' && path === '/api/v1/ai/test-generations') {
        generationPosts++
        const payload = request.postDataJSON()
        const definition = { title: payload.topic, description: `Description ${generationPosts}`, subject: payload.subject, level: payload.level, instructions: `Exam instructions ${generationPosts}`, language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, additionalInformation: payload.additionalInformation, questions: Array.from({ length: payload.questionCount }, (_, index) => question(`Generation ${generationPosts}, question ${index + 1}`)) }
        definitions.push(definition)
        return respond({ id: 300 + generationPosts, status: 'completed', result_json: JSON.stringify({ definition }), error_message: null })
      }
      if (method === 'POST' && path === '/api/v1/files') { await uploadGate; return respond({ id: 501 }) }
      if (['POST', 'PUT'].includes(method) && ['/api/v1/tests', '/api/v1/tests/201'].includes(path)) {
        await saveGate
        const value = request.postDataJSON()
        stored = { id: 201, owner_id: auth.user.id, title: value.title, status: 'published', shared: false, definition_json: JSON.stringify(value), question_count: value.questions.length, total_time_seconds: value.questions.reduce((total, item) => total + item.timeSeconds, 0), updated_at: new Date().toISOString() }
        return respond(stored)
      }
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
  await creator.getByLabel('Дисциплина', { exact: true }).fill(settings.subject)
  await creator.getByRole('option', { name: settings.subject, exact: true }).click()
  await creator.getByLabel('Тема', { exact: true }).fill(settings.topic)
  await creator.getByLabel('Клас', { exact: true }).selectOption(settings.level)
  await creator.getByLabel('Въпроси', { exact: true }).fill(String(settings.questionCount))
  await creator.getByLabel('Трудност', { exact: true }).selectOption(settings.difficulty)
  await creator.getByLabel('Скала', { exact: true }).selectOption(settings.gradingScale)
  await creator.getByLabel('Праг за успех (%)', { exact: true }).fill(String(settings.passThreshold))
  await creator.getByLabel('Допълнителна информация за теста', { exact: true }).fill(settings.additionalInformation)
  await creator.getByRole('button', { name: 'Генерирай', exact: true }).click()
  const discard = page.getByRole('button', { name: 'Откажи', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Отказ от генерирания тест', exact: true })
  await discard.first().waitFor()
  assert.equal(await discard.count(), 2, 'A new AI draft has header and footer discard actions')
  assert.equal(await discard.first().isDisabled(), true)
  assert.equal(await discard.last().isDisabled(), true)
  await page.waitForFunction(() => [...document.querySelectorAll('button')].filter(button => button.textContent.trim() === 'Откажи').every(button => !button.disabled))
  const prompts = page.locator('.ws-question').getByLabel('Текст', { exact: true })
  await prompts.first().fill('Teacher edit retained when dismissing confirmation')
  const mutationCount = mutations.length
  await discard.last().click()
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Продължи редакцията', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await prompts.first().innerText(), 'Teacher edit retained when dismissing confirmation')
  await discard.first().click()
  await dialog.waitFor()
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await prompts.first().innerText(), 'Teacher edit retained when dismissing confirmation')
  assert.equal(await discard.first().evaluate(element => element === document.activeElement), true)
  assert.equal(mutations.length, mutationCount, 'Dismissing the dialog does not mutate anything')
  const footer = page.locator('.ws-editor-footer')
  await footer.scrollIntoViewIfNeeded()
  await page.screenshot({ path: new URL('ai-discard-footer-desktop.png', artifacts).pathname })
  await page.setViewportSize({ width: 390, height: 844 })
  await discard.last().scrollIntoViewIfNeeded()
  assert.equal(await discard.last().evaluate(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight }), true)
  await page.screenshot({ path: new URL('ai-discard-footer-mobile.png', artifacts).pathname })
  await discard.last().click()
  await dialog.waitFor()
  assert.equal(await dialog.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight }), true)
  await page.screenshot({ path: new URL('ai-discard-dialog-mobile.png', artifacts).pathname })
  await dialog.getByRole('button', { name: 'Изхвърли черновата', exact: true }).click()
  await creator.waitFor()
  assert.equal(await page.locator('.ws-question').count(), 0)
  assert.equal(await discard.count(), 0)
  assert.equal(stored, null)
  assert.equal(mutations.length, mutationCount, 'Discard is local: it never saves, deletes or submits another AI request')
  for (const [name, expected] of [['Дисциплина', settings.subject], ['Тема', settings.topic], ['Клас', settings.level], ['Въпроси', String(settings.questionCount)], ['Трудност', settings.difficulty], ['Скала', settings.gradingScale], ['Праг за успех (%)', String(settings.passThreshold)], ['Допълнителна информация за теста', settings.additionalInformation]]) assert.equal(await creator.getByLabel(name, { exact: true }).inputValue(), expected)

  // A second generation starts cleanly and has its own cancellable draft.
  await page.setViewportSize({ width: 1280, height: 800 })
  await creator.getByRole('button', { name: 'Генерирай', exact: true }).click()
  await discard.first().waitFor()
  assert.equal(await discard.first().isDisabled(), true)
  await page.waitForFunction(() => [...document.querySelectorAll('button')].filter(button => button.textContent.trim() === 'Откажи').every(button => !button.disabled))
  assert.deepEqual(await prompts.allInnerTexts(), definitions[1].questions.map(item => item.text))
  assert.equal(generationPosts, 2)
  assert.equal(await page.getByText('Teacher edit retained when dismissing confirmation', { exact: true }).count(), 0)

  // Upload and save must lock both discard actions, so pending work cannot be lost.
  const uploadRequest = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/files')
  await page.getByLabel('Снимка към условието', { exact: true }).first().setInputFiles({ name: 'question.png', mimeType: 'image/png', buffer: png })
  await uploadRequest
  assert.equal(await discard.first().isDisabled(), true)
  assert.equal(await discard.last().isDisabled(), true)
  releaseUpload()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].filter(button => button.textContent.trim() === 'Откажи').every(button => !button.disabled))
  const saveRequest = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/tests')
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await saveRequest
  assert.equal(await discard.first().isDisabled(), true)
  assert.equal(await discard.last().isDisabled(), true)
  releaseSave()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  assert.equal(await discard.count(), 0)
  const savedDefinition = JSON.parse(stored.definition_json)
  assert.deepEqual(savedDefinition.questions, definitions[1].questions.map((item, index) => index === 0 ? { ...item, imageId: 501 } : item))
  await page.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  assert.equal(await discard.count(), 0, 'Saved tests never expose whole AI draft discard')
  await page.getByRole('group', { name: 'Настройки на теста', exact: true }).getByRole('button', { name: 'Добави с AI', exact: true }).click()
  const append = page.getByRole('form', { name: 'Добавяне на въпроси с AI', exact: true })
  await append.getByLabel('Въпроси', { exact: true }).fill('1')
  await append.getByRole('button', { name: 'Генерирай', exact: true }).click()
  await page.getByRole('progressbar', { name: 'Показани AI въпроси', exact: true }).waitFor()
  assert.equal(await discard.count(), 0, 'Adding AI questions cannot discard the original test')
  await page.waitForFunction(() => { const save = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Запази теста'); return save && !save.disabled })
  assert.deepEqual((await prompts.allInnerTexts()).slice(0, settings.questionCount), savedDefinition.questions.map(item => item.text))
  assert.equal(await discard.count(), 0)
  await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await chooseTestCreation(page, 'manual')
  await page.getByRole('group', { name: 'Настройки на теста', exact: true }).waitFor()
  assert.equal(await discard.count(), 0, 'Manual drafts do not inherit the AI discard action')
  assert.equal(generationPosts, 3)
  assert.equal(mutations.filter(item => ['POST', 'PUT'].includes(item.method) && ['/api/v1/tests', '/api/v1/tests/201'].includes(item.path)).length, 1)
  assert.equal(mutations.some(item => item.method === 'DELETE'), false)
  assert.deepEqual(errors, [])
  console.log('Passed: AI draft discard in header/footer, cancel/Escape retain edits, confirm discards locally with retained settings, regenerate has no stale result, reveal/upload/save locks, saved/append/manual exclusions, desktop/mobile layouts. API fixtures only.')
} finally {
  releaseUpload()
  releaseSave()
  await browser.close()
}
