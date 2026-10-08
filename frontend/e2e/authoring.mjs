import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const stamp = Date.now()
const response = await fetch(`${base}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Authoring Teacher', email: `authoring-${stamp}@example.test`, password: 'test-password-123', role: 'TEACHER' }),
})
assert.equal(response.status, 200)
const auth = await response.json()
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),
  headless: true,
})
const errors = []
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(frontend)
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: 'Ръчен тест', exact: true }).click()
  const title = `Manual authoring ${stamp}`
  await page.getByLabel('Заглавие', { exact: true }).fill(title)
  assert.equal(await page.getByRole('button', { name: 'Публикувай версия', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByLabel('Заглавие', { exact: true }).inputValue(), title)
  await page.getByLabel('Текст', { exact: true }).fill('Кой тип в Java е логически?')
  await page.getByLabel('Опция 1', { exact: true }).fill('boolean')
  await page.getByLabel('Опция 2', { exact: true }).fill('int')
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await page.getByText('Тестът е запазен.', { exact: true }).waitFor()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  await page.getByRole('button', { name: title, exact: true }).waitFor()
  await page.getByRole('button', { name: title, exact: true }).click()
  await page.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  await page.getByLabel('Описание', { exact: true }).fill('Edited description')
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  const tests = await fetch(`${base}/api/v1/tests`, { headers: { Authorization: `Bearer ${auth.token}` } }).then(r => r.json())
  const owned = tests.filter(test => test.owner_id === auth.user.id)
  assert.equal(owned.length, 1)
  assert.equal(owned[0].status, 'published')
  await page.getByRole('button', { name: 'С AI', exact: true }).click()
  await page.getByLabel('Въпроси', { exact: true }).fill('5')
  await page.getByRole('button', { name: 'Генерирай', exact: true }).click()
  await Promise.race([
    page.getByLabel('Заглавие', { exact: true }).waitFor({ timeout: 240000 }),
    page.locator('.ws-ai-band .error').waitFor({ timeout: 240000 }).then(async () => {
      throw new Error(await page.locator('.ws-ai-band .error').innerText())
    }),
  ])
  assert.equal(await page.locator('.ws-question').count(), 5)
  const aiTitle = `AI authoring ${stamp}`
  await page.getByLabel('Заглавие', { exact: true }).fill(aiTitle)
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await page.getByText('Тестът е запазен.', { exact: true }).waitFor()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  await page.screenshot({ path: new URL('authoring-desktop.png', artifacts).pathname, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: new URL('authoring-mobile.png', artifacts).pathname, fullPage: true })
  await page.getByRole('button', { name: aiTitle, exact: true }).click()
  await page.getByRole('button', { name: 'Редактирай теста', exact: true }).click()
  assert.equal(await page.getByLabel('Банка с въпроси', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Генерирай избраните отново', exact: true }).count(), 0)
  const originalTexts = await page.locator('.ws-question').getByLabel('Текст', { exact: true }).evaluateAll(elements => elements.map(element => element.value))
  const additions = page.getByRole('region', { name: 'Добавяне на въпроси' })
  await additions.getByLabel('Брой нови въпроси', { exact: true }).fill('0')
  assert.equal(await additions.getByRole('button', { name: 'Ръчно', exact: true }).isDisabled(), true)
  await additions.getByLabel('Брой нови въпроси', { exact: true }).fill('2')
  await additions.getByRole('button', { name: 'Ръчно', exact: true }).click()
  assert.equal(await page.locator('.ws-question').count(), 7)
  assert.equal(await page.locator('.ws-question').nth(5).getByLabel('Текст', { exact: true }).inputValue(), '')
  await page.locator('.ws-question').last().getByRole('button', { name: 'Изтрий въпрос', exact: true }).click()
  await page.locator('.ws-question').last().getByRole('button', { name: 'Изтрий въпрос', exact: true }).click()
  await additions.scrollIntoViewIfNeeded()
  const ordering = await page.evaluate(() => ({ last: [...document.querySelectorAll('.ws-question')].at(-1).getBoundingClientRect().bottom, add: document.querySelector('.ws-add-questions').getBoundingClientRect().top }))
  assert.ok(ordering.add >= ordering.last)
  await page.screenshot({ path: new URL('question-additions-mobile.png', artifacts).pathname })
  await additions.getByRole('button', { name: 'С AI', exact: true }).click()
  await Promise.race([
    page.waitForFunction(() => document.querySelectorAll('.ws-question').length === 7, null, { timeout: 240000 }),
    additions.getByRole('alert').waitFor({ timeout: 240000 }).then(async () => { throw new Error(await additions.getByRole('alert').innerText()) }),
  ])
  assert.equal(await page.getByLabel('Заглавие', { exact: true }).inputValue(), aiTitle)
  const appendedTexts = await page.locator('.ws-question').getByLabel('Текст', { exact: true }).evaluateAll(elements => elements.map(element => element.value))
  assert.deepEqual(appendedTexts.slice(0, 5), originalTexts)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await additions.scrollIntoViewIfNeeded()
  await page.screenshot({ path: new URL('question-additions-desktop.png', artifacts).pathname })
  await page.getByRole('button', { name: 'Запази теста', exact: true }).click()
  await page.getByRole('heading', { name: 'Библиотека с тестове', exact: true }).waitFor()
  const savedTests = await fetch(`${base}/api/v1/tests`, { headers: { Authorization: `Bearer ${auth.token}` } }).then(r => r.json())
  assert.equal(savedTests.filter(test => test.owner_id === auth.user.id).length, 2)
  const savedAi = savedTests.find(test => test.title === aiTitle)
  const stored = await fetch(`${base}/api/v1/tests/${savedAi.id}`, { headers: { Authorization: `Bearer ${auth.token}` } }).then(r => r.json())
  assert.equal(JSON.parse(stored.definition_json).questions.length, 7)
  await page.reload()
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: title, exact: true }).waitFor()
  await page.getByRole('button', { name: aiTitle, exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Passed: manual creation, live AI generation and question append, counted manual additions, preserved original questions and test identity, publication, persistence, desktop/mobile layout.')
} finally {
  await browser.close()
}
