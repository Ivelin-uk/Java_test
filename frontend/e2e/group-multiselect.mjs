import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173', base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const auth = { token: 'group-multiselect-fixture', user: { id: 101, name: 'Teacher', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const group = { id: 301, name: '12А', subject: 'Java', description: 'Учебна група' }
const student = (id, name) => ({ user_id: id, name, email: `student-${id}@example.test`, roles_json: '["STUDENT"]', status: 'active' })
const directory = [student(501, 'Вече добавен ученик'), student(502, 'Иван Петров'), student(503, 'Мария Николова'), student(504, 'Александър Константинов Димитров'), student(505, 'Георги Иванов'), student(506, 'Елена Георгиева'), student(507, 'Петър Стоянов'), { ...student(508, 'Неактивен ученик'), status: 'inactive' }, { ...student(509, 'Учител'), roles_json: '["TEACHER"]' }, { ...student(510, 'Двойна роля'), roles_json: '["STUDENT","TEACHER"]' }]
directory[3].email = 'a-very-long-student-email-address-for-responsive-layout@example.test'
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const errors = []
try {
  for (const viewport of [{ width: 1440, height: 1000, theme: 'light' }, { width: 1440, height: 1000, theme: 'dark' }, { width: 390, height: 844, theme: 'light' }, { width: 320, height: 844, theme: 'dark' }]) {
    const context = await browser.newContext({ viewport, colorScheme: viewport.theme })
    await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), auth)
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const members = [{ ...directory[0], active: true }], mutations = []
    let releaseAdd, failStudent = null
    let addGate = new Promise(resolve => { releaseAdd = resolve })
    await page.route(`${base}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
      if (method === 'GET') {
        const data = { '/api/auth/me': auth.user, '/api/v1/groups': [group], '/api/v1/assignments': [], '/api/v1/grading': [], '/api/v1/members': directory, [`/api/v1/groups/${group.id}/members`]: members }
        if (Object.hasOwn(data, path)) return respond(data[path])
      }
      if (method === 'POST' && path === `/api/v1/groups/${group.id}/members`) {
        const body = request.postDataJSON()
        mutations.push(body)
        assert.deepEqual(Object.keys(body), ['userId'])
        assert(directory.some(user => user.user_id === body.userId && user.status === 'active' && user.roles_json === '["STUDENT"]'))
        if (body.userId === failStudent) { failStudent = null; return respond({ detail: 'Временно неуспешно добавяне.' }, 503) }
        await addGate
        assert(!members.some(member => member.user_id === body.userId))
        members.push({ ...directory.find(user => user.user_id === body.userId), active: true })
        return route.fulfill({ status: 204 })
      }
      errors.push(`Unexpected API: ${method} ${path}`)
      return respond({}, 404)
    })
    try {
      await page.goto(frontend)
      await page.getByRole('button', { name: 'Групи', exact: true }).click()
      await page.getByRole('table', { name: 'Групи', exact: true }).getByRole('button', { name: group.name, exact: true }).click()
      const region = page.getByRole('region', { name: 'Участници в групата', exact: true })
      const form = region.getByRole('form', { name: 'Добавяне на ученици', exact: true })
      const picker = form.getByRole('combobox', { name: 'Търси ученици', exact: true })
      const options = form.getByRole('listbox', { name: 'Ученици', exact: true })
      const selected = form.getByRole('list', { name: 'Избрани: Ученици', exact: true })
      const add = form.getByRole('button', { name: 'Добави', exact: true })
      const table = region.getByRole('table', { name: 'Участници в групата', exact: true })
      const select = async id => { await picker.fill(directory.find(user => user.user_id === id).email); await options.getByRole('option').click() }
      await table.getByText(directory[0].email, { exact: true }).waitFor()
      assert.equal(await add.isDisabled(), true)
      await picker.click()
      assert.equal(await options.getAttribute('aria-multiselectable'), 'true')
      assert.equal(await options.getByRole('option').count(), 6)
      for (const id of [501, 508, 509, 510]) assert.equal(await options.getByRole('option', { name: directory.find(user => user.user_id === id).name, exact: true }).count(), 0)
      await select(502)
      assert.equal(await options.isVisible(), true)
      assert.equal(await options.getByRole('option', { name: directory[1].name, exact: true }).getAttribute('aria-selected'), 'true')
      await select(503)
      await picker.fill(`  ${directory[3].email.toUpperCase()}  `)
      await page.keyboard.press('Enter')
      await form.getByText('Избрани: 3', { exact: true }).waitFor()
      assert.equal(mutations.length, 0)
      await options.getByRole('option', { name: directory[1].name, exact: true }).click()
      await form.getByText('Избрани: 2', { exact: true }).waitFor()
      await select(502)
      await page.keyboard.press('Escape')
      assert.equal(await picker.getAttribute('aria-expanded'), 'false')
      await selected.getByRole('button', { name: `Премахни: ${directory[2].name}`, exact: true }).click()
      assert.equal(await selected.getByText(directory[2].email, { exact: true }).count(), 0)
      await select(503)
      await page.keyboard.press('Escape')
      await form.getByText('Избрани: 3', { exact: true }).waitFor()
      const description = page.getByRole('textbox', { name: 'Описание', exact: true })
      await description.fill('Незаписано описание')
      assert.equal(await selected.getByRole('listitem').count(), 3)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.equal(await form.evaluate(element => [...element.querySelectorAll('li, button')].every(child => { const box = child.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth })), true)
      await page.screenshot({ path: new URL(`group-multiselect-${viewport.theme}-${viewport.width}.png`, artifacts).pathname, fullPage: true })
      await picker.click()
      await page.screenshot({ path: new URL(`group-multiselect-options-${viewport.theme}-${viewport.width}.png`, artifacts).pathname, fullPage: true })
      const pending = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1/groups/${group.id}/members`)
      await Promise.all([add.click(), pending])
      assert.equal(await add.isDisabled(), true)
      assert.equal(await picker.isDisabled(), true)
      await form.evaluate(element => { element.requestSubmit(); element.requestSubmit() })
      assert.equal(mutations.length, 1)
      releaseAdd()
      await region.getByText('Добавени ученици: 3.', { exact: true }).waitFor()
      await table.getByText(directory[2].email, { exact: true }).waitFor()
      await form.getByText('Избрани: 0', { exact: true }).waitFor()
      assert.equal(await table.locator('tbody tr').count(), 4)
      assert.equal(await add.isDisabled(), true)
      assert.deepEqual(mutations.map(body => body.userId), [504, 502, 503])
      assert.equal(await description.inputValue(), 'Незаписано описание')
      await picker.fill(directory[1].email)
      await options.getByText('Няма намерени резултати.', { exact: true }).waitFor()
      for (const id of [505, 506, 507]) await select(id)
      failStudent = 506
      addGate = Promise.resolve()
      await add.click()
      await region.getByRole('alert').getByText('Временно неуспешно добавяне.', { exact: true }).waitFor()
      await table.getByText(directory[4].email, { exact: true }).waitFor()
      await form.getByText('Избрани: 2', { exact: true }).waitFor()
      assert.equal(await selected.getByText(directory[4].email, { exact: true }).count(), 0)
      for (const user of directory.slice(5, 7)) assert.equal(await selected.getByText(user.email, { exact: true }).count(), 1)
      assert.deepEqual(mutations.map(body => body.userId), [504, 502, 503, 505, 506])
      await add.click()
      await region.getByText('Добавени ученици: 2.', { exact: true }).waitFor()
      await table.getByText(directory[6].email, { exact: true }).waitFor()
      await form.getByText('Избрани: 0', { exact: true }).waitFor()
      assert.deepEqual(mutations.map(body => body.userId), [504, 502, 503, 505, 506, 506, 507])
      assert.equal(await table.locator('tbody tr').count(), 7)
      assert.equal(await description.inputValue(), 'Незаписано описание')
      assert.equal(await region.getByRole('alert').count(), 0)
      await picker.fill(''); await picker.click()
      await options.getByText('Няма налични ученици.', { exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await page.reload()
      await page.getByRole('button', { name: 'Групи', exact: true }).click()
      await page.getByRole('table', { name: 'Групи', exact: true }).getByRole('button', { name: group.name, exact: true }).click()
      await table.getByText(directory[6].email, { exact: true }).waitFor()
      assert.equal(await table.locator('tbody tr').count(), 7)
    } catch (error) {
      await page.screenshot({ path: new URL(`group-multiselect-failure-${viewport.theme}-${viewport.width}.png`, artifacts).pathname, fullPage: true })
      throw error
    } finally { releaseAdd(); await context.close() }
  }
  assert.deepEqual(errors, [])
  console.log('Passed: multi-select, search by name/email, keyboard and mouse selection, deselection, open list and selected count, exclusion of existing/inactive/teacher accounts, batch add, duplicate-submit guard, partial failure and retry without duplicate additions, unsaved group fields, reload persistence, desktop/mobile and both themes. API fixtures only.')
} finally { await browser.close() }
