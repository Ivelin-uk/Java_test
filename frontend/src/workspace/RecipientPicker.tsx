import { useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

interface RecipientOption { id: number; name: string; detail: string }

export function RecipientPicker({ title, searchLabel, placeholder, emptyMessage, options, selected, toggle, disabled, loading }: {
  title: string; searchLabel: string; placeholder: string; emptyMessage: string; options: RecipientOption[];
  selected: number[]; toggle: (id: number) => void; disabled: boolean; loading: boolean;
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const search = query.trim().toLocaleLowerCase()
  const results = options.filter(option => `${option.name} ${option.detail}`.toLocaleLowerCase().includes(search))
  return <fieldset className="ws-recipient-picker" disabled={disabled || loading}>
    <legend>{title}</legend>
    <div className="ws-recipient-search">
      <Search size={17} aria-hidden="true" />
      <input ref={input} id={id} type="search" aria-label={searchLabel} aria-controls={`${id}-results`} autoComplete="off" placeholder={placeholder} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} />
      {query && <button type="button" className="icon-button" title={`Изчисти търсенето: ${title}`} onClick={() => { setQuery(''); input.current?.focus() }}><X size={16} /></button>}
    </div>
    <div className="ws-recipient-summary"><span role="status">Избрани: {selected.length}</span><span>{results.length} / {options.length}</span></div>
    <div id={`${id}-results`} className="ws-recipient-options">
      {loading ? <p className="ws-muted" role="status">Зареждане...</p> : results.map(option => <label className="ws-check ws-recipient-option" key={option.id}>
        <input type="checkbox" aria-label={option.name} checked={selected.includes(option.id)} onChange={() => toggle(option.id)} />
        <span><span>{option.name}</span>{option.detail && <small>{option.detail}</small>}</span>
      </label>)}
      {!loading && !results.length && <p className="ws-muted">{search ? 'Няма намерени резултати.' : emptyMessage}</p>}
    </div>
  </fieldset>
}
