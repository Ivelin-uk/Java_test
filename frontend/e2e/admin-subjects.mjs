import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://127.0.0.1:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const admin = { id: 1, name: 'Администратор', email: 'admin@example.test', role: 'ADMIN', active: true, passwordChangeRequired: false, roleSelectionRequired: false, subscription: { paid: false, paidUntil: null, paidAt: null, active: false }, allowedMethods: [], subscriptionMethods: [] }
const auth = { token: 'admin-subjects-fixture', user: admin }
const subjects = [{ id: 11, name: 'Математика' }, { id: 12, name: 'Немски език' }]
const topics = [{ id: 21, subjectId: 11, name: 'Дроби', level: '' }, { id: 22, subjectId: 11, name: 'Уравнения', level: '7' }, { id: 23, subjectId: 12, name: 'Граматика', level: '8' }]
const errors = [], writes = [], reads = [], teacherQueries = []
let nextSubject = 13, nextTopic = 24, failList = true, failCreate = true, releaseTopic, topicGate = Promise.resolve()
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, colorScheme: 'light' })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
    const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
    const respond = (value, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (method === 'GET') {
      if (path === '/api/auth/google/config') return respond({ enabled: false })
      if (path === '/api/auth/me') return respond(admin)
      if (path === '/api/admin/users') return respond([admin])
      if (['/api/admin/permissions', '/api/admin/audit', '/api/admin/teacher-billing', '/api/admin/teacher-billing/payments'].includes(path)) return respond([])
    }
    if (path.startsWith('/api/admin/subjects')) {
      assert.equal(request.headers().authorization, `Bearer ${auth.token}`)
      if (method === 'GET') reads.push(path)
      const subjectPath = path.match(/^\/api\/admin\/subjects\/(\d+)$/)
      const topicPath = path.match(/^\/api\/admin\/subjects\/(\d+)\/topics(?:\/(\d+))?$/)
      const projection = subject => ({ ...subject, topicCount: topics.filter(topic => topic.subjectId === subject.id).length })
      if (method === 'GET' && path === '/api/admin/subjects') {
        if (failList) { failList = false; return respond({ detail: 'Каталогът временно не е достъпен.' }, 503) }
        return respond(subjects.map(projection))
      }
      if (method === 'GET' && topicPath && !topicPath[2]) return respond(topics.filter(topic => topic.subjectId === Number(topicPath[1])))
      const payload = request.postData() ? request.postDataJSON() : null
      if (['POST', 'PUT', 'DELETE'].includes(method)) writes.push({ method, path, payload })
      if (method === 'POST' && path === '/api/admin/subjects') {
        if (failCreate) { failCreate = false; return respond({ detail: 'Дисциплината не е записана. Опитай отново.' }, 503) }
        const subject = { id: nextSubject++, name: payload.name.trim() }
        subjects.push(subject)
        return respond(projection(subject))
      }
      if (method === 'PUT' && subjectPath) {
        const subject = subjects.find(subject => subject.id === Number(subjectPath[1]))
        subject.name = payload.name.trim()
        return respond(projection(subject))
      }
      if (method === 'DELETE' && subjectPath) {
        const id = Number(subjectPath[1])
        subjects.splice(subjects.findIndex(subject => subject.id === id), 1)
        for (let index = topics.length - 1; index >= 0; index--) if (topics[index].subjectId === id) topics.splice(index, 1)
        return route.fulfill({ status: 204, headers })
      }
      if (method === 'POST' && topicPath && !topicPath[2]) {
        await topicGate
        const topic = { id: nextTopic++, subjectId: Number(topicPath[1]), name: payload.name.trim(), level: payload.level ?? '' }
        topics.push(topic)
        return respond(topic)
      }
      if (method === 'PUT' && topicPath?.[2]) {
        const topic = topics.find(topic => topic.id === Number(topicPath[2]) && topic.subjectId === Number(topicPath[1]))
        Object.assign(topic, { name: payload.name.trim(), level: payload.level ?? '' })
        return respond(topic)
      }
      if (method === 'DELETE' && topicPath?.[2]) {
        topics.splice(topics.findIndex(topic => topic.id === Number(topicPath[2]) && topic.subjectId === Number(topicPath[1])), 1)
        return route.fulfill({ status: 204, headers })
      }
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(frontend)
  assert.equal(reads.length, 0, 'Opening unrelated admin tabs should not load the catalog')
  await page.getByRole('tab', { name: 'Дисциплини и теми', exact: true }).click()
  await page.getByRole('alert').getByText('Каталогът временно не е достъпен.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Зареди дисциплините', exact: true }).click()
  const subjectTable = page.getByRole('table', { name: 'Дисциплини', exact: true })
  const topicTable = page.getByRole('table', { name: 'Теми', exact: true })
  const selectSubject = name => page.getByRole('button', { name: `Избери дисциплина ${name}`, exact: true }).click()
  await selectSubject('Математика')
  await topicTable.getByRole('cell', { name: 'Уравнения', exact: true }).waitFor()
  assert.equal(await topicTable.getByText('Граматика', { exact: true }).count(), 0)
  await selectSubject('Немски език')
  await topicTable.getByRole('cell', { name: 'Граматика', exact: true }).waitFor()
  assert.equal(await topicTable.getByText('Уравнения', { exact: true }).count(), 0)

  await page.getByRole('button', { name: 'Добави дисциплина', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Нова дисциплина', exact: true })
  const save = () => dialog.getByRole('button', { name: 'Запази', exact: true })
  assert.equal(await save().isDisabled(), true)
  await dialog.getByLabel('Име на дисциплината', { exact: true }).fill('Астрономия')
  await save().click()
  await dialog.getByRole('alert').getByText('Дисциплината не е записана. Опитай отново.', { exact: true }).waitFor()
  assert.equal(await dialog.getByLabel('Име на дисциплината', { exact: true }).inputValue(), 'Астрономия')
  await save().click()
  await dialog.waitFor({ state: 'hidden' })
  await subjectTable.getByText('Астрономия', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Редактирай дисциплина Астрономия', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Редакция на дисциплина', exact: true })
  await dialog.getByLabel('Име на дисциплината', { exact: true }).fill('Астрономия и космос')
  await save().click()
  await dialog.waitFor({ state: 'hidden' })
  await selectSubject('Астрономия и космос')

  await page.getByRole('button', { name: 'Добави тема', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Нова тема', exact: true })
  await dialog.getByLabel('Име на темата', { exact: true }).fill('Слънчевата система')
  assert.equal(await dialog.getByLabel('Клас', { exact: true }).inputValue(), '')
  await dialog.getByLabel('Клас', { exact: true }).selectOption('6')
  topicGate = new Promise(resolve => { releaseTopic = resolve })
  await save().click()
  await page.waitForFunction(() => document.querySelector('dialog')?.getAttribute('aria-busy') === 'true')
  assert.equal(await dialog.getByLabel('Име на темата', { exact: true }).isDisabled(), true)
  assert.equal(await dialog.getByRole('button', { name: 'Отказ', exact: true }).isDisabled(), true)
  await page.keyboard.press('Escape')
  assert.equal(await dialog.isVisible(), true)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  const topicCreates = () => writes.filter(write => write.method === 'POST' && write.path.endsWith('/topics'))
  assert.equal(topicCreates().length, 1)
  releaseTopic(); topicGate = Promise.resolve()
  await dialog.waitFor({ state: 'hidden' })
  await topicTable.getByRole('cell', { name: 'Слънчевата система', exact: true }).waitFor()
  assert.equal(topics.find(topic => topic.name === 'Слънчевата система').level, '6')
  assert.equal(topics.find(topic => topic.name === 'Слънчевата система').subjectId, 13)
  await page.getByRole('button', { name: 'Редактирай тема Слънчевата система', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Редакция на тема', exact: true })
  await dialog.getByLabel('Име на темата', { exact: true }).fill('Планети и звезди')
  await dialog.getByLabel('Клас', { exact: true }).selectOption('')
  await save().click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(topics.find(topic => topic.name === 'Планети и звезди').level, '')

  await page.getByRole('button', { name: 'Изтрий тема Планети и звезди', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Изтриване на тема', exact: true })
  await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
  assert.equal(writes.filter(write => write.method === 'DELETE').length, 0)
  await page.getByRole('button', { name: 'Изтрий тема Планети и звезди', exact: true }).click()
  await dialog.getByRole('button', { name: 'Изтрий темата', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(topics.some(topic => topic.name === 'Планети и звезди'), false)
  await page.getByRole('button', { name: 'Изтрий дисциплина Астрономия и космос', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Изтриване на дисциплина', exact: true })
  await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
  assert.equal(subjects.some(subject => subject.name === 'Астрономия и космос'), true)
  await page.getByRole('button', { name: 'Изтрий дисциплина Астрономия и космос', exact: true }).click()
  await dialog.getByRole('button', { name: 'Изтрий дисциплината', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(subjects.some(subject => subject.name === 'Астрономия и космос'), false)

  await page.getByRole('button', { name: 'Добави дисциплина', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Нова дисциплина', exact: true })
  await dialog.getByLabel('Име на дисциплината', { exact: true }).fill('Обща астрономия')
  await save().click()
  await dialog.waitFor({ state: 'hidden' })
  await selectSubject('Обща астрономия')
  await page.getByRole('button', { name: 'Добави тема', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Нова тема', exact: true })
  await dialog.getByLabel('Име на темата', { exact: true }).fill('Галактики')
  await dialog.getByLabel('Клас', { exact: true }).selectOption('9')
  await save().click()
  await dialog.waitFor({ state: 'hidden' })
  await topicTable.getByRole('cell', { name: 'Галактики', exact: true }).waitFor()

  subjects.push({ id: 15, name: 'Дисциплина от базата' })
  await page.getByRole('button', { name: 'Обнови', exact: true }).click()
  await subjectTable.getByText('Дисциплина от базата', { exact: true }).waitFor()
  await selectSubject('Математика')
  for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1050 : 844 })
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Тъмна тема' : 'Светла тема', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await page.screenshot({ path: new URL(`admin-subjects-${theme}-${width}.png`, artifacts).pathname, fullPage: true })
    await page.getByRole('button', { name: 'Добави тема', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Нова тема', exact: true })
    assert.equal(await dialog.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1 }), true)
    await page.screenshot({ path: new URL(`admin-subjects-dialog-${theme}-${width}.png`, artifacts).pathname })
    await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
  }
  await page.reload()
  await page.getByRole('tab', { name: 'Дисциплини и теми', exact: true }).click()
  await subjectTable.getByText('Дисциплина от базата', { exact: true }).waitFor()

  const teacherAuth = { token: 'catalog-teacher-fixture', user: { id: 101, name: 'Учител', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
  const teacherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await teacherContext.addInitScript(value => { localStorage.setItem('quicktest.auth', JSON.stringify(value)); history.replaceState({ examaiView: 'tests' }, '') }, teacherAuth)
  await teacherContext.route(`${base}/api/**`, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
    const respond = value => route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(value) })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    assert.equal(request.headers().authorization, `Bearer ${teacherAuth.token}`)
    if (path === '/api/auth/me') return respond(teacherAuth.user)
    if (path === '/api/v1/tests') return respond([])
    if (path === '/api/v1/subjects') return respond(subjects.map(subject => ({ name: subject.name, preset: true })))
    if (path === '/api/v1/subjects/topics') {
      const subject = subjects.find(subject => subject.name === url.searchParams.get('subject')), level = url.searchParams.get('level')
      teacherQueries.push({ subject: subject?.name, level })
      return respond(topics.filter(topic => topic.subjectId === subject?.id && (!level || !topic.level || topic.level === level)).map(topic => topic.name))
    }
    errors.push(`Unexpected teacher API: ${request.method()} ${path}`)
    return route.fulfill({ status: 404, headers })
  })
  const teacherPage = await teacherContext.newPage()
  teacherPage.on('pageerror', error => errors.push(error.message))
  await teacherPage.goto(frontend)
  await teacherPage.getByRole('button', { name: 'С AI', exact: true }).click()
  const creator = teacherPage.getByRole('region', { name: 'Създаване на тест с AI', exact: true })
  await creator.getByLabel('Дисциплина', { exact: true }).selectOption('Обща астрономия')
  await creator.getByLabel('Клас', { exact: true }).selectOption('9')
  await creator.locator('datalist option[value="Галактики"]').waitFor({ state: 'attached' })
  await creator.getByLabel('Тема', { exact: true }).fill('Галактики')
  await creator.getByLabel('Клас', { exact: true }).selectOption('8')
  await teacherPage.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/v1/subjects/topics' && url.searchParams.get('level') === '8' })
  assert.equal(await creator.locator('datalist option[value="Галактики"]').count(), 0)
  assert.ok(teacherQueries.some(query => query.subject === 'Обща астрономия' && query.level === '9'))
  assert.ok(teacherQueries.some(query => query.subject === 'Обща астрономия' && query.level === '8'))
  await teacherContext.close()
  assert.deepEqual(errors, [])
  console.log('Passed: database catalog loading and retry, subject/topic CRUD and grade values, discipline isolation, failed-save retry, pending-submit guard, delete cancellation, refresh/reload, responsive light/dark administration and teacher AI selection from the admin-managed catalog. API fixtures only.')
} catch (error) {
  if (page) await page.screenshot({ path: new URL('admin-subjects-failure.png', artifacts).pathname, fullPage: true }).catch(() => {})
  throw error
} finally { await browser.close() }
