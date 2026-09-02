'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Menu, X } from 'lucide-react'

const DESTINATIONS = [
  { href: '/', label: 'Mingla Explorer' },
  { href: '/host', label: 'Mingla Host' },
] as const

export function PageSystemNav() {
  const [open, setOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) menuButtonRef.current?.focus()
      wasOpenRef.current = false
      return
    }

    wasOpenRef.current = true
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('button, a[href]')?.focus()
    }, 0)

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <header className="ps-nav" data-print-hide>
      <div className="ps-nav-inner">
        <Link href="/" aria-label="Mingla home" className="ps-logo-link">
          <img src="/brand/mingla-wordmark.svg" alt="Mingla" width="116" height="41" />
        </Link>

        <nav aria-label="Primary" className="ps-desktop-nav">
          {DESTINATIONS.map((destination) => (
            <Link key={destination.href} href={destination.href} className="ps-nav-link">
              {destination.label}
            </Link>
          ))}
        </nav>

        <button
          ref={menuButtonRef}
          type="button"
          className="ps-menu-button"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="page-system-menu"
          onClick={() => setOpen(true)}
        >
          <Menu aria-hidden="true" size={20} />
        </button>
      </div>

      {open ? (
        <div className="ps-menu-layer">
          <button
            type="button"
            className="ps-menu-backdrop"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            id="page-system-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Mingla navigation"
            className="ps-menu-panel"
          >
            <div className="ps-menu-heading">
              <span>Choose a side</span>
              <button
                type="button"
                className="ps-icon-button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" size={20} />
              </button>
            </div>
            <nav aria-label="Menu destinations" className="ps-menu-destinations">
              {DESTINATIONS.map((destination) => (
                <Link
                  key={destination.href}
                  href={destination.href}
                  className="ps-menu-link"
                  onClick={() => setOpen(false)}
                >
                  {destination.label}
                </Link>
              ))}
            </nav>
            <p className="ps-menu-note">
              These private fixtures are for design and content review. City and guide routes are not published here.
            </p>
          </div>
        </div>
      ) : null}
    </header>
  )
}
