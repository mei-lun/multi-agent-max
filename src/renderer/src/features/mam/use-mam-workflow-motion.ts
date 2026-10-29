import { useEffect, useState } from 'react'

export function useMamWorkflowMotion(): Readonly<{
  live: boolean
  enabled: boolean
  setLive(value: boolean): void
}> {
  const [live, setLive] = useState(true)
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  const [visible, setVisible] = useState(() => typeof document !== 'undefined' && !document.hidden)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setReduced(query.matches)
    query.addEventListener('change', update)
    update()
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const update = (): void => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return { live, enabled: live && !reduced && visible, setLive }
}
