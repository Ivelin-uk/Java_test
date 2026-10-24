import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import TextAlign from '@tiptap/extension-text-align'
import { InlineMath } from '@tiptap/extension-mathematics'
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, List, ListOrdered, Redo2, RemoveFormatting, Sigma, Strikethrough, Subscript as SubscriptIcon, Superscript as SuperscriptIcon, Underline, Undo2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { mathOptions, questionTextLimit, richTextContent, serializedQuestionText } from './richText'
import { FormulaDialog } from './FormulaDialog'
import 'katex/dist/katex.min.css'
import './richText.css'

export function QuestionTextEditor({ value, onChange, disabled = false, label = 'Условие на въпроса', ariaLabel = 'Текст', toolbarLabel = 'Форматиране на условието', hint = 'Маркирай текст, за да го форматираш. За корен, дроб или уравнение избери „Формула“.', maxLength = questionTextLimit }: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  label?: string
  ariaLabel?: string
  toolbarLabel?: string
  hint?: string
  maxLength?: number
}) {
  const labelId = useId()
  const hintId = useId()
  const lastValue = useRef(value)
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  const [formula, setFormula] = useState<{ latex: string; position?: number } | null>(null)
  const content = useMemo(() => richTextContent(value), [value])
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, blockquote: false, code: false, codeBlock: false, horizontalRule: false, link: false, trailingNode: false }),
      Superscript, Subscript, TextAlign.configure({ types: ['paragraph'] }),
      InlineMath.configure({ katexOptions: mathOptions, onClick: (node, position) => setFormula({ latex: String(node.attrs.latex), position }) }),
    ],
    content,
    editable: !disabled,
    editorProps: { attributes: { class: 'question-text question-text-input', role: 'textbox', 'aria-label': ariaLabel, 'aria-multiline': 'true', 'aria-describedby': hintId } },
    onUpdate: ({ editor }) => {
      const next = serializedQuestionText(editor.getJSON(), editor.getHTML(), editor.getText({ blockSeparator: '\n' }))
      lastValue.current = next
      onChangeRef.current(next)
    },
  })
  const state = useEditorState({ editor, selector: ({ editor }) => editor ? {
    bold: editor.isActive('bold'), italic: editor.isActive('italic'), underline: editor.isActive('underline'), strike: editor.isActive('strike'),
    superscript: editor.isActive('superscript'), subscript: editor.isActive('subscript'), bulletList: editor.isActive('bulletList'), orderedList: editor.isActive('orderedList'),
    left: !editor.getAttributes('paragraph').textAlign || editor.isActive({ textAlign: 'left' }), center: editor.isActive({ textAlign: 'center' }), right: editor.isActive({ textAlign: 'right' }),
    undo: editor.can().undo(), redo: editor.can().redo(),
  } : null })

  useEffect(() => { editor?.setEditable(!disabled, false) }, [editor, disabled])
  useEffect(() => {
    if (editor && value !== lastValue.current) {
      editor.commands.setContent(content, { emitUpdate: false })
      lastValue.current = value
    }
  }, [editor, value, content])

  function button(Icon: LucideIcon, title: string, run: () => void, pressed?: boolean, unavailable = false) {
    return <button type="button" title={title} aria-label={title} aria-pressed={pressed} disabled={disabled || unavailable} onMouseDown={event => event.preventDefault()} onClick={run}><Icon size={17} aria-hidden="true" /></button>
  }

  return <div className="question-editor-field">
    <span id={labelId} className="question-editor-label">{label}</span>
    <div className={`question-editor${disabled ? ' question-editor-disabled' : ''}`} role="group" aria-labelledby={labelId}>
      {editor && state && <div className="question-editor-toolbar" role="toolbar" aria-label={toolbarLabel}>
        <div className="question-editor-tools">
          {button(Bold, 'Удебелен (Ctrl+B)', () => editor.chain().focus().toggleBold().run(), state.bold)}
          {button(Italic, 'Курсив (Ctrl+I)', () => editor.chain().focus().toggleItalic().run(), state.italic)}
          {button(Underline, 'Подчертан (Ctrl+U)', () => editor.chain().focus().toggleUnderline().run(), state.underline)}
          {button(Strikethrough, 'Зачеркнат', () => editor.chain().focus().toggleStrike().run(), state.strike)}
        </div>
        <div className="question-editor-tools">
          {button(SuperscriptIcon, 'Горен индекс / степен', () => editor.chain().focus().unsetSubscript().toggleSuperscript().run(), state.superscript)}
          {button(SubscriptIcon, 'Долен индекс', () => editor.chain().focus().unsetSuperscript().toggleSubscript().run(), state.subscript)}
          <button type="button" className="question-formula-button" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => {
            const selected = editor.state.selection
            const node = editor.state.doc.nodeAt(selected.from)
            setFormula(node?.type.name === 'inlineMath' ? { latex: String(node.attrs.latex), position: selected.from } : { latex: '' })
          }}><Sigma size={17} aria-hidden="true" /> Формула</button>
        </div>
        <div className="question-editor-tools">
          {button(List, 'Списък с точки', () => editor.chain().focus().toggleBulletList().run(), state.bulletList)}
          {button(ListOrdered, 'Номериран списък', () => editor.chain().focus().toggleOrderedList().run(), state.orderedList)}
          {button(AlignLeft, 'Подравни вляво', () => editor.chain().focus().setTextAlign('left').run(), state.left)}
          {button(AlignCenter, 'Центрирай', () => editor.chain().focus().setTextAlign('center').run(), state.center)}
          {button(AlignRight, 'Подравни вдясно', () => editor.chain().focus().setTextAlign('right').run(), state.right)}
        </div>
        <div className="question-editor-tools">
          {button(RemoveFormatting, 'Изчисти форматирането', () => editor.chain().focus().unsetAllMarks().clearNodes().setTextAlign('left').run())}
          {button(Undo2, 'Отмени', () => editor.chain().focus().undo().run(), undefined, !state.undo)}
          {button(Redo2, 'Повтори', () => editor.chain().focus().redo().run(), undefined, !state.redo)}
        </div>
      </div>}
      <EditorContent editor={editor} />
    </div>
    <p id={hintId} className="question-editor-hint">{hint}</p>
    {value.length > maxLength && <p role="alert" className="question-editor-error">Текстът с форматирането е твърде дълъг. Съкрати го (до {maxLength} символа).</p>}
    {formula && editor && !disabled && <FormulaDialog initialLatex={formula.latex} onClose={() => { setFormula(null); requestAnimationFrame(() => editor.commands.focus()) }} onSave={latex => {
      if (formula.position === undefined) editor.chain().unsetSuperscript().unsetSubscript().insertInlineMath({ latex }).run()
      else editor.chain().updateInlineMath({ latex, pos: formula.position }).run()
      setFormula(null)
      requestAnimationFrame(() => editor.commands.focus())
    }} />}
  </div>
}
