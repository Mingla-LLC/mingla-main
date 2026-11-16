'use client'

// #4452 §2.4 — the page's pop-up form (centre pop-up or side panel on desktop,
// a near full-screen sheet on phones). Mounted once in the root layout; it
// reads the current page's popup block from the published content passed by
// the server layout wrapper.
//
// Fixed rules: never after a submit (180 days), never on /apply, /schedule,
// /unsubscribe or a tool report, never while the privacy sheet is open; Close,
// "Not now", Esc and a scrim tap all close it; with answers, the first close
// asks "Keep going / Close" once. Focus is trapped and returns to the opener.

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { type RendererForm } from './form-renderer'
import { PopupDialog, type CloseHow } from './popup-dialog'
import type { BookingBasics } from '@/lib/forms/booking'
import { POPUP_OPEN_EVENT } from './popup-bus'
import { virtualPageView } from './virtual-page'
import { formEvent } from './form-events'
import type { FormContext } from '@/lib/forms/events'
import { trackFunnel } from '@/lib/forms/submit'
import {
  type Block,
  DONE_MS,
  effectiveTrigger,
  popupAllowed,
  popupBlockedPath,
  type PublicForm,
  reachedHalf,
} from '@/lib/site-pages/model'
import { FIRST_FIELD_SELECTOR, focusablesIn, privacySheetOpen } from '@/lib/forms/popup-dom'
import './forms.css'

export interface PopupEntry {
  block: Block
  form: PublicForm
}

function storage(): Storage | null {
  try {
    const s = window.localStorage
    s.getItem('mingla:probe')
    return s
  } catch {
    return null
  }
}

/** §8: the fixed properties for this page's pop-up. */
function ctxOf(entry: PopupEntry): FormContext {
  return { form_key: entry.form.key, form_version: entry.form.version, label: entry.form.audience, placement: 'popup', spot: 'popup' }
}

