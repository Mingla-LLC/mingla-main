'use client'
// ORCH-1317 [Mingla link-in-bio page] — the interactive shell for
// usemingla.com/links. This is the single link Mingla drops in its social bios,
// so it is MOBILE-FIRST (a centered column, 44px+ tap targets, no horizontal
// overflow) and premium/uncluttered (a Linktree feel on the brand's night canvas).
//
// SNAPSHOT CONTRACT (§1): the whole page fits in ONE viewport and NEVER scrolls —
// wordmark + tagline + tab toggle + active CTA + socials are all visible at once.
// The root is exactly one dynamic viewport tall (100dvh, 100svh fallback) with
// `overflow-hidden` and safe-area insets; a flex column distributes the content so
// it fits short phones (~667px) without clipping and taller ones without scroll.
//
// STRUCTURE (all data lives in lib/links-config.ts — add tabs/socials there, not
// here): a wordmark + tagline, an accessible two-tab segmented control (ARIA
// tablist + roving tabindex + arrow-key nav), a per-tab CTA panel, and a socials
// row pinned to the bottom.
//
// A11Y: role=tablist/tab/tabpanel, aria-selected, roving tabindex (only the
// active tab is Tab-focusable), ArrowLeft/Right/Home/End move selection AND
// focus, and every interactive element carries the shared .focus-ring.
//
// ANALYTICS (§7): consent-gated captureMarketing (no-op until PostHog opt-in) on
// tab switch + every CTA / store-badge / social click.

import { useCallback, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Instagram, Linkedin, Facebook, Youtube } from 'lucide-react'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/lib/cn'
import {
  LINKS_SOCIALS,
  LINKS_TABS,
  socialHref,
  type LinksTab,
  type LinksTabId,
} from '@/lib/links-config'

const EASE = [0.16, 1, 0.3, 1] as const

// The CTA is an <a>/<Link> (navigation), so it can't use the <Button> element —
// it mirrors the Button token recipe (rounded-full font-display, warm / glass
// variant, lg size h-14 = 56px tap target, full width).
const CTA_BASE =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full px-7 text-base font-display font-medium tracking-[-0.005em] transition-all duration-200 ease-out-quart cursor-pointer focus-ring'
const CTA_INTENT: Record<LinksTab['cta']['intent'], string> = {
  primary:
    'bg-warm text-white hover:-translate-y-0.5 hover:bg-[var(--color-warm-hover)] hover:brightness-110 active:translate-y-0 active:brightness-100',
  glass:
    'glass-soft text-text-primary hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:brightness-100',
}

// lucide ships clean Instagram / LinkedIn / Facebook / YouTube marks. It has no X
// (Twitter rebrand), TikTok, or Threads glyph, so those use inline brand SVGs (§4).
function SocialIcon({ label }: { label: string }) {
  const cls = 'h-5 w-5'
  switch (label) {
    case 'Instagram':
      return <Instagram className={cls} aria-hidden="true" />
    case 'LinkedIn':
      return <Linkedin className={cls} aria-hidden="true" />
    case 'Facebook':
      return <Facebook className={cls} aria-hidden="true" />
    case 'YouTube':
      return <Youtube className={cls} aria-hidden="true" />
    case 'TikTok':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.08-.14 1.62.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
        </svg>
      )
    case 'Threads':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M16.5 11.1c-.11-.05-.22-.1-.34-.15-.2-3.7-2.22-5.82-5.62-5.84h-.05c-2.03 0-3.72.87-4.76 2.45l1.87 1.28c.77-1.17 1.99-1.42 2.9-1.42h.03c1.13.01 1.99.34 2.54 .99 .4 .47 .67 1.12 .8 1.94-1-.17-2.08-.22-3.24-.15-3.24.19-5.33 2.08-5.19 4.7 .07 1.33 .73 2.47 1.86 3.22 .96 .63 2.19 .94 3.47 .87 1.69-.09 3.02-.74 3.94-1.92 .7-.9 1.15-2.06 1.35-3.53 .81 .49 1.41 1.13 1.74 1.91 .57 1.32 .6 3.49-1.17 5.26-1.55 1.55-3.42 2.22-6.24 2.24-3.13-.02-5.5-1.03-7.04-2.99C2.7 17.44 1.96 15.15 1.93 12v-.01c.03-3.15 .77-5.44 2.21-6.82C5.68 3.21 8.05 2.2 11.18 2.18c3.15 .02 5.55 1.03 7.14 3 .78 .97 1.37 2.19 1.75 3.6l1.95-.52c-.47-1.75-1.22-3.27-2.24-4.54C17.75 1.28 14.79 .02 11.19 0h-.02C7.57 .02 4.6 1.29 2.72 3.68 1.05 5.81 .18 8.75 .15 12.24v.02c.03 3.49 .9 6.43 2.57 8.55C4.6 23.2 7.57 24.47 11.17 24.49h.02c3.28-.02 5.6-.88 7.5-2.78 2.49-2.49 2.41-5.6 1.59-7.53-.59-1.38-1.71-2.5-3.24-3.24zM11.5 16.68c-1.42 .08-2.9-.56-2.97-1.92-.05-1.01 .72-2.13 3.06-2.27 .27-.02 .53-.02 .79-.02 .85 0 1.64 .08 2.36 .24-.27 3.36-1.85 3.9-3.24 3.97z" />
        </svg>
      )
    case 'X':
    default:
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
        </svg>
      )
  }
}

