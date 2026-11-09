'use client'
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { detectClientPlatform } from '@/lib/device-platform'

// #4339 speed fix — the open/close state of the hand-off sheet, split from
// handoff-sheet.tsx so a page's buttons ship only this; the sheet itself (its
// frame, photo, QR code and store buttons) loads when a computer visitor taps
// (explorer-handoff.tsx, host-handoff.tsx).

/**
 * Open/close state for a hand-off sheet, returning focus to whatever opened it.
 *
 * `trigger` holds the dialog ARIA for the button. It is empty in the server
 * HTML and on phones, where the button is a plain link to the store (#4137
 * AC-D1: no CTA is a dialog trigger before hydration); once React runs on a
 * computer it says the button opens a dialog and whether it is open.
 */
export function useHandoffSheet() {
  const [open, setOpen] = useState(false)
  const [computer, setComputer] = useState(false)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    setComputer(detectClientPlatform() === 'other')
  }, [])

  const show = useCallback((event: MouseEvent<HTMLElement>) => {
    openerRef.current = event.currentTarget
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    const opener = openerRef.current
    window.requestAnimationFrame(() => opener?.focus({ preventScroll: true }))
  }, [])

  const trigger: { 'aria-haspopup'?: 'dialog'; 'aria-expanded'?: boolean } = computer
    ? { 'aria-haspopup': 'dialog', 'aria-expanded': open }
    : {}

  return { open, show, close, trigger }
}

/** A modified click (new tab, new window, middle button) keeps the plain link. */
export function isPlainClick(event: MouseEvent<HTMLElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

