'use client'
import { useEffect } from 'react'

// Content protection (Balanced). A client-only behavior layer that discourages
// casual copying of the marketing creative WITHOUT touching the server-rendered
// HTML/metadata — so search crawlers index the page exactly as before and SEO
// is unaffected. Note: no web technique can truly prevent screenshots or a
// determined developer; this raises friction, it is not DRM.
//
// What it blocks for human browsers:
//   - right-click / context menu (save-image-as, view-source entry points)
//   - copy / cut (except inside real form fields) + text selection start
//   - image/element drag-out
//   - devtools + save + print + view-source keyboard shortcuts
export function ContentProtection() {
  useEffect(() => {
    const isFormField = (el: EventTarget | null): boolean =>
      el instanceof HTMLElement &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

    // Always-block (context menu, drag). Returns false for legacy handlers.
    const hardBlock = (e: Event): void => {
      e.preventDefault()
    }

    // Copy/cut/selection — allow inside form fields so users can still use forms.
    const softBlock = (e: Event): void => {
      if (!isFormField(e.target)) e.preventDefault()
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey

      // F12 — devtools
      if (e.key === 'F12') {
        e.preventDefault()
        return
      }
      // Ctrl/Cmd+U (view-source), Ctrl/Cmd+S (save), Ctrl/Cmd+P (print)
      if (mod && !e.shiftKey && !e.altKey && (key === 'u' || key === 's' || key === 'p')) {
        e.preventDefault()
        return
      }
      // Ctrl/Cmd+Shift+I / J / C  — devtools (inspect, console, element picker)
      if (mod && e.shiftKey && (key === 'i' || key === 'j' || key === 'c')) {
        e.preventDefault()
        return
      }
      // macOS Cmd+Opt+I / J / C — devtools
      if (e.metaKey && e.altKey && (key === 'i' || key === 'j' || key === 'c')) {
        e.preventDefault()
      }
    }

    document.addEventListener('contextmenu', hardBlock)
    document.addEventListener('dragstart', hardBlock)
    document.addEventListener('copy', softBlock)
    document.addEventListener('cut', softBlock)
    document.addEventListener('selectstart', softBlock)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('contextmenu', hardBlock)
      document.removeEventListener('dragstart', hardBlock)
      document.removeEventListener('copy', softBlock)
      document.removeEventListener('cut', softBlock)
      document.removeEventListener('selectstart', softBlock)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return null
}
