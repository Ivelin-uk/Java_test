import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// This is a real HTTP/browser test. Run only against a disposable backend/database.
// E2E_CHAT_ISOLATED=true E2E_API_URL=http://localhost:8083 \
// E2E_FRONTEND_URL=http://localhost:5175 node e2e/chat.mjs
assert.equal(process.env.E2E_CHAT_ISOLATED, 'true', 'Use a disposable database and explicitly set E2E_CHAT_ISOLATED=true.')
assert.ok(process.env.E2E_API_URL && process.env.E2E_FRONTEND_URL, 'Set explicit E2E_API_URL and E2E_FRONTEND_URL for the isolated environment.')
const base = process.env.E2E_API_URL.replace(/\/$/, '')
const frontend = process.env.E2E_FRONTEND_URL.replace(/\/$/, '')
for (const url of [base, frontend]) assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), 'Chat E2E is restricted to a local isolated environment.')

const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const outcomes = [], errors = [], accounts = [], contexts = []
let browser, teacher, otherTeacher, student, outsider, nonmember, group, otherGroup, customThread, teacherPage, studentPage
const button = (page, name) => page.getByRole('button', { name, exact: true })
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const conversation = page => page.getByRole('log', { name: 'История на съобщенията', exact: true })
const thread = (page, name) => page.locator('.chat-thread').filter({ hasText: name }).first()