export function PopupHost({ byPage, keyForPath }: { byPage: Record<string, PopupEntry>; keyForPath: Record<string, string> }) {
  const pathname = usePathname() ?? '/'
  const entry = byPage[keyForPath[pathname] ?? ''] ?? null
  const [open, setOpen] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [done, setDone] = useState<{ id: string; first: string | null; booking?: BookingBasics | null } | null>(null)
  const dirty = useRef(false)
  const asked = useRef(false)
  const shownThisView = useRef(false)
  const opener = useRef<HTMLElement | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const visitId = useRef('')
  const [isPhone, setIsPhone] = useState(false)

  const memKey = entry ? `mingla:popup:${entry.form.id}:${entry.block.id}` : ''

  const show = useCallback((trigger: string, from: HTMLElement | null = null) => {
    if (!entry || shownThisView.current) return
    if (privacySheetOpen(document)) return  // only while the privacy panel is actually open
    const s = storage()
    const now = Date.now()
    const done = Number(s?.getItem(`mingla:form-done:${entry.form.id}`) ?? '') || null
    const closedAt = Number(s?.getItem(memKey) ?? '') || null
    let visit = false
    try { visit = window.sessionStorage.getItem(memKey) === '1' } catch { visit = false }
    if (trigger !== 'button' && !popupAllowed(entry.block.popup!.freq, { closedAt, doneAt: done, shownThisVisit: visit, shownThisView: shownThisView.current, storageBroken: s === null }, now)) return
    if (done && now - done < DONE_MS) return
    shownThisView.current = true
    opener.current = from
    try { window.sessionStorage.setItem(memKey, '1') } catch { /* private mode */ }
    setOpen(true)
    visitId.current = crypto.randomUUID()
    formEvent('popup_shown', ctxOf(entry), { trigger, style: isPhone ? 'sheet' : entry.block.popup!.style })
    trackFunnel('popup_shown', { formId: entry.form.id, visitId: visitId.current, placement: 'popup', props: { trigger } })
  }, [entry, memKey, isPhone])

  // Triggers.
  useEffect(() => {
    if (!entry || popupBlockedPath(pathname)) return
    const phone = window.matchMedia('(max-width: 859px)').matches
    setIsPhone(phone)
    const trigger = effectiveTrigger(entry.block.popup!, phone)
    if (!trigger) return
    const onOpen = (e: Event) => show('button', ((e as CustomEvent).detail?.opener as HTMLElement) ?? null)
    window.addEventListener(POPUP_OPEN_EVENT, onOpen)
    let cleanup = () => {}
    if (trigger === 'scroll_half') {
      let raf = 0
      const onScroll = () => {
        if (raf) return
        raf = requestAnimationFrame(() => {
          raf = 0
          if (reachedHalf(window.scrollY, window.innerHeight, document.documentElement.scrollHeight)) show('scroll_half')
        })
      }
      window.addEventListener('scroll', onScroll, { passive: true })
      cleanup = () => window.removeEventListener('scroll', onScroll)
    } else if (trigger === 'after_20s') {
      let left = 20_000
      let started = Date.now()
      let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => show('after_20s'), left)
      const onVis = () => {
        if (document.hidden) { if (timer) clearTimeout(timer); timer = null; left -= Date.now() - started }
        else { started = Date.now(); timer = setTimeout(() => show('after_20s'), Math.max(left, 0)) }
      }
      document.addEventListener('visibilitychange', onVis)
      cleanup = () => { if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVis) }
    } else if (trigger === 'exit_intent') {
      const onOut = (e: MouseEvent) => { if (e.relatedTarget === null && e.clientY <= 0) show('exit_intent') }
      document.addEventListener('mouseout', onOut)
      cleanup = () => document.removeEventListener('mouseout', onOut)
    }
    return () => { cleanup(); window.removeEventListener(POPUP_OPEN_EVENT, onOpen) }
  }, [entry, pathname, show])

  const close = useCallback((how: CloseHow) => {
    if (how !== 'done' && dirty.current && !asked.current && !done) {
      asked.current = true
      setConfirmClose(true)
      return
    }
    setOpen(false)
    setConfirmClose(false)
    try { storage()?.setItem(memKey, String(Date.now())) } catch { /* ignore */ }
    if (entry) {
      formEvent('popup_closed', ctxOf(entry), { how, had_answers: dirty.current, stage: done ? 'success' : 'form' })
      trackFunnel('popup_closed', { formId: entry.form.id, visitId: visitId.current, placement: 'popup', props: { how } })
    }
    ;(opener.current ?? document.body).focus?.()
  }, [done, entry, memKey])

  // Focus trap, Esc, inert background and the scroll lock.
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const prevOverflow = root.style.overflow
    root.style.overflow = 'hidden'
    const siblings = Array.from(document.body.children).filter((el) => !el.contains(dialog.current))
    siblings.forEach((el) => el.setAttribute('inert', ''))
    // The first real field, never the bot trap (#4452 rework 1, P0-2).
    const first = dialog.current?.querySelector<HTMLElement>(FIRST_FIELD_SELECTOR) ?? dialog.current
    first?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (confirmClose) { setConfirmClose(false); return }  // Esc on the prompt means Keep going
        close('esc')
      }
      if (e.key === 'Tab' && dialog.current) {
        const items = focusablesIn<HTMLElement>(dialog.current).filter((el) => el.offsetParent !== null || el === document.activeElement)
        if (!items.length) return
        const a = items[0]
        const z = items[items.length - 1]
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      root.style.overflow = prevOverflow
      siblings.forEach((el) => el.removeAttribute('inert'))
      document.removeEventListener('keydown', onKey)
    }
  }, [open, confirmClose, close])

  if (!entry || !open) return null
  const style = isPhone ? 'sheet' : entry.block.popup!.style
  return (
    <PopupDialog
      dialogRef={dialog}
      style={style}
      form={entry.form as unknown as RendererForm & { name: string }}
      block={entry.block}
      confirmClose={confirmClose}
      onKeepGoing={() => setConfirmClose(false)}
      onClose={close}
      done={done}
      onDirty={(d) => { dirty.current = d }}
      onDone={(o, first, booking) => {
        setDone({ id: o.submissionId, first, booking })
        virtualPageView(`/apply/${entry.form.slug ?? entry.form.key}/thanks`)
      }}
      onBooked={() => virtualPageView(`/apply/${entry.form.slug ?? entry.form.key}/booked`)}
    />
  )
}
