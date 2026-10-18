import { useEffect, useId, useRef, useState } from 'react'
import katex from 'katex'
import type { MathfieldElement } from 'mathlive'
import { Check, X } from 'lucide-react'
import { mathOptions } from './richText'
import 'mathlive/fonts.css'

const templates = [
  ['Степен', 'x^{2}', '#@^{#?}'], ['Долен индекс', 'x_{n}', '#@_{#?}'],
  ['Корен', '\\sqrt{x}', '\\sqrt{#0}'], ['Корен n-ти', '\\sqrt[n]{x}', '\\sqrt[#?]{#0}'],
  ['Дроб', '\\frac{a}{b}', '\\frac{#0}{#?}'], ['Скоби', '\\left(x\\right)', '\\left(#0\\right)'],
  ['Сума', '\\sum_{i=1}^{n}', '\\sum_{#?}^{#?}#0'], ['Интеграл', '\\int_{a}^{b}', '\\int_{#?}^{#?}#0\\,dx'],
  ['Безкрайност', '\\infty', '\\infty'], ['Пи', '\\pi', '\\pi'], ['Плюс-минус', '\\pm', '\\pm'], ['Неравенство', '\\leq', '\\leq'],
]

export function FormulaDialog({ initialLatex, onClose, onSave }: { initialLatex: string; onClose: () => void; onSave: (latex: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const keyboardHost = useRef<HTMLDivElement>(null)
  const mathfield = useRef<MathfieldElement | null>(null)
  const titleId = useId()
  const [latex, setLatex] = useState(initialLatex)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  let validationError = ''
  try { if (latex.trim()) katex.renderToString(latex, { ...mathOptions, throwOnError: true }) } catch { validationError = 'Довърши формулата или поправи невалидните символи.' }
  const valid = !!latex.trim() && latex.length <= 2000 && !validationError

  useEffect(() => {
    dialog.current?.showModal()
    let active = true
    let dispose: (() => void) | undefined
    import('mathlive').then(({ MathfieldElement }) => {
      if (!active || !host.current) return
      MathfieldElement.fontsDirectory = null
      MathfieldElement.soundsDirectory = null
      const field = new MathfieldElement()
      field.mathVirtualKeyboardPolicy = 'manual'
      field.smartFence = true
      field.setAttribute('aria-label', 'Математическа формула')
      field.value = initialLatex
      const input = () => setLatex(field.value)
      field.addEventListener('input', input)
      field.addEventListener('change', input)
      host.current.append(field)
      const keyboard = window.mathVirtualKeyboard
      keyboard.container = keyboardHost.current
      keyboard.layouts = ['compact', 'symbols', 'greek']
      const geometry = () => { if (keyboardHost.current) keyboardHost.current.style.height = `${keyboard.boundingRect.height}px` }
      keyboard.addEventListener('geometrychange', geometry)
      mathfield.current = field
      setReady(true)
      field.focus()
      dispose = () => { keyboard.hide(); keyboard.removeEventListener('geometrychange', geometry); keyboard.container = null; field.removeEventListener('input', input); field.removeEventListener('change', input); field.remove(); mathfield.current = null }
    }).catch(() => { if (active) setLoadError('Редакторът за формули не се зареди. Затвори прозореца и опитай отново.') })
    return () => { active = false; dispose?.() }
  }, [initialLatex])

  return <dialog ref={dialog} className="formula-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }} onKeyDownCapture={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <header><h3 id={titleId}>{initialLatex ? 'Редактиране на формула' : 'Добавяне на формула'}</h3><button type="button" className="icon-button" title="Затвори формулата" onClick={onClose}><X size={18} /></button></header>
    <p className="question-editor-hint">Избери символ и попълни полетата. Използвай стрелките, за да се придвижваш между степента, корена и дробта.</p>
    <div className="formula-templates" role="group" aria-label="Математически символи">{templates.map(([label, preview, insert]) => <button key={label} type="button" title={label} aria-label={label} disabled={!ready} onMouseDown={event => event.preventDefault()} onClick={() => {
      mathfield.current?.focus()
      mathfield.current?.insert(insert, { focus: true, selectionMode: 'placeholder' })
      setLatex(mathfield.current?.value ?? '')
    }} dangerouslySetInnerHTML={{ __html: katex.renderToString(preview, mathOptions) }} />)}</div>
    <div ref={host} className="formula-input" />
    <button type="button" className="formula-more-symbols" disabled={!ready} onMouseDown={event => event.preventDefault()} onClick={() => { mathfield.current?.focus(); window.mathVirtualKeyboard.visible = !window.mathVirtualKeyboard.visible }}>Още символи и гръцки букви</button>
    {!ready && !loadError && <p role="status">Зареждане на редактора…</p>}
    {loadError && <p role="alert" className="question-editor-error">{loadError}</p>}
    {validationError && <p role="alert" className="question-editor-error">{validationError}</p>}
    {latex.length > 2000 && <p role="alert" className="question-editor-error">Формулата е твърде дълга (до 2000 символа).</p>}
    <details className="formula-source"><summary>LaTeX код</summary><label>Код на формулата<input value={latex} onChange={event => { setLatex(event.target.value); if (mathfield.current) mathfield.current.value = event.target.value }} /></label></details>
    <div ref={keyboardHost} className="formula-keyboard" />
    <div className="dialog-actions"><button type="button" onClick={onClose}>Отказ</button><button type="button" className="primary command-button" disabled={!ready || !valid} onClick={() => onSave(latex.trim())}><Check size={17} />{initialLatex ? 'Запази формулата' : 'Добави формулата'}</button></div>
  </dialog>
}
