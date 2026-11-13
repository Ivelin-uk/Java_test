import { useEffect, useId, useRef, useState } from 'react'
import { Link2, Unlink } from 'lucide-react'
import './matchingBlocks.css'

export interface MatchingBlock { id: string; text: string }
export interface BlockMatch { leftId: string; rightId: string }

type MatchingBlocksProps = {
  left: MatchingBlock[]
  right: MatchingBlock[]
  value: BlockMatch[]
  onChange: (matches: BlockMatch[]) => void
  disabled?: boolean
}

export function MatchingBlocks({ left, right, value, onChange, disabled = false }: MatchingBlocksProps) {
  const instructions = useId()
  const board = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<{ side: 'left' | 'right'; id: string } | null>(null)
  const [paths, setPaths] = useState<{ id: string; path: string }[]>([])
  const [announcement, setAnnouncement] = useState('')
  const visible = value.filter(match => left.some(block => block.id === match.leftId) && right.some(block => block.id === match.rightId))

  useEffect(() => {
    const element = board.current
    if (!element) return
    function measure() {
      const bounds = element!.getBoundingClientRect()
      const buttons = [...element!.querySelectorAll<HTMLButtonElement>('[data-matching-id]')]
      setPaths(value.flatMap(match => {
        const a = buttons.find(button => button.dataset.matchingSide === 'left' && button.dataset.matchingId === match.leftId)?.getBoundingClientRect()
        const b = buttons.find(button => button.dataset.matchingSide === 'right' && button.dataset.matchingId === match.rightId)?.getBoundingClientRect()
        if (!a || !b) return []
        const x1 = a.right - bounds.left, y1 = a.top + a.height / 2 - bounds.top
        const x2 = b.left - bounds.left, y2 = b.top + b.height / 2 - bounds.top
        const middle = (x1 + x2) / 2
        return [{ id: match.leftId, path: `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}` }]
      }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.querySelectorAll('button').forEach(button => observer.observe(button))
    return () => observer.disconnect()
  }, [left, right, value])

  function choose(side: 'left' | 'right', block: MatchingBlock) {
    if (disabled) return
    if (!selected || selected.side === side) {
      setSelected(selected?.side === side && selected.id === block.id ? null : { side, id: block.id })
      return
    }
    const match = side === 'left' ? { leftId: block.id, rightId: selected.id } : { leftId: selected.id, rightId: block.id }
    onChange([...value.filter(current => current.leftId !== match.leftId && current.rightId !== match.rightId), match])
    setSelected(null)
    setAnnouncement(`Свързани: ${left.find(item => item.id === match.leftId)?.text} — ${right.find(item => item.id === match.rightId)?.text}.`)
  }

  return <section className="matching-blocks" aria-label="Свързване на блокчета" aria-describedby={instructions}>
    <p className="matching-instructions" id={instructions}>Избери блокче от едната колона, след това съответстващото му от другата. За промяна свържи отново. Всички двойки трябва да са верни за пълния брой точки.</p>
    <div className="matching-board" ref={board}>
      <svg className="matching-lines" aria-hidden="true">{paths.map(path => <path key={path.id} d={path.path} />)}</svg>
      {(['left', 'right'] as const).map(side => <div className={`matching-column matching-column-${side}`} key={side}>
        <h3>{side === 'left' ? 'Леви блокчета' : 'Десни блокчета'}</h3>
        {(side === 'left' ? left : right).map(block => {
          const match = visible.find(item => side === 'left' ? item.leftId === block.id : item.rightId === block.id)
          const number = match ? left.findIndex(item => item.id === match.leftId) + 1 : null
          const active = selected?.side === side && selected.id === block.id
          const connected = match ? (side === 'left' ? right.find(item => item.id === match.rightId) : left.find(item => item.id === match.leftId)) : null
          return <button type="button" className={`matching-block ${match ? 'is-linked' : ''} ${active ? 'is-selected' : ''}`} key={block.id} data-matching-side={side} data-matching-id={block.id} aria-label={`${side === 'left' ? 'Ляво' : 'Дясно'} блокче: ${block.text}${connected ? `. Свързано с: ${connected.text}` : ''}`} aria-pressed={active} disabled={disabled} onClick={() => choose(side, block)}>
            <span className="matching-block-text">{block.text}</span><span className="matching-block-marker" aria-hidden="true">{number ?? <Link2 size={16} />}</span>
          </button>
        })}
      </div>)}
    </div>
    <p className="matching-progress" role="status">Свързани двойки: {visible.length} / {left.length}{selected ? ' · Избери блокче от другата колона.' : ''}</p>
    {visible.length > 0 && <div className="matching-remove" aria-label="Премахване на връзки">{visible.map(match => {
      const number = left.findIndex(block => block.id === match.leftId) + 1
      return <button type="button" className="command-button" key={match.leftId} aria-label={`Премахни връзка ${number}`} disabled={disabled} onClick={() => { onChange(value.filter(current => current.leftId !== match.leftId)); setSelected(null); setAnnouncement(`Връзка ${number} е премахната.`) }}><Unlink size={15} aria-hidden="true" />Връзка {number}</button>
    })}</div>}
    <span className="matching-sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>
}

export function MatchingAnswerList({ left, right, matches, solution, showVerdicts = false }: { left: MatchingBlock[]; right: MatchingBlock[]; matches: BlockMatch[]; solution?: BlockMatch[]; showVerdicts?: boolean }) {
  return <ul className="matching-answer-list">{left.map(block => {
    const match = matches.find(item => item.leftId === block.id)
    const target = right.find(item => item.id === match?.rightId)
    const expected = solution?.find(item => item.leftId === block.id)
    const verdict = showVerdicts && expected ? target?.id === expected.rightId ? 'correct' : 'incorrect' : ''
    return <li key={block.id} className={verdict ? `is-${verdict}` : ''}><span>{block.text}</span><span className="matching-answer-arrow" aria-hidden="true">→</span><span>{target?.text ?? 'Без връзка'}{verdict && <small>{verdict === 'correct' ? 'Вярна връзка' : target ? 'Невярна връзка' : 'Пропусната връзка'}</small>}</span></li>
  })}</ul>
}
