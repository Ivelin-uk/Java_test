import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'ai-source-material-fixture', user: { id: 101, name: 'AI Teacher', email: 'source-material@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const sourceText = 'Лекция: Основи на Java.\nПроменливата boolean приема стойности true и false.\nКласът описва полета и методи.'
const replacementText = 'Презентация: Колекции в Java.\nList пази подредени елементи. Set пази уникални елементи.'
const question = { type: 'SINGLE_CHOICE', text: 'Original question about variables', difficulty: 'MEDIUM', points: 1, timeSeconds: 60, options: [{ text: 'boolean', correct: true }, { text: 'int', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'Logical values.' }
const original = { title: 'Java original', description: 'Original description', subject: 'Java', level: '10', instructions: 'Original instructions', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, additionalInformation: 'Original teacher context', questions: [question] }
const stored = { id: 201, owner_id: auth.user.id, title: original.title, status: 'draft', shared: false, definition_json: JSON.stringify(original), question_count: 1, total_time_seconds: 60, updated_at: new Date().toISOString() }
const uploadPath = '/api/v1/ai/test-generations/source-material'
const generationPath = '/api/v1/ai/test-generations'
const uploads = [], generations = [], errors = []
const generationError = 'Generation fixture unavailable; the form can be tried again.'
let rejectUpload = true, finishPending
const pendingUpload = new Promise(resolve => { finishPending = resolve })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const file = (name, text = 'Fixture document bytes', mimeType = 'application/octet-stream') => ({ name, mimeType, buffer: Buffer.from(text) })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/v1/tests') return respond([stored])
      if (path === '/api/v1/tests/201') return respond(stored)
      if (['/api/v1/groups', '/api/v1/assignments', '/api/v1/grading'].includes(path)) return respond([])
    }
    if (method === 'POST' && path === uploadPath) {
      const payload = request.postDataJSON()
      uploads.push(payload)
      if (payload.fileName === 'retry.pdf' && rejectUpload) {
        rejectUpload = false
        return respond({ detail: 'Документът не съдържа четим текст.' }, 422)
      }
      if (payload.fileName === 'pending.pptx') await pendingUpload
      const text = payload.fileName === 'replacement.pptx' ? replacementText : sourceText
      return respond({ fileName: payload.fileName, sourceText: text, characterCount: text.length })
    }
    if (method === 'POST' && path === generationPath) {
      generations.push(request.postDataJSON())
      return respond({ detail: generationError }, 503)
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return route.fulfill({ status: 404 })
  })
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: 'С AI', exact: true }).click()
  const creator = page.getByRole('region', { name: 'Създаване на тест с AI', exact: true })
  const input = creator.getByLabel('Лекция или презентация', { exact: true })
  const useMaterial = creator.getByRole('checkbox', { name: 'Генерирай тест по качения материал', exact: true })
  const generate = creator.getByRole('button', { name: 'Генерирай', exact: true })
  const remove = creator.getByRole('button', { name: 'Премахни материала', exact: true })
  await input.waitFor({ state: 'attached' })
  for (const extension of ['.pdf', '.pptx', '.docx', '.txt']) assert.ok((await input.getAttribute('accept')).includes(extension))
  assert.equal(await useMaterial.isChecked(), false)
  assert.equal(await useMaterial.isDisabled(), true)
  assert.equal(await creator.getByLabel('Тема', { exact: true }).inputValue(), '')
  await creator.getByLabel('Тема', { exact: true }).fill('Основи на Java')
  assert.equal(await generate.isEnabled(), true)

  await input.setInputFiles(file('lecture.exe'))
  await creator.getByRole('alert').getByText('Изберете PDF, PPTX, DOCX или TXT файл.', { exact: true }).waitFor()
  assert.equal(uploads.length, 0)
  await input.setInputFiles({ name: 'too-large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) })
  await creator.getByRole('alert').getByText('Файлът трябва да е до 8 MB.', { exact: true }).waitFor()
  assert.equal(uploads.length, 0)
  assert.equal(await generate.isEnabled(), true)

  const lectureName = 'Лекция 01 — Основи на Java и примери за работа с променливи.pptx'
  const lectureBytes = 'Presentation fixture bytes with Cyrillic: лекция'
  await input.setInputFiles(file(lectureName, lectureBytes))
  await creator.getByText(lectureName, { exact: true }).waitFor()
  await creator.getByRole('status').filter({ hasText: `${sourceText.length.toLocaleString('bg-BG')} символа текст` }).waitFor()
  assert.equal(await useMaterial.isChecked(), true)
  assert.equal(await useMaterial.isEnabled(), true)
  assert.equal(uploads.length, 1)
  assert.deepEqual(Object.keys(uploads[0]).sort(), ['base64', 'fileName'])
  assert.equal(uploads[0].fileName, lectureName)
  assert.equal(Buffer.from(uploads[0].base64, 'base64').toString(), lectureBytes)
  await creator.getByLabel('Допълнителна информация за теста', { exact: true }).fill('Само въпроси за понятията в материала.')
  for (const { theme, width } of [{ theme: 'light', width: 1440 }, { theme: 'dark', width: 1440 }, { theme: 'light', width: 390 }, { theme: 'dark', width: 320 }]) {
    await page.setViewportSize({ width, height: 1000 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await creator.evaluate(element => [...element.querySelectorAll('input,select,textarea,button')].filter(control => control.checkVisibility()).every(control => { const bounds = control.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth })), true)
    await page.screenshot({ path: new URL(`ai-source-material-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  async function submit(scope, button) {
    const received = page.waitForResponse(response => new URL(response.url()).pathname === generationPath && response.request().method() === 'POST')
    await button.click()
    await received
    await page.getByRole('alert').getByText(generationError, { exact: true }).first().waitFor()
    assert.equal(await scope.getByRole('button', { name: 'Генерирай', exact: true }).isEnabled(), true)
    return generations.at(-1)
  }
  await useMaterial.uncheck()
  const withoutSource = await submit(creator, generate)
  assert.equal(Object.hasOwn(withoutSource, 'sourceText'), false)
  assert.equal(withoutSource.sourceOnly, false)
  assert.equal(withoutSource.additionalInformation, 'Само въпроси за понятията в материала.')
  assert.equal(await creator.getByText(lectureName, { exact: true }).isVisible(), true)
  await useMaterial.check()
  const withSource = await submit(creator, generate)
  assert.equal(withSource.sourceText, sourceText)
  assert.equal(withSource.sourceOnly, true)
  assert.equal(uploads.length, 1)
  await remove.click()
  assert.equal(await useMaterial.isChecked(), false)
  assert.equal(await useMaterial.isDisabled(), true)
  assert.equal(await creator.getByText(lectureName, { exact: true }).count(), 0)
  assert.equal(await generate.isEnabled(), true)

  await input.setInputFiles(file('retry.pdf'))
  await creator.getByRole('alert').getByText('Документът не съдържа четим текст.', { exact: true }).waitFor()
  assert.equal(await useMaterial.isChecked(), false)
  assert.equal(await useMaterial.isDisabled(), true)
  assert.equal(await generate.isEnabled(), true)
  await input.setInputFiles(file('retry.pdf'))
  await creator.getByRole('status').filter({ hasText: `${sourceText.length.toLocaleString('bg-BG')} символа текст` }).waitFor()
  assert.equal(await useMaterial.isChecked(), true)
  assert.equal(uploads.filter(upload => upload.fileName === 'retry.pdf').length, 2)

  const pendingRequest = page.waitForRequest(request => new URL(request.url()).pathname === uploadPath && request.method() === 'POST' && request.postDataJSON().fileName === 'pending.pptx')
  await input.setInputFiles(file('pending.pptx'))
  await pendingRequest
  assert.equal(await generate.isDisabled(), true)
  await creator.getByLabel('Тема', { exact: true }).fill('Колекции в Java')
  await creator.locator('form').evaluate(form => form.requestSubmit())
  assert.equal(generations.length, 2)
  await remove.click()
  assert.equal(await useMaterial.isDisabled(), true)
  assert.equal(await generate.isEnabled(), true)
  await input.setInputFiles(file('replacement.pptx'))
  await creator.getByRole('status').filter({ hasText: `${replacementText.length.toLocaleString('bg-BG')} символа текст` }).waitFor()
  assert.equal(await useMaterial.isChecked(), true)
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === uploadPath && response.request().postDataJSON().fileName === 'pending.pptx')
  finishPending()
  await oldResponse
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await creator.getByText('replacement.pptx', { exact: true }).isVisible(), true)
  assert.equal(await creator.getByText('pending.pptx', { exact: true }).count(), 0)
  assert.equal(await creator.getByLabel('Тема', { exact: true }).inputValue(), 'Колекции в Java')
  const replacement = await submit(creator, generate)
  assert.equal(replacement.sourceText, replacementText)
  assert.equal(replacement.sourceOnly, true)
  await remove.click()
  const removed = await submit(creator, generate)
  assert.equal(Object.hasOwn(removed, 'sourceText'), false)
  assert.equal(removed.sourceOnly, false)

  await creator.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await page.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  const settings = page.getByRole('group', { name: 'Настройки на теста', exact: true })
  await settings.getByRole('button', { name: 'Добави с AI', exact: true }).click()
  const appendForm = page.getByRole('form', { name: 'Добавяне на въпроси с AI', exact: true })
  const appendMaterial = appendForm.getByRole('checkbox', { name: 'Генерирай тест по качения материал', exact: true })
  await appendForm.getByLabel('Лекция или презентация', { exact: true }).setInputFiles(file('append.docx'))
  await appendForm.getByRole('status').filter({ hasText: `${sourceText.length.toLocaleString('bg-BG')} символа текст` }).waitFor()
  assert.equal(await appendMaterial.isChecked(), true)
  const appendSource = await submit(appendForm, appendForm.getByRole('button', { name: 'Генерирай', exact: true }))
  assert.equal(appendSource.sourceText, sourceText)
  assert.equal(appendSource.sourceOnly, true)
  await appendMaterial.uncheck()
  const appendFallback = await submit(appendForm, appendForm.getByRole('button', { name: 'Генерирай', exact: true }))
  assert.ok(appendFallback.sourceText.includes(question.text))
  assert.ok(appendFallback.sourceText.includes(original.description))
  assert.equal(appendFallback.sourceText.includes(sourceText), false)
  assert.equal(appendFallback.sourceOnly, false)
  assert.equal(await page.locator('.ws-question').count(), 1)
  assert.deepEqual(JSON.parse(stored.definition_json), original)
  assert.deepEqual(errors, [])
  console.log('Passed: lecture/presentation file validation and upload, material checkbox controls generation, safe upload error retry, processing blocks generation, removed upload cannot replace newer material, append source/fallback context, responsive layouts in both themes. API fixtures only.')
} finally {
  finishPending()
  await browser.close()
}
