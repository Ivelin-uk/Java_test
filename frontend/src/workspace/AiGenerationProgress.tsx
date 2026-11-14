import { ArrowDown, LoaderCircle, Sparkles } from 'lucide-react'
import type { RefObject } from 'react'
import './aiGenerationProgress.css'

export function AiGenerationProgress({ progressRef, submitting, status, total, shown, following, onResume }: {
  progressRef: RefObject<HTMLElement | null>; submitting: boolean; status?: string; total?: number; shown?: number; following: boolean; onResume: () => void
}) {
  const revealing = shown !== undefined && total !== undefined
  return <section ref={progressRef} className="ws-ai-progress" aria-label="Зареждане на AI теста">
    <div className="ws-ai-progress-heading">
      <span className="ws-ai-progress-icon" aria-hidden="true">{revealing ? <Sparkles size={21} /> : <LoaderCircle size={21} className="spin" />}</span>
      <div role="status" aria-live="polite" aria-atomic="true">
        <strong>{revealing ? `Показани ${shown} от ${total} въпроса` : submitting ? 'Изпращане на AI заявката…' : status === 'queued' ? 'AI заявката е на опашка…' : 'AI подготвя теста…'}</strong>
        <p>{revealing ? 'Въпросите се появяват последователно. След това можеш да ги редактираш.' : 'Подготвяме въпросите и отговорите. Това може да отнеме малко време.'}</p>
      </div>
      {!following && <button type="button" className="command-button" onClick={onResume}><ArrowDown size={16} aria-hidden="true" />Следвай новите въпроси</button>}
    </div>
    {revealing
      ? <progress aria-label="Показани AI въпроси" max={total} value={shown} />
      : <div className="ws-ai-progress-track" aria-hidden="true"><span /></div>}
  </section>
}
