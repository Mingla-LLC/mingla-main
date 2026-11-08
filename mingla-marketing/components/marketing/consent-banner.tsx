'use client'
// #2331 → #4318 — the usemingla.com privacy strip. One thin full-width button,
// "Privacy & ad choices", 28px plus the bottom safe area, at the very bottom of
// every page (/links included). It is server-rendered, so it is there from the
// first paint, and it never changes size or position. There is no first-visit
// banner, no OK prompt and no toast: analytics and ads are on unless this
// visitor turned them off (I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF, #4128).
//
// I-PRIVACY-BAR-NEVER-OCCLUDES: the strip's height is `--mingla-privacy-inset`
// on the root element (a CSS default before hydration, then its measured
// height). The page body gets that much bottom padding so the last line can
// always scroll clear, every bottom-fixed element adds it to its own offset,
// and one-screen pages size themselves to `calc(100dvh - var(--mingla-privacy-inset))`.
//
// Tapping the strip opens the choices (Analytics, Ads measurement, Save) as a
// sheet above it. The sheet traps focus, closes on Escape and returns focus to
// the strip. After Save the strip reads "Saved" for 1.8s (aria-live). The one
// reopen event (PRIVACY_CHOICES_EVENT) opens the same sheet.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { SITE_ORIGIN } from '@/lib/site'
import {
  getMarketingPrivacySnapshot,
  posthogOptIn,
  PRIVACY_CHOICES_EVENT,
  saveMarketingPrivacy,
  subscribeMarketingConsent,
  type MarketingPrivacySnapshot,
} from '@/components/marketing/posthog-provider'
import { captureMarketingAdClickIds } from '@/lib/ad-click-capture'

export const PRIVACY_INSET_PROPERTY = '--mingla-privacy-inset'
export const PRIVACY_STRIP_LABEL = 'Privacy & ad choices'
export const PRIVACY_SAVED_LABEL = 'Saved'
const PANEL_ID = 'mingla-privacy-panel'
const SAVED_MS = 1800

// #4318 — the strip and its (hidden) sheet are server-rendered. Until React
// hydrates, this inline handler opens and closes that same sheet (Escape and
// the scrim close it) and marks any switch the visitor flips. It reads and
// writes no choice: Save is the app's, and on hydration the app takes the open
// sheet over (see takeOverPrehydrationSheet).
// While closed the sheet is not a dialog (no role, no aria-modal), so nothing
// else on the page ever mistakes it for an open one. The handler acts on
// Escape only while its own sheet is open, never prevents or stops an event,
// and removes every listener once the app takes over
// (window.__minglaPrivacyPrehydrationOff).
const PREHYDRATION_SCRIPT = `(function(){var d=document,w=window;function q(t){return d.querySelector('[data-testid="'+t+'"]')}var strip=q("privacy-strip"),sheet=q("privacy-sheet"),scrim=q("privacy-scrim");if(!strip||!sheet||!scrim)return;function show(on){sheet.hidden=!on;scrim.hidden=!on;strip.setAttribute("aria-expanded",on?"true":"false");if(on){sheet.setAttribute("role","dialog");sheet.setAttribute("aria-modal","true")}else{sheet.removeAttribute("role");sheet.removeAttribute("aria-modal")}}function tap(){if(!sheet.hidden){show(false);strip.focus();return}show(true);var f=sheet.querySelector("input");if(f)f.focus()}function shut(){show(false);strip.focus()}function flip(e){var t=e.target;if(t&&t.setAttribute)t.setAttribute("data-mpb-touched","")}function key(e){if(e.key==="Escape"&&!sheet.hidden)shut()}strip.addEventListener("click",tap);scrim.addEventListener("click",shut);sheet.addEventListener("change",flip);d.addEventListener("keydown",key);w.__minglaPrivacyPrehydrationOff=function(){strip.removeEventListener("click",tap);scrim.removeEventListener("click",shut);sheet.removeEventListener("change",flip);d.removeEventListener("keydown",key);w.__minglaPrivacyPrehydrationOff=undefined}})();`

type Draft = { analytics: boolean; ads: boolean }

/**
 * #4318 — if the visitor opened the server-rendered sheet before hydration,
 * the switches it should keep: a switch they flipped keeps its position, the
 * rest show what is actually running. Null when the sheet is closed.
 */
function takeOverPrehydrationSheet(sheet: HTMLElement | null, running: Draft): Draft | null {
  if (sheet === null || sheet.hidden) return null
  const kept = (kind: keyof Draft): boolean => {
    const input = sheet.querySelector<HTMLInputElement>(`[data-testid="privacy-switch-${kind}"]`)
    return input !== null && input.hasAttribute('data-mpb-touched') ? input.checked : running[kind]
  }
  return { analytics: kept('analytics'), ads: kept('ads') }
}

const SERVER_SNAPSHOT: MarketingPrivacySnapshot = { saved: true, analytics: false, ads: false, gpc: false }

