'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import {
  HeroPlaceDeck,
  useDeckRotation,
  type DeckPill,
} from '@/components/sections/explorer-home/hero-place-deck'
import { DEFAULT_CITY, type CityKey } from '@/lib/city-decks'
import { cn } from '@/lib/cn'
import { PRIVACY_SECTIONS, PRIVACY_EFFECTIVE_DATE } from '@/lib/privacyContent'
import { TERMS_SECTIONS, TERMS_EFFECTIVE_DATE } from '@/lib/termsContent'

// ---------------------------------------------------------------
// Mingla Explorer Hero
//
// Premium night-map canvas. The hero stays one viewport tall, but the
// background now carries the Mingla route/plan energy without competing
// with the rotating card deck.
// ---------------------------------------------------------------

interface ChipLink {
  href: string
  label: string
  /** When true, render only below the md breakpoint (mobile-only).
      The surface toggle in the header is hidden on mobile, so the
      bottom row carries the cross-link there. */
  mobileOnly?: boolean
  /** When true, the href is an absolute external URL (e.g. the careers
      subdomain) and must render as a real `<a>` anchor — a relative Next.js
      `<Link>` would 404 on the apex (ORCH-1225). Same-tab navigation. */
  external?: boolean
}

const SITE_CHIPS: ChipLink[] = [
  { href: '/host', label: 'Host', mobileOnly: true },
  // ORCH-1225 — 'Career' pill links to the careers subdomain. Always visible
  // (no mobileOnly) so it is discoverable on desktop too, where 'Host'
  // is hidden. ABSOLUTE external URL: a relative `/careers` 404s on the apex
  // (the marketing middleware host-rewrites `career.usemingla.com` only).
  { href: 'https://career.usemingla.com', label: 'Career', external: true },
  // ORCH-1053 — 'About' pill removed from the consumer page per operator.
  { href: '/support', label: 'Support' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
]

// ---------------------------------------------------------------
// HeadlinePill — the white-glass rounded pill in "Find <pill> that fit the
// vibe". ORCH-1007 hero-pill sync: it is now DRIVEN by the rotating deck. The
// `pill` ({ label, icon }) comes from the shared `useDeckRotation` hook, so the
// word always matches the deck's current front card and they advance on the
// SAME 2000ms tick. There is no independent timer here anymore — the previous
// PREFERENCE_CHIPS list + CYCLE_MS cycle were removed.
//
// Visual style is preserved verbatim (white glass pill + warm icon chip). The
// label swap keeps the same enter/exit motion feel via AnimatePresence keyed on
// the label, and `layout` animates the pill width as the word changes.
// ---------------------------------------------------------------
interface HeadlinePillProps {
  pill: DeckPill
}

function HeadlinePill({ pill }: HeadlinePillProps) {
  const Icon = pill.icon
  const chipMotion = {
    duration: 0.52,
    ease: [0.16, 1, 0.3, 1] as const,
  }

  return (
    <motion.span
      layout
      transition={{ layout: chipMotion }}
      className="relative inline-flex h-[1.08em] shrink-0 overflow-hidden rounded-full border border-white/75 bg-white/[0.94] px-[0.42em] align-[-0.08em] text-[#18110c] shadow-[0_18px_50px_rgba(235,120,37,0.24),inset_0_1px_0_rgba(255,255,255,0.96),inset_0_-10px_24px_rgba(235,120,37,0.14)] backdrop-blur-2xl"
    >
      <span className="inline-flex h-full items-center justify-center gap-[0.36em] whitespace-nowrap font-display text-[0.54em] leading-none">
        <span
          aria-hidden="true"
          className="grid size-[1.28em] place-items-center rounded-full bg-warm/12 text-warm shadow-[inset_0_0_0_1px_rgba(235,120,37,0.18)]"
        >
          <Icon strokeWidth={2.35} className="size-[0.86em]" />
        </span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={pill.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={chipMotion}
          >
            {pill.label}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.span>
  )
}

interface TermsModalProps {
  open: boolean
  onClose: () => void
}

function TermsModal({ open, onClose }: TermsModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="terms-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="terms-modal-title"
          onClick={onClose}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 px-4 py-5 backdrop-blur-xl sm:px-6"
        >
          <motion.div
            key="terms-panel"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ type: 'spring', stiffness: 240, damping: 28 }}
            onClick={(event) => event.stopPropagation()}
            className="relative flex max-h-[min(760px,calc(100svh-2.5rem))] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-white/14 bg-[#0d0d10] shadow-[0_40px_120px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.08)]"
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0d0d10]/98 px-5 py-5 backdrop-blur-2xl sm:px-7">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">
                Effective Date: {TERMS_EFFECTIVE_DATE}
              </p>
              <h2
                id="terms-modal-title"
                className="mt-2 font-display text-3xl leading-none text-text-primary sm:text-5xl"
              >
                Terms of Service
              </h2>
              <button
                type="button"
                autoFocus
                onClick={onClose}
                aria-label="Close terms"
                className="absolute right-4 top-4 grid size-10 place-items-center rounded-full border border-white/12 bg-white/10 text-text-primary transition-all duration-200 hover:bg-white/16 focus-ring"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-6 text-left sm:px-7 sm:py-7">
              <div className="space-y-6">
                {TERMS_SECTIONS.map((section) => {
                  const hasContact = 'contact' in section

                  return (
                    <section
                      key={section.title}
                      className={cn(
                        'space-y-3',
                        hasContact &&
                          'rounded-3xl border border-warm/25 bg-warm/10 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
                      )}
                    >
                      <h3 className="font-display text-xl leading-tight text-white/95 sm:text-2xl">
                        {section.title}
                      </h3>
                      <div className="space-y-3 text-sm leading-7 text-white/72 sm:text-base">
                        {section.paragraphs.map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                        {'bullets' in section ? (
                          <ul className="space-y-2 pl-5">
                            {section.bullets.map((bullet) => (
                              <li key={bullet} className="list-disc marker:text-warm/80">
                                {bullet}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {hasContact ? (
                          <div className="space-y-3 rounded-2xl border border-white/12 bg-black/20 p-4 text-white/82">
                            <p className="font-semibold text-white">
                              {section.contact.name}
                            </p>
                            <p>
                              Email:{' '}
                              <a
                                href={`mailto:${section.contact.email}`}
                                className="font-semibold text-warm underline-offset-4 hover:underline focus-ring"
                              >
                                {section.contact.email}
                              </a>
                            </p>
                            <p>
                              Website:{' '}
                              <a
                                href={section.contact.website}
                                className="font-semibold text-warm underline-offset-4 hover:underline focus-ring"
                              >
                                {section.contact.website}
                              </a>
                            </p>
                            <Link
                              href="/delete-account"
                              className="inline-flex min-h-10 items-center rounded-full border border-white/14 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/16 focus-ring"
                            >
                              Account deletion instructions
                            </Link>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  )
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function PrivacyModal({ open, onClose }: TermsModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="privacy-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="privacy-modal-title"
          onClick={onClose}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 px-4 py-5 backdrop-blur-xl sm:px-6"
        >
          <motion.div
            key="privacy-panel"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ type: 'spring', stiffness: 240, damping: 28 }}
            onClick={(event) => event.stopPropagation()}
            className="relative flex max-h-[min(760px,calc(100svh-2.5rem))] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-white/14 bg-[#0d0d10] shadow-[0_40px_120px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.08)]"
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0d0d10]/98 px-5 py-5 backdrop-blur-2xl sm:px-7">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">
                Effective Date: {PRIVACY_EFFECTIVE_DATE}
              </p>
              <h2
                id="privacy-modal-title"
                className="mt-2 font-display text-3xl leading-none text-text-primary sm:text-5xl"
              >
                Privacy Policy
              </h2>
              <button
                type="button"
                autoFocus
                onClick={onClose}
                aria-label="Close privacy policy"
                className="absolute right-4 top-4 grid size-10 place-items-center rounded-full border border-white/12 bg-white/10 text-text-primary transition-all duration-200 hover:bg-white/16 focus-ring"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-6 text-left sm:px-7 sm:py-7">
              <div className="space-y-6">
                {PRIVACY_SECTIONS.map((section) => {
                  const hasContact = 'contact' in section

                  return (
                    <section
                      key={section.title}
                      className={cn(
                        'space-y-3',
                        hasContact &&
                          'rounded-3xl border border-warm/25 bg-warm/10 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
                      )}
                    >
                      <h3 className="font-display text-xl leading-tight text-white/95 sm:text-2xl">
                        {section.title}
                      </h3>
                      <div className="space-y-3 text-sm leading-7 text-white/72 sm:text-base">
                        {section.paragraphs.map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                        {'bullets' in section ? (
                          <ul className="space-y-2 pl-5">
                            {section.bullets.map((bullet) => (
                              <li key={bullet} className="list-disc marker:text-warm/80">
                                {bullet}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {'footer' in section ? <p>{section.footer}</p> : null}
                        {hasContact ? (
                          <div className="space-y-3 rounded-2xl border border-white/12 bg-black/20 p-4 text-white/82">
                            <p className="font-semibold text-white">
                              {section.contact.name}
                            </p>
                            <p>
                              Email:{' '}
                              <a
                                href={`mailto:${section.contact.email}`}
                                className="font-semibold text-warm underline-offset-4 hover:underline focus-ring"
                              >
                                {section.contact.email}
                              </a>
                            </p>
                            <p>
                              Website:{' '}
                              <a
                                href={section.contact.website}
                                className="font-semibold text-warm underline-offset-4 hover:underline focus-ring"
                              >
                                {section.contact.website}
                              </a>
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  )
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function SupportModal({ open, onClose }: TermsModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="support-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-modal-title"
          onClick={onClose}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 px-4 py-5 backdrop-blur-xl sm:px-6"
        >
          <motion.div
            key="support-panel"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ type: 'spring', stiffness: 240, damping: 28 }}
            onClick={(event) => event.stopPropagation()}
            className="relative flex max-h-[min(760px,calc(100svh-2.5rem))] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-white/14 bg-[#0d0d10] shadow-[0_40px_120px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.08)]"
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0d0d10]/98 px-5 py-5 backdrop-blur-2xl sm:px-7">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">
                Support
              </p>
              <h2
                id="support-modal-title"
                className="mt-2 font-display text-3xl leading-none text-text-primary sm:text-5xl"
              >
                How can we help?
              </h2>
              <button
                type="button"
                autoFocus
                onClick={onClose}
                aria-label="Close support"
                className="absolute right-4 top-4 grid size-10 place-items-center rounded-full border border-white/12 bg-white/10 text-text-primary transition-all duration-200 hover:bg-white/16 focus-ring"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-6 text-left sm:px-7 sm:py-7">
              <div className="space-y-6 text-sm leading-7 text-white/72 sm:text-base">
                <p>
                  The Mingla team reads every support message and aims to
                  respond within 1–2 business days.
                </p>

                <div className="rounded-3xl border border-warm/25 bg-warm/10 p-5 text-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <p className="font-semibold text-white">
                    For help with your account, app access, or a problem you
                    spotted, email:
                  </p>
                  <a
                    href="mailto:support@usemingla.com"
                    className="mt-3 inline-flex min-h-10 items-center rounded-full border border-white/14 bg-white/10 px-4 text-sm font-semibold text-warm transition hover:bg-white/16 focus-ring"
                  >
                    support@usemingla.com
                  </a>
                </div>

                <section className="space-y-3">
                  <h3 className="font-display text-xl leading-tight text-white/95 sm:text-2xl">
                    Quick links
                  </h3>
                  <ul className="space-y-2 pl-5">
                    <li className="list-disc marker:text-warm/80">
                      <Link
                        href="/privacy-policy"
                        className="font-semibold text-warm underline-offset-4 hover:underline focus-ring"
                      >
                        Privacy Policy
                      </Link>
                    </li>
                    <li className="list-disc marker:text-warm/80">
                      <Link
                        href="/terms-of-service"
                        className="font-semibold text-warm underline-offset-4 hover:underline focus-ring"
                      >
                        Terms of Service
                      </Link>
                    </li>
                    <li className="list-disc marker:text-warm/80">
                      <Link
                        href="/delete-account"
                        className="font-semibold text-warm underline-offset-4 hover:underline focus-ring"
                      >
                        Delete your account
                      </Link>
                    </li>
                  </ul>
                </section>

                <p>
                  Account deletion is also available in the app from Settings →
                  Delete Account.
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

interface ExplorerHeroProps {
  /** Server-resolved marketing city (ORCH-1007 location-aware). Defaults to DC. */
  cityKey?: CityKey
}

export function ExplorerHero({ cityKey = DEFAULT_CITY }: ExplorerHeroProps) {
  const reduced = useMinglaReducedMotion()
  // Single source of truth for the rotation: the SAME index/timer drives both
  // the deck's front card and the headline pill (ORCH-1007 hero-pill sync).
  // The rotation is built from the RESOLVED city's interleaved slots.
  const rotation = useDeckRotation(cityKey)
  const [supportOpen, setSupportOpen] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)

  return (
    <section className="relative flex h-[100svh] flex-col overflow-hidden px-[clamp(1rem,4vw,2.5rem)]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_62%,rgba(235,120,37,0.16),transparent_34%),radial-gradient(ellipse_at_12%_16%,rgba(235,120,37,0.11),transparent_32%),radial-gradient(ellipse_at_88%_24%,rgba(118,67,38,0.18),transparent_36%),linear-gradient(180deg,#08090b_0%,#0c0d10_50%,#07080a_100%)]" />
        <div className="absolute inset-0 opacity-[0.11] [background-image:linear-gradient(rgba(235,120,37,0.24)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:72px_72px]" />
        <div className="absolute left-[-18%] top-[16%] h-[36rem] w-[76%] rotate-[-12deg] rounded-[50%] border border-dashed border-warm/20" />
        <div className="absolute right-[-22%] top-[44%] h-[28rem] w-[68%] rotate-[13deg] rounded-[50%] border border-dashed border-white/10" />
        <div className="absolute left-[12%] top-[54%] h-px w-[76%] -rotate-6 bg-gradient-to-r from-transparent via-warm/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#07080a] to-transparent" />
      </div>

      {/* Top spacer — fluid gap below the floating header (header bottom
          sits at 56px from viewport top). Floor 80 keeps tiny phones intact;
          11vh grows breathing room on tablet/desktop. */}
      <div
        aria-hidden="true"
        className="shrink-0"
        style={{ height: 'clamp(80px, 11vh, 160px)' }}
      />

      {/* Content area — fills the middle. Typography and the deck use
          clamp(min, vh-based, max) so they scale with available height. */}
      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center text-center">
        {/* Headline */}
        <motion.h1
          initial={reduced ? false : { opacity: 0, y: 16, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{
            duration: 0.72,
            delay: reduced ? 0 : 0.18,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="search-primary-answer flex max-w-[min(56rem,calc(100vw-2rem))] flex-col items-center justify-center gap-y-[0.12em] font-display leading-[1.12] tracking-[-0.005em] text-text-primary"
          style={{ fontSize: 'clamp(1.7rem, 5.7vmin, 4rem)' }}
        >
          <span className="inline-flex items-center justify-center gap-x-[0.22em] whitespace-nowrap">
            <span>Find</span>
            <HeadlinePill pill={rotation.pill} />
          </span>
          <span className="whitespace-nowrap">
            that fit the vibe.
          </span>
        </motion.h1>

        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.7,
            delay: reduced ? 0 : 1.15,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="flex w-full justify-center"
          style={{ marginTop: 'clamp(1.1rem, 3.6vmin, 2.8rem)' }}
        >
          <div
            className="mx-auto flex justify-center"
            style={{
              maxWidth: 'min(420px, calc(100vw - clamp(48px, 12vw, 96px)))',
              transform:
                'scale(clamp(0.82, calc(0.82 + (100vmin - 360px) / 1600px), 1.08))',
              transformOrigin: 'center',
            }}
          >
            <HeroPlaceDeck rotation={rotation} cityKey={cityKey} />
          </div>
        </motion.div>
      </div>

      {/* Bottom spacer — fluid gap above the chip row, mirrors the top spacer
          so breathing room is symmetric on every viewport. */}
      <div
        aria-hidden="true"
        className="shrink-0"
        style={{ height: 'clamp(80px, 11vh, 160px)' }}
      />

      {/* Chip-style site links at the bottom of the hero. The outer
          container enforces the same fluid side padding as the section,
          so chips never sit closer than 16px (or further than 40px) from
          a viewport edge. */}
      <div className="absolute inset-x-0 bottom-8 z-10 px-[clamp(0.75rem,4vw,2.5rem)]">
      <motion.nav
        aria-label="Site"
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.6,
          delay: reduced ? 0 : 1.5,
          ease: [0.16, 1, 0.3, 1],
        }}
        className="mx-auto flex items-center justify-center gap-1 sm:gap-2"
      >
        {SITE_CHIPS.map((chip) => {
          const chipClassName = cn(
            'glass-soft inline-flex h-7 items-center whitespace-nowrap rounded-full px-2 text-[10px] font-medium text-text-secondary transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:text-text-primary hover:brightness-110 active:translate-y-0 active:brightness-100 focus-ring sm:h-9 sm:px-4 sm:text-sm',
            chip.mobileOnly && 'md:hidden',
          )

          if (chip.href === '/privacy') {
            return (
              <button
                key={chip.href}
                type="button"
                onClick={() => setPrivacyOpen(true)}
                className={chipClassName}
              >
                {chip.label}
              </button>
            )
          }

          if (chip.href === '/support') {
            return (
              <button
                key={chip.href}
                type="button"
                onClick={() => setSupportOpen(true)}
                className={chipClassName}
              >
                {chip.label}
              </button>
            )
          }

          if (chip.href === '/terms') {
            return (
              <button
                key={chip.href}
                type="button"
                onClick={() => setTermsOpen(true)}
                className={chipClassName}
              >
                {chip.label}
              </button>
            )
          }

          // ORCH-1225 — external absolute URL (careers subdomain) renders as a
          // real anchor; a relative Next.js <Link> would 404 on the apex.
          // Same-tab navigation (same brand family) — no target/rel needed.
          if (chip.external) {
            return (
              <a key={chip.href} href={chip.href} className={chipClassName}>
                {chip.label}
              </a>
            )
          }

          return (
            <Link key={chip.href} href={chip.href} className={chipClassName}>
              {chip.label}
            </Link>
          )
        })}
      </motion.nav>
      </div>
      <SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />
      <TermsModal open={termsOpen} onClose={() => setTermsOpen(false)} />
      <PrivacyModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </section>
  )
}
