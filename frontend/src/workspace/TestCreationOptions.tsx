import { useEffect, useRef } from 'react'
import { ArrowRight, FileImage, FileText, PencilLine, Sparkles, X } from 'lucide-react'
import './testCreation.css'

export type TestCreationMode = 'ai' | 'manual' | 'google-forms' | 'photo'

const choices: { mode: TestCreationMode; title: string; description: string; note: string; icon: typeof Sparkles }[] = [
  { mode: 'ai', title: 'С AI', description: 'Опиши предмета и темата — AI ще подготви въпроси за преглед и редакция.', note: 'Най-бързият начин', icon: Sparkles },
  { mode: 'manual', title: 'Ръчно', description: 'Създай теста стъпка по стъпка и задай верните отговори и оценяването.', note: 'Пълен контрол', icon: PencilLine },
  { mode: 'google-forms', title: 'От Google Forms', description: 'Запази формуляра като PDF и качи файла, за да превърнем въпросите в тест.', note: 'PDF експорт', icon: FileText },
  { mode: 'photo', title: 'От снимка', description: 'Качи ясна снимка или сканирано изображение на теста и AI ще го разчете.', note: 'PNG или JPG', icon: FileImage },
]

export function TestCreationOptions({ onClose, onChoose }: { onClose: () => void; onChoose: (mode: TestCreationMode) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    element?.showModal()
    closeButton.current?.focus()
    return () => {
      element?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  return <dialog ref={dialog} className="ws-create-dialog" aria-labelledby="create-test-title" aria-describedby="create-test-description" onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <header className="ws-create-dialog-head">
      <div><span className="ws-create-eyebrow">НОВ ТЕСТ</span><h2 id="create-test-title">Как искаш да създадеш теста?</h2><p id="create-test-description">Избери най-удобния начин. Ще можеш да прегледаш и редактираш въпросите преди запазване.</p></div>
      <button ref={closeButton} type="button" className="icon-button" aria-label="Затвори" onClick={onClose}><X size={19} aria-hidden="true" /></button>
    </header>
    <div className="ws-create-options">
      {choices.map(({ mode, title, description, note, icon: Icon }) => <button key={mode} type="button" className={`ws-create-option${mode === 'ai' ? ' ws-create-option-featured' : ''}`} onClick={() => onChoose(mode)}>
        <span className="ws-create-option-icon"><Icon size={21} aria-hidden="true" /></span>
        <span className="ws-create-option-copy"><strong>{title}</strong><span>{description}</span><small>{note}</small></span>
        <ArrowRight className="ws-create-option-arrow" size={18} aria-hidden="true" />
      </button>)}
    </div>
    <footer className="ws-create-dialog-foot"><span>Всички въпроси остават за твой преглед.</span></footer>
  </dialog>
}
