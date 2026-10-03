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
//
// Opt-in copy region (#3431): anything inside an element carrying the
// `data-allow-copy` attribute (today only the Help pages' <main>) lets people
// select, copy, cut and right-click → Copy text, so support agents can paste
// the exact steps to a customer. Images and video inside it still get no
// context menu, and drag-out + the keyboard-shortcut blocking stay on
// everywhere, opt-in region included.
export function ContentProtection() {
  useEffect(() => {
    const isFormField = (el: EventTarget | null): boolean =>
      el instanceof HTMLElement &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

    // Events can target a Text node (e.g. selectstart); resolve to its element.
    const elementOf = (target: EventTarget | null): Element | null => {
      if (target instanceof Element) return target
      if (target instanceof Node) return target.parentElement
      return null
    }

    const inAllowCopy = (el: Element | null): boolean =>
      el !== null && el.closest('[data-allow-copy]') !== null

    const isMedia = (el: Element | null): boolean =>
      el !== null && (el.tagName === 'IMG' || el.tagName === 'VIDEO')

    // Always-block (drag).
    const hardBlock = (e: Event): void => {
      e.preventDefault()
    }

    // Context menu — allowed on text inside the opt-in copy region (so
    // right-click → Copy works), never on images/video (save-image stays blocked).
    const contextMenuBlock = (e: Event): void => {
      const el = elementOf(e.target)
      if (inAllowCopy(el) && !isMedia(el)) return
      e.preventDefault()
    }

    // Copy/cut/selection — allow inside form fields so users can still use
    // forms, and inside the opt-in copy region.
    const softBlock = (e: Event): void => {
      if (isFormField(e.target)) return
      if (inAllowCopy(elementOf(e.target))) return
      e.preventDefault()
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

    document.addEventListener('contextmenu', contextMenuBlock)
    document.addEventListener('dragstart', hardBlock)
    document.addEventListener('copy', softBlock)
    document.addEventListener('cut', softBlock)
    document.addEventListener('selectstart', softBlock)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('contextmenu', contextMenuBlock)
      document.removeEventListener('dragstart', hardBlock)
      document.removeEventListener('copy', softBlock)
      document.removeEventListener('cut', softBlock)
      document.removeEventListener('selectstart', softBlock)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return null
}
