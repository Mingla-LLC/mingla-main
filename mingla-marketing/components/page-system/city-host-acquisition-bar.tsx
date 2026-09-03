'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, X } from 'lucide-react'

const HOST_DESTINATIONS = [
  { label: 'Host an event', href: 'https://host.usemingla.com/event/create' },
  { label: 'Host a trip', href: 'https://host.usemingla.com/trip/create' },
  { label: 'Host an experience', href: 'https://host.usemingla.com/experience/create' },
  { label: 'Add a venue', href: 'https://host.usemingla.com/venue/create' },
] as const

export function CityHostAcquisitionBar() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) triggerRef.current?.focus()
      wasOpenRef.current = false
      return
    }
    wasOpenRef.current = true
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => sheetRef.current?.querySelector<HTMLElement>('a[href]')?.focus(), 0)

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = sheetRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
      if (!focusable?.length) return
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
      window.clearTimeout(timer)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <aside className="ps-host-acquisition" aria-label="Host on Mingla">
      <div className="ps-host-acquisition-inner">
        <strong>Bring something to Lagos</strong>
        <nav aria-label="Create with Mingla Host" className="ps-host-acquisition-desktop">
          {HOST_DESTINATIONS.map((destination) => (
            <a key={destination.href} href={destination.href}>
              {destination.label}<ArrowUpRight aria-hidden="true" size={14} />
            </a>
          ))}
        </nav>
        <button
          ref={triggerRef}
          type="button"
          className="ps-host-acquisition-trigger"
          aria-expanded={open}
          aria-controls="host-acquisition-sheet"
          onClick={() => setOpen(true)}
        >
          Start hosting
        </button>
      </div>

      {open ? (
        <div className="ps-host-sheet-layer">
          <button type="button" className="ps-host-sheet-backdrop" aria-label="Close hosting choices" onClick={() => setOpen(false)} />
          <div ref={sheetRef} id="host-acquisition-sheet" className="ps-host-sheet" role="dialog" aria-modal="true" aria-labelledby="host-sheet-title">
            <header>
              <div><span>Mingla Host</span><h2 id="host-sheet-title">What are you bringing to Lagos?</h2></div>
              <button type="button" aria-label="Close hosting choices" onClick={() => setOpen(false)}><X aria-hidden="true" size={20} /></button>
            </header>
            <nav aria-label="Hosting choices">
              {HOST_DESTINATIONS.map((destination) => (
                <a key={destination.href} href={destination.href}>
                  <span>{destination.label}</span><ArrowUpRight aria-hidden="true" size={18} />
                </a>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </aside>
  )
}
