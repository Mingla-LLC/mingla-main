'use client'
// #2331 — the in-page "Your privacy choices" link. A normal link in the footer
// (or at the end of content on footer-less pages such as /links), never a
// floating control. It reopens the same privacy bar, already expanded.

import { PRIVACY_CHOICES_EVENT } from '@/components/marketing/posthog-provider'

export function openPrivacyChoices(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PRIVACY_CHOICES_EVENT))
}

export function PrivacyChoicesLink({
  className,
  onOpen,
}: {
  readonly className?: string
  /** Runs before the bar reopens (e.g. a modal closing itself first). */
  readonly onOpen?: () => void
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onOpen?.()
        openPrivacyChoices()
      }}
      data-testid="privacy-choices-link"
      className={
        className ??
        'rounded-sm text-left text-sm text-text-secondary underline-offset-2 transition-colors hover:text-text-primary hover:underline focus-ring'
      }
    >
      Your privacy choices
    </button>
  )
}
