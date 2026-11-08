'use client'
import { useEffect, useRef, type ReactNode } from 'react'

// #4339 — the landing page's behaviour, ported from the design's mountReveal,
// mountFeat and mountLit, on top of server-rendered markup:
//   - `.reveal` sections fade up once 15% is in view;
//   - each feature card slides in at 15% in view and becomes the active one
//     (its left-column button lights) at 60%;
//   - the left-column buttons and "See what's inside" scroll to their target;
//   - the large paragraph lights word by word with scroll.
// Reduced motion: every word is lit, cards and sections are shown, scrolling
// jumps instead of gliding. Without JavaScript the CSS shows everything, since
// the hidden start states only apply once [data-lp-js] is set here.

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

// The same root carries Home and Mingla Host (#4339 phase 2a); only a landing
// page has an ICP slug.
export function LandingRoot({ children, slug }: { children: ReactNode; slug?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const rm = reducedMotion()
    root.setAttribute('data-lp-js', '')
    const cleanups: (() => void)[] = []

    // Section reveal at 15%.
    const reveal = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in')
            reveal.unobserve(entry.target)
          }
        }),
      { threshold: 0.15 },
    )
    root.querySelectorAll('.reveal').forEach((el) => reveal.observe(el))
    cleanups.push(() => reveal.disconnect())

    // #4339 — a section the reader jumped past (a fast fling, an in-page
    // anchor, a restored scroll position) never crosses the 15% line, so the
    // observer never fires for it and it would stay an empty gap. Anything
    // whose top is already above the bottom of the screen is shown.
    let catchUpFrame = 0
    const catchUp = () => {
      catchUpFrame = 0
      root.querySelectorAll<HTMLElement>('.reveal:not(.in)').forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight) {
          el.classList.add('in')
          reveal.unobserve(el)
        }
      })
    }
    const onCatchUp = () => {
      if (catchUpFrame === 0) catchUpFrame = window.requestAnimationFrame(catchUp)
    }
    window.addEventListener('scroll', onCatchUp, { passive: true })
    catchUp()
    cleanups.push(() => {
      window.removeEventListener('scroll', onCatchUp)
      if (catchUpFrame !== 0) window.cancelAnimationFrame(catchUpFrame)
    })

    // Features: slide in at 15%, active at 60%.
    const feat = root.querySelector<HTMLElement>('[data-feat]')
    if (feat) {
      const cards = Array.from(feat.querySelectorAll<HTMLElement>('.fcard'))
      const buttons = Array.from(feat.querySelectorAll<HTMLButtonElement>('.fnav button'))
      const setActive = (index: number) =>
        buttons.forEach((button, i) => {
          button.classList.toggle('on', i === index)
          if (i === index) button.setAttribute('aria-current', 'true')
          else button.removeAttribute('aria-current')
        })
      const slide = new IntersectionObserver(
        (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('in')),
        { threshold: 0.15 },
      )
      const active = new IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.i))
          }),
        { threshold: 0.6 },
      )
      cards.forEach((card) => {
        slide.observe(card)
        active.observe(card)
      })
      const onNav = (event: Event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.fnav button')
        if (!button) return
        cards[Number(button.dataset.go)]?.scrollIntoView({ behavior: rm ? 'auto' : 'smooth', block: 'center' })
      }
      feat.addEventListener('click', onNav)
      cleanups.push(() => {
        slide.disconnect()
        active.disconnect()
        feat.removeEventListener('click', onNav)
      })

      // "See what's inside" glides to the features (the plain #anchor jumps without JS).
      const onInside = (event: Event) => {
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-see-inside]')
        if (!link) return
        event.preventDefault()
        feat.scrollIntoView({ behavior: rm ? 'auto' : 'smooth' })
        window.history.replaceState(null, '', `#${feat.id}`)
      }
      root.addEventListener('click', onInside)
      cleanups.push(() => root.removeEventListener('click', onInside))
    }

    // Words that light up on scroll.
    const lit = root.querySelector<HTMLElement>('[data-lit]')
    if (lit) {
      const words = Array.from(lit.querySelectorAll<HTMLElement>('.w'))
      if (rm) {
        words.forEach((w) => w.classList.add('lit'))
      } else {
        let frame = 0
        const paint = () => {
          frame = 0
          const rect = lit.getBoundingClientRect()
          const vh = window.innerHeight
          const t = Math.min(1, Math.max(0, (vh * 0.85 - rect.top) / (rect.height + vh * 0.35)))
          const n = Math.round(t * words.length)
          words.forEach((w, i) => w.classList.toggle('lit', i < n))
        }
        const onScroll = () => {
          if (frame === 0) frame = window.requestAnimationFrame(paint)
        }
        window.addEventListener('scroll', onScroll, { passive: true })
        window.addEventListener('resize', onScroll, { passive: true })
        paint()
        cleanups.push(() => {
          window.removeEventListener('scroll', onScroll)
          window.removeEventListener('resize', onScroll)
          if (frame !== 0) window.cancelAnimationFrame(frame)
        })
      }
    }

    return () => {
      cleanups.forEach((fn) => fn())
      root.removeAttribute('data-lp-js')
    }
  }, [])

  return (
    <div ref={ref} data-landing="" data-cutout="" data-icp={slug}>
      {children}
    </div>
  )
}
