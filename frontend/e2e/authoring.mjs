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
  await page.getByLabel('Текст', { exact: true }).fill('Кой тип в Java е логически?')
  await page.getByLabel('Опция 1', { exact: true }).fill('boolean')
  await page.getByLabel('Опция 2', { exact: true }).fill('int')
  await page.getByRole('button', { name: 'Публикувай версия', exact: true }).click()
  await page.getByText('Публикувана е нова неизменяема версия.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await page.getByRole('button', { name: title, exact: true }).waitFor()
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
  await page.getByRole('button', { name: 'Публикувай версия', exact: true }).click()
  await page.getByText('Публикувана е нова неизменяема версия.', { exact: true }).waitFor()
  await page.screenshot({ path: new URL('authoring-desktop.png', artifacts).pathname, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: new URL('authoring-mobile.png', artifacts).pathname, fullPage: true })
  await page.getByRole('button', { name: 'Към библиотеката', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Тестове', exact: true }).click()
  await page.getByRole('button', { name: title, exact: true }).waitFor()
  await page.getByRole('button', { name: aiTitle, exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Passed: manual creation, live AI generation, automatic editor, publication, persistence, desktop/mobile layout.')
} finally {
  await browser.close()
}