async function request(path, auth, method = 'GET', data) {
  const response = await fetch(`${base}${path}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  const text = await response.text()
  let result = null
  try { result = text ? JSON.parse(text) : null } catch { result = text }
  return { status: response.status, data: result }
}

async function success(path, auth, method = 'GET', data) {
  const result = await request(path, auth, method, data)
  assert.ok(result.status >= 200 && result.status < 300, `${method} ${path} returned ${result.status}: ${result.data?.detail ?? 'unexpected response'}`)
  return result.data
}

async function eventually(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  let last
  do {
    try { return await check() } catch (cause) { last = cause }
    await new Promise(resolve => setTimeout(resolve, 150))
  } while (Date.now() < deadline)
  throw new Error(`${label}: ${last?.message ?? 'condition not reached'}`, { cause: last })
}

async function account(kind, role) {
  const auth = await success('/api/auth/register', null, 'POST', {
    name: `Chat ${kind} ${stamp}`,
    email: `chat-${kind}-${stamp}@example.test`,
    password: 'chat-test-password-123',
    role,
  })
  accounts.push(auth)
  assert.equal(auth.user.role, role)
  assert.equal(auth.user.roleSelectionRequired, false)
  // Verification remains entirely inside the local mail adapter.
  const mailbox = await success('/api/v1/profile/mailbox', auth)
  for (const mail of mailbox) {
    let payload
    try { payload = JSON.parse(mail.payload_json) } catch { continue }
    if (payload.token) {
      const verified = await request('/api/v1/profile/notification-email/verify', auth, 'POST', { token: payload.token })
      if (verified.status === 200) break
    }
  }
  return auth
}

async function pageFor(auth) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  contexts.push(context)
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(frontend)
  await button(page, 'Чат').click()
  await page.getByRole('region', { name: 'Чат', exact: true }).waitFor()
  return { page, context }
}

async function showThread(page, name) {
  const back = button(page, 'Към разговорите')
  if (await back.isVisible()) await back.click()
  await thread(page, name).click()
  await conversation(page).waitFor()
}

async function sendFrom(page, text) {
  await page.getByRole('textbox', { name: 'Съобщение', exact: true }).fill(text)
  await button(page, 'Изпрати съобщение').click()
  await conversation(page).getByText(text, { exact: true }).waitFor()
}

async function send(auth, conversationId, text, key = randomUUID()) {
  return success(`/api/v1/chat/conversations/${conversationId}/messages`, auth, 'POST', { text, clientMessageId: key })
}

try {
  teacher = await account('teacher', 'TEACHER')
  otherTeacher = await account('other-teacher', 'TEACHER')
  student = await account('student', 'STUDENT')
  outsider = await account('outsider', 'STUDENT')
  nonmember = await account('nonmember', 'STUDENT')
  group = await success('/api/v1/groups', teacher, 'POST', { name: `Chat group ${stamp}`, subject: 'Java', description: 'Disposable chat E2E fixture' })
  otherGroup = await success('/api/v1/groups', otherTeacher, 'POST', { name: `Other teacher group ${stamp}`, subject: 'Biology', description: 'Private group picker fixture' })
  const groupThread = await success(`/api/v1/chat/groups/${group.id}`, teacher, 'POST')
  await success('/api/v1/groups/join', student, 'POST', { code: group.join_code })
  const studentThreads = await success('/api/v1/chat/threads', student)
  assert.ok(studentThreads.some(value => value.id === groupThread.id), 'A later group participant must see the existing group conversation without reopening it.')
  outcomes.push('new group participants discover existing conversations')

  for (const path of [
    `/api/v1/chat/conversations/${groupThread.id}/messages`,
    `/api/v1/chat/groups/${group.id}`,
  ]) {
    const result = await request(path, outsider, path.includes('/messages') ? 'GET' : 'POST')
    assert.ok([403, 404].includes(result.status), `Unrelated student accessed ${path}`)
  }
  const peers = await success(`/api/v1/chat/peers?query=${encodeURIComponent(outsider.user.email)}`, student)
  assert.deepEqual(peers.map(value => value.user_id), [outsider.user.id])
  assert.equal(peers[0].email, outsider.user.email)
  assert.equal(peers[0].role, 'STUDENT')
  assert.equal((await success(`/api/v1/chat/peers?query=${encodeURIComponent(student.user.email)}`, student)).length, 0)
  const unrelatedDirect = await success(`/api/v1/chat/direct/${teacher.user.id}`, outsider, 'POST')
  assert.equal(unrelatedDirect.id, (await success(`/api/v1/chat/direct/${outsider.user.id}`, teacher, 'POST')).id)
  assert.ok([403, 404].includes((await request(`/api/v1/chat/conversations/${unrelatedDirect.id}/messages`, nonmember)).status))
  outcomes.push('registered profiles are searchable and can start unrelated direct chats while existing conversation history remains private')

  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),
    headless: process.env.E2E_HEADED !== 'true',
  })
  const teacherBrowser = await pageFor(teacher)
  const studentBrowser = await pageFor(student)
  teacherPage = teacherBrowser.page
  studentPage = studentBrowser.page
  await showThread(teacherPage, group.name)
  const first = `Групово съобщение ${stamp}`
  await sendFrom(teacherPage, first)
  await thread(studentPage, group.name).getByText(first, { exact: true }).waitFor()
  await showThread(studentPage, group.name)
  await conversation(studentPage).getByText(first, { exact: true }).waitFor()
  outcomes.push('group messages arrive live, including the sidebar before selection')

  const back = button(teacherPage, 'Към разговорите')
  if (await back.isVisible()) await back.click()
  await button(teacherPage, 'Контакти').click()
  await teacherPage.getByRole('searchbox', { name: 'Търси разговор', exact: true }).fill(outsider.user.email)
  await teacherPage.getByRole('button', { name: new RegExp(escape(outsider.user.name)) }).waitFor()
  await teacherPage.getByRole('searchbox', { name: 'Търси разговор', exact: true }).fill(student.user.name)
  await teacherPage.getByRole('button', { name: new RegExp(escape(student.user.name)) }).click()
  const privateText = `Лично съобщение ${stamp}`
  await sendFrom(teacherPage, privateText)
  await thread(studentPage, teacher.user.name).getByText(privateText, { exact: true }).waitFor()
  const direct = (await success('/api/v1/chat/threads', teacher)).find(value => value.peerId === student.user.id)
  assert.ok(direct, 'Direct conversation was not persisted')
  const second = await send(teacher, direct.id, `Второ лично съобщение ${stamp}`)
  const beforeRead = (await success('/api/v1/chat/threads', student)).find(value => value.id === direct.id)
  assert.equal(beforeRead.unreadCount, 2)
  const page = await success(`/api/v1/chat/conversations/${direct.id}/messages`, student)
  assert.equal((await success('/api/v1/chat/threads', student)).find(value => value.id === direct.id).unreadCount, 2, 'Fetching history must not mark unseen messages read')
  const firstPrivate = page.messages.find(value => value.text === privateText)
  await success(`/api/v1/chat/conversations/${direct.id}/read`, student, 'POST', { messageId: firstPrivate.id })
  assert.equal((await success('/api/v1/chat/threads', student)).find(value => value.id === direct.id).unreadCount, 1, 'Read acknowledgement must stop at the supplied visible message')
  await showThread(studentPage, teacher.user.name)
  await conversation(studentPage).getByText(second.text, { exact: true }).waitFor()
  await eventually(async () => assert.equal((await success('/api/v1/chat/threads', student)).find(value => value.id === direct.id).unreadCount, 0), 'Visible messages become read')
  outcomes.push('new direct conversations appear live and read acknowledgements do not consume unseen messages')

  const groupBack = button(teacherPage, 'Към разговорите')
  if (await groupBack.isVisible()) await groupBack.click()
  assert.equal(await button(studentPage, 'Нова чат група').count(), 0, 'Only teachers can open the group picker')
  await button(teacherPage, 'Нова чат група').first().click()
  const groupPicker = teacherPage.getByRole('region', { name: 'Нова чат група', exact: true })
  const suggestions = groupPicker.locator('.chat-group-suggestions')
  await suggestions.getByRole('button', { name: new RegExp(escape(group.name)) }).waitFor()
  assert.equal(await suggestions.getByRole('button').count(), 1, 'The picker only suggests this teacher\'s existing learning groups')
  assert.equal(await suggestions.getByRole('button', { name: new RegExp(escape(otherGroup.name)) }).count(), 0)
  assert.equal(await groupPicker.getByRole('checkbox').count(), 0)
  assert.equal(await groupPicker.getByRole('textbox', { name: 'Име на чат групата', exact: true }).count(), 0)
  const groupSearch = groupPicker.getByRole('searchbox', { name: 'Търси моя група', exact: true })
  await groupSearch.fill(otherGroup.name)
  await groupPicker.getByText('Няма намерена група', { exact: true }).waitFor()
  await groupSearch.fill('Java')
  await suggestions.getByRole('button', { name: new RegExp(escape(group.name)) }).waitFor()
  await teacherPage.screenshot({ path: new URL('chat-group-create.png', artifacts).pathname, fullPage: true })
  await teacherPage.setViewportSize({ width: 390, height: 844 })
  assert.equal(await teacherPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The learning group picker must fit on mobile')
  await teacherPage.screenshot({ path: new URL('chat-group-create-mobile.png', artifacts).pathname, fullPage: true })
  await teacherPage.setViewportSize({ width: 1440, height: 1000 })
  const openingGroup = teacherPage.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${base}/api/v1/chat/groups/${group.id}`)
  await suggestions.getByRole('button', { name: new RegExp(escape(group.name)) }).click()
  const openedResponse = await openingGroup
  assert.equal(openedResponse.status(), 200)
  const openedGroup = await openedResponse.json()
  assert.equal(openedGroup.groupId, group.id)
  assert.equal(openedGroup.id, groupThread.id, 'Selecting an existing group reuses its conversation')
  await teacherPage.getByRole('heading', { name: group.name, exact: true }).waitFor()
  const pickerText = `Съобщение до моята учебна група ${stamp}`
  await sendFrom(teacherPage, pickerText)
  await thread(studentPage, group.name).getByText(pickerText, { exact: true }).waitFor()
  assert.ok([403, 404].includes((await request(`/api/v1/chat/conversations/${openedGroup.id}/messages`, outsider)).status))
  await teacherPage.screenshot({ path: new URL('chat-group-conversation.png', artifacts).pathname, fullPage: true })
  outcomes.push('the teacher group picker suggests only their existing learning groups and opens the selected group conversation with its actual members')

  // The former custom-group HTTP contract remains compatible; it has no creation UI.
  customThread = await success('/api/v1/chat/custom-groups', teacher, 'POST', { title: `API compatibility ${stamp}`, participantIds: [student.user.id, outsider.user.id] })
  const customText = `API compatibility message ${stamp}`
  await send(teacher, customThread.id, customText)
  assert.ok((await success(`/api/v1/chat/conversations/${customThread.id}/messages`, student)).messages.some(value => value.text === customText))
  assert.ok((await success(`/api/v1/chat/conversations/${customThread.id}/messages`, outsider)).messages.some(value => value.text === customText))
  for (const path of [
    `/api/v1/chat/conversations/${customThread.id}/messages`,
    `/api/v1/chat/conversations/${customThread.id}/realtime-ticket`,
  ]) assert.ok([403, 404].includes((await request(path, nonmember, path.endsWith('/realtime-ticket') ? 'POST' : 'GET')).status))
  assert.ok(!(await success('/api/v1/chat/threads', nonmember)).some(value => value.id === customThread.id))
  await showThread(teacherPage, student.user.name)
  await showThread(studentPage, teacher.user.name)
  outcomes.push('the retained custom-group HTTP contract still restricts history and realtime tickets to its participants')

  const draft = `Лична чернова ${stamp}`
  await teacherPage.getByRole('textbox', { name: 'Съобщение', exact: true }).fill(draft)
  await showThread(teacherPage, group.name)
  assert.equal(await teacherPage.getByRole('textbox', { name: 'Съобщение', exact: true }).inputValue(), '')
  await teacherPage.getByRole('textbox', { name: 'Съобщение', exact: true }).fill('Групова чернова')
  await showThread(teacherPage, student.user.name)
  assert.equal(await teacherPage.getByRole('textbox', { name: 'Съобщение', exact: true }).inputValue(), draft)
  const attemptedKeys = []
  await teacherPage.route(`${base}/api/v1/chat/conversations/${direct.id}/messages`, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'Временно прекъсване за E2E проверка.' }) })
  }, { times: 1 })
  teacherPage.on('request', value => {
    if (value.method() === 'POST' && new URL(value.url()).pathname === `/api/v1/chat/conversations/${direct.id}/messages` && value.postDataJSON()?.text === draft) {
      attemptedKeys.push(value.postDataJSON().clientMessageId)
    }
  })
  await button(teacherPage, 'Изпрати съобщение').click()
  await button(teacherPage, 'Повтори изпращането').click()
  await conversation(studentPage).getByText(draft, { exact: true }).waitFor()
  assert.equal(attemptedKeys.length, 2)
  assert.ok(attemptedKeys.every(value => value === attemptedKeys[0] && typeof value === 'string'), 'Retry must retain the same client message id')
  assert.equal((await success(`/api/v1/chat/conversations/${direct.id}/messages`, teacher)).messages.filter(value => value.text === draft).length, 1)
  await showThread(teacherPage, group.name)
  assert.equal(await teacherPage.getByRole('textbox', { name: 'Съобщение', exact: true }).inputValue(), 'Групова чернова')
  await teacherPage.getByRole('textbox', { name: 'Съобщение', exact: true }).fill('')
  outcomes.push('drafts remain in their conversation and failed optimistic sends retry once with the original id')

  const key = randomUUID(), idempotentText = `Повторение без дубликат ${stamp}`
  const saved = await send(teacher, direct.id, idempotentText, key)
  const repeated = await send(teacher, direct.id, idempotentText, key)
  assert.equal(repeated.id, saved.id)
  assert.equal((await request(`/api/v1/chat/conversations/${direct.id}/messages`, teacher, 'POST', { text: 'Different content', clientMessageId: key })).status, 409)
  outcomes.push('repeated sends are idempotent and reusing a key with changed content is rejected')

  await showThread(studentPage, group.name)
  const fileName = `chat-${stamp}.txt`, contents = Buffer.from('Проверка на прикачен файл.\n', 'utf8')
  await studentPage.getByLabel('Прикачи файл', { exact: true }).setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: contents })
  await button(studentPage, 'Изпрати съобщение').click()
  const attachment = conversation(teacherPage).getByRole('button', { name: new RegExp(escape(fileName)) })
  await attachment.waitFor()
  const downloadPromise = teacherPage.waitForEvent('download')
  await attachment.click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), fileName)
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  assert.deepEqual(Buffer.concat(chunks), contents)
  const fileMessage = (await success(`/api/v1/chat/conversations/${groupThread.id}/messages`, student)).messages.find(value => value.attachmentName === fileName)
  assert.ok(fileMessage)
  assert.ok([403, 404].includes((await request(`/api/v1/chat/conversations/${groupThread.id}/messages/${fileMessage.id}/attachment`, outsider)).status))
  outcomes.push('files send and download intact, with access checked for unrelated profiles')

  await studentBrowser.context.setOffline(true)
  await studentPage.waitForFunction(() => !navigator.onLine)
  const burst = []
  for (let index = 0; index < 55; index++) burst.push(await send(teacher, groupThread.id, `Catchup ${stamp} ${index + 1}`))
  const catchup = []
  let afterId = fileMessage.id, hasMore = true, pages = 0
  while (hasMore) {
    const result = await success(`/api/v1/chat/conversations/${groupThread.id}/messages?afterId=${afterId}`, student)
    catchup.push(...result.messages)
    assert.ok(result.afterId >= afterId)
    if (result.hasMore) assert.ok(result.afterId > afterId, 'Incremental cursor must advance')
    afterId = result.afterId
    hasMore = result.hasMore
    assert.ok(++pages < 5, 'Catchup did not terminate')
  }
  assert.deepEqual(catchup.map(value => value.id), burst.map(value => value.id))
  await studentBrowser.context.setOffline(false)
  await conversation(studentPage).getByText(burst[0].text, { exact: true }).waitFor({ timeout: 30000 })
  await conversation(studentPage).getByText(burst.at(-1).text, { exact: true }).waitFor()
  const latest = await success(`/api/v1/chat/conversations/${groupThread.id}/messages`, student)
  assert.equal(latest.messages.length, 50)
  assert.equal(latest.hasMore, true)
  const older = await success(`/api/v1/chat/conversations/${groupThread.id}/messages?beforeId=${latest.beforeId}`, student)
  assert.ok(older.messages.some(value => value.id === fileMessage.id))
  assert.ok(!older.messages.some(value => latest.messages.some(current => current.id === value.id)))
  outcomes.push('reconnection catches up across multiple pages without dropping messages; older history has no overlap')

  await studentPage.reload()
  await button(studentPage, 'Чат').click()
  await showThread(studentPage, group.name)
  await conversation(studentPage).getByText(burst.at(-1).text, { exact: true }).waitFor()
  await conversation(studentPage).evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll', { bubbles: true })) })
  const anchorId = latest.messages[0].id
  const anchor = conversation(studentPage).locator(`[data-message-id="${anchorId}"]`)
  const relativeTop = element => element.getBoundingClientRect().top - element.closest('[role="log"]').getBoundingClientRect().top
  const previousTop = await anchor.evaluate(relativeTop)
  await button(studentPage, 'Зареди по-старите').click()
  await conversation(studentPage).locator(`[data-message-id="${older.messages[0].id}"]`).waitFor()
  assert.ok(Math.abs(await anchor.evaluate(relativeTop) - previousTop) < 4, 'Prepending older messages must preserve the reader\'s scroll position')
  await conversation(studentPage).evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll', { bubbles: true })) })
  const whileReading = await send(teacher, groupThread.id, `Известие при четене ${stamp}`)
  await conversation(studentPage).getByText(whileReading.text, { exact: true }).waitFor()
  assert.ok(await conversation(studentPage).evaluate(element => element.scrollTop < 4), 'Incoming messages must not jump away from the older history being read')
  await button(studentPage, 'Ново съобщение').click()
  outcomes.push('older-history loading preserves position and incoming messages do not force scrolling')
  await studentPage.screenshot({ path: new URL('chat-desktop.png', artifacts).pathname, fullPage: true })
  for (const width of [390, 320]) {
    await studentPage.setViewportSize({ width, height: 844 })
    assert.equal(await studentPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Chat overflows at ${width}px`)
    await studentPage.screenshot({ path: new URL(`chat-mobile-${width}.png`, artifacts).pathname, fullPage: true })
    await button(studentPage, 'Към разговорите').click()
    await thread(studentPage, group.name).click()
    await conversation(studentPage).waitFor()
  }
  outcomes.push('persisted conversations reload and the mobile conversation/back flow fits 320px and 390px')

  await success(`/api/v1/groups/${group.id}/members/${student.user.id}`, teacher, 'DELETE')
  for (const path of [
    `/api/v1/chat/conversations/${groupThread.id}/messages`,
    `/api/v1/chat/conversations/${groupThread.id}/messages/${fileMessage.id}/attachment`,
  ]) assert.ok([403, 404].includes((await request(path, student)).status), `Revoked member retains access to ${path}`)
  const retainedThreads = await success('/api/v1/chat/threads', student)
  assert.ok(!retainedThreads.some(value => value.id === groupThread.id))
  assert.ok(retainedThreads.some(value => value.id === direct.id))
  assert.ok(retainedThreads.some(value => value.id === customThread.id))
  assert.equal((await request(`/api/v1/chat/conversations/${direct.id}/messages`, student)).status, 200)
  assert.equal((await request(`/api/v1/chat/conversations/${customThread.id}/messages`, student)).status, 200)
  assert.ok((await success('/api/v1/chat/peers', student)).some(value => value.user_id === teacher.user.id))
  outcomes.push('learning membership removal revokes learning group history and downloads while independent chats and registered discovery persist')
  assert.deepEqual(errors, [])
  await writeFile(new URL('chat-report.json', artifacts), JSON.stringify({ checked: outcomes, pageErrors: errors, isolated: true }, null, 2))
  console.log(JSON.stringify({ checked: outcomes, pageErrors: errors, isolated: true }, null, 2))
} catch (error) {
  if (studentPage && !studentPage.isClosed()) await studentPage.screenshot({ path: new URL('chat-failure.png', artifacts).pathname, fullPage: true }).catch(() => {})
  throw error
} finally {
  for (const context of contexts) await context.close().catch(() => {})
  await browser?.close()
  if (teacher && group) await request(`/api/v1/groups/${group.id}`, teacher, 'DELETE').catch(() => {})
  if (otherTeacher && otherGroup) await request(`/api/v1/groups/${otherGroup.id}`, otherTeacher, 'DELETE').catch(() => {})
  // Account deletion is opt-in and limited to IDs created by this invocation.
  if (process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD) {
    const admin = await request('/api/auth/login', null, 'POST', { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD }).catch(() => null)
    if (admin?.status === 200) {
      for (const auth of accounts.toReversed()) {
        const result = await request(`/api/admin/users/${auth.user.id}`, admin.data, 'DELETE', { password: process.env.E2E_ADMIN_PASSWORD }).catch(() => null)
        if (result?.status !== 204) console.error(`Cleanup could not remove disposable account ${auth.user.id}: HTTP ${result?.status ?? 'unavailable'}`)
      }
      await request('/api/auth/logout', admin.data, 'POST').catch(() => {})
    }
  }
  for (const auth of accounts) await request('/api/auth/logout', auth, 'POST').catch(() => {})
}
