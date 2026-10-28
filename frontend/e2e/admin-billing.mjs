import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://127.0.0.1:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
const user = (id, name, email, role) => ({ id, name, email, role, active: true, passwordChangeRequired: false, roleSelectionRequired: false, subscription: { paid: false, paidUntil: null, paidAt: null, active: false }, allowedMethods: [], subscriptionMethods: [] })
const admin = user(1, 'Администратор', 'admin@example.test', 'ADMIN')
const teacher = user(2, 'Ивелин Михайлов', 'ivelin@example.test', 'TEACHER')
const second = user(3, 'Ивелин Петров', 'petrov@school.test', 'TEACHER')
const third = user(4, 'Мария Иванова', 'maria@example.test', 'TEACHER')
const users = [admin, teacher, second, third]
const limits = { free: { groups: 1, activeAssignments: 5, aiCredits: 10 }, pro: { groups: 20, activeAssignments: 100, aiCredits: 100 } }
const plans = [teacher, second, third].map(user => ({ userId: user.id, plan: 'free', status: 'free', period: null, amountMinor: null, currency: null, paidThrough: null, cancelAtPeriodEnd: false, limits: limits.free, usage: { groups: 1, activeAssignments: 3, aiCredits: 8 }, reservedAiCredits: 2 }))
const paymentMonth = new Date().toISOString().slice(0, 7)
const payments = [{ invoiceId: 'in_fixture', userId: teacher.id, status: 'paid', billingPeriod: 'month', amountDue: 800, amountPaid: 800, currency: 'eur', paymentAt: new Date().toISOString(), periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() + 30 * 86400000).toISOString() }]
const errors = [], mutations = [], audits = []
let failReset = true, release, gate = Promise.resolve()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } })
  await context.addInitScript(value => localStorage.setItem('quicktest.auth', JSON.stringify(value)), { token: 'admin-billing-fixture', user: admin })
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
    const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
    const respond = (body, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/api/auth/google/config') return respond({ enabled: false })
    if (path === '/api/auth/me') return respond(admin)
    if (path === '/api/admin/users') return respond(users)
    if (path === '/api/admin/teacher-billing') return respond(plans)
    if (path === '/api/admin/teacher-billing/payments') return respond(url.searchParams.get('month') === paymentMonth ? payments : [])
    if (path === '/api/admin/permissions') return respond([])
    if (path === '/api/admin/audit') return respond(audits)
    const match = path.match(/^\/api\/admin\/teacher-billing\/(\d+)\/(reset-ai|plan)$/)
    if (match && (method === 'POST' || method === 'PUT')) {
      assert.equal(request.headers().authorization, 'Bearer admin-billing-fixture')
      const payload = request.postDataJSON()
      const plan = plans.find(plan => plan.userId === Number(match[1]))
      if (match[2] === 'plan') {
        mutations.push(payload)
        plan.manualPlan = payload.plan === 'auto' ? null : payload.plan
        plan.plan = plan.manualPlan ?? 'free'
        plan.limits = limits[plan.plan]
        audits.unshift({ id: audits.length + 1, createdAt: new Date().toISOString(), actorEmail: admin.email, targetEmail: teacher.email, action: 'TEACHER_PLAN_CHANGED', details: 'Планът е сменен.' })
        return respond(plan)
      }
      mutations.push(payload)
      if (failReset) { failReset = false; return respond({ detail: 'Временна грешка. Опитай отново.' }, 503) }
      await gate
      plan.usage.aiCredits = plan.reservedAiCredits
      audits.unshift({ id: audits.length + 1, createdAt: new Date().toISOString(), actorEmail: admin.email, targetEmail: teacher.email, action: 'TEACHER_AI_RESET', details: `Период: ${payload.period}` })
      return respond(plan)
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(frontend)
  await page.getByRole('tab', { name: 'Абонаменти', exact: true }).click()
  const table = page.getByRole('table', { name: 'Абонаменти на учителите', exact: true })
  const name = page.getByRole('textbox', { name: 'Филтър по име', exact: true })
  const email = page.getByRole('textbox', { name: 'Филтър по имейл' })
  const row = () => table.getByRole('row').filter({ hasText: teacher.email })
  await row().waitFor()
  assert.ok((await row().innerText()).includes('8 / 10'))
  await name.fill('ИВЕЛИН')
  assert.equal(await table.locator('tbody tr').count(), 2)
  await email.fill('IVELIN@EXAMPLE')
  assert.equal(await table.locator('tbody tr').count(), 1)
  await email.fill('missing')
  await page.getByText('Няма учители според текущите филтри.').waitFor()
  await page.getByRole('button', { name: 'Изчисти филтрите' }).click()
  assert.equal(await table.locator('tbody tr').count(), 3)
  await page.getByRole('combobox', { name: 'Филтър по абонамент' }).selectOption('pro')
  await page.getByText('Няма учители според текущите филтри.').waitFor()
  await page.getByRole('combobox', { name: 'Филтър по абонамент' }).selectOption('all')
  await page.getByRole('cell', { name: 'Платено', exact: true }).waitFor()
  const paymentTable = page.getByRole('table', { name: 'История на плащанията', exact: true })
  assert.equal(await paymentTable.locator('tbody tr').count(), 1)
  await row().getByRole('button', { name: `Смени плана на ${teacher.email}` }).click()
  const planDialog = page.getByRole('dialog', { name: 'Смяна на план', exact: true })
  await planDialog.getByRole('combobox', { name: 'Нов план' }).selectOption('pro')
  await planDialog.getByRole('button', { name: 'Отказ', exact: true }).click()
  assert.equal(mutations.length, 0)
  await row().getByRole('button', { name: `Смени плана на ${teacher.email}` }).click()
  await planDialog.getByRole('combobox', { name: 'Нов план' }).selectOption('pro')
  assert.ok((await planDialog.innerText()).includes('продължава да се таксува'))
  await planDialog.getByRole('button', { name: 'Запази плана', exact: true }).click()
  await planDialog.waitFor({ state: 'hidden' })
  assert.ok((await row().innerText()).includes('8 / 100'))
  assert.ok((await row().innerText()).includes('Зададен от администратор'))
  await page.getByRole('button', { name: `Нулирай AI кредитите на ${teacher.email}` }).click()
  let dialog = page.getByRole('dialog', { name: 'Нулиране на AI кредити', exact: true })
  assert.equal(await dialog.getByRole('combobox', { name: 'Период за нулиране на AI кредити' }).inputValue(), 'month')
  gate = new Promise(resolve => { release = resolve })
  await dialog.getByRole('button', { name: 'Нулирай кредитите', exact: true }).click()
  await dialog.getByRole('alert').waitFor()
  await dialog.getByRole('button', { name: 'Нулирай кредитите', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('dialog button[type="submit"]')?.disabled)
  assert.equal(await dialog.getByRole('button', { name: 'Отказ', exact: true }).isDisabled(), true)
  release(); gate = Promise.resolve()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(mutations.length, 3)
  assert.equal(mutations[1].requestKey, mutations[2].requestKey)
  assert.equal(mutations[2].period, paymentMonth)
  assert.ok((await row().innerText()).includes('2 / 100'))
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    await page.screenshot({ path: new URL(`admin-billing-${theme}.png`, artifacts).pathname, fullPage: true })
    await page.setViewportSize({ width: 320, height: 850 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await name.fill('Ивелин Михайлов')
    await page.screenshot({ path: new URL(`admin-billing-${theme}-mobile.png`, artifacts).pathname, fullPage: true })
    await row().getByRole('button', { name: `Нулирай AI кредитите на ${teacher.email}` }).click()
    dialog = page.getByRole('dialog', { name: 'Нулиране на AI кредити', exact: true })
    await page.screenshot({ path: new URL(`admin-billing-${theme}-dialog.png`, artifacts).pathname, fullPage: true })
    assert.ok(await dialog.evaluate(element => element.getBoundingClientRect().width <= innerWidth))
    await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
    await name.fill('')
    await page.setViewportSize({ width: 1440, height: 1050 })
  }
  await page.getByRole('tab', { name: 'Журнал', exact: true }).click()
  await page.getByRole('cell', { name: 'Нулиране на AI кредити', exact: false }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Admin billing: subscription filters, monthly payment history, scoped quota reset, retry and mobile layouts passed.')
} finally { await browser.close() }
