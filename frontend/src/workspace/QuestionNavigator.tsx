import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export function QuestionNavigator({
  questionCount,
  visibleQuestions,
  activeQuestion,
  expanded,
  onToggle,
  onSelect,
}: {
  questionCount: number
  visibleQuestions: number[]
  activeQuestion: number
  expanded: boolean
  onToggle: () => void
  onSelect: (question: number) => void
}) {
  const [navigationOffset, setNavigationOffset] = useState(76)
  useEffect(() => {
    const appNavigation = document.querySelector('.ws-nav')
    if (!appNavigation) return
    const updateOffset = () => setNavigationOffset(appNavigation.getBoundingClientRect().bottom + 12)
    const observer = new ResizeObserver(updateOffset)
    observer.observe(appNavigation)
    window.addEventListener('scroll', updateOffset, { passive: true })
    window.addEventListener('resize', updateOffset)
    updateOffset()
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', updateOffset)
      window.removeEventListener('resize', updateOffset)
    }
  }, [])

  if (!questionCount) return null

  return <nav className={`ws-question-navigator${expanded ? ' is-expanded' : ''}`} style={{ paddingTop: navigationOffset }} aria-label="Навигация по въпросите">
    <header className="ws-question-navigator-header">
      <span className="ws-question-navigator-eyebrow">Навигация</span>
      <button
        type="button"
        className="ws-question-navigator-toggle"
        aria-label={`${expanded ? 'Свий' : 'Разгъни'} лентата с въпроси`}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span>Въпроси</span>
        {expanded ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
      </button>
      <div className="ws-question-navigator-current" aria-live="polite">
        <strong>{String(activeQuestion + 1).padStart(2, '0')}</strong>
        <span>от {questionCount}</span>
      </div>
    </header>
    <div className="ws-question-navigator-list" role="group" aria-label="Избери въпрос">
      {visibleQuestions.map(question => <button
        key={question}
        type="button"
        className="ws-question-navigator-item"
        aria-label={`Към въпрос ${question + 1}`}
        aria-current={question === activeQuestion ? 'step' : undefined}
        onClick={() => onSelect(question)}
      >
        <span className="ws-question-navigator-number">{String(question + 1).padStart(2, '0')}</span>
        <span className="ws-question-navigator-label">Въпрос {question + 1}</span>
      </button>)}
    </div>
  </nav>
}
