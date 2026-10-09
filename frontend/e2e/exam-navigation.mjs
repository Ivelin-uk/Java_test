import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'exam-navigation-fixture', user: { id: 101, name: 'Student', email: 'student@example.test', role: 'STUDENT', active: true, passwordChangeRequired: false } }
const assignment = { id: 301, title: 'Последователни въпроси', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), max_attempts: 1, canceled: false }
const definitions = [
  { id: 501, text: 'Първи въпрос', type: 'SINGLE_CHOICE', options: Array.from({ length: 10 }, (_, i) => ({ id: `first-${i}`, text: `Отговор ${i + 1} с достатъчно дълъг текст за проверка на превъртането.` })) },
  { id: 502, text: 'Втори въпрос', type: 'OPEN_ANSWER', options: [] },
  { id: 503, text: 'Последен въпрос', type: 'SINGLE_CHOICE', options: [{ id: 'last-1', text: 'Да' }, { id: 'last-2', text: 'Не' }] },
]
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const errors = []
let page
try {
  for (const scenario of [{ name: 'automatic', strict: true, width: 1440, gated: true }, { name: 'retry', strict: false, width: 320, failAnswer: true, failOpen: true }, { name: 'fullscreen-loss', strict: true, width: 1440, gated: true, loseFullscreen: true }, { name: 'hidden', strict: false, width: 390, gated: true, hidden: true }]) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: 844 } })
    await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
    page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    let current = 0, status = 'in_progress', questionStatus = 'open', deadline = Date.now() + 180000
    let failedAnswer = false, failedOpen = false, firstOpen = true
    let releaseAnswer, markAnswer, releaseOpen, markOpen
    const answerGate = new Promise(resolve => { releaseAnswer = resolve }), answerSeen = new Promise(resolve => { markAnswer = resolve })
    const openGate = new Promise(resolve => { releaseOpen = resolve }), openSeen = new Promise(resolve => { markOpen = resolve })
    const answerCalls = [], accepted = [], openCalls = []
    function state() {
      return { id: 401, assignment_id: assignment.id, status, server_now: new Date().toISOString(), question_number: current + 1, question_count: definitions.length, question: status === 'in_progress' ? { ...definitions[current], status: questionStatus, maximum_points: 1, time_seconds: 180, open_instance: questionStatus === 'open' ? `instance-${current}` : null, opened_at: questionStatus === 'open' ? new Date(deadline - 180000).toISOString() : null, deadline_at: questionStatus === 'open' ? new Date(deadline).toISOString() : null, draft: null } : null }
    }
    await page.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
      const unavailable = () => route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'Временно прекъсната връзка.' }) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (method === 'GET') {
        const data = { '/api/auth/me': auth.user, '/api/v1/assignments': [assignment], '/api/v1/results': [], '/api/v1/attempts': [], [`/api/v1/assignments/${assignment.id}/preflight`]: { ...assignment, total_seconds: 540, question_count: 3, instructions: '', fullscreen_exempt: !scenario.strict } }
        if (Object.hasOwn(data, path)) return respond(data[path])
        if (path === '/api/v1/attempts/401/state') return respond(state())
      }
      if (method === 'POST' && path === `/api/v1/assignments/${assignment.id}/attempts`) {
        const body = request.postDataJSON()
        assert.equal(body.code, 'ABCDEFGH'); assert.equal(body.visible, true)
        if (scenario.strict) assert.equal(body.fullscreenActive, true)
        deadline = Date.now() + 180000
        return respond(state())
      }
      if (method === 'PUT' && /\/attempts\/401\/questions\/\d+\/draft$/.test(path)) return respond(state())
      if (method === 'POST' && /\/attempts\/401\/questions\/\d+\/answer$/.test(path)) {
        const body = request.postDataJSON()
        answerCalls.push(body)
        if (scenario.failAnswer && !failedAnswer) { failedAnswer = true; return unavailable() }
        assert(path.includes(`/questions/${definitions[current].id}/`)); assert.equal(questionStatus, 'open')
        assert.equal(body.openInstance, `instance-${current}`)
        assert.equal(accepted.some(row => row.idempotencyKey === body.idempotencyKey), false)
        accepted.push(body)
        current++
        if (current === definitions.length) status = 'pending_review'
        else questionStatus = 'pending'
        if (scenario.gated && accepted.length === 1) { markAnswer(); await answerGate }
        return respond(state())
      }
      if (method === 'POST' && path === '/api/v1/attempts/401/questions/open') {
        const body = request.postDataJSON()
        openCalls.push(body)
        assert.equal(body.visible, true)
        if (scenario.strict) assert.equal(body.fullscreenActive, true)
        assert.equal(status, 'in_progress'); assert.equal(questionStatus, 'pending')
        if (scenario.failOpen && !failedOpen) { failedOpen = true; return unavailable() }
        if (scenario.gated && firstOpen && !scenario.loseFullscreen && !scenario.hidden) { firstOpen = false; markOpen(); await openGate }
        questionStatus = 'open'; deadline = Date.now() + 180000
        return respond(state())
      }
      if (method === 'POST' && path === '/api/v1/attempts/401/events') return respond(state())
      errors.push(`Unexpected API: ${method} ${path}`)
      return route.fulfill({ status: 404 })
    })
    try {
      await page.goto(frontend)
      await page.getByRole('button', { name: 'Моите тестове', exact: true }).click()
      await page.getByRole('button', { name: 'Подготовка', exact: true }).click()
      await page.getByLabel('Код за достъп', { exact: true }).fill('ABCDEFGH')
      await page.getByRole('button', { name: 'Започни на цял екран', exact: true }).click()
      await page.getByRole('heading', { name: definitions[0].text, exact: true }).waitFor()
      if (scenario.strict) assert.equal(await page.evaluate(() => !!document.fullscreenElement), true)
      await page.getByRole('radio').first().check()
      const confirm = page.getByRole('button', { name: 'Потвърди отговора', exact: true })
      const resume = page.getByRole('button', { name: 'Продължи на цял екран', exact: true })
      await confirm.click()
      if (scenario.failAnswer) {
        await page.getByRole('alert').getByText('Временно прекъсната връзка.', { exact: true }).waitFor()
        assert.equal(await page.getByRole('radio').first().isChecked(), true)
        assert.equal(openCalls.length, 0); assert.equal(accepted.length, 0)
        await confirm.click()
      }
      if (scenario.gated) {
        await answerSeen
        assert.equal(await confirm.isDisabled(), true)
        await confirm.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
        assert.equal(answerCalls.length, 1)
        if (scenario.loseFullscreen) await page.evaluate(() => document.exitFullscreen())
        if (scenario.hidden) await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
        releaseAnswer()
        if (scenario.loseFullscreen || scenario.hidden) {
          await resume.waitFor()
          await page.waitForFunction(() => !document.querySelector('button.primary:disabled'))
          assert.equal(openCalls.length, 0)
          if (scenario.hidden) await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
          await resume.click()
        } else {
          await openSeen
          assert.equal(await resume.isDisabled(), true)
          assert.equal(accepted.length, 1)
          releaseOpen()
        }
      }
      if (scenario.failOpen) {
        await page.getByRole('alert').getByText('Временно прекъсната връзка.', { exact: true }).waitFor()
        await resume.click()
        assert.equal(accepted.length, 1)
      }
      await page.getByRole('heading', { name: definitions[1].text, exact: true }).waitFor()
      assert.equal(await resume.count(), 0)
      assert.equal(await page.getByLabel('Отговор', { exact: true }).inputValue(), '')
      assert.equal(await page.evaluate(() => document.querySelector('.exam-screen').scrollTop === 0 && scrollY === 0), true)
      assert.equal(await page.getByRole('heading', { name: definitions[1].text, exact: true }).evaluate(element => element === document.activeElement), true)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: new URL(`next-question-${scenario.name}.png`, artifacts).pathname })
      await page.getByLabel('Отговор', { exact: true }).fill('Инстанция на клас.')
      await confirm.click()
      await page.getByRole('heading', { name: definitions[2].text, exact: true }).waitFor()
      assert.equal(await page.getByRole('radio', { checked: true }).count(), 0)
      await confirm.click()
      await page.getByRole('heading', { name: 'Опитът е предаден', exact: true }).waitFor()
      assert.equal(accepted.length, 3)
      assert.deepEqual(accepted.map(row => row.answer), [{ optionIds: ['first-0'], text: '' }, { optionIds: [], text: 'Инстанция на клас.' }, { optionIds: [], text: '' }])
      assert.equal(openCalls.length, scenario.failOpen ? 3 : 2)
    } finally {
      releaseAnswer(); releaseOpen()
      await context.close()
    }
  }
  assert.deepEqual(errors, [])
  console.log('Passed: automatic next question, native fullscreen and exempt mode, no extra continue click, fresh timer and answer, scroll/focus reset, final submission, answer/open failure recovery, duplicate-click guard, fullscreen/visibility safeguards, desktop/mobile. API fixtures only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('exam-navigation-failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally {
  await browser.close()
}
