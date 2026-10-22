import { LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'

export function Feedback({ error, busy }: { error?: string; busy?: boolean }) {
  return <>{error && <p className="error ws-feedback" role="alert">{error}</p>}{busy && <p className="ws-feedback" role="status"><LoaderCircle size={16} className="spin" /> Изчакване...</p>}</>
}
export function Empty({ children = 'Няма записи.' }: { children?: ReactNode }) { return <p className="ws-empty">{children}</p> }
export function SectionHead({ title, children }: { title: string; children?: ReactNode }) { return <div className="ws-section-head"><h2>{title}</h2><div className="ws-actions">{children}</div></div> }
