'use client'
import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ---------------------------------------------------------------
// #2902 — mobile side menu.
//
// WHY THIS IS NOT THE SUPPLIED shadcn <Sheet>.
//
// The snippet's sheet is built on Radix (`@radix-ui/react-dialog`) plus
// `class-variance-authority`, `@radix-ui/react-slot` and
// `@radix-ui/react-label`. This app has NO Radix and no CVA — it is a plain
// Next.js + Tailwind app, not a shadcn project (no `components.json`, and `cn`
// lives at `@/lib/cn`, not `@/lib/utils`). Pulling in four packages to ship one
// drawer, on the marketing site where bundle size is a Core Web Vitals problem
// this very issue is trying to fix, is a bad trade.
//
// So the drawer is built the way this repo already builds modals (see
// `app-qr-panel.tsx` and the Explorer hero's own sheets): AnimatePresence, an
// escape handler, a scroll lock, a focus trap and a labelled dialog role. That
// is the accessibility Radix would have given us, written once, with no new
// dependency.
//
// If the project ever adopts shadcn properly, this is a drop-in replacement
// target — the props match <Sheet side="right">.
// ---------------------------------------------------------------

interface SideMenuProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  side?: 'left' | 'right'
}

export function SideMenu({ open, onClose, title, children, side = 'right' }: SideMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const reduced = useMinglaReducedMotion()

  // Escape closes; focus is trapped inside the panel while it is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Scroll lock, restored exactly to whatever it was before.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  // Move focus into the panel when it opens.
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('a[href], button')?.focus()
    }, 60)
    return () => window.clearTimeout(id)
  }, [open])

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={reduced ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.24 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-black/45 backdrop-blur-sm"
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={reduced ? false : { x: side === 'right' ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={reduced ? { opacity: 0 } : { x: side === 'right' ? '100%' : '-100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 260 }}
            className={cn(
              'fixed inset-y-0 z-[101] flex w-[82%] max-w-sm flex-col p-3',
              side === 'right' ? 'right-0' : 'left-0',
            )}
          >
            <div className="cut-card flex h-full flex-col overflow-y-auto p-6">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-[var(--cut-muted)]">
                  {title}
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close menu"
                  className="cut-btn cut-btn-light flex h-11 w-11 items-center justify-center rounded-full focus-ring"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-8 flex flex-1 flex-col">{children}</div>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  )
}