// Above page content and the fixed nav; below dialogs, sheets and the side menu (z ≥ 100).
const BAR_CSS = `
:root{${PRIVACY_INSET_PROPERTY}:calc(28px + env(safe-area-inset-bottom,0px))}
body{padding-bottom:var(${PRIVACY_INSET_PROPERTY},0px)}
.mps{position:fixed;left:0;right:0;bottom:0;z-index:95;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:calc(28px + env(safe-area-inset-bottom,0px));margin:0;padding:0 12px env(safe-area-inset-bottom,0px);border:0;border-radius:0;background:#15171c;color:rgba(255,255,255,.9);font:600 12px/1 var(--font-inter,-apple-system),-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;-webkit-font-smoothing:antialiased}
.mps svg{display:block;flex:none;width:14px;height:14px}
.mps:focus{outline:none}
.mps:focus-visible{outline:2px solid #eb7825;outline-offset:-3px}
.mps-saved{color:#8fd3a8}
.mpb-scrim{position:fixed;left:0;right:0;top:0;bottom:var(${PRIVACY_INSET_PROPERTY},0px);z-index:96;background:rgba(0,0,0,.45)}
.mpb{position:fixed;left:0;right:0;bottom:var(${PRIVACY_INSET_PROPERTY},0px);z-index:97;box-sizing:border-box;margin:0;background:#15171c;color:#fff;border-radius:18px 18px 0 0;padding:16px max(16px,env(safe-area-inset-right,0px)) 12px max(16px,env(safe-area-inset-left,0px));max-height:80vh;max-height:80dvh;overflow-y:auto;overscroll-behavior:contain;font-family:var(--font-inter,inherit),-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;animation:mpb-in .2s ease-out}
.mpb *{box-sizing:border-box}
.mpb-panel{max-width:640px;margin:0 auto;display:flex;flex-direction:column}
.mpb-title{margin:0 0 4px;font-size:15px;line-height:20px;font-weight:700;color:#fff}
.mpb-switch-row{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 0;border-top:1px solid rgba(255,255,255,.1);cursor:pointer}
.mpb-switch-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.mpb-switch-title{font-size:14px;font-weight:700;color:#fff}
.mpb-switch-desc{font-size:13px;line-height:18px;color:rgba(255,255,255,.72)}
.mpb-switch{appearance:none;-webkit-appearance:none;flex-shrink:0;position:relative;width:44px;height:26px;margin:9px 0;border-radius:999px;background:rgba(255,255,255,.24);border:0;cursor:pointer;transition:background .2s ease}
.mpb-switch::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s ease}
.mpb-switch:checked{background:#eb7825}
.mpb-switch:checked::after{transform:translateX(18px)}
.mpb-switch:focus-visible{outline:2px solid #eb7825;outline-offset:2px}
.mpb-actions{display:flex;align-items:center;gap:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,.1)}
.mpb-hit{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 2px;margin:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.mpb-hit:focus{outline:none}
.mpb-hit:focus-visible .mpb-pill{outline:2px solid #eb7825;outline-offset:2px}
.mpb-pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 16px;border-radius:999px;font-size:13px;font-weight:700;line-height:1;white-space:nowrap}
.mpb-primary{background:#eb7825;color:#111}
.mpb-policy{margin-left:auto;display:inline-flex;align-items:center;min-height:44px;padding:0 4px;font-size:13px;color:rgba(255,255,255,.72);text-decoration:underline}
.mpb-policy:focus-visible{outline:2px solid #eb7825;outline-offset:2px}
@keyframes mpb-in{from{transform:translateY(12px)}to{transform:none}}
@media (prefers-reduced-motion:reduce){.mpb{animation:none}.mpb-switch,.mpb-switch::after{transition:none}}
`

function writeInset(px: number): void {
  document.documentElement.style.setProperty(PRIVACY_INSET_PROPERTY, `${Math.max(0, Math.round(px))}px`)
}

