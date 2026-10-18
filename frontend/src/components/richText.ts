import DOMPurify from 'dompurify'
import katex from 'katex'
import type { JSONContent } from '@tiptap/core'

// Keep the existing string API and distinguish formatted content from legacy text
// (including questions which contain literal HTML or mathematical inequalities).
const prefix = '<!--examai-rich-text:v1-->'
export const questionTextLimit = 12000
export const mathOptions = { throwOnError: false, trust: false, strict: 'ignore' as const, maxExpand: 200, maxSize: 20 }

function richDocument(value: string) {
  const document = new DOMParser().parseFromString(DOMPurify.sanitize(value.slice(prefix.length), {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'ul', 'ol', 'li', 'span'],
    ALLOWED_ATTR: ['style', 'data-type', 'data-latex'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  }), 'text/html')
  document.body.querySelectorAll<HTMLElement>('*').forEach(element => {
    const alignment = element.style.textAlign
    element.removeAttribute('style')
    if (element.tagName === 'P' && ['center', 'right', 'justify'].includes(alignment)) element.style.textAlign = alignment
    if (element.tagName === 'SPAN' && element.dataset.type === 'inline-math') {
      element.textContent = element.dataset.latex ?? ''
    } else {
      element.removeAttribute('data-type')
      element.removeAttribute('data-latex')
    }
  })
  return document
}

export function richTextContent(value: string): string | JSONContent {
  if (value.startsWith(prefix)) return richDocument(value).body.innerHTML
  return { type: 'doc', content: value.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) }
}

export function plainQuestionText(value: string): string {
  if (!value.startsWith(prefix)) return value
  const document = richDocument(value)
  document.body.querySelectorAll('[data-type="inline-math"]').forEach(element => { element.textContent = `\\(${element.getAttribute('data-latex') ?? ''}\\)` })
  document.body.querySelectorAll('sup, sub').forEach(element => { element.replaceWith(`${element.tagName === 'SUP' ? '^' : '_'}{${element.textContent}}`) })
  document.body.querySelectorAll('p, li').forEach(element => element.append('\n'))
  document.body.querySelectorAll('br').forEach(element => element.replaceWith('\n'))
  return document.body.textContent?.trim() ?? ''
}

export function serializedQuestionText(json: JSONContent, html: string, text: string): string {
  const formatted = (node: JSONContent): boolean => !!node.marks?.length || !['doc', 'paragraph', 'text', 'hardBreak'].includes(node.type ?? '') || !!node.attrs?.textAlign && node.attrs.textAlign !== 'left' || !!node.content?.some(formatted)
  if (!text.trim() && !html.includes('data-type="inline-math"')) return ''
  return formatted(json) ? prefix + html : text
}

export function renderedQuestionHtml(value: string): string | null {
  if (!value.startsWith(prefix)) return null
  const document = richDocument(value)
  document.body.querySelectorAll<HTMLElement>('[data-type="inline-math"]').forEach(element => {
    const latex = element.dataset.latex ?? ''
    element.className = 'question-formula'
    element.innerHTML = katex.renderToString(latex, mathOptions)
  })
  return document.body.innerHTML
}
