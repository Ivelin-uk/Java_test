import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { chooseTestCreation } from './helpers/test-creation.mjs'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const auth = { token: 'matching-authoring-fixture', user: { id: 101, name: 'Matching Teacher', email: 'matching@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const pairs = [{ left: 'България', right: 'София' }, { left: 'Франция', right: 'Париж' }, { left: 'Италия', right: 'Рим' }]
const generated = { type: 'MATCHING', text: 'Свържете държавите със столиците.', difficulty: 'MEDIUM', points: 2, timeSeconds: 60, options: [], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'Държави и столици.', matchingPairs: pairs }
const rows = new Map(), generations = [], errors = []
let invalidGeneration = false, jobId = 301
const jobs = new Map()
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    if (!path.startsWith('/api/')) return route.continue()
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin }, body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/v1/subjects') return respond([{ name: 'География', preset: false }])
      if (['/api/v1/subjects/topics', '/api/v1/subjects/topics/personal'].includes(path)) return respond([])
      if (path === '/api/v1/tests') return respond([...rows.values()])
      if (['/api/v1/groups', '/api/v1/assignments', '/api/v1/grading'].includes(path)) return respond([])
      const test = path.match(/^\/api\/v1\/tests\/(\d+)$/)
      if (test) return respond(rows.get(Number(test[1])))
      const job = path.match(/^\/api\/v1\/ai\/test-generations\/(\d+)$/)
      if (job) return respond(jobs.get(Number(job[1])))
    }
    if (method === 'POST' && path === '/api/v1/ai/test-generations') {
      generations.push(request.postDataJSON())
      const q = invalidGeneration ? { ...generated, matchingPairs: [pairs[0], pairs[0]] } : generated
      const result = { id: jobId++, status: 'completed', result_json: JSON.stringify({ definition: { title: 'Столици', description: '', subject: 'География', level: '', language: 'bg', instructions: '', gradingScale: 'bulgarian', passThreshold: 50, questions: [q] } }), error_message: null }
      jobs.set(result.id, result)
      return respond({ ...result, status: 'queued', result_json: null })
    }
    const update = path.match(/^\/api\/v1\/tests\/(\d+)$/)
    if (method === 'POST' && path === '/api/v1/tests' || method === 'PUT' && update) {
      const id = update ? Number(update[1]) : 201, definition = request.postDataJSON()
      const row = { id, owner_id: 101, title: definition.title, status: 'draft', shared: false, definition_json: JSON.stringify(definition), question_count: definition.questions.length, total_time_seconds: 60, updated_at: '2026-11-13T08:00:00Z' }
      rows.set(id, row)
      return respond(row)
    }
    const publish = path.match(/^\/api\/v1\/tests\/(\d+)\/publish$/)
    if (method === 'POST' && publish) { rows.get(Number(publish[1])).status = 'published'; return respond({ id: 401 }) }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await chooseTestCreation(page, 'ai')
  const ai = page.getByRole('region', { name: 'Създаване на тест с AI', exact: true })
  await ai.getByRole('checkbox', { name: 'Свързване на блокчета', exact: true }).check()
  await ai.getByRole('checkbox', { name: 'Един верен отговор', exact: true }).uncheck()
  await ai.getByRole('combobox', { name: 'Дисциплина', exact: true }).fill('География')
  await ai.getByRole('combobox', { name: 'Дисциплина', exact: true }).press('Enter')
  await ai.getByLabel('Тема', { exact: true }).fill('Столици')
  await ai.getByLabel('Въпроси', { exact: true }).fill('1')
  await ai.getByRole('button', { name: 'Генерирай', exact: true }).click()
  await page.getByRole('group', { name: 'Правилни двойки за свързване', exact: true }).waitFor()
  assert.deepEqual(generations[0].questionTypes, ['MATCHING'])
  assert.equal(await page.getByLabel('Въпрос 1, ляво блокче 1', { exact: true }).inputValue(), 'България')

  // Changing types removes stale pairs and restores an editable matching question.
  await page.getByLabel('Тип на въпрос 1', { exact: true }).selectOption('SINGLE_CHOICE')
  assert.equal(await page.getByRole('group', { name: 'Правилни двойки за свързване', exact: true }).count(), 0)
  await page.getByLabel('Тип на въпрос 1', { exact: true }).selectOption('MATCHING')
  await page.getByLabel('Текст', { exact: true }).fill('Свържете държавите със столиците.')
  for (let index = 0; index < 2; index++) {
    await page.getByLabel(`Въпрос 1, ляво блокче ${index + 1}`, { exact: true }).fill(pairs[index].left)
    await page.getByLabel(`Въпрос 1, дясно блокче ${index + 1}`, { exact: true }).fill(pairs[index].right)
  }
  assert.equal(await page.getByRole('button', { name: 'Премахни двойка 1', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Добави двойка', exact: true }).click()
  await page.getByLabel('Въпрос 1, ляво блокче 3', { exact: true }).fill(pairs[2].left)
  await page.getByLabel('Въпрос 1, дясно блокче 3', { exact: true }).fill(pairs[2].right)
  await page.getByRole('button', { name: 'Премахни двойка 3', exact: true }).click()
  const deletion = page.getByRole('dialog', { name: 'Премахване на двойка', exact: true })
  await deletion.getByRole('button', { name: 'Отказ', exact: true }).click()
  assert.equal(await page.getByLabel('Въпрос 1, ляво блокче 3', { exact: true }).inputValue(), pairs[2].left)

  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 1000 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.getByRole('group', { name: 'Правилни двойки за свързване', exact: true }).screenshot({ path: new URL(`matching-authoring-${theme}.png`, artifacts).pathname })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  const saved = JSON.parse(rows.get(201).definition_json)
  assert.deepEqual(saved.questions[0].matchingPairs, pairs)
  assert.deepEqual(saved.questions[0].options, [])
  await page.getByRole('button', { name: 'Столици', exact: true }).click()
  assert.equal(await page.getByRole('list', { name: 'Правилни двойки', exact: true }).getByRole('listitem').count(), 3)
  await page.getByRole('region', { name: 'Избран тест' }).getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  assert.equal(await page.getByLabel('Въпрос 1, дясно блокче 2', { exact: true }).inputValue(), 'Париж')

  await page.getByRole('button', { name: 'Подмени въпрос 1 с AI', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Подмяна на въпрос 1', exact: true })
  assert.equal(await modal.getByRole('checkbox', { name: 'Свързване на блокчета', exact: true }).isChecked(), true)
  invalidGeneration = true
  await modal.getByRole('button', { name: 'Генерирай', exact: true }).click()
  await modal.getByRole('alert').getByText('AI не върна един валиден въпрос. Опитайте с нова заявка.', { exact: true }).waitFor()
  invalidGeneration = false
  await modal.getByRole('button', { name: 'Генерирай', exact: true }).click()
  await modal.getByRole('region', { name: 'Преглед на новия въпрос', exact: true }).getByRole('list', { name: 'Правилни двойки', exact: true }).waitFor()
  await modal.getByRole('button', { name: 'Подмени въпроса', exact: true }).click()
  await modal.waitFor({ state: 'detached' })
  assert.equal(await page.getByLabel('Въпрос 1, ляво блокче 3', { exact: true }).inputValue(), 'Италия')
  assert.deepEqual(errors, [])
  console.log('Passed: MATCHING AI selection, generated/manual pair editor, type switching, deletion cancellation, save/reopen/preview, malformed AI pairs rejection and single-question replacement, mobile light/dark layouts. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: new URL('matching-authoring-failure.png', artifacts).pathname, fullPage: true })
    console.error('Fixture page:', (await page.locator('body').innerText()).slice(0, 1500), 'Browser errors:', errors)
  }
  throw error
} finally {
  await browser.close()
}
