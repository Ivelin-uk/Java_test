import { ArrowLeftRight, Plus } from 'lucide-react'
import { DeleteConfirmationButton } from '../components/DeleteConfirmationDialog'
import type { MatchingPair } from './types'
import './matchingPairs.css'

export function MatchingPairsEditor({ pairs, questionNumber, onChange, disabled }: { pairs: MatchingPair[]; questionNumber: number; onChange: (pairs: MatchingPair[]) => void; disabled: boolean }) {
  function patch(index: number, side: keyof MatchingPair, text: string) {
    onChange(pairs.map((pair, i) => i === index ? { ...pair, [side]: text } : pair))
  }
  return <fieldset className="ws-matching-editor" disabled={disabled}>
    <legend>Правилни двойки за свързване</legend>
    <p className="ws-muted">Въведи от 2 до 12 двойки. Блокчетата се разбъркват при решаване. Всички двойки трябва да са свързани правилно за пълния брой точки.</p>
    {pairs.map((pair, index) => <div className="ws-matching-pair-row" key={index}>
      <label>Ляво блокче {index + 1}<input aria-label={`Въпрос ${questionNumber}, ляво блокче ${index + 1}`} maxLength={4000} value={pair.left} onChange={event => patch(index, 'left', event.target.value)} /></label>
      <ArrowLeftRight size={19} aria-hidden="true" />
      <label>Дясно блокче {index + 1}<input aria-label={`Въпрос ${questionNumber}, дясно блокче ${index + 1}`} maxLength={4000} value={pair.right} onChange={event => patch(index, 'right', event.target.value)} /></label>
      <DeleteConfirmationButton label={`Премахни двойка ${index + 1}`} disabled={disabled || pairs.length <= 2} title="Премахване на двойка" confirmLabel="Премахни" description={<>Да премахнем ли двойката „{pair.left} ↔ {pair.right}“?</>} successMessage="Двойката е премахната от черновата." onConfirm={() => onChange(pairs.filter((_, i) => i !== index))} />
    </div>)}
    <button type="button" className="command-button" disabled={pairs.length >= 12} onClick={() => onChange([...pairs, { left: '', right: '' }])}><Plus size={16} /> Добави двойка</button>
  </fieldset>
}

export function MatchingPairsPreview({ pairs }: { pairs?: MatchingPair[] | null }) {
  if (!pairs?.length) return null
  return <ul className="ws-matching-pairs-preview" aria-label="Правилни двойки">{pairs.map((pair, index) => <li key={index}><span>{pair.left}</span><ArrowLeftRight size={17} aria-hidden="true" /><span>{pair.right}</span></li>)}</ul>
}
