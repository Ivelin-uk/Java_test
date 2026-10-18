import { useMemo } from 'react'
import { renderedQuestionHtml } from './richText'
import 'katex/dist/katex.min.css'
import './richText.css'

export function QuestionText({ value, className = '' }: { value: string; className?: string }) {
  const html = useMemo(() => renderedQuestionHtml(value), [value])
  return html === null
    ? <div className={`question-text question-text-plain ${className}`}>{value}</div>
    : <div className={`question-text ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}
