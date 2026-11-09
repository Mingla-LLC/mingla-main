'use client'
import { useEffect, useState } from 'react'

// #4339 — the home headline's middle line: one italic phrase at a time,
// swapped every 2.6s with a short fade-and-drop (the design's mountSwap).
// The server HTML and reduced motion show the first phrase and never change.
// It is aria-hidden: the headline's screen-reader text is fixed (see the home
// page), so assistive tech does not hear the h1 change every few seconds.

const HOLD_MS = 2600
const SWAP_MS = 350

export function RotatingPhrase({ phrases }: { phrases: readonly string[] }) {
  const [index, setIndex] = useState(0)
  const [out, setOut] = useState(false)

  useEffect(() => {
    if (phrases.length < 2) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true) return
    let swap = 0
    const id = window.setInterval(() => {
      setOut(true)
      swap = window.setTimeout(() => {
        setIndex((i) => (i + 1) % phrases.length)
        setOut(false)
      }, SWAP_MS)
    }, HOLD_MS)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(swap)
    }
  }, [phrases.length])

  return <em className={out ? 'swap out' : 'swap'}>{phrases[index]}</em>
}
