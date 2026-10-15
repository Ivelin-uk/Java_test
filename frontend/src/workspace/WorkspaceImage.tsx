import { useEffect, useRef, useState } from 'react'
import { Image, RefreshCw, X, ZoomIn } from 'lucide-react'
import type { WorkspaceApi } from './api'
import type { ExamSession } from './types'

export function WorkspaceImage({ api, id, attempt, session, logo = false }: { api: WorkspaceApi; id?: number | null; attempt?: number; session?: ExamSession; logo?: boolean }) {
  const [loaded, setLoaded] = useState<{ id: number; url: string } | null>(null)
  const [failed, setFailed] = useState<{ id: number; retry: number } | null>(null)
  const [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!id) return
    let active = true, objectUrl = ''
    api.image(id, attempt, session).then(blob => { if (active) { objectUrl = URL.createObjectURL(blob); setLoaded({ id, url: objectUrl }) } }).catch(() => { if (active) { setLoaded(null); setFailed({ id, retry }) } })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [api, id, attempt, session, retry])
  const visible = loaded?.id === id ? loaded : null
  const failure = failed?.id === id && failed?.retry === retry
  useEffect(() => {
    if (!expanded || !visible) return
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [expanded, visible])
  if (logo) return visible ? <img className="ws-logo" src={visible.url} alt="Лого" /> : null
  if (!id) return null
  return <div className="ws-question-media">
    {visible ? <button type="button" className="ws-image-button" title="Увеличи изображението" aria-label="Увеличи изображението" onClick={() => setExpanded(true)}><img className="ws-question-image" src={visible.url} alt="Изображение към въпроса" /><ZoomIn size={18} aria-hidden="true" /></button>
      : <div className="ws-image-placeholder" role={failure ? 'alert' : 'status'}><Image size={24} aria-hidden="true" /><span>{failure ? 'Изображението не може да се зареди.' : 'Зареждане на изображението...'}</span>{failure && <button type="button" className="icon-button" title="Опитай отново" aria-label="Опитай отново да заредиш изображението" onClick={() => setRetry(value => value + 1)}><RefreshCw size={18} /></button>}</div>}
    {expanded && visible && <dialog ref={dialog} className="ws-image-viewer" aria-label="Изображение към въпроса" onCancel={event => { event.preventDefault(); setExpanded(false) }}>
      <header><h3>Изображение към въпроса</h3><button type="button" className="icon-button" title="Затвори изображението" aria-label="Затвори изображението" onClick={() => setExpanded(false)}><X size={18} /></button></header>
      <img src={visible.url} alt="Изображение към въпроса в голям размер" />
    </dialog>}
  </div>
}
