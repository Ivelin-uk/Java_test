import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

// Fixtures only: no requests reach Stripe or a payment provider.
const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const base = process.env.E2E_API_URL ?? 'http://localhost:8080'
const teacher = { token: 'billing-fixture', user: { id: 101, name: 'Учител', email: 'teacher@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false, roleSelectionRequired: false } }
const free = { groups: 1, activeAssignments: 5, aiCredits: 10 }, pro = { groups: 20, activeAssignments: 100, aiCredits: 100 }
const initial = {
  plan: 'free', status: 'free', currentPeriod: null, paidThrough: null, cancelAtPeriodEnd: false,
  mode: 'test', checkoutAvailable: true, portalAvailable: false, cancellationAvailable: false,
  prices: { month: { available: true, amountMinor: 800, currency: 'eur' }, year: { available: false } },
  limits: free, usage: { groups: 1, activeAssignments: 2, aiCredits: 3 }, plans: { free, pro },
}
const artifacts = new URL('../../.artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const errors = []
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })

async function fixture({ signedIn = true, role = 'TEACHER', billing = initial, viewport = { width: 1440, height: 1100 }, theme = 'light' } = {}) {
  const state = { billing: structuredClone(billing), gets: 0, failGet: 0, failCheckout: 0, failPortal: 0, failCancel: 0, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_fixture', portalUrl: 'https://billing.stripe.com/p/session/test_fixture', requests: [], redirects: [] }
  const auth = { ...teacher, user: { ...teacher.user, role } }
  const context = await browser.newContext({ viewport })
  await context.addInitScript(({ auth, signedIn, theme }) => {
    localStorage.setItem('quicktest.theme', theme)
    if (signedIn) localStorage.setItem('quicktest.auth', JSON.stringify(auth))
  }, { auth, signedIn, theme })
  await context.route('https://checkout.stripe.com/**', async route => { state.redirects.push(route.request().url()); await route.fulfill({ contentType: 'text/html', body: '<h1>Fixture checkout</h1>' }) })
  await context.route('https://billing.stripe.com/**', async route => { state.redirects.push(route.request().url()); await route.fulfill({ contentType: 'text/html', body: '<h1>Fixture portal</h1>' }) })
  await context.route(`${base}/api/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin }, body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    state.requests.push({ path, method, data: request.postData() ? request.postDataJSON() : null })
    if (method === 'GET') {
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/auth/google/config') return respond({ enabled: false })
      if (path === '/api/v1/billing') {
        state.gets++
        if (state.failGet-- > 0) return respond({ detail: 'Временно недостъпен абонамент.' }, 503)
        return respond(state.billing)
      }
      if (['/api/v1/groups', '/api/v1/assignments', '/api/v1/results', '/api/v1/grading', '/api/v1/profile/identities'].includes(path)) return respond([])
      if (path === '/api/v1/profile/notification-email') return respond(null)
    }
    if (method === 'POST') {
      if (path === '/api/auth/login') return respond(auth)
      if (path === '/api/v1/billing/checkout') {
        // Let two same-tick DOM clicks reach the handler while the first is pending.
        await new Promise(resolve => setTimeout(resolve, 120))
        if (state.failCheckout-- > 0) return respond({ detail: 'Stripe временно не отговаря.' }, 503)
        return respond({ url: state.checkoutUrl })
      }
      if (path === '/api/v1/billing/portal') {
        if (state.failPortal-- > 0) return respond({ detail: 'Порталът временно не е достъпен.' }, 503)
        return respond({ url: state.portalUrl })
      }
      if (path === '/api/v1/billing/cancel') {
        await new Promise(resolve => setTimeout(resolve, 120))
        if (state.failCancel-- > 0) return respond({ detail: 'Спирането временно не е достъпно.' }, 503)
        state.billing = { ...state.billing, cancelAtPeriodEnd: true, cancellationAvailable: false }
        return respond({ cancelAtPeriodEnd: true, paidThrough: state.billing.paidThrough })
      }
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  return { page, context, state }
}

try {
  // Direct route, server errors/retry, honest unconfigured state and responsive themes.
  const unconfigured = await fixture({ billing: { ...initial, mode: 'unconfigured', checkoutAvailable: false, prices: { month: { available: false, amountMinor: 800, currency: 'eur' }, year: { available: false } } } })
  unconfigured.state.failGet = 100 // Also covers React StrictMode probing the initial effect twice.
  await unconfigured.page.goto(`${frontend}/billing`)
  await unconfigured.page.getByRole('alert').getByText('Временно недостъпен абонамент.', { exact: true }).waitFor()
  unconfigured.state.failGet = 0
  await unconfigured.page.getByRole('button', { name: 'Опитай отново', exact: true }).click()
  await unconfigured.page.getByRole('heading', { name: 'ExamAI Free', exact: true }).waitFor()
  await unconfigured.page.getByText('Плащанията още не са активирани', { exact: true }).waitFor()
  assert.equal(await unconfigured.page.getByRole('button', { name: 'Абонирай се за Pro', exact: true }).isDisabled(), true)
  await unconfigured.page.getByText('8,00', { exact: false }).waitFor()
  await unconfigured.page.getByRole('progressbar', { name: 'Групи: 1 от 1', exact: true }).waitFor()
  await unconfigured.page.screenshot({ path: new URL('billing-light.png', artifacts).pathname, fullPage: true })
  await unconfigured.page.getByRole('button', { name: 'Тъмна тема', exact: true }).click()
  assert.equal(await unconfigured.page.locator('html').getAttribute('data-theme'), 'dark')
  await unconfigured.page.screenshot({ path: new URL('billing-dark.png', artifacts).pathname, fullPage: true })
  await unconfigured.page.getByRole('button', { name: 'Табло', exact: true }).click()
  await unconfigured.page.getByRole('heading', { name: 'Моето табло', exact: true }).waitFor()
  await unconfigured.page.goBack()
  await unconfigured.page.getByRole('heading', { name: 'Абонамент', exact: true }).waitFor()
  assert.equal(new URL(unconfigured.page.url()).pathname, '/billing')
  await unconfigured.page.reload()
  await unconfigured.page.getByRole('heading', { name: 'ExamAI Free', exact: true }).waitFor()
  await unconfigured.context.close()

  const profile = await fixture({ billing: { ...initial, plans: { free, pro: { ...pro, groups: 42 } } } })
  await profile.page.goto(frontend)
  await profile.page.getByRole('navigation', { name: 'Основна навигация' }).getByRole('button', { name: 'Профил', exact: true }).click()
  const planCard = profile.page.getByRole('region', { name: 'План и плащане', exact: true })
  await planCard.getByRole('heading', { name: 'ExamAI Free', exact: true }).waitFor()
  await planCard.getByRole('progressbar', { name: 'Групи: 1 от 1', exact: true }).waitFor()
  await planCard.getByRole('progressbar', { name: 'Активни възлагания: 2 от 5', exact: true }).waitFor()
  const freeCard = planCard.getByRole('article', { name: 'Free', exact: true }), proCard = planCard.getByRole('article', { name: 'Pro', exact: true })
  await freeCard.getByText('Текущ план', { exact: true }).waitFor()
  await freeCard.getByText('10 пробни AI кредита общо', { exact: true }).waitFor()
  await proCard.getByText('До 42 групи', { exact: true }).waitFor()
  await proCard.getByText('100 AI кредита всеки месец', { exact: true }).waitFor()
  await proCard.getByText('Автоматична AI проверка при предаване', { exact: true }).waitFor()
  await proCard.getByText('8,00', { exact: false }).waitFor()
  assert.equal(await proCard.getByText('50,00', { exact: false }).count(), 0)
  await profile.page.screenshot({ path: new URL('profile-plans-light.png', artifacts).pathname, fullPage: true })
  await profile.page.getByRole('button', { name: 'Тъмна тема', exact: true }).click()
  await profile.page.screenshot({ path: new URL('profile-plans-dark.png', artifacts).pathname, fullPage: true })
  for (const width of [390, 320]) {
    await profile.page.setViewportSize({ width, height: 844 })
    assert.equal(await profile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await profile.page.screenshot({ path: new URL(`profile-plans-${width}.png`, artifacts).pathname, fullPage: true })
  }
  await proCard.getByRole('button', { name: 'Виж месечния абонамент', exact: true }).click()
  await profile.page.getByRole('heading', { name: 'Абонамент', exact: true }).waitFor()
  profile.state.failGet = 100
  await profile.page.getByRole('navigation').getByRole('button', { name: 'Профил', exact: true }).click()
  await planCard.getByRole('alert').getByText('Временно недостъпен абонамент.', { exact: true }).waitFor()
  assert.equal(await planCard.getByRole('heading', { name: 'ExamAI Free', exact: true }).count(), 0)
  profile.state.failGet = 0
  await planCard.getByRole('button', { name: 'Опитай отново', exact: true }).click()
  await planCard.getByRole('heading', { name: 'ExamAI Free', exact: true }).waitFor()
  await planCard.getByRole('button', { name: 'Планове и плащане', exact: true }).click()
  await profile.page.getByRole('heading', { name: 'Абонамент', exact: true }).waitFor()
  await profile.context.close()

  const mobile = await fixture({ billing: { ...initial, mode: 'unconfigured', checkoutAvailable: false, prices: { month: { available: false, amountMinor: 800, currency: 'eur' }, year: { available: false } } }, viewport: { width: 390, height: 844 }, theme: 'dark' })
  await mobile.page.goto(`${frontend}/billing`)
  await mobile.page.getByRole('heading', { name: 'ExamAI Free', exact: true }).waitFor()
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await mobile.page.screenshot({ path: new URL('billing-mobile.png', artifacts).pathname, fullPage: true })
  await mobile.page.setViewportSize({ width: 320, height: 844 })
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await mobile.context.close()

  // Same-tick double click is one request. A retry keeps the idempotency key.
  const monthly = await fixture()
  monthly.state.failCheckout = 1
  await monthly.page.goto(`${frontend}/billing`)
  const subscribe = monthly.page.getByRole('button', { name: 'Изпробвай Pro в Stripe', exact: true })
  await subscribe.waitFor()
  await subscribe.evaluate(button => { button.click(); button.click() })
  await monthly.page.getByRole('alert').getByText('Stripe временно не отговаря.', { exact: true }).waitFor()
  let posts = monthly.state.requests.filter(request => request.path === '/api/v1/billing/checkout')
  assert.equal(posts.length, 1)
  assert.equal(posts[0].data.period, 'month')
  assert.match(posts[0].data.requestKey, /^[0-9a-f-]{36}$/)
  const key = posts[0].data.requestKey
  monthly.state.checkoutUrl = 'https://checkout.stripe.com.attacker.test/steal'
  await subscribe.click()
  await monthly.page.getByRole('alert').getByText('Не може да се отвори защитената страница за плащане. Опитай отново.', { exact: true }).waitFor()
  assert.equal(new URL(monthly.page.url()).pathname, '/billing')
  monthly.state.checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_fixture'
  await subscribe.click()
  await monthly.page.getByRole('heading', { name: 'Fixture checkout', exact: true }).waitFor()
  posts = monthly.state.requests.filter(request => request.path === '/api/v1/billing/checkout')
  assert.equal(posts.length, 3)
  assert.equal(posts.every(request => request.data.requestKey === key), true)
  assert.equal(monthly.state.redirects.length, 1)
  await monthly.context.close()

  // Only monthly subscriptions are offered, with card entry and compatible wallets in hosted Stripe Checkout.
  const live = await fixture({ billing: { ...initial, mode: 'live' } })
  await live.page.goto(`${frontend}/billing`)
  await live.page.getByRole('heading', { name: 'ExamAI Free', exact: true }).waitFor()
  assert.equal(await live.page.getByRole('button', { name: 'Годишно', exact: true }).count(), 0)
  await live.page.getByText('8,00', { exact: false }).waitFor()
  const methods = live.page.getByLabel('Начини на плащане', { exact: true })
  for (const name of ['Кредитна / дебитна карта', 'Apple Pay', 'Google Pay']) await methods.getByText(name, { exact: true }).waitFor()
  await live.page.getByText('Подновява се автоматично всеки месец. Можеш да спреш подновяването по всяко време.', { exact: true }).waitFor()
  await live.page.getByRole('button', { name: 'Абонирай се за Pro', exact: true }).click()
  await live.page.getByRole('heading', { name: 'Fixture checkout', exact: true }).waitFor()
  assert.equal(live.state.requests.find(request => request.path === '/api/v1/billing/checkout').data.period, 'month')
  await live.context.close()

  // Return URL does not activate Pro: wait until a fresh server response confirms it.
  const returned = await fixture()
  await returned.page.goto(`${frontend}/billing?checkout=success`)
  await returned.page.getByText('Изчакваме потвърждение от Stripe', { exact: true }).waitFor()
  await returned.page.getByRole('heading', { name: 'ExamAI Free', exact: true }).waitFor()
  assert.equal(await returned.page.getByText('Pro е активен', { exact: true }).count(), 0)
  assert.equal(await returned.page.getByRole('button', { name: 'Изпробвай Pro в Stripe', exact: true }).isDisabled(), true)
  assert.equal(new URL(returned.page.url()).search, '?checkout=success')
  returned.state.billing = { ...returned.state.billing, plan: 'pro', status: 'active', currentPeriod: 'month', limits: pro, portalAvailable: true, paidThrough: '2027-02-26T12:00:00Z' }
  await returned.page.getByText('Pro е активен', { exact: true }).waitFor({ timeout: 6000 })
  await returned.page.getByRole('heading', { name: 'ExamAI Pro', exact: true }).waitFor()
  await returned.page.getByText('Период: месечен — 8,00 €.', { exact: false }).waitFor()
  await returned.page.getByRole('progressbar', { name: 'AI кредити този месец: 3 от 100', exact: true }).waitFor()
  assert.equal(returned.state.requests.filter(request => request.path === '/api/v1/billing/checkout').length, 0)
  returned.state.failPortal = 1
  const portal = returned.page.getByRole('button', { name: 'Управлявай / смени плана', exact: true })
  await portal.click()
  await returned.page.getByRole('alert').getByText('Порталът временно не е достъпен.', { exact: true }).waitFor()
  await portal.click()
  await returned.page.getByRole('heading', { name: 'Fixture portal', exact: true }).waitFor()
  assert.equal(returned.state.redirects[0], 'https://billing.stripe.com/p/session/test_fixture')
  await returned.context.close()

  // Pending confirmation stops polling after a bounded number of requests.
  const pending = await fixture()
  await pending.page.clock.install()
  await pending.page.goto(`${frontend}/billing?checkout=success`)
  await pending.page.getByRole('heading', { name: 'ExamAI Free', exact: true }).waitFor()
  for (let i = 0; i < 12; i++) {
    await pending.page.clock.runFor(2501)
    await pending.page.waitForTimeout(15)
  }
  await pending.page.getByText('Потвърждението се забавя', { exact: true }).waitFor()
  const gets = pending.state.gets
  assert.ok(gets >= 12 && gets <= 13) // React StrictMode can cancel an initial request.
  await pending.page.clock.runFor(30000)
  assert.equal(pending.state.gets, gets)
  assert.equal(await pending.page.getByText('Pro е активен', { exact: true }).count(), 0)
  await pending.context.close()

  // Cancel-at-period-end remains Pro with an explicit access date.
  const canceled = await fixture({ billing: { ...initial, plan: 'pro', status: 'active', currentPeriod: 'year', prices: { ...initial.prices, year: { available: false, amountMinor: 5000, currency: 'eur' } }, limits: pro, cancelAtPeriodEnd: true, paidThrough: '2027-02-26T12:00:00Z', portalAvailable: true } })
  await canceled.page.goto(`${frontend}/billing`)
  await canceled.page.getByText('Прекратява се в края на периода', { exact: true }).waitFor()
  await canceled.page.getByText('Достъп до Pro до', { exact: false }).waitFor()
  assert.equal(await canceled.page.getByRole('button', { name: 'Изпробвай Pro в Stripe', exact: true }).count(), 0)
  await canceled.page.getByRole('navigation').getByRole('button', { name: 'Профил', exact: true }).click()
  const paidProfile = canceled.page.getByRole('region', { name: 'План и плащане', exact: true })
  await paidProfile.getByRole('heading', { name: 'ExamAI Pro', exact: true }).waitFor()
  await paidProfile.getByRole('article', { name: 'Pro', exact: true }).getByText('Текущ план', { exact: true }).waitFor()
  await paidProfile.getByText('Годишен —', { exact: false }).waitFor()
  await paidProfile.getByText('Достъп до Pro до', { exact: false }).waitFor()
  await paidProfile.getByRole('progressbar', { name: 'AI кредити този месец: 3 от 100', exact: true }).waitFor()
  await paidProfile.getByRole('button', { name: 'Управлявай абонамента', exact: true }).click()
  await canceled.page.getByRole('heading', { name: 'Абонамент', exact: true }).waitFor()
  await canceled.context.close()

  // Renewal cancellation requires confirmation, supports retry and same-tick duplicate clicks, and preserves paid access.
  const stopping = await fixture({ billing: { ...initial, plan: 'pro', status: 'active', currentPeriod: 'month', limits: pro, cancellationAvailable: true, portalAvailable: true, paidThrough: '2027-02-26T12:00:00Z' } })
  await stopping.page.goto(`${frontend}/billing`)
  const stop = stopping.page.getByRole('button', { name: 'Спри подновяването', exact: true })
  await stop.click()
  const confirmationDialog = stopping.page.getByRole('dialog', { name: 'Спиране на месечното подновяване', exact: true })
  await confirmationDialog.waitFor()
  assert.equal(stopping.state.requests.filter(request => request.path === '/api/v1/billing/cancel').length, 0)
  await confirmationDialog.getByRole('button', { name: 'Отказ', exact: true }).click()
  await stop.click()
  stopping.state.failCancel = 1
  const confirmStop = confirmationDialog.getByRole('button', { name: 'Потвърди спирането', exact: true })
  await confirmStop.evaluate(button => { button.click(); button.click() })
  await confirmationDialog.getByRole('alert').getByText('Спирането временно не е достъпно.', { exact: true }).waitFor()
  assert.equal(stopping.state.requests.filter(request => request.path === '/api/v1/billing/cancel').length, 1)
  assert.equal(stopping.state.billing.cancelAtPeriodEnd, false)
  await stopping.page.setViewportSize({ width: 320, height: 844 })
  assert.equal(await confirmationDialog.evaluate(element => element.getBoundingClientRect().right <= innerWidth), true)
  await confirmStop.click()
  await confirmationDialog.waitFor({ state: 'hidden' })
  await stopping.page.getByText('Прекратява се в края на периода', { exact: true }).waitFor()
  await stopping.page.getByText('Достъп до Pro до', { exact: false }).waitFor()
  await stopping.page.getByRole('heading', { name: 'ExamAI Pro', exact: true }).waitFor()
  assert.equal(await stop.count(), 0)
  assert.equal(stopping.state.requests.filter(request => request.path === '/api/v1/billing/cancel').length, 2)
  await stopping.page.reload()
  await stopping.page.getByRole('heading', { name: 'ExamAI Pro', exact: true }).waitFor()
  await stopping.page.getByText('Прекратява се в края на периода', { exact: true }).waitFor()
  await stopping.context.close()

  const aborted = await fixture()
  await aborted.page.goto(`${frontend}/billing?checkout=canceled`)
  await aborted.page.getByText('Плащането е прекъснато', { exact: true }).waitFor()
  assert.equal(aborted.state.requests.filter(request => request.path === '/api/v1/billing/checkout').length, 0)
  await aborted.context.close()

  // Student direct URL cannot render billing or fetch its private endpoint.
  const student = await fixture({ role: 'STUDENT' })
  await student.page.goto(`${frontend}/billing`)
  await student.page.getByRole('heading', { name: 'Моят профил', exact: true }).waitFor()
  await student.page.getByRole('heading', { name: 'Безплатен ученически достъп', exact: true }).waitFor()
  assert.equal(await student.page.getByRole('region', { name: 'План и плащане', exact: true }).count(), 0)
  assert.equal(await student.page.getByRole('button', { name: 'Абонамент', exact: true }).count(), 0)
  assert.equal(student.state.gets, 0)
  await student.context.close()

  // Signing in after a Stripe return preserves the destination and query.
  const login = await fixture({ signedIn: false })
  await login.page.goto(`${frontend}/billing?checkout=success`)
  await login.page.getByRole('textbox', { name: 'Имейл', exact: true }).fill(teacher.user.email)
  await login.page.getByLabel('Парола', { exact: true }).fill('fixture-password')
  await login.page.getByRole('button', { name: 'Влез', exact: true }).click()
  await login.page.getByRole('heading', { name: 'Абонамент', exact: true }).waitFor()
  await login.page.getByText('Изчакваме потвърждение от Stripe', { exact: true }).waitFor()
  assert.equal(new URL(login.page.url()).search, '?checkout=success')
  await login.context.close()

  assert.deepEqual(errors, [])
  console.log('Billing fixture tests passed: routing, roles, quotas, intervals, idempotency, redirects, confirmation, portal, themes and mobile.')
} finally { await browser.close() }
