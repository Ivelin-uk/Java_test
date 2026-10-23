import { LoaderCircle, MoveHorizontal } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export function Feedback({ error, busy }: { error?: string; busy?: boolean }) {
  return <>{error && <p className="error ws-feedback" role="alert">{error}</p>}{busy && <p className="ws-feedback" role="status"><LoaderCircle size={16} className="spin" /> Изчакване...</p>}</>
}
export function Empty({ children = 'Няма записи.' }: { children?: ReactNode }) { return <p className="ws-empty">{children}</p> }
export function SectionHead({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="ws-section-head"><div className="ws-heading"><h2>{title}</h2>{description && <p>{description}</p>}</div>{children && <div className="ws-actions">{children}</div>}</div>
}

export function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = useId()
  return <section className="ws-card" aria-labelledby={id}>
    <header className="ws-card-head"><h3 id={id}>{title}</h3>{description && <p>{description}</p>}</header>
    <div className="ws-card-body">{children}</div>
  </section>
}

export function TableContainer({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const hintId = useId()
  const [scrollable, setScrollable] = useState(false)
  useEffect(() => {
    const container = ref.current
    if (!container) return
    const measure = () => setScrollable(container.scrollWidth > container.clientWidth + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    if (container.firstElementChild) observer.observe(container.firstElementChild)
    measure()
    return () => observer.disconnect()
  }, [])
  return <div className="ws-table-region">
    {scrollable && <p className="ws-table-hint" id={hintId}><MoveHorizontal size={17} aria-hidden="true" />Плъзни наляво и надясно, за да видиш цялата таблица.</p>}
    <div ref={ref} className="ws-table-wrap" role="region" aria-label={label} aria-describedby={scrollable ? hintId : undefined} tabIndex={scrollable ? 0 : undefined}>{children}</div>
  </div>
}
