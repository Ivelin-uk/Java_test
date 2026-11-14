import { useCallback, useEffect, useRef, useState } from 'react'

type Reveal = { indices: number[]; shown: number }

export function useAiGenerationProgress(waiting: boolean) {
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [following, setFollowing] = useState(true)
  const progressRef = useRef<HTMLElement>(null)
  const questionRef = useRef<HTMLElement>(null)
  const active = waiting || reveal !== null
  const latestIndex = reveal && reveal.shown > 0 ? reveal.indices[reveal.shown - 1] : undefined
  const begin = useCallback(() => { setReveal(null); setFollowing(true) }, [])
  const showQuestions = useCallback((indices: number[]) => setReveal({ indices, shown: 0 }), [])
  const resume = useCallback(() => setFollowing(true), [])

  useEffect(() => {
    if (!reveal) return
    const timer = window.setTimeout(() => {
      setReveal(previous => previous && previous.shown < previous.indices.length
        ? { ...previous, shown: previous.shown + 1 }
        : null)
    }, reveal.shown === 0 ? 150 : 650)
    return () => window.clearTimeout(timer)
  }, [reveal])

  useEffect(() => {
    if (!active) return
    let frame = 0
    const navigation = document.querySelector('.ws-nav')
    const follow = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const navigationHeight = navigation?.getBoundingClientRect().height ?? 0
        if (progressRef.current) progressRef.current.style.top = `${navigationHeight + 12}px`
        const target = latestIndex === undefined ? progressRef.current : questionRef.current
        if (!target || !following) return
        const progressHeight = latestIndex === undefined ? 0 : progressRef.current?.getBoundingClientRect().height ?? 0
        window.scrollTo({
          top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - navigationHeight - progressHeight - 32),
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        })
      })
    }
    const observer = new ResizeObserver(follow)
    if (navigation) observer.observe(navigation)
    if (progressRef.current) observer.observe(progressRef.current)
    const editor = questionRef.current?.closest('.ws-editor')
    if (editor) observer.observe(editor)
    window.addEventListener('resize', follow)
    follow()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', follow)
      window.cancelAnimationFrame(frame)
    }
  }, [active, following, latestIndex])

  useEffect(() => {
    if (!active || !following) return
    const pause = () => {
      setFollowing(false)
      window.scrollTo({ top: window.scrollY, behavior: 'instant' })
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && (event.target.closest('input, textarea, select, [contenteditable="true"]')
        || event.key === ' ' && event.target.closest('button, a, [role="button"]'))) return
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pause()
    }
    window.addEventListener('wheel', pause, { passive: true })
    window.addEventListener('touchmove', pause, { passive: true })
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('wheel', pause)
      window.removeEventListener('touchmove', pause)
      window.removeEventListener('keydown', keydown)
    }
  }, [active, following])

  return {
    reveal, active, following, progressRef, questionRef, latestIndex,
    begin, showQuestions, resume,
    visible: (index: number) => !reveal || !reveal.indices.includes(index) || reveal.indices.indexOf(index) < reveal.shown,
  }
}

