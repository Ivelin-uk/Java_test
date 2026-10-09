import { useId, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type { Assessment } from './types'

export function TestPicker({ tests, selected, select, disabled }: { tests: Assessment[]; selected: Assessment | null; select: (test: Assessment | null) => void; disabled: boolean }) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const results = tests.filter(test => test.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  function choose(test: Assessment) { select(test); setQuery(''); setOpen(false); setIndex(0) }
  return <div className="ws-user-picker ws-test-picker" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}>
    <label htmlFor={id}>Тест</label>
    <div className="ws-test-picker-input">
      <input ref={input} id={id} role="combobox" required autoComplete="off" placeholder="Търси по име на теста" disabled={disabled} value={selected?.title ?? query} aria-expanded={open} aria-controls={open ? `${id}-results` : undefined} aria-autocomplete="list" aria-activedescendant={open && results[index] ? `${id}-option-${results[index].id}` : undefined}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={e => { select(null); setQuery(e.target.value); setIndex(0); setOpen(true) }}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); setOpen(true)
            const next = open ? Math.max(0, Math.min(results.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1))) : 0
            setIndex(next); document.getElementById(`${id}-option-${results[next]?.id}`)?.scrollIntoView({ block: 'nearest' })
          } else if (e.key === 'Enter' && open) { e.preventDefault(); if (results[index]) choose(results[index]) }
        }} />
      <div className="ws-test-picker-tools">
        {selected && <button type="button" className="icon-button" title="Изчисти избрания тест" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => { select(null); setQuery(''); setIndex(0); setOpen(true); input.current?.focus() }}><X size={15} /></button>}
        <button type="button" className="icon-button" title="Списък с тестове" aria-expanded={open} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => { setOpen(!open); input.current?.focus({ preventScroll: true }) }}><ChevronDown size={17} /></button>
      </div>
    </div>
    {open && !disabled && <div className="ws-user-options" id={`${id}-results`} role="listbox" aria-label="Тестове за възлагане">
      {results.map((test, i) => <button type="button" role="option" tabIndex={-1} id={`${id}-option-${test.id}`} aria-selected={i === index} key={test.id} onMouseDown={e => e.preventDefault()} onClick={() => choose(test)}><strong>{test.title}</strong><small>{test.question_count} въпроса · {(test.total_time_seconds / 60).toLocaleString('bg-BG', { maximumFractionDigits: 2 })} мин</small></button>)}
      {!results.length && <p>Няма намерени тестове.</p>}
    </div>}
  </div>
}
