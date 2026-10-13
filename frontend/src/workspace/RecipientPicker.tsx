import { useId, useRef, useState } from 'react'
import { ChevronDown, Square, SquareCheck, X } from 'lucide-react'

interface RecipientOption { id: number; name: string; detail: string }

export function RecipientPicker({ title, searchLabel, placeholder, emptyMessage, options, selected, toggle, disabled, loading }: {
  title: string; searchLabel: string; placeholder: string; emptyMessage: string; options: RecipientOption[];
  selected: number[]; toggle: (id: number) => void; disabled: boolean; loading: boolean;
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const search = query.trim().toLocaleLowerCase()
  const results = options.filter(option => `${option.name} ${option.detail}`.toLocaleLowerCase().includes(search))
  const selectedOptions = options.filter(option => selected.includes(option.id))
  const activeIndex = Math.min(index, Math.max(0, results.length - 1))
  const expanded = open && !disabled && !loading
  function move(next: number) {
    setIndex(next)
    document.getElementById(`${id}-option-${results[next]?.id}`)?.scrollIntoView({ block: 'nearest' })
  }
  function choose(value: number) {
    toggle(value); setQuery(''); setIndex(0); setOpen(false)
  }
  return <fieldset className="ws-recipient-picker" disabled={disabled || loading} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false) } }}>
    <legend>{title}</legend>
    <div className="ws-recipient-control">
      <input ref={input} id={id} role="combobox" aria-label={searchLabel} aria-expanded={expanded} aria-controls={expanded ? `${id}-results` : undefined} aria-autocomplete="list" aria-activedescendant={expanded && results[activeIndex] ? `${id}-option-${results[activeIndex].id}` : undefined} autoComplete="off" placeholder={placeholder} value={query}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setIndex(0); setOpen(true) }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true)
            move(expanded ? Math.max(0, Math.min(results.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1))) : 0)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            if (expanded && results[activeIndex]) choose(results[activeIndex].id)
            else setOpen(true)
          }
        }} />
      <div className="ws-test-picker-tools">
        {query && <button type="button" className="icon-button" title={`Изчисти търсенето: ${title}`} onMouseDown={event => event.preventDefault()} onClick={() => { setQuery(''); setIndex(0); input.current?.focus(); setOpen(true) }}><X size={16} /></button>}
        <button type="button" className="icon-button" title={`Списък: ${title}`} aria-expanded={expanded} aria-controls={expanded ? `${id}-results` : undefined} onMouseDown={event => event.preventDefault()} onClick={() => { input.current?.focus({ preventScroll: true }); setOpen(!expanded) }}><ChevronDown size={17} /></button>
      </div>
      {expanded && <div id={`${id}-results`} className="ws-user-options ws-recipient-options" role="listbox" aria-label={title} aria-multiselectable="true">
        {results.map((option, position) => <button type="button" role="option" tabIndex={-1} id={`${id}-option-${option.id}`} key={option.id} aria-label={option.name} aria-selected={selected.includes(option.id)} data-active={position === activeIndex} onMouseDown={event => event.preventDefault()} onClick={() => choose(option.id)}>
          {selected.includes(option.id) ? <SquareCheck size={18} aria-hidden="true" /> : <Square size={18} aria-hidden="true" />}
          <span><strong>{option.name}</strong>{option.detail && <small>{option.detail}</small>}</span>
        </button>)}
        {!results.length && <p className="ws-muted">{search ? 'Няма намерени резултати.' : emptyMessage}</p>}
      </div>}
    </div>
    <div className="ws-recipient-summary"><span role="status">{loading ? 'Зареждане...' : `Избрани: ${selected.length}`}</span><span>{expanded ? `${results.length} / ${options.length}` : null}</span></div>
    {!!selectedOptions.length && <ul className="ws-recipient-selected" aria-label={`Избрани: ${title}`}>{selectedOptions.map(option => <li key={option.id}>
      <span><strong>{option.name}</strong>{option.detail && <small>{option.detail}</small>}</span>
      <button type="button" className="icon-button" title={`Премахни: ${option.name}`} onClick={() => { toggle(option.id); input.current?.focus({ preventScroll: true }); setOpen(false) }}><X size={16} /></button>
    </li>)}</ul>}
  </fieldset>
}
