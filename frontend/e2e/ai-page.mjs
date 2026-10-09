import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'ai-page-fixture', user: { id: 101, name: 'AI Teacher', email: 'ai-page@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const question = text => ({ type: 'SINGLE_CHOICE', text, difficulty: 'MEDIUM', points: 1, timeSeconds: 60, options: [{ text: 'boolean', correct: true }, { text: 'int', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'A logical value.' })
const definition = { title: 'AI generated test', description: 'Generated description', subject: 'Java', level: '12', instructions: '', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, questions: [question('First generated question'), question('Second generated question')] }
const mutations = [], errors = []
let jobStatus = 'running', failRetry = true, pollCount = 0, stored = null
const job = status => ({ id: 301, status, result_json: status === 'completed' ? JSON.stringify({ definition }) : null, error_message: status === 'failed' ? 'AI fixture failure.' : null })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (method === 'GET') {
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/v1/tests') return respond(stored ? [stored] : [])
      if (path === '/api/v1/assignments' || path === '/api/v1/grading') return respond([])
      if (path === '/api/v1/ai/test-generations/301') {
        pollCount++
        if (pollCount === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Temporary connection failure.' }) })
        return respond(job(jobStatus))
      }
    } else {
      mutations.push({ method, path, body: request.postData() ? request.postDataJSON() : null })
      if (method === 'POST' && path === '/api/v1/ai/test-generations') return respond(job('queued'))
      if (method === 'POST' && path === '/api/v1/ai/test-generations/301/retry') {
        if (failRetry) { failRetry = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Retry unavailable.' }) }) }
        jobStatus = 'running'
        return respond(job('queued'))
      }
      if (method === 'POST' && path === '/api/v1/tests') {
        const draft = request.postDataJSON()
        stored = { id: 201, title: draft.title, owner_id: auth.user.id, status: 'draft', shared: false, definition_json: JSON.stringify(draft), updated_at: new Date().toISOString(), question_count: draft.questions.length, total_time_seconds: 120 }
        return respond(stored)
      }
      if (method === 'POST' && path === '/api/v1/tests/201/publish') { stored.status = 'published'; return respond({ id: 202 }) }
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return route.fulfill({ status: 404 })
  })
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: 'С AI', exact: true }).click()
  const creator = page.getByRole('region', { name: 'Създаване на тест с AI', exact: true })
  await creator.getByRole('heading', { name: 'Създаване на тест с AI', exact: true }).waitFor()
  assert.equal(await page.getByRole('table', { name: 'Тестове', exact: true }).count(), 0)
  assert.equal(await creator.getByLabel('Тема', { exact: true }).evaluate(element => element === document.activeElement), true)
  await creator.getByLabel('Тема', { exact: true }).fill('State retained')
  await creator.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  await page.getByRole('button', { name: 'С AI', exact: true }).click()
  assert.equal(await creator.getByLabel('Тема', { exact: true }).inputValue(), 'State retained')
  const generate = creator.getByRole('button', { name: 'Генерирай', exact: true })
  await creator.getByLabel('Тема', { exact: true }).fill('   ')
  assert.equal(await generate.isDisabled(), true)
  await creator.getByLabel('Тема', { exact: true }).fill('  Java basics  ')
  await creator.getByLabel('Въпроси', { exact: true }).fill('0')
  assert.equal(await generate.isDisabled(), true)
  await creator.getByLabel('Въпроси', { exact: true }).fill('21')
  assert.equal(await generate.isDisabled(), true)
  await creator.getByLabel('Въпроси', { exact: true }).fill('2')
  await creator.getByRole('checkbox', { name: 'Един верен отговор', exact: true }).uncheck()
  assert.equal(await generate.isDisabled(), true)
  await creator.getByRole('checkbox', { name: 'Един верен отговор', exact: true }).check()
  await creator.getByRole('checkbox', { name: 'Кратък текст', exact: true }).check()
  await creator.getByLabel('Дисциплина', { exact: true }).fill('Java')
  await creator.getByLabel('Клас / ниво', { exact: true }).fill('12')
  await creator.getByLabel('Учебен текст', { exact: true }).fill('Boolean values in Java.')
  await creator.getByRole('combobox', { name: 'Трудност', exact: true }).selectOption('MIXED')
  await creator.getByRole('alert').getByText('Сумата по трудност трябва да е равна на броя въпроси.', { exact: true }).waitFor()
  assert.equal(await generate.isDisabled(), true)
  await creator.getByLabel('Лесни', { exact: true }).fill('1')
  await creator.getByLabel('Средни', { exact: true }).fill('1')
  await creator.getByLabel('Трудни', { exact: true }).fill('0')
  assert.equal(await generate.isDisabled(), false)
  assert.equal(mutations.length, 0)
  for (const { theme, width, height } of [{ theme: 'light', width: 1440, height: 1000 }, { theme: 'dark', width: 1440, height: 1000 }, { theme: 'dark', width: 390, height: 844 }, { theme: 'light', width: 390, height: 844 }]) {
    await page.setViewportSize({ width, height })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await creator.evaluate(element => [...element.querySelectorAll('input,select,textarea,button')].every(control => { const bounds = control.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth })), true)
    await page.screenshot({ path: new URL(`ai-page-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
  }
  await generate.click()
  await creator.getByRole('button', { name: 'Генериране...', exact: true }).waitFor()
  assert.equal(await creator.getByRole('button', { name: 'Към библиотеката', exact: true }).isDisabled(), true)
  assert.equal(await creator.getByLabel('Тема', { exact: true }).isDisabled(), true)
  assert.equal(await creator.getByRole('textbox', { name: 'Учебен текст', exact: true }).isDisabled(), true)
  const payload = mutations[0].body
  assert.equal(payload.topic, 'Java basics')
  assert.equal(payload.questionCount, 2)
  assert.equal(payload.subject, 'Java')
  assert.equal(payload.level, '12')
  assert.equal(payload.sourceText, 'Boolean values in Java.')
  assert.deepEqual(payload.questionTypes, ['SINGLE_CHOICE', 'SHORT_ANSWER'])
  assert.deepEqual(payload.difficultyCounts, { EASY: 1, MEDIUM: 1, HARD: 0, VERY_HARD: 0 })
  await creator.locator('form').evaluate(form => form.requestSubmit())
  assert.equal(mutations.length, 1)
  await creator.getByRole('alert').getByText('Не може да се провери AI заявката. Изчаква се връзка със сървъра.', { exact: true }).waitFor()
  jobStatus = 'failed'
  await creator.getByRole('alert').getByText('AI fixture failure.', { exact: true }).waitFor()
  await creator.getByRole('button', { name: 'Повтори', exact: true }).click()
  await creator.getByRole('alert').getByText('Retry unavailable.', { exact: true }).waitFor()
  assert.equal(await creator.getByLabel('Тема', { exact: true }).inputValue(), '  Java basics  ')
  await creator.getByRole('button', { name: 'Повтори', exact: true }).click()
  await creator.getByRole('button', { name: 'Генериране...', exact: true }).waitFor()
  jobStatus = 'completed'
  await page.getByLabel('Заглавие', { exact: true }).waitFor()
  assert.equal(await creator.count(), 0)
  assert.equal(await page.locator('.ws-question').count(), 2)
  assert.equal(await page.getByLabel('Заглавие', { exact: true }).inputValue(), definition.title)
  assert.equal(stored, null)
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  assert.equal(stored.status, 'published')
  assert.equal(await page.getByRole('button', { name: definition.title, exact: true }).count(), 1)
  assert.equal(mutations.filter(request => request.path === '/api/v1/ai/test-generations').length, 1)
  assert.deepEqual(errors, [])
  console.log('Passed: separate AI page, back navigation, field validation, mixed distribution, disabled pending controls, one generation request, polling recovery, failure/retry, generated draft review and explicit save, desktop/mobile and both themes. API fixtures only.')
} finally {
  await browser.close()
}
