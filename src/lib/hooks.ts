import { useCallback, useEffect, useRef, useState } from 'react'

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, size }
}

export function useThrottledCallback<A extends any[]>(
  fn: (...args: A) => void,
  ms: number
) {
  const last = useRef(0)
  const timer = useRef<number | null>(null)
  const latest = useRef(fn)
  latest.current = fn

  const run = useCallback(
    (...args: A) => {
      const now = performance.now()
      const wait = ms - (now - last.current)
      if (wait <= 0) {
        last.current = now
        latest.current(...args)
      } else {
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
          last.current = performance.now()
          latest.current(...args)
        }, wait)
      }
    },
    [ms]
  )

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])

  return run
}

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduce(mq.matches)
    const on = () => setReduce(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduce
}