export function ConsentBanner(): React.ReactElement {
  const privacy = useSyncExternalStore(
    subscribeMarketingConsent,
    getMarketingPrivacySnapshot,
    () => SERVER_SNAPSHOT,
  )
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ analytics: true, ads: true })
  const [saved, setSaved] = useState(false)
  const stripRef = useRef<HTMLButtonElement | null>(null)
  const sheetRef = useRef<HTMLElement | null>(null)
  const adoptedDraftRef = useRef<Draft | null>(null)

  // #4318 — hydration: the inline handler stands down, and a sheet the visitor
  // already opened stays open, now the app's, before the next paint.
  useLayoutEffect(() => {
    const flag = window as Window & { __minglaPrivacyHydrated?: boolean; __minglaPrivacyPrehydrationOff?: () => void }
    flag.__minglaPrivacyHydrated = true
    flag.__minglaPrivacyPrehydrationOff?.()
    const snapshot = getMarketingPrivacySnapshot()
    const adopted = takeOverPrehydrationSheet(sheetRef.current, { analytics: snapshot.analytics, ads: snapshot.ads })
    if (adopted !== null) {
      adoptedDraftRef.current = adopted
      setOpen(true)
    }
  }, [])

  useEffect(() => {
    // toward #3697: first-party ad click may record from the first page.
    captureMarketingAdClickIds()
    const reopen = (): void => setOpen(true)
    window.addEventListener(PRIVACY_CHOICES_EVENT, reopen)
    return () => {
      window.removeEventListener(PRIVACY_CHOICES_EVENT, reopen)
      writeInset(0)
    }
  }, [])

  // The switches always start from what is actually running.
  useEffect(() => {
    if (!open) return
    const adopted = adoptedDraftRef.current
    adoptedDraftRef.current = null
    setDraft(adopted ?? { analytics: privacy.analytics, ads: privacy.ads })
  }, [open, privacy.analytics, privacy.ads])

  // I-PRIVACY-BAR-NEVER-OCCLUDES — the strip's height is the page's bottom inset.
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (strip === null) return
    const measure = (): void => writeInset(strip.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(false), SAVED_MS)
    return () => window.clearTimeout(timer)
  }, [saved])

  const close = useCallback((): void => {
    setOpen(false)
    window.requestAnimationFrame(() => stripRef.current?.focus())
  }, [])

  // Focus moves into the sheet, stays there (Tab wraps) and Escape closes it.
  useEffect(() => {
    if (!open) return
    const sheet = sheetRef.current
    const focusables = (): HTMLElement[] =>
      sheet === null ? [] : Array.from(sheet.querySelectorAll<HTMLElement>('input, button, a[href]'))
    window.requestAnimationFrame(() => focusables()[0]?.focus())
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !sheet?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !sheet?.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  const choose = (): void => {
    const choice = { analytics: draft.analytics, ads: draft.ads }
    setSaved(true)
    close()
    saveMarketingPrivacy(choice)
    captureMarketingAdClickIds()
    if (choice.analytics) void posthogOptIn()
  }

  return (
    <>
      <style id="mingla-privacy-bar-style" dangerouslySetInnerHTML={{ __html: BAR_CSS }} />
      {/* The inline handler may show these before hydration; the app then adopts them. */}
      <div className="mpb-scrim" data-testid="privacy-scrim" onClick={close} hidden={!open} suppressHydrationWarning />
          <section
            ref={sheetRef}
            hidden={!open}
            suppressHydrationWarning
            className="mpb ph-no-capture"
            role={open ? 'dialog' : undefined}
            aria-modal={open ? true : undefined}
            aria-labelledby="mingla-privacy-title"
            id={PANEL_ID}
            data-testid="privacy-sheet"
          >
            <div className="mpb-panel" data-testid="privacy-panel">
              <h2 className="mpb-title" id="mingla-privacy-title">{PRIVACY_STRIP_LABEL}</h2>
              <label className="mpb-switch-row">
                <span className="mpb-switch-copy">
                  <span className="mpb-switch-title">Analytics</span>
                  <span className="mpb-switch-desc">Helps us see which pages work and fix what doesn&apos;t.</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="mpb-switch"
                  aria-label="Analytics"
                  data-testid="privacy-switch-analytics"
                  checked={draft.analytics}
                  onChange={(event) => setDraft((current) => ({ ...current, analytics: event.target.checked }))}
                />
              </label>
              <label className="mpb-switch-row">
                <span className="mpb-switch-copy">
                  <span className="mpb-switch-title">Ads measurement</span>
                  <span className="mpb-switch-desc">Lets Meta, TikTok, Snapchat and Reddit measure our ads.</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="mpb-switch"
                  aria-label="Ads measurement"
                  data-testid="privacy-switch-ads"
                  checked={draft.ads}
                  onChange={(event) => setDraft((current) => ({ ...current, ads: event.target.checked }))}
                />
              </label>
              <div className="mpb-actions">
                <button type="button" className="mpb-hit" data-testid="privacy-bar-save" onClick={choose}>
                  <span className="mpb-pill mpb-primary">Save</span>
                </button>
                {/* Absolute, not "/privacy-policy": the root layout also renders on
                    career.usemingla.com, where every path is rewritten under /careers. */}
                <a className="mpb-policy" href={`${SITE_ORIGIN}/privacy-policy`}>
                  Privacy policy
                </a>
              </div>
            </div>
          </section>
      <button
        type="button"
        ref={stripRef}
        className="mps ph-no-capture"
        data-testid="privacy-strip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? PANEL_ID : undefined}
        onClick={() => (open ? close() : window.dispatchEvent(new Event(PRIVACY_CHOICES_EVENT)))}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M2 4h7M12 4h2M2 12h2M7 12h7" />
          <circle cx="10.5" cy="4" r="1.5" />
          <circle cx="5.5" cy="12" r="1.5" />
        </svg>
        <span aria-live="polite" className={saved ? 'mps-saved' : undefined}>
          {saved ? PRIVACY_SAVED_LABEL : PRIVACY_STRIP_LABEL}
        </span>
      </button>
      <script dangerouslySetInnerHTML={{ __html: PREHYDRATION_SCRIPT }} />
    </>
  )
}
