import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const stamp = Date.now()
const outcomes = []
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
async function request(path, auth, method = 'GET', data) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
  const text = await response.text()
  return { status: response.status, data: text ? JSON.parse(text) : null }
}
async function account(kind) {
  const result = await request('/api/auth/register', null, 'POST', { name: `E2E ${kind} ${stamp}`, email: `e2e-${kind}-${stamp}@example.test`, password: 'test-password-123', role: kind === 'student' ? 'STUDENT' : 'TEACHER' })
  assert.equal(result.status, 200)
  const auth = result.data
  const mailbox = await request('/api/v1/profile/mailbox', auth)
  const token = JSON.parse(mailbox.data[0].payload_json).token
  assert.equal((await request('/api/v1/profile/notification-email/verify', auth, 'POST', { token })).status, 200)
  return auth
}
const teacher = await account('teacher'), student = await account('student'), second = await account('second')
assert.equal((await request('/api/v1/organizations', teacher)).status, 404)
assert.equal((await request('/api/v1/tests', student)).status, 403)
outcomes.push('direct registration without school membership')
const definition = { title: `E2E Exam ${stamp}`, description: '', subject: 'Java', level: '12', instructions: 'Отговорете на двата въпроса.', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50, questions: [
  { type: 'SINGLE_CHOICE', text: 'Кой тип е логически?', difficulty: 'EASY', points: 2, timeSeconds: 120, options: [{ text: 'boolean', correct: true }, { text: 'String', correct: false }], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'boolean' },
  { type: 'OPEN_ANSWER', text: 'Какво е обект?', difficulty: 'MEDIUM', points: 3, timeSeconds: 120, options: [], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: 'Инстанция на клас.', explanation: '' },
] }
const test = (await request('/api/v1/tests', teacher, 'POST', definition)).data
assert.equal((await request(`/api/v1/tests/${test.id}`, second)).status, 403)
outcomes.push('private teacher content and role boundaries')
const version = (await request(`/api/v1/tests/${test.id}/publish`, teacher, 'POST')).data
const group = (await request('/api/v1/groups', teacher, 'POST', { name: `E2E group ${stamp}`, description: '', subject: 'Java' })).data
assert.equal((await request(`/api/v1/groups/${group.id}/members`, teacher, 'POST', { userId: student.user.id })).status, 200)
const assignment = (await request('/api/v1/assignments', teacher, 'POST', { versionId: version.id, groupIds: [group.id], startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), maxAttempts: 1, shuffleQuestions: false, shuffleOptions: false, answersAfterDeadline: true })).data
assert.equal((await request('/api/v1/conversations', teacher)).status, 404)
assert.equal((await request('/ws/chat', teacher)).status, 403)
outcomes.push('chat endpoints removed')
const executablePath = process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
const browser = await chromium.launch({ executablePath, headless: process.env.E2E_HEADED !== 'true', args: ['--disable-gpu'] })
const errors = []
async function pageWith(auth, viewport) {
  const context = await browser.newContext({ viewport })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(frontend)
  await page.getByRole('navigation').waitFor()
  assert.equal(await page.getByRole('combobox', { name: 'Активна организация' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Нова организация', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Чат', exact: true }).count(), 0)
  return { context, page }
}
try {
  const { page: tpage, context: tc } = await pageWith(teacher, { width: 1440, height: 1000 })
  await tpage.getByRole('button', { name: 'Тестове', exact: true }).click()
  await tpage.getByRole('button', { name: definition.title, exact: true }).waitFor()
  await tpage.screenshot({ path: new URL('teacher-desktop.png', artifacts).pathname, fullPage: true })
  const { page, context } = await pageWith(student, { width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Моите тестове', exact: true }).click()
  await page.getByRole('button', { name: 'Подготовка', exact: true }).click()
  await page.getByLabel('Код за достъп').fill(assignment.code)
  await page.getByRole('button', { name: 'Започни на цял екран', exact: true }).click()
  await page.getByRole('heading', { name: 'Кой тип е логически?' }).waitFor()
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), true)
  await page.getByRole('radio', { name: 'boolean', exact: true }).check()
  await page.screenshot({ path: new URL('exam-fullscreen.png', artifacts).pathname, fullPage: true })
  await page.getByRole('button', { name: 'Потвърди отговора', exact: true }).click()
  await page.getByRole('heading', { name: 'Какво е обект?', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Продължи на цял екран', exact: true }).count(), 0)
  await page.getByLabel('Отговор', { exact: true }).fill('Обектът е инстанция на клас.')
  await page.getByRole('button', { name: 'Потвърди отговора', exact: true }).click()
  await page.getByRole('heading', { name: 'Опитът е предаден', exact: true }).waitFor()
  outcomes.push('fullscreen, sequential questions, automatic submission')
  await page.getByRole('button', { name: 'Моите тестове', exact: true }).click()
  await page.getByText('Няма публикувани резултати.', { exact: true }).waitFor()
  outcomes.push('unpublished grades hidden')
  await tpage.getByRole('button', { name: 'Проверка', exact: true }).click()
  await tpage.getByRole('button', { name: student.user.name, exact: true }).click()
  const publish = tpage.locator('.ws-publication').getByRole('button', { name: 'Потвърди', exact: true })
  assert.equal(await publish.isDisabled(), true)
  await tpage.getByLabel('Финални точки', { exact: true }).nth(1).fill('3')
  await tpage.getByRole('button', { name: 'Запази проверката', exact: true }).nth(1).click()
  await publish.click()
  await tpage.getByRole('dialog').getByRole('button', { name: 'Потвърди', exact: true }).click()
  await tpage.getByText('Резултатът е публикуван; известието е в опашката.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Обнови', exact: true }).click()
  await page.getByRole('button', { name: 'Преглед на резултата', exact: true }).click()
  await page.getByText('Подробните отговори ще бъдат достъпни след края на разрешения период.', { exact: true }).waitFor()
  outcomes.push('manual grading, publication, answer release policy')
  await page.getByRole('button', { name: 'Профил', exact: true }).click()
  await page.getByText(`${definition.title} · оценка 6`, { exact: true }).waitFor()
  outcomes.push('transactional local result mail')
  const published = (await request('/api/v1/results', student)).data[0]
  await page.goto(`${frontend}/results/${published.attempt_id}`)
  await page.getByText('Подробните отговори ще бъдат достъпни след края на разрешения период.', { exact: true }).waitFor()
  outcomes.push('protected personal result deep link')
  await context.close(); await tc.close()
  const { page: mobile, context: mc } = await pageWith(student, { width: 390, height: 844 })
  await mobile.getByRole('button', { name: 'Моите тестове', exact: true }).click()
  await mobile.getByText(definition.title, { exact: true }).first().waitFor()
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await mobile.screenshot({ path: new URL('student-mobile.png', artifacts).pathname, fullPage: true })
  await mc.close()
  outcomes.push('mobile layout without page overflow')
  assert.deepEqual(errors, [])
  await writeFile(new URL(process.env.E2E_HEADED === 'true' ? 'headed-browser-report.json' : 'browser-report.json', artifacts), JSON.stringify({ checked: outcomes, pageErrors: errors, nativeFullscreen: process.env.E2E_HEADED === 'true' ? 'headed automated Chrome; manual cross-browser checks remain required' : 'headless only; headed browser verification remains required', fixture: { teacher: teacher.user.id, student: student.user.id, assessment: test.id, assignment: assignment.id } }, null, 2))
  console.log(JSON.stringify({ checked: outcomes, pageErrors: errors }, null, 2))
} finally { await browser.close() }
