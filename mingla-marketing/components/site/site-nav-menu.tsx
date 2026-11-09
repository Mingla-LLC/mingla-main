'use client'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { SiteNavSurface } from './site-nav'

// #4339 speed fix — the site nav's only interactive part: the menu's open
// state. The server component site-nav.tsx renders the pill's contents (`lead`)
// and the menu's groups (`children`); this island toggles the ink button, and
// closes the menu on Escape (focus back to the button), on a click outside and
// when a link in it is followed.

interface SiteNavMenuProps {
  surface: SiteNavSurface
  /** Wordmark, top links and the hand-off CTA, rendered by the server. */
  lead: ReactNode
  /** The menu groups and the feature card, rendered by the server. */
  children: ReactNode
}

export function SiteNavMenu({ surface, lead, children }: SiteNavMenuProps) {
  const [open, setOpen] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const burgerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) burgerRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
      }
    }
    const onPointer = (event: PointerEvent) => {
      const nav = navRef.current
      if (nav && event.target instanceof Node && !nav.contains(event.target)) close(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open, close])

  return (
    <header ref={navRef} className={open ? 'site-nav open' : 'site-nav'} data-site-nav="" data-surface={surface}>
      <div className="nav-in">
        {lead}
        <button
          ref={burgerRef}
          type="button"
          className="burger"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">
            <i />
            <i />
          </span>
        </button>
        <div
          id={menuId}
          className="drop"
          inert={!open}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) setOpen(false)
          }}
        >
          {children}
        </div>
      </div>
    </header>
  )
}