interface LinksExperienceProps {
  /** Tagline under the wordmark. Passed from the (server) page so the copy is
   *  editable in one place; defaults to the brand line if omitted. */
  tagline?: string
}

export function LinksExperience({
  tagline = 'Find a vibe, not a venue.',
}: LinksExperienceProps) {
  const reduced = useMinglaReducedMotion()
  const [activeId, setActiveId] = useState<LinksTabId>(LINKS_TABS[0].id)
  const idBase = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const activeIndex = LINKS_TABS.findIndex((t) => t.id === activeId)
  const activeTab = LINKS_TABS[activeIndex] ?? LINKS_TABS[0]

  const tabDomId = (id: LinksTabId) => `${idBase}-tab-${id}`
  const panelDomId = (id: LinksTabId) => `${idBase}-panel-${id}`

  const selectTab = useCallback((id: LinksTabId) => {
    setActiveId((prev) => {
      if (prev !== id) {
        // §7 — consent-gated no-op analytics on tab switch.
        captureMarketing('links_page_tab_switched', { tab: id })
      }
      return id
    })
  }, [])

  // Roving-tabindex arrow-key navigation (WAI-ARIA tabs pattern): Arrow keys move
  // selection AND focus; Home/End jump to the ends.
  const onTabKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      const last = LINKS_TABS.length - 1
      let next = index
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = index === last ? 0 : index + 1
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          next = index === 0 ? last : index - 1
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = last
          break
        default:
          return
      }
      e.preventDefault()
      const nextTab = LINKS_TABS[next]
      selectTab(nextTab.id)
      tabRefs.current[next]?.focus()
    },
    [selectTab],
  )

  const onCtaClick = useCallback((tab: LinksTab) => {
    captureMarketing('links_page_cta_clicked', {
      tab: tab.id,
      destination: tab.cta.destination,
    })
  }, [])

  const onSocialClick = useCallback(
    (network: string) => {
      // `surface` distinguishes an @usemingla tap (explorer) from an
      // @minglabusiness tap (business) on the same network icon.
      captureMarketing('links_page_social_clicked', { network, surface: activeId })
    },
    [activeId],
  )

  return (
    <main
      id="main"
      // §1 SNAPSHOT: exactly one dynamic viewport tall, never scrolls. `h-[100svh]`
      // is the fallback; the inline `height: 100dvh` wins on modern browsers (and is
      // silently dropped where dvh is unsupported, leaving svh). `overflow-hidden`
      // guarantees no scrollbar; the flex column below distributes the content to fit.
      className="relative flex h-[100svh] flex-col overflow-hidden bg-[#08090b] px-5 text-text-primary"
      style={{
        height: '100dvh',
        paddingTop: 'max(1.25rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))',
      }}
    >
      {/* Brand night-canvas atmosphere (matches /download). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_10%,rgba(235,120,37,0.18),transparent_34%),radial-gradient(ellipse_at_84%_16%,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,#08090b_0%,#0d0d10_60%,#07080a_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black to-transparent" />
      </div>

      {/* Centered content column. `min-h-0` lets it shrink inside the fixed-height
          flex parent so the socials row below always stays on-screen (§1). */}
      <div className="relative z-10 flex w-full min-h-0 flex-1 flex-col items-center justify-center">
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="w-full max-w-[440px]"
        >
          {/* Wordmark + tagline. */}
          <div className="flex flex-col items-center text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/mingla-wordmark.svg"
              alt="Mingla"
              className="h-9 w-auto select-none sm:h-10"
              draggable={false}
            />
            <p className="mt-3 text-balance text-lg font-medium leading-snug text-white/82">
              {tagline}
            </p>
          </div>

          {/* Segmented tablist. */}
          <div
            role="tablist"
            aria-label="Choose Mingla for you or your business"
            aria-orientation="horizontal"
            className="glass-soft mt-6 flex gap-1 rounded-full p-1"
          >
            {LINKS_TABS.map((tab, i) => {
              const selected = tab.id === activeId
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[i] = el
                  }}
                  role="tab"
                  id={tabDomId(tab.id)}
                  aria-selected={selected}
                  aria-controls={panelDomId(tab.id)}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectTab(tab.id)}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                  className={cn(
                    'relative flex h-11 flex-1 items-center justify-center rounded-full px-4 text-[15px] font-display font-medium tracking-[-0.005em] transition-colors duration-200 focus-ring',
                    selected ? 'text-white' : 'text-white/60 hover:text-white/85',
                  )}
                >
                  {selected ? (
                    <motion.span
                      layoutId="links-tab-pill"
                      className="absolute inset-0 rounded-full bg-warm"
                      // §2 — crisp, no spring/overshoot: a short ease-out slide.
                      transition={
                        reduced
                          ? { duration: 0 }
                          : { type: 'tween', duration: 0.18, ease: [0.4, 0, 0.2, 1] }
                      }
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              )
            })}
          </div>

          {/* Active tab panel. Only one panel is mounted (roving tabindex model).
              §2 — a quick crossfade on switch (tween, no overshoot). */}
          <motion.div
            key={activeTab.id}
            role="tabpanel"
            id={panelDomId(activeTab.id)}
            aria-labelledby={tabDomId(activeTab.id)}
            tabIndex={0}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="mt-5 rounded-[28px] border border-white/10 bg-white/[0.03] p-6 text-center focus-ring"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-warm">
              {activeTab.eyebrow}
            </p>
            <h1 className="mt-2 font-display text-2xl leading-tight text-white sm:text-[28px]">
              {activeTab.heading}
            </h1>
            <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-white/72">
              {activeTab.body}
            </p>

            {/* §4 — Explorer is a single smart CTA. `/download` already routes per
                device (iPhone → App Store, Android → Play, desktop → QR) from the
                store-links single source of truth, so no store badges are needed. */}
            <div className="mt-5">
              <Link
                href={activeTab.cta.href}
                onClick={() => onCtaClick(activeTab)}
                className={cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent])}
              >
                {activeTab.cta.label}
              </Link>
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* Socials — pinned to the bottom of the viewport (§3, all 7 accounts).
          The row is SURFACE-AWARE: on the Business tab the five business-branded
          networks swap to @minglabusiness, while YouTube & LinkedIn stay universal
          (resolved by `socialHref`). `flex-wrap` + a tight gap keep all seven 44px
          tap targets on one tidy row on standard phones (≥390px) and wrap them
          cleanly on narrower/very short devices — never forcing a scroll (§1). */}
      <motion.nav
        aria-label={
          activeId === 'business' ? 'Mingla Business on social media' : 'Mingla on social media'
        }
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: reduced ? 0 : 0.25, ease: EASE }}
        className="relative z-10 mt-5 flex flex-wrap items-center justify-center gap-1.5"
      >
        {LINKS_SOCIALS.map((s) => (
          <a
            key={s.label}
            href={socialHref(s, activeId)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${activeId === 'business' ? 'Mingla Business' : 'Mingla'} on ${s.label}`}
            onClick={() => onSocialClick(s.label)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus-ring"
          >
            <SocialIcon label={s.label} />
          </a>
        ))}
      </motion.nav>
    </main>
  )
}
