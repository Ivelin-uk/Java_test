import { useEffect, useState } from 'react'
import type { WorkspaceApi } from './api'
import type { ExamSession } from './types'

export function WorkspaceImage({ api, id, attempt, session, logo = false }: { api: WorkspaceApi; id?: number | null; attempt?: number; session?: ExamSession; logo?: boolean }) {
  const [loaded, setLoaded] = useState<{ id: number; url: string } | null>(null)
  useEffect(() => {
    if (!id) return
    let active = true, objectUrl = ''
    api.image(id, attempt, session).then(blob => { if (active) { objectUrl = URL.createObjectURL(blob); setLoaded({ id, url: objectUrl }) } }).catch(() => { if (active) setLoaded(null) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [api, id, attempt, session])
  return loaded && loaded.id === id ? <img className={logo ? 'ws-logo' : 'ws-question-image'} src={loaded.url} alt={logo ? 'Лого на организацията' : 'Изображение към въпроса'} /> : null
}
