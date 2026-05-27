'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChefHat,
  Coffee,
  Compass,
  Film,
  Footprints,
  Gamepad2,
  Heart,
  Martini,
  Palette,
  Sandwich,
  Sparkles,
  Trees,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { HeroVibeDeck } from '@/components/sections/explorer-home/hero-vibe-deck'
import { cn } from '@/lib/cn'

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
}

const SITE_CHIPS: ChipLink[] = [
  { href: '/organisers', label: 'Organiser', mobileOnly: true },
  { href: '/about', label: 'About' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
]

interface PreferenceChip {
  label: string
  icon: LucideIcon
}

const PREFERENCE_CHIPS: PreferenceChip[] = [
  { label: 'romantic plans', icon: Heart },
  { label: 'adventurous plans', icon: Compass },
  { label: 'first date plans', icon: Sparkles },
  { label: 'group plans', icon: Users },
  { label: 'picnic plans', icon: Sandwich },
  { label: 'stroll routes', icon: Footprints },
  { label: 'play dates', icon: Gamepad2 },
  { label: 'icebreaker places', icon: Sparkles },
  { label: 'nature places', icon: Trees },
  { label: 'drinks places', icon: Martini },
  { label: 'artsy places', icon: Palette },
  { label: 'movie dates', icon: Film },
  { label: 'brunch places', icon: Coffee },
  { label: 'casual places', icon: UtensilsCrossed },
  { label: 'fine dining places', icon: ChefHat },
] as const

const CYCLE_MS = 2800

const TERMS_SECTIONS = [
  {
    title: '1. Acceptance of Terms',
    paragraphs: [
      'By downloading, installing, or using the Mingla mobile application or website (the "Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use our Service. These Terms apply to all users of the Service.',
    ],
  },
  {
    title: '2. About Mingla',
    paragraphs: [
      'Mingla is a date and hangout planning platform that helps couples, singles, and friend groups discover local experiences, generate personalized plans, and coordinate outings. Mingla is operated by usemingla.com.',
    ],
  },
  {
    title: '3. Eligibility',
    paragraphs: [
      'You must be at least 13 years of age to use Mingla. By using the Service, you represent and warrant that you meet this age requirement. If you are under 18, you represent that you have obtained parental or guardian consent to use the Service.',
    ],
  },
  {
    title: '4. Account Registration',
    paragraphs: [
      'To access certain features, you must create an account. You may register using your Google account, Apple ID, or phone number. You agree to:',
    ],
    bullets: [
      'Provide accurate and complete information during registration',
      'Keep your account credentials secure and not share them with others',
      'Notify us immediately of any unauthorized use of your account',
      'Be responsible for all activity that occurs under your account',
    ],
  },
  {
    title: '5. Phone Verification and SMS',
    paragraphs: [
      'To use certain features of Mingla, you must verify your phone number. By providing your phone number, you consent to receive a one-time SMS passcode (OTP) for verification purposes. Standard message and data rates may apply.',
      'When you invite a friend via SMS, you represent that you have obtained that person’s consent to receive a text message from Mingla on your behalf. Misuse of the invite feature to send unsolicited messages is strictly prohibited and may result in account termination.',
    ],
  },
  {
    title: '6. User Conduct',
    paragraphs: ['You agree not to use Mingla to:'],
    bullets: [
      'Violate any applicable laws or regulations',
      'Harass, abuse, or harm other users',
      'Send spam or unsolicited communications',
      'Impersonate any person or entity',
      'Upload or transmit harmful, offensive, or inappropriate content',
      'Attempt to gain unauthorized access to the Service or other users’ accounts',
      'Reverse engineer, decompile, or disassemble any part of the Service',
      'Use the Service for any commercial purpose without our written consent',
    ],
  },
  {
    title: '7. User-Generated Content',
    paragraphs: [
      'You may submit content to Mingla including reviews, preferences, and plans ("User Content"). By submitting User Content, you grant Mingla a non-exclusive, worldwide, royalty-free license to use, display, and distribute that content solely to operate and improve the Service.',
      'You represent that you own or have the rights to any User Content you submit, and that it does not violate any third-party rights or applicable laws.',
    ],
  },
  {
    title: '8. Intellectual Property',
    paragraphs: [
      'All content, branding, design, software, and technology within the Mingla Service are the property of Mingla / usemingla.com and are protected by applicable intellectual property laws. You may not copy, reproduce, distribute, or create derivative works from any part of the Service without our express written permission.',
    ],
  },
  {
    title: '9. Third-Party Services',
    paragraphs: [
      'Mingla integrates with third-party services including Google, Apple, Supabase, Twilio, and Vonage. Your use of those services is subject to their respective terms of service and privacy policies. Mingla is not responsible for the conduct or content of any third-party service.',
    ],
  },
  {
    title: '10. Location Services',
    paragraphs: [
      'Mingla may request access to your device’s location to suggest nearby experiences and venues. You may disable location access at any time in your device settings. Disabling location services may limit certain features of the app.',
    ],
  },
  {
    title: '11. Disclaimer of Warranties',
    paragraphs: [
      'THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. MINGLA DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF HARMFUL COMPONENTS. YOUR USE OF THE SERVICE IS AT YOUR SOLE RISK.',
    ],
  },
  {
    title: '12. Limitation of Liability',
    paragraphs: [
      'TO THE MAXIMUM EXTENT PERMITTED BY LAW, MINGLA SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY TO YOU SHALL NOT EXCEED THE AMOUNT YOU PAID TO US IN THE TWELVE MONTHS PRECEDING THE CLAIM, OR $100, WHICHEVER IS GREATER.',
    ],
  },
  {
    title: '13. Indemnification',
    paragraphs: [
      'You agree to indemnify, defend, and hold harmless Mingla, its officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses (including legal fees) arising out of or related to your use of the Service, your User Content, or your violation of these Terms.',
    ],
  },
  {
    title: '14. Termination',
    paragraphs: [
      'We reserve the right to suspend or terminate your account at any time, with or without notice, for any violation of these Terms or for any other reason at our sole discretion. Upon termination, your right to use the Service will immediately cease.',
    ],
  },
  {
    title: '15. Governing Law',
    paragraphs: [
      'These Terms shall be governed by and construed in accordance with the laws of the United States, without regard to conflict of law principles. Any disputes arising from these Terms shall be resolved in the courts of competent jurisdiction.',
    ],
  },
  {
    title: '16. Changes to Terms',
    paragraphs: [
      'We reserve the right to modify these Terms at any time. We will notify you of material changes by posting updated Terms on our website and updating the effective date. Your continued use of the Service after such changes constitutes your acceptance of the new Terms.',
    ],
  },
  {
    title: '17. Contact Us',
    paragraphs: [
      'If you have any questions about these Terms of Service, please contact us at:',
    ],
    contact: {
      name: 'Mingla / usemingla.com',
      email: 'developer@usemingla.com',
      website: 'https://www.usemingla.com',
    },
  },
] as const

const PRIVACY_SECTIONS = [
  {
    title: '1. Introduction',
    paragraphs: [
      'Welcome to Mingla ("we," "our," or "us"). Mingla is a date and hangout planning app operated by usemingla.com. We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our mobile application and website (collectively, the "Service").',
      'Please read this policy carefully. If you disagree with its terms, please discontinue use of our Service.',
    ],
  },
  {
    title: '2. Information We Collect',
    paragraphs: [],
  },
  {
    title: '2.1 Information You Provide',
    paragraphs: [],
    bullets: [
      'Full name and display name',
      'Email address',
      'Phone number (used for SMS verification and invite features)',
      'Profile information such as preferences, location, and interests',
      'Content you submit, including date plans, reviews, and messages',
    ],
  },
  {
    title: '2.2 Information Collected Automatically',
    paragraphs: [],
    bullets: [
      'Device information (device type, operating system, unique device identifiers)',
      'Usage data (features used, pages visited, time spent in-app)',
      'Location data (with your permission, to suggest local experiences)',
      'Log data (IP address, browser type, referring URLs)',
    ],
  },
  {
    title: '2.3 Information from Third Parties',
    paragraphs: [],
    bullets: [
      'Google Sign-In: name, email address, and profile picture from your Google account',
      'Apple Sign-In: name and email address from your Apple ID',
    ],
  },
  {
    title: '3. How We Use Your Information',
    paragraphs: ['We use the information we collect to:'],
    bullets: [
      'Create and manage your Mingla account',
      'Verify your phone number via one-time SMS passcodes (OTP)',
      'Send invite SMS messages on your behalf when you invite friends to join Mingla',
      'Generate personalized date and hangout plans based on your preferences',
      'Suggest local experiences, venues, and activities near you',
      'Improve and develop our Service',
      'Communicate with you about updates, features, and support',
      'Detect and prevent fraud, abuse, and security incidents',
      'Comply with legal obligations',
    ],
  },
  {
    title: '4. SMS Messaging',
    paragraphs: ['Mingla uses SMS messaging for two purposes:'],
  },
  {
    title: '4.1 Phone Number Verification (OTP)',
    paragraphs: [
      'When you sign up or add a phone number, we send a one-time passcode (OTP) to verify that the number belongs to you. This is a single transactional message and does not constitute marketing.',
    ],
  },
  {
    title: '4.2 Invite Messages',
    paragraphs: [
      'When you choose to invite a friend to Mingla, you may enter their phone number and we will send them a single SMS invite on your behalf. By submitting a contact’s phone number, you confirm that you have their permission to send them this message. The invited person will receive one SMS only and will not be contacted again unless they sign up and opt in to further communications.',
      'To opt out of receiving SMS messages from Mingla, reply STOP to any message. For help, reply HELP.',
    ],
  },
  {
    title: '5. How We Share Your Information',
    paragraphs: ['We do not sell your personal information. We may share your information with:'],
  },
  {
    title: '5.1 Service Providers',
    paragraphs: [],
    bullets: [
      'Supabase – database and authentication infrastructure',
      'Twilio – SMS delivery for OTP verification and invite messages',
      'Vonage – SMS delivery services',
      'Google – authentication services (Google Sign-In)',
      'Apple – authentication services (Apple Sign-In)',
    ],
  },
  {
    title: '5.2 Legal Requirements',
    paragraphs: [
      'We may disclose your information if required by law, court order, or governmental authority, or to protect the rights, property, or safety of Mingla, our users, or the public.',
    ],
  },
  {
    title: '5.3 Business Transfers',
    paragraphs: [
      'In the event of a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction. We will notify you before your information is transferred and becomes subject to a different privacy policy.',
    ],
  },
  {
    title: '6. Data Retention',
    paragraphs: [
      'We retain your personal information for as long as your account is active or as needed to provide you with our Service. If you delete your account, we will delete or anonymize your personal data within 30 days, unless we are required to retain it for legal or regulatory reasons.',
    ],
  },
  {
    title: '7. Your Rights and Choices',
    paragraphs: [
      'Depending on your location, you may have the following rights:',
    ],
    bullets: [
      'Access: Request a copy of the personal data we hold about you',
      'Correction: Request that we correct inaccurate or incomplete data',
      'Deletion: Request that we delete your personal data',
      'Portability: Request a copy of your data in a machine-readable format',
      'Opt-out: Opt out of SMS messages by replying STOP',
    ],
    footer: 'To exercise any of these rights, contact us at privacy@usemingla.com.',
  },
  {
    title: '8. Children’s Privacy',
    paragraphs: [
      'Mingla is not intended for use by individuals under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected data from a child under 13, we will take steps to delete it promptly.',
    ],
  },
  {
    title: '9. Security',
    paragraphs: [
      'We implement industry-standard security measures to protect your information, including encryption in transit and at rest, secure authentication via Supabase, and access controls. However, no method of electronic storage or transmission is 100% secure, and we cannot guarantee absolute security.',
    ],
  },
  {
    title: '10. Third-Party Links',
    paragraphs: [
      'Our Service may contain links to third-party websites or services. We are not responsible for the privacy practices of those third parties and encourage you to review their privacy policies.',
    ],
  },
  {
    title: '11. Changes to This Policy',
    paragraphs: [
      'We may update this Privacy Policy from time to time. We will notify you of material changes by posting the new policy on our website and updating the effective date. Your continued use of the Service after changes are posted constitutes your acceptance of the updated policy.',
    ],
  },
  {
    title: '12. Contact Us',
    paragraphs: [
      'If you have any questions about this Privacy Policy, please contact us at:',
    ],
    contact: {
      name: 'Mingla / usemingla.com',
      email: 'developer@usemingla.com',
      website: 'https://www.usemingla.com',
    },
  },
] as const

interface PreferenceChipCycleProps {
  chips: readonly PreferenceChip[]
  intervalMs?: number
  startDelayMs?: number
}

function PreferenceChipCycle({
  chips,
  intervalMs = CYCLE_MS,
  startDelayMs = 0,
}: PreferenceChipCycleProps) {
  const reduced = useMinglaReducedMotion()
  const [i, setI] = useState(0)
  const [armed, setArmed] = useState(startDelayMs === 0)

  useEffect(() => {
    if (reduced) return
    if (startDelayMs > 0) {
      const t = window.setTimeout(() => setArmed(true), startDelayMs)
      return () => window.clearTimeout(t)
    }
  }, [reduced, startDelayMs])

  useEffect(() => {
    if (reduced || !armed) return
    const id = window.setInterval(
      () => setI((prev) => (prev + 1) % chips.length),
      intervalMs,
    )
    return () => window.clearInterval(id)
  }, [reduced, armed, chips.length, intervalMs])

  const current = reduced ? chips[0] : chips[i]
  const Icon = current.icon
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
        <span>{current.label}</span>
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
                Effective Date: February 16, 2026
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
                Effective Date: February 16, 2026
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

export function ExplorerHero() {
  const reduced = useMinglaReducedMotion()
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
          className="flex max-w-[min(56rem,calc(100vw-2rem))] flex-col items-center justify-center gap-y-[0.12em] font-display leading-[1.12] tracking-[-0.005em] text-text-primary"
          style={{ fontSize: 'clamp(1.7rem, 5.7vmin, 4rem)' }}
        >
          <span className="inline-flex items-center justify-center gap-x-[0.22em] whitespace-nowrap">
            <span>Find</span>
            <PreferenceChipCycle chips={PREFERENCE_CHIPS} startDelayMs={900} />
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
            <HeroVibeDeck />
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

          return chip.href === '/terms' ? (
            <button
              key={chip.href}
              type="button"
              onClick={() => setTermsOpen(true)}
              className={chipClassName}
            >
              {chip.label}
            </button>
          ) : (
            <Link key={chip.href} href={chip.href} className={chipClassName}>
              {chip.label}
            </Link>
          )
        })}
      </motion.nav>
      </div>
      <TermsModal open={termsOpen} onClose={() => setTermsOpen(false)} />
      <PrivacyModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </section>
  )
}
