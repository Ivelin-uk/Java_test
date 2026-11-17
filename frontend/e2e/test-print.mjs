import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { chromium } from 'playwright'

const frontend = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const auth = { token: 'test-print-fixture', user: { id: 101, name: 'Учител за печат', email: 'print@example.test', role: 'TEACHER', active: true, passwordChangeRequired: false } }
const baseQuestion = { difficulty: 'MEDIUM', points: 2, timeSeconds: 60, options: [], acceptedAnswers: [], caseInsensitive: true, collapseWhitespace: true, criteria: '', explanation: 'СЕКРЕТНО ОБЯСНЕНИЕ' }
const definition = {
  title: 'Програмиране — тест за печат', description: 'Контролна работа на хартия.', subject: 'Програмиране', level: '12',
  instructions: 'Прочетете внимателно всеки въпрос. Пишете четливо.', language: 'bg', gradingScale: 'bulgarian', passThreshold: 50,
  questions: [
    { ...baseQuestion, type: 'SINGLE_CHOICE', text: 'Кой тип съхранява логическа стойност?', options: [{ text: 'boolean', correct: true }, { text: 'String', correct: false }, { text: 'int', correct: false }] },
    { ...baseQuestion, type: 'MULTIPLE_CHOICE', text: 'Кои са цели числа при x < 3?', options: [{ text: '2', correct: true }, { text: '3', correct: true }, { text: '2.5', correct: false }] },
    { ...baseQuestion, type: 'TRUE_FALSE', text: 'Класът е шаблон за обекти.', options: [{ text: 'Вярно', correct: true }, { text: 'Невярно', correct: false }] },
    { ...baseQuestion, type: 'SHORT_ANSWER', text: 'Допълнете името на езика.', acceptedAnswers: ['СЕКРЕТЕН ОТГОВОР'] },
    { ...baseQuestion, type: 'OPEN_ANSWER', text: '<!--examai-rich-text:v1--><p>Обяснете <strong>наследяването</strong>.</p><p>Дайте пример при x <span data-type="inline-math" data-latex="x^2"></span>.</p>', criteria: 'СЕКРЕТНИ КРИТЕРИИ', imageId: 901 },
    { ...baseQuestion, type: 'MATCHING', text: 'Свържете термините с определенията.', matchingPairs: [{ left: 'Клас', right: 'Шаблон' }, { left: 'Обект', right: 'Инстанция' }, { left: 'Метод', right: 'Поведение' }] },
  ],
}
const oneVariantDefinition = { ...definition, title: 'Вярно или невярно', questions: [definition.questions[2]] }
function assessment(id, value) {
  return { id, title: value.title, subject: value.subject, level: value.level, public_number: String(123456789000 + id), owner_id: auth.user.id, status: 'published', shared: false, mobile_allowed: false,
    updated_at: '2026-11-17T10:00:00Z', question_count: value.questions.length, total_time_seconds: value.questions.length * 60, definition_json: JSON.stringify(value) }
}
const tests = [assessment(201, definition), assessment(202, oneVariantDefinition)]
// Valid tiny PNG; file reads are mocked with the same authorization path used by the app.
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBz8AAAAASUVORK5CYII=', 'base64')
const artifacts = new URL('../../.artifacts/test-print/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const errors = [], requests = []
let failDetail = false, failImage = false, holdImage = false, releaseImage
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true })
let page

