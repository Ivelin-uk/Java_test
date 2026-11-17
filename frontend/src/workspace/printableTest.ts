import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import { plainQuestionText } from '../components/richText'
import type { Definition, Question } from './types'

export type PrintFormat = 'pdf' | 'docx'
type ImageLoader = (id: number) => Promise<Blob>
interface PrintableQuestion {
  question: Question
  options: Question['options']
  leftPairs: NonNullable<Question['matchingPairs']>
  rightAnswers: string[]
}
interface PrintableVariant { questions: PrintableQuestion[] }
interface PrintImage { dataUrl: string; bytes: Uint8Array; type: 'png' | 'jpg'; width: number; height: number }
type PrintBlock = { kind: 'text'; text: string; title?: boolean; heading?: boolean; question?: boolean; muted?: boolean; pageBreak?: boolean; indent?: boolean }
  | { kind: 'image'; image: PrintImage }
  | { kind: 'matching'; left: string[]; right: string[] }
let fontsLoaded = false
const answerLine = '____________________________________________________________'

function factorial(count: number): bigint {
  let value = 1n
  for (let index = 2; index <= count; index += 1) value *= BigInt(index)
  return value
}
function answerPermutationCount(definition: Definition): bigint {
  return definition.questions.reduce((count, question) => {
    if (question.type === 'MATCHING') return count * factorial(question.matchingPairs?.length ?? 0) ** 2n
    if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') return count * factorial(question.options.length)
    return count
  }, 1n)
}
function permutationCount(definition: Definition, shuffleQuestions: boolean): bigint {
  return shuffleQuestions ? factorial(definition.questions.length) : answerPermutationCount(definition)
}
export function printableVariantLimit(definition: Definition, shuffleQuestions = true): number {
  const count = shuffleQuestions ? factorial(definition.questions.length) : answerPermutationCount(definition)
  return Number(count < 20n ? count : 20n)
}
function permutation<T>(items: readonly T[], rank: bigint): T[] {
  const remaining = [...items], result: T[] = []
  while (remaining.length) {
    const block = factorial(remaining.length - 1)
    result.push(remaining.splice(Number(rank / block), 1)[0])
    rank %= block
  }
  return result
}
function randomRank(limit: bigint): bigint {
  const words = new Uint32Array(Math.max(1, Math.ceil(limit.toString(2).length / 32)))
  crypto.getRandomValues(words)
  return words.reduce((value, word) => (value << 32n) | BigInt(word), 0n) % limit
}
function printableVariants(definition: Definition, count: number, shuffleQuestions: boolean): PrintableVariant[] {
  if (!definition.questions.length) throw new Error('Тестът няма въпроси за печат.')
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('Избери от 1 до 20 варианта.')
  const possible = permutationCount(definition, shuffleQuestions)
  if (BigInt(count) > possible) throw new Error(`Този тест позволява най-много ${possible} различни варианта чрез разбъркване.`)
  const questionOrderCount = factorial(definition.questions.length)
  const answerOrderCount = answerPermutationCount(definition)
  const used = new Set<bigint>()
  return Array.from({ length: count }, () => {
    const rankLimit = shuffleQuestions ? questionOrderCount : answerOrderCount
    let rank = randomRank(rankLimit)
    // The fallback guarantees progress even if a random draw repeats.
    while (used.has(rank)) rank = (rank + 1n) % rankLimit
    used.add(rank)
    const questionRank = shuffleQuestions ? rank : 0n
    let answerRank = shuffleQuestions ? randomRank(answerOrderCount) : rank
    function takeAnswerPermutation<T>(items: readonly T[]) {
      const combinations = factorial(items.length), next = permutation(items, answerRank % combinations)
      answerRank /= combinations
      return next
    }
    const ordered = shuffleQuestions ? permutation(definition.questions, questionRank) : definition.questions
    return { questions: ordered.map(question => ({
      question,
      options: question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE' ? takeAnswerPermutation(question.options) : question.options,
      leftPairs: question.type === 'MATCHING' ? takeAnswerPermutation(question.matchingPairs ?? []) : [],
      rightAnswers: question.type === 'MATCHING' ? takeAnswerPermutation((question.matchingPairs ?? []).map(pair => pair.right)) : [],
    })) }
  })
}
function printableText(value: string | null | undefined): string {
  // Unlike parsing every string as HTML, this preserves legacy code and comparisons.
  return plainQuestionText(value ?? '').replace(/\u00a0/g, ' ').trim()
}
function letter(index: number) { return String.fromCharCode(65 + index) }
function correctAnswer({ question, options, leftPairs, rightAnswers }: PrintableQuestion): string {
  if (question.type === 'MATCHING') return leftPairs.map((pair, index) => `${index + 1}–${letter(rightAnswers.indexOf(pair.right))}`).join(', ')
  if (question.type === 'TRUE_FALSE') return question.options.filter(option => option.correct).map(option => printableText(option.text)).join(', ') || 'Няма зададен верен отговор'
  const correct = options.filter(option => option.correct)
  if (correct.length) return correct.map(option => `${letter(options.indexOf(option))}. ${printableText(option.text)}`).join('; ')
  if (question.acceptedAnswers?.length) return question.acceptedAnswers.map(printableText).join('; ')
  if (question.criteria?.trim()) return `Критерии: ${printableText(question.criteria)}`
  return 'За ръчна проверка'
}
function variantLabel(index: number, count: number) { return `Вариант ${index + 1}/${count}` }
function printBlocks(definition: Definition, variants: PrintableVariant[], includeAnswerKey: boolean, images = new Map<number, PrintImage>()): PrintBlock[] {
  const blocks: PrintBlock[] = []
  const text = (value: string, options: Omit<Extract<PrintBlock, { kind: 'text' }>, 'kind' | 'text'> = {}) => blocks.push({ kind: 'text', text: value, ...options })
  variants.forEach((variant, variantIndex) => {
    text(definition.title || 'Тест', { title: true, pageBreak: variantIndex > 0 })
    text(variantLabel(variantIndex, variants.length), { heading: true })
    text('Име: _______________________________________   Клас: __________\nДата: __________________')
    const metadata = [definition.subject, definition.level ? `Клас: ${definition.level}` : ''].filter(Boolean).join(' · ')
    if (metadata) text(metadata, { muted: true })
    for (const value of [definition.description, definition.instructions]) if (value) text(printableText(value))
    variant.questions.forEach(({ question, options, leftPairs, rightAnswers }, index) => {
      text(`${index + 1}. ${printableText(question.text) || 'Въпрос без текст'}`, { question: true })
      const image = question.imageId ? images.get(question.imageId) : undefined
      if (image) blocks.push({ kind: 'image', image })
      if (question.type === 'MATCHING') {
        blocks.push({ kind: 'matching', left: leftPairs.map((pair, index) => `${index + 1}. ${printableText(pair.left)}`), right: rightAnswers.map((answer, index) => `${letter(index)}. ${printableText(answer)}`) })
        text(`Връзки: ${leftPairs.map((_, index) => `${index + 1}–____`).join('    ')}`, { indent: true })
      } else if (question.type === 'TRUE_FALSE') {
        text('[ ] Вярно                 [ ] Невярно', { indent: true })
      } else if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') {
        if (question.type === 'MULTIPLE_CHOICE') text('Отбележи всички верни отговори.', { muted: true, indent: true })
        options.forEach((option, optionIndex) => text(`[ ] ${letter(optionIndex)}. ${printableText(option.text)}`, { indent: true }))
      } else {
        for (let line = 0; line < (question.type === 'OPEN_ANSWER' ? 5 : 2); line += 1) text(answerLine, { indent: true, muted: true })
      }
    })
  })
  if (includeAnswerKey) {
    text('Ключ с верните отговори', { title: true, pageBreak: true })
    text(`${definition.title || 'Тест'} · За учителя`, { muted: true })
    variants.forEach((variant, index) => {
      text(variantLabel(index, variants.length), { heading: true })
      variant.questions.forEach((question, index) => text(`${index + 1}. ${correctAnswer(question)}`))
    })
  }
  return blocks
}
function pdfDocument(blocks: PrintBlock[]): TDocumentDefinitions {
  const content: Content[] = blocks.map(block => {
    if (block.kind === 'image') return { image: block.image.dataUrl, fit: [360, 200], margin: [12, 0, 0, 8] }
    if (block.kind === 'matching') return { columns: [{ width: '*', stack: block.left.map(text => ({ text, margin: [0, 2, 0, 2] })) }, { width: '*', stack: block.right.map(text => ({ text, margin: [0, 2, 0, 2] })) }], columnGap: 20, margin: [12, 0, 0, 6] }
    return { text: block.text, fontSize: block.title ? 21 : block.heading ? 13 : block.muted ? 10 : 11, bold: block.title || block.heading || block.question,
      color: block.muted ? '#555555' : '#111111', pageBreak: block.pageBreak ? 'before' : undefined,
      margin: [block.indent ? 12 : 0, block.question ? 10 : block.heading ? 6 : 0, 0, block.title || block.heading ? 8 : 6],
      headlineLevel: block.question || block.title || block.heading ? 1 : undefined }
  })
  return { pageSize: 'A4', pageMargins: [40, 40, 40, 40], content,
    defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.15 },
    footer: (page, pages) => ({ text: `${page} / ${pages}`, alignment: 'center', fontSize: 9, margin: [0, 10, 0, 0] }),
    pageBreakBefore: (current, container) => current.headlineLevel === 1 && container.getFollowingNodesOnPage().length === 0,
  }
}
export function printableTestDocument(definition: Definition, variantCount: number, includeAnswerKey = false, shuffleQuestions = true): TDocumentDefinitions {
  return pdfDocument(printBlocks(definition, printableVariants(definition, variantCount, shuffleQuestions), includeAnswerKey))
}
async function loadImages(definition: Definition, loader?: ImageLoader): Promise<Map<number, PrintImage>> {
  const ids = [...new Set(definition.questions.map(question => question.imageId).filter((id): id is number => !!id))]
  if (ids.length && !loader) throw new Error('Изображенията към теста не могат да бъдат заредени за печат.')
  const images = new Map<number, PrintImage>()
  await Promise.all(ids.map(async id => {
    const blob = await loader!(id)
    if (!['image/png', 'image/jpeg'].includes(blob.type)) throw new Error('Изображението към въпрос трябва да е PNG или JPEG.')
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Изображението не може да бъде прочетено.'))
      reader.readAsDataURL(blob)
    })
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => reject(new Error('Изображението не може да бъде заредено за печат.'))
      image.src = dataUrl
    })
    images.set(id, { dataUrl, bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type === 'image/png' ? 'png' : 'jpg', ...dimensions })
  }))
  return images
}
async function wordDocument(blocks: PrintBlock[], title: string): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, BorderStyle, WidthType, Footer, PageNumber } = await import('docx')
  function textRuns(text: string) { return text.split('\n').map((text, index) => new TextRun({ text, break: index ? 1 : undefined })) }
  const children = blocks.map(block => {
    if (block.kind === 'image') {
      const { image } = block, scale = Math.min(1, 480 / image.width, 267 / image.height)
      return new Paragraph({ children: [new ImageRun({ data: image.bytes, type: image.type, transformation: { width: Math.round(image.width * scale), height: Math.round(image.height * scale) } })], spacing: { after: 140 }, keepNext: true })
    }
    if (block.kind === 'matching') {
      const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
      return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder }, rows: block.left.map((text, index) => new TableRow({ cantSplit: true, children: [
        new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: textRuns(text) })] }),
        new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: textRuns(block.right[index]) })] }),
      ] })) })
    }
    return new Paragraph({ children: block.text.split('\n').map((text, index) => new TextRun({ text, break: index ? 1 : undefined, bold: block.title || block.heading || block.question, size: block.title ? 42 : block.heading ? 26 : block.muted ? 20 : 22, color: block.muted ? '555555' : '111111' })),
      pageBreakBefore: block.pageBreak, keepNext: block.title || block.heading || block.question,
      indent: block.indent ? { left: 200 } : undefined,
      spacing: { before: block.question ? 200 : block.heading ? 120 : 0, after: block.title || block.heading ? 160 : 100, line: 280 },
    })
  })
  return Packer.toBlob(new Document({ title, creator: 'ExamAI', styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 800, bottom: 800, left: 800, right: 800 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: 'center', children: [new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 18 })] })] }) }, children }],
  }))
}
export async function downloadPrintableTest(definition: Definition, variantCount: number, includeAnswerKey = false, format: PrintFormat = 'pdf', loadImage?: ImageLoader, shuffleQuestions = true) {
  const variants = printableVariants(definition, variantCount, shuffleQuestions), images = await loadImages(definition, loadImage)
  const blocks = printBlocks(definition, variants, includeAnswerKey, images)
  const filename = `${(definition.title || 'test').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || 'test'}-variants.${format}`
  if (format === 'docx') {
    const blob = await wordDocument(blocks, definition.title || 'Тест'), url = URL.createObjectURL(blob), link = document.createElement('a')
    try { link.href = url; link.download = filename; document.body.append(link); link.click() }
    finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
    return
  }
  const [{ default: pdfMake }, { default: fontFiles }] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])
  if (!fontsLoaded) { pdfMake.addVirtualFileSystem(fontFiles); fontsLoaded = true }
  await pdfMake.createPdf(pdfDocument(blocks)).download(filename)
}
