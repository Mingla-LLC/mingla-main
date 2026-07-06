'use client'
// ORCH-1317 [Mingla link-in-bio page] — the interactive shell for
// usemingla.com/links. This is the single link Mingla drops in its social bios,
// so it is MOBILE-FIRST (a centered column, 44px+ tap targets, no horizontal
// overflow) and premium/uncluttered (a Linktree feel on the brand's night canvas).
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
import { Instagram, Linkedin, Facebook } from 'lucide-react'
import { AppStoreBadges } from '@/components/ui/app-store-badges'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/lib/cn'
import {
  LINKS_SOCIALS,
  LINKS_TABS,
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

// lucide ships clean Instagram / LinkedIn / Facebook marks; it has no X (Twitter
// rebrand) glyph, so X uses an inline SVG of the current wordmark logo (§4).
function SocialIcon({ label }: { label: string }) {
  const cls = 'h-5 w-5'
  if (label === 'Instagram') return <Instagram className={cls} aria-hidden="true" />
  if (label === 'LinkedIn') return <Linkedin className={cls} aria-hidden="true" />
  if (label === 'Facebook') return <Facebook className={cls} aria-hidden="true" />
  // X (formerly Twitter)
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  )
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

  // Delegated capture for the two store badges (each is its own <a>); derive the
  // store from the anchor's aria-label so both badge clicks are attributed.
  const onBadgesClickCapture = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return
      const label = anchor.getAttribute('aria-label') ?? ''
      const destination = /google play/i.test(label)
        ? 'play'
        : /app store/i.test(label)
          ? 'app_store'
          : 'store_badge'
      captureMarketing('links_page_cta_clicked', { tab: 'explorer', destination })
    },
    [],
  )

  const onSocialClick = useCallback((network: string) => {
    captureMarketing('links_page_social_clicked', { network })
  }, [])

  return (
    <main
      id="main"
      className="relative flex min-h-[100svh] flex-col overflow-hidden bg-[#08090b] px-5 pb-8 pt-12 text-text-primary sm:pt-16"
      style={{
        paddingTop: 'max(3rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
      }}
    >
      {/* Brand night-canvas atmosphere (matches /download). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_10%,rgba(235,120,37,0.18),transparent_34%),radial-gradient(ellipse_at_84%_16%,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,#08090b_0%,#0d0d10_60%,#07080a_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black to-transparent" />
      </div>

      {/* Centered content column. */}
      <div className="relative z-10 flex w-full flex-1 flex-col items-center justify-center">
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
            <p className="mt-4 text-balance text-lg font-medium leading-snug text-white/82">
              {tagline}
            </p>
          </div>

          {/* Segmented tablist. */}
          <div
            role="tablist"
            aria-label="Choose Mingla for you or your business"
            aria-orientation="horizontal"
            className="glass-soft mt-8 flex gap-1 rounded-full p-1"
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
                      transition={
                        reduced
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 380, damping: 32 }
                      }
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              )
            })}
          </div>

          {/* Active tab panel. Only one panel is mounted (roving tabindex model). */}
          <motion.div
            key={activeTab.id}
            role="tabpanel"
            id={panelDomId(activeTab.id)}
            aria-labelledby={tabDomId(activeTab.id)}
            tabIndex={0}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.03] p-6 text-center focus-ring sm:p-7"
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

            <div className="mt-6">
              <Link
                href={activeTab.cta.href}
                onClick={() => onCtaClick(activeTab)}
                className={cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent])}
              >
                {activeTab.cta.label}
              </Link>
            </div>

            {activeTab.showStoreBadges ? (
              <>
                <div className="mt-6 flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-white/12" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                    or pick your store
                  </span>
                  <span className="h-px flex-1 bg-white/12" />
                </div>
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                <div className="mt-6" onClickCapture={onBadgesClickCapture}>
                  <AppStoreBadges />
                </div>
              </>
            ) : null}
          </motion.div>
        </motion.div>
      </div>

      {/* Socials — pinned to the bottom of the column. */}
      <motion.nav
        aria-label="Mingla on social media"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: reduced ? 0 : 0.25, ease: EASE }}
        className="relative z-10 mt-10 flex items-center justify-center gap-2"
      >
        {LINKS_SOCIALS.map((s) => (
          <a
            key={s.label}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Mingla on ${s.label}`}
            onClick={() => onSocialClick(s.label)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus-ring"
          >
            <SocialIcon label={s.label} />
          </a>
        ))}
      </motion.nav>
    </main>
  )
}