async function bytes(download, name) {
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  const buffer = Buffer.concat(chunks)
  await writeFile(new URL(name, artifacts), buffer)
  return buffer
}
function verifyAnswerKeys(paragraphs, variants) {
  const keyStart = paragraphs.indexOf('Ключ с верните отговори')
  assert.ok(keyStart >= 0)
  function sections(values) {
    const result = new Map()
    let current
    for (const value of values) {
      const match = value.match(/^Вариант\s+(\d+)\s*[/]\s*\d+$/i)
      if (match) { current = []; result.set(Number(match[1]), current) }
      else current?.push(value)
    }
    return result
  }
  const student = sections(paragraphs.slice(0, keyStart)), teacher = sections(paragraphs.slice(keyStart + 1))
  const prompts = ['Кой тип съхранява логическа стойност?', 'Кои са цели числа при x < 3?', 'Класът е шаблон за обекти.', 'Допълнете името на езика.', 'Обяснете наследяването.', 'Свържете термините с определенията.']
  for (let index = 1; index <= variants; index++) {
    const values = student.get(index), answers = teacher.get(index)
    assert.ok(values && answers, `Variant ${index} must have both student questions and a teacher key`)
    const anchors = values.map((text, position) => ({ text, position, source: prompts.findIndex(prompt => text.includes(prompt)) })).filter(anchor => anchor.source >= 0)
    assert.equal(anchors.length, prompts.length)
    for (const [position, anchor] of anchors.entries()) {
      const questionNumber = anchor.text.match(/^(\d+)\.\s/)[1]
      const answer = answers.find(text => text.startsWith(`${questionNumber}. `))?.slice(questionNumber.length + 2)
      assert.ok(answer, `Missing key entry for question ${questionNumber} in variant ${index}`)
      const block = values.slice(anchor.position + 1, anchors[position + 1]?.position ?? values.length)
      if (anchor.source < 2) {
        const choices = block.map(text => text.match(/^\[ \]\s*([A-Z])\.\s*(.*)$/)).filter(Boolean)
        assert.equal(choices.length, definition.questions[anchor.source].options.length)
        const expected = choices.filter(choice => definition.questions[anchor.source].options.some(option => option.correct && option.text === choice[2])).map(choice => `${choice[1]}. ${choice[2]}`).sort()
        assert.deepEqual(answer.split('; ').sort(), expected, `MC key must follow shuffled letters for question ${questionNumber}, variant ${index}`)
      } else if (anchor.source === 5) {
        const left = block.map(text => text.match(/^(\d+)\.\s*(Клас|Обект|Метод)$/)).filter(Boolean)
        const right = block.map(text => text.match(/^([A-Z])\.\s*(Шаблон|Инстанция|Поведение)$/)).filter(Boolean)
        assert.equal(left.length, 3); assert.equal(right.length, 3)
        const expected = left.map(value => {
          const correct = definition.questions[5].matchingPairs.find(pair => pair.left === value[2]).right
          return `${value[1]}–${right.find(value => value[2] === correct)[1]}`
        }).sort()
        assert.deepEqual(answer.split(', ').sort(), expected, `Matching key must follow both shuffled columns for variant ${index}`)
      }
    }
  }
}
async function inspectWord(buffer, variants, key, shuffleQuestions = true) {
  assert.equal(buffer.subarray(0, 2).toString(), 'PK')
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('word/document.xml').async('string')
  const decode = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map(match => [...match[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => decode(match[1])).join('')).filter(Boolean)
  const text = paragraphs.join(' ')
  for (const expected of [definition.title, 'Програмиране', 'Име:', 'Клас:', 'Дата:', definition.instructions, 'наследяването', 'x < 3', 'Клас', 'Шаблон', 'Обект', 'Инстанция', 'Метод', 'Поведение']) assert.ok(text.includes(expected), `Word must preserve ${expected}`)
  for (let index = 1; index <= variants; index++) assert.ok(new RegExp(`Вариант\\s+${index}\\s*[/]\\s*${variants}`, 'i').test(text), `Missing variant ${index}/${variants}`)
  const studentSections = text.split('Ключ с верните отговори')[0].split(/Вариант\s+\d+\s*[/]\s*\d+/i).slice(1)
  assert.equal(studentSections.length, variants)
  assert.equal(new Set(studentSections.map(section => section.replaceAll(definition.title, '').replace(/\s+/g, ' ').trim())).size, variants, 'Requested variants must use distinct question/answer arrangements')
  const promptOrder = studentSections.map(section => ['Кой тип съхранява логическа стойност?', 'Кои са цели числа при x < 3?', 'Класът е шаблон за обекти.', 'Допълнете името на езика.', 'Обяснете наследяването.', 'Свържете термините с определенията.']
    .map((prompt, index) => ({ index, position: section.indexOf(prompt) }))
    .sort((left, right) => left.position - right.position)
    .map(value => value.index))
  if (shuffleQuestions) assert.equal(new Set(promptOrder.map(order => order.join(','))).size, variants, 'Shuffled variants must not reuse a question order')
  else for (const order of promptOrder) assert.deepEqual(order, [0, 1, 2, 3, 4, 5], 'Question order must be preserved when shuffling is disabled')
  assert.equal(text.includes('Ключ с верните отговори'), key)
  assert.equal(text.includes('СЕКРЕТЕН ОТГОВОР'), key, 'Accepted answers belong only in the optional teacher key')
  assert.equal(text.includes('СЕКРЕТНИ КРИТЕРИИ'), key, 'Grading criteria belong only in the optional teacher key')
  assert.equal(text.includes('СЕКРЕТНО ОБЯСНЕНИЕ'), false, 'Explanations must not be exposed to students')
  if (key) verifyAnswerKeys(paragraphs, variants)
  assert.ok(Object.keys(zip.files).some(path => path.startsWith('word/media/')), 'Question image must be embedded in Word')
  const pageBreaks = (xml.match(/w:type="page"|w:pageBreakBefore/g) ?? []).length
  assert.ok(pageBreaks >= variants - 1, 'Every variant must start on a new page')
  return text
}
function inspectPdf(buffer, variants, key) {
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-')
  assert.ok(buffer.length > 3000, 'PDF must contain the generated exam')
  const raw = buffer.toString('latin1')
  assert.ok((raw.match(/\/Type\s*\/Page\b/g) ?? []).length >= variants + (key ? 1 : 0), 'PDF must separate each variant and the teacher key')
  assert.match(raw, /\/Subtype\s*\/Image\b/, 'Question image must be embedded in PDF')
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' })
  await context.addInitScript(value => {
    localStorage.setItem('quicktest.auth', JSON.stringify(value))
    localStorage.setItem('quicktest.theme', 'light')
    history.replaceState({ examaiView: 'tests' }, '')
  }, auth)
  // All API traffic is handled here; the test never creates or changes real teaching data.
  await context.route('**/api/**', async route => {
    const request = route.request(), method = request.method(), path = new URL(request.url()).pathname
    requests.push({ method, path })
    const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (method === 'GET') {
      if (path === '/api/auth/me') return respond(auth.user)
      if (path === '/api/v1/tests') return respond(tests)
      if (path === '/api/v1/subjects') return respond([{ name: 'Програмиране', preset: true }])
      if (['/api/v1/subjects/topics', '/api/v1/subjects/topics/personal', '/api/v1/groups', '/api/v1/assignments', '/api/v1/grading'].includes(path)) return respond([])
      if (path === '/api/v1/files/901') {
        if (holdImage) { holdImage = false; await new Promise(resolve => { releaseImage = resolve }) }
        if (failImage) { failImage = false; return respond({ detail: 'Изображението е недостъпно.' }, 503) }
        return route.fulfill({ status: 200, contentType: 'image/png', headers, body: image })
      }
      const test = tests.find(value => path === `/api/v1/tests/${value.id}`)
      if (test) {
        if (failDetail) { failDetail = false; return respond({ detail: 'Тестът временно не може да се зареди.' }, 503) }
        return respond(test)
      }
    }
    errors.push(`Unexpected API: ${method} ${path}`)
    return respond({}, 404)
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const downloads = []
  page.on('download', value => downloads.push(value))
  await page.goto(frontend)
  const table = page.getByRole('table', { name: 'Тестове', exact: true })
  const row = table.getByRole('row').filter({ has: page.getByRole('button', { name: definition.title, exact: true }) })
  const directPrint = row.getByRole('button', { name: 'Свали за печат', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Свали тест за печат', exact: true })
  const count = dialog.getByLabel('Брой варианти', { exact: true })
  const format = dialog.locator('select')
  const key = dialog.getByLabel('Отделен ключ с верните отговори', { exact: true })
  const shuffle = dialog.getByLabel('Разбъркай въпросите във всеки вариант', { exact: true })
  await directPrint.click()
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Свали PDF', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('dialog input[type="number"]')?.matches(':disabled') === false)
  assert.equal(await page.getByRole('region', { name: 'Избран тест', exact: true }).count(), 0, 'Print must open directly from the table without selecting the preview')
  assert.equal(await count.inputValue(), '3')
  assert.equal(await format.inputValue(), 'pdf')
  assert.equal(await key.isChecked(), true)
  assert.equal(await shuffle.isChecked(), true)
  for (const invalid of ['', '0', '21', '1.5']) {
    await count.fill(invalid)
    assert.equal(await dialog.getByRole('button', { name: 'Свали PDF', exact: true }).isDisabled(), true, `Invalid count ${invalid} must not be downloadable`)
  }
  await count.fill('3')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await directPrint.evaluate(element => element === document.activeElement), true, 'Escape must restore the triggering table button')

  failDetail = true
  await directPrint.click()
  await dialog.getByRole('alert').filter({ hasText: 'Тестът временно не може да се зареди.' }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Свали PDF', exact: true }).isDisabled(), true)
  await dialog.getByRole('button', { name: 'Опитай отново', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('dialog input[type="number"]')?.matches(':disabled') === false)
  await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await directPrint.evaluate(element => element === document.activeElement), true)

  // A paper exam with a single true/false question has only one distinct arrangement.
  const limitedRow = table.getByRole('row').filter({ has: page.getByRole('button', { name: oneVariantDefinition.title, exact: true }) })
  await limitedRow.getByRole('button', { name: 'Свали за печат', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('dialog input[type="number"]')?.matches(':disabled') === false)
  assert.equal(await count.inputValue(), '1')
  assert.equal(await count.getAttribute('max'), '1')
  await count.fill('2')
  assert.equal(await dialog.getByRole('button', { name: 'Свали PDF', exact: true }).isDisabled(), true)
  await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  await directPrint.click()
  await page.waitForFunction(() => document.querySelector('dialog input[type="number"]')?.matches(':disabled') === false)
  holdImage = true
  const imageRequested = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/files/901')
  const pendingPdf = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Свали PDF', exact: true }).click()
  await imageRequested
  assert.equal(await dialog.getAttribute('aria-busy'), 'true')
  assert.equal(await count.isDisabled(), true)
  assert.equal(await dialog.getByRole('button', { name: 'Отказ', exact: true }).isDisabled(), true)
  await dialog.locator('form').evaluate(element => { element.requestSubmit(); element.requestSubmit() })
  await page.keyboard.press('Escape')
  assert.equal(await dialog.isVisible(), true, 'Busy export must not be dismissed')
  releaseImage()
  const pdfDownload = await pendingPdf
  assert.match(pdfDownload.suggestedFilename(), /\.pdf$/)
  inspectPdf(await bytes(pdfDownload, 'sample-key.pdf'), 3, true)
  await page.waitForFunction(() => document.querySelector('dialog')?.getAttribute('aria-busy') === 'false')
  assert.equal(downloads.length, 1, 'Repeated submit during generation must create one download')
  await format.selectOption('docx')
  const pendingWord = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Свали Word', exact: true }).click()
  const wordDownload = await pendingWord
  assert.match(wordDownload.suggestedFilename(), /\.docx$/)
  await inspectWord(await bytes(wordDownload, 'sample-key.docx'), 3, true)
  await page.waitForFunction(() => document.querySelector('dialog')?.getAttribute('aria-busy') === 'false')
  assert.equal(downloads.length, 2)
  await dialog.getByRole('button', { name: 'Отказ', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  // The preview offers the same export flow, and student copies exclude the answer key.
  await row.getByRole('button', { name: definition.title, exact: true }).click()
  const preview = page.getByRole('region', { name: 'Избран тест', exact: true })
  await preview.getByRole('button', { name: 'Свали за печат', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('dialog input[type="number"]')?.matches(':disabled') === false)
  await count.fill('2')
  await shuffle.uncheck()
  await key.uncheck()
  await format.selectOption('docx')
  failImage = true
  await dialog.getByRole('button', { name: 'Свали Word', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: 'Изображението е недостъпно.' }).waitFor()
  const studentWord = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Свали Word', exact: true }).click()
  await inspectWord(await bytes(await studentWord, 'sample-student.docx'), 2, false, false)
  await page.waitForFunction(() => document.querySelector('dialog')?.getAttribute('aria-busy') === 'false')
  await format.selectOption('pdf')
  const studentPdf = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Свали PDF', exact: true }).click()
  inspectPdf(await bytes(await studentPdf, 'sample-student.pdf'), 2, false)
  await page.waitForFunction(() => document.querySelector('dialog')?.getAttribute('aria-busy') === 'false')
  assert.equal(downloads.length, 4, 'Image failure must not create an incomplete download')

  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((element, theme) => element.setAttribute('data-theme', theme), theme)
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true, `${theme} ${width}: dialog must not overflow horizontally`)
      assert.equal(await dialog.locator('input,select,button').evaluateAll(controls => controls.filter(control => control.checkVisibility()).every(control => {
        const box = control.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth
      })), true, `${theme} ${width}: dialog controls must fit viewport`)
      await dialog.screenshot({ path: new URL(`dialog-${theme}-${width}.png`, artifacts).pathname })
    }
  }
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await preview.getByRole('button', { name: 'Свали за печат', exact: true }).evaluate(element => element === document.activeElement), true)
  await page.setViewportSize({ width: 1440, height: 1100 })
  await table.scrollIntoViewIfNeeded()
  await page.screenshot({ path: new URL('library-desktop.png', artifacts).pathname, fullPage: true })
  assert.equal(requests.some(request => !['GET', 'OPTIONS'].includes(request.method)), false, 'Export must not mutate a test or assignment')
  assert.deepEqual(errors, [])
  console.log('Passed: direct library and preview export, PDF and Word bytes/content, shuffled variants and optional teacher key, images/Cyrillic/instructions/all question types, count validation and single-arrangement limit, load retry, cancel/Escape/focus, busy/duplicate-submit protection, light/dark desktop and 390/320 dialogs. Mocked API only.')
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('failure.png', artifacts).pathname, fullPage: true })
  throw error
} finally { await browser.close() }
