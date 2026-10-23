import { LoaderCircle, MoveHorizontal } from 'lucide-react'
import { Children, cloneElement, Fragment, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from 'react'

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

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!isValidElement<{ children?: ReactNode; 'aria-label'?: string }>(node)) return ''
  return node.props['aria-label'] ?? Children.toArray(node.props.children).map(textContent).join('')
}

function flattenChildren(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap(child =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flattenChildren(child.props.children)
      : [child],
  )
}

function addMobileTableLabels(children: ReactNode): ReactNode {
  if (!isValidElement<{ children?: ReactNode }>(children) || children.type !== 'table') return children

  const labels: string[] = []
  flattenChildren(children.props.children).forEach(section => {
    if (!isValidElement<{ children?: ReactNode }>(section) || section.type !== 'thead') return
    flattenChildren(section.props.children).forEach(row => {
      if (!isValidElement<{ children?: ReactNode }>(row) || row.type !== 'tr') return
      flattenChildren(row.props.children).forEach(cell => {
        if (isValidElement<{ children?: ReactNode }>(cell) && cell.type === 'th') {
          labels.push(textContent(cell.props.children))
        }
      })
    })
  })

  const tableChildren = flattenChildren(children.props.children).map(section => {
    if (!isValidElement<{ children?: ReactNode }>(section) || section.type !== 'tbody') return section
    return cloneElement(section, undefined, flattenChildren(section.props.children).map(row => {
      if (!isValidElement<{ children?: ReactNode }>(row) || row.type !== 'tr') return row
      return cloneElement(row, undefined, flattenChildren(row.props.children).map((cell, index) => {
        if (!isValidElement<{ children?: ReactNode; 'data-label'?: string }>(cell) || cell.type !== 'td') return cell
        return cloneElement(cell, { 'data-label': labels[index] })
      }))
    }))
  })

  return cloneElement(children, undefined, tableChildren)
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
    <div ref={ref} className="ws-table-wrap" role="region" aria-label={label} aria-describedby={scrollable ? hintId : undefined} tabIndex={scrollable ? 0 : undefined}>{addMobileTableLabels(children)}</div>
  </div>
}
