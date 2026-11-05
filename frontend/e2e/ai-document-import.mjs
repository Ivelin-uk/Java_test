import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'ai-document-import-fixture', user: { id: 101, name: 'Учител', email: 'document-import@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const warning = 'Верният отговор на въпрос 2 е предложен от AI. Провери го преди запазване.'
const definition = {
  title: 'Импортирана алгебра', description: 'Тест, разпознат от качен документ.', subject: 'Математика', level: '8', instructions: 'Прочети всяко условие.', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, additionalInformation: '',
  questions: [
    { type: 'SINGLE_CHOICE', text: 'Колко е 2 + 2?', difficulty: 'EASY', points: 2, timeSeconds: 60, options: [{ text: '4', correct: true }, { text: '5', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'Събиране.' },
    { type: 'SHORT_ANSWER', text: 'Колко е 3 × 3?', difficulty: 'MEDIUM', points: 3, timeSeconds: 90, options: [], acceptedAnswers: ['9'], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'Умножение.' },
  ],
}
const imports = [], writes = [], errors = [], tests = []
const importPath = '/api/v1/ai/test-generations/import'
let failImport = true, releaseImport
const importGate = new Promise(resolve => { releaseImport = resolve })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const file = (name, content = 'Document fixture bytes', mimeType = 'application/octet-stream') => ({ name, mimeType, buffer: Buffer.from(content) })
const image = name => ({ name, mimeType: name.endsWith('.png') ? 'image/png' : 'image/jpeg', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' })
  await context.addInitScript(value => {
    localStorage.setItem('quicktest.auth', JSON.stringify(value))
    localStorage.setItem('quicktest.theme', 'light')
    history.replaceState({ examaiView: 'tests' }, '')
  }, auth)
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (method === 'GET') {
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/v1/tests') return respond(tests)
      if (path === '/api/v1/subjects') return respond([{ name: 'Математика', preset: true }])
      if (['/api/v1/subjects/topics', '/api/v1/subjects/topics/personal', '/api/v1/groups', '/api/v1/assignments', '/api/v1/grading'].includes(path)) return respond([])
      const test = tests.find(test => path === `/api/v1/tests/${test.id}`)
      if (test) return respond(test)
    }
    if (method === 'POST' && path === importPath) {
      const body = request.postDataJSON()
      imports.push(body)
      if (body.fileName === 'retry.pdf' && failImport) {
        failImport = false
        return respond({ detail: 'AI не успя да разчете теста. Опитай отново.' }, 502)
      }
      if (body.fileName === 'pending.docx') await importGate
      return respond({ fileName: body.fileName, definition, warnings: [warning] })
    }
    if (method === 'POST' && path === '/api/v1/tests') {
      const body = request.postDataJSON()
      writes.push({ method, path, body })
      const test = { id: 501, public_number: '123456789501', owner_id: auth.user.id, title: body.title, subject: body.subject, level: body.level, status: 'draft', shared: false, mobile_allowed: false, definition_json: JSON.stringify(body), question_count: body.questions.length, total_time_seconds: 150, updated_at: '2026-11-05T12:00:00Z' }
      tests.push(test)
      return respond(test)
    }
    if (method === 'POST' && path === '/api/v1/tests/501/publish') {
      writes.push({ method, path })
      tests[0].status = 'published'
      return respond({ id: 601 })
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(frontend)
  await page.getByRole('button', { name: 'С AI', exact: true }).click()
  const creator = page.getByRole('region', { name: 'Създаване на тест с AI', exact: true })
  const topicTab = creator.getByRole('tab', { name: 'По тема', exact: true })
  const importTab = creator.getByRole('tab', { name: 'Импортирай тест', exact: true })
  const form = creator.getByRole('form', { name: 'Импортиране на тест с AI', exact: true })
  const input = creator.getByLabel('Файл с тест', { exact: true })
  const submit = form.getByRole('button', { name: 'Обработи с AI', exact: true })
  const remove = form.getByRole('button', { name: 'Премахни файла', exact: true })
  const back = creator.getByRole('button', { name: 'Към библиотеката', exact: true })
  const review = page.getByRole('region', { name: 'Преглед на импортиран тест', exact: true })
  async function selected(tab) {
    await tab.and(page.locator('[aria-selected="true"]')).waitFor()
    assert.equal(await tab.getAttribute('tabindex'), '0')
    const panelId = await tab.getAttribute('aria-controls')
    assert.ok(panelId)
    const panel = page.locator(`[id=${JSON.stringify(panelId)}]`)
    await panel.waitFor({ state: 'visible' })
    assert.equal(await panel.getAttribute('role'), 'tabpanel')
    assert.equal(await panel.getAttribute('aria-labelledby'), await tab.getAttribute('id'))
  }
  async function ready() { await submit.and(page.locator(':enabled')).waitFor() }
  async function chooseImport() {
    await page.getByRole('button', { name: 'С AI', exact: true }).click()
    await importTab.click()
    await selected(importTab)
  }
  await selected(topicTab)
  await topicTab.focus()
  for (const [key, tab] of [['ArrowRight', importTab], ['Home', topicTab], ['End', importTab], ['ArrowLeft', topicTab]]) {
    await page.keyboard.press(key)
    await selected(tab)
    assert.equal(await tab.evaluate(element => element === document.activeElement), true)
  }
  await importTab.click()
  await selected(importTab)
  assert.equal(await submit.isDisabled(), true)
  const accept = await input.getAttribute('accept')
  for (const extension of ['.docx', '.pdf', '.png', '.jpg', '.jpeg']) assert.ok(accept.includes(extension))
  await input.setInputFiles(file('unsafe.exe'))
  await form.getByRole('alert').waitFor()
  assert.equal(await submit.isDisabled(), true)
  assert.equal(imports.length, 0)
  await input.setInputFiles({ name: 'too-large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) })
  await form.getByRole('alert').filter({ hasText: '8 MB' }).waitFor()
  assert.equal(imports.length, 0)
  await input.setInputFiles(file('empty.pdf', ''))
  await form.getByRole('alert').waitFor()
  assert.equal(imports.length, 0)
  await input.setInputFiles(file('remove.docx'))
  await ready()
  await form.getByText('remove.docx', { exact: true }).waitFor()
  await remove.click()
  assert.equal(await submit.isDisabled(), true)
  assert.equal(imports.length, 0)

  await input.setInputFiles(file('retry.pdf', 'PDF retry fixture', 'application/pdf'))
  await ready()
  await submit.click()
  await form.getByRole('alert').getByText('AI не успя да разчете теста. Опитай отново.', { exact: true }).waitFor()
  await form.getByText('retry.pdf', { exact: true }).waitFor()
  await ready()
  assert.equal(imports.length, 1)
  assert.equal(writes.length, 0)
  await submit.click()
  await review.getByText('retry.pdf', { exact: true }).waitFor()
  await review.getByText(warning, { exact: true }).waitFor()
  assert.equal(writes.length, 0, 'AI import must open an unsaved draft, never save or publish automatically')
  assert.equal(await page.getByRole('combobox', { name: 'Тема', exact: true }).inputValue(), definition.title)
  assert.equal(await page.getByLabel('Клас', { exact: true }).inputValue(), '8')
  await page.getByRole('textbox', { name: 'Текст', exact: true }).first().waitFor()
  assert.ok((await page.getByRole('textbox', { name: 'Текст', exact: true }).first().innerText()).includes(definition.questions[0].text))
  await page.getByRole('combobox', { name: 'Тема', exact: true }).fill('Редактиран импорт')
  await review.getByText(warning, { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  assert.deepEqual(writes.map(({ method, path }) => ({ method, path })), [{ method: 'POST', path: '/api/v1/tests' }, { method: 'POST', path: '/api/v1/tests/501/publish' }])
  assert.equal(writes[0].body.title, 'Редактиран импорт')
  assert.deepEqual(writes[0].body.questions, definition.questions)
  assert.equal(await review.count(), 0)

  await chooseImport()
  await input.setInputFiles(file('pending.docx', 'Pending Word fixture'))
  await ready()
  const requestCount = imports.length
  const importRequest = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === importPath)
  await form.evaluate(element => { element.requestSubmit(); element.requestSubmit() })
  await importRequest
  assert.equal(await submit.isDisabled(), true)
  assert.equal(await input.isDisabled(), true)
  assert.equal(await remove.isDisabled(), true)
  assert.equal(await back.isDisabled(), true)
  assert.equal(await topicTab.isDisabled(), true)
  assert.equal(await importTab.isDisabled(), true)
  assert.equal(imports.length, requestCount + 1, 'Repeated submit events must trigger one AI request')
  releaseImport()
  await review.getByText('pending.docx', { exact: true }).waitFor()
  assert.equal(writes.length, 2)
  assert.deepEqual(Object.keys(imports.at(-1)).sort(), ['base64', 'fileName'])
  assert.equal(Buffer.from(imports.at(-1).base64, 'base64').toString(), 'Pending Word fixture')
  await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()

  for (const uploaded of [file('existing.pdf', '%PDF mock fixture', 'application/pdf'), image('photo.png'), image('photo.jpg'), image('photo.jpeg')]) {
    await chooseImport()
    await input.setInputFiles(uploaded)
    await ready()
    await submit.click()
    await review.getByText(uploaded.name, { exact: true }).waitFor()
    assert.equal(imports.at(-1).fileName, uploaded.name)
    assert.equal(Buffer.from(imports.at(-1).base64, 'base64').equals(uploaded.buffer), true)
    assert.equal(writes.length, 2)
    await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  }

  await chooseImport()
  await input.setInputFiles(file('Тест по математика — 8 клас.docx'))
  await ready()
  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 })
      await form.scrollIntoViewIfNeeded()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.equal(await form.locator('input,button').evaluateAll(controls => controls.filter(control => control.checkVisibility()).every(control => { const bounds = control.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth })), true)
      await page.screenshot({ path: new URL(`ai-document-import-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
    }
  }
  await submit.click()
  await review.getByText(warning, { exact: true }).waitFor()
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.screenshot({ path: new URL('ai-document-review-desktop.png', artifacts).pathname, fullPage: true })
  await page.setViewportSize({ width: 320, height: 1100 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: new URL('ai-document-review-mobile.png', artifacts).pathname, fullPage: true })
  assert.equal(writes.length, 2)
  assert.deepEqual(errors, [])
  console.log('Passed: AI import tabs/keyboard, Word/PDF/photo file selection and validation, removal, retry, pending controls/double-submit guard, editable review/warnings, no auto-save, manual save/publish, light/dark desktop/mobile. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('ai-document-import-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  releaseImport?.()
  await browser.close()
}
