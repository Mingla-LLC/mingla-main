import Image from 'next/image'
import { DeviceCta } from '@/components/cutout/device-cta'
import type { BlogMediaSize, BlogOfferingFacts } from '@/lib/blog/data'

// #4137 — an event / offering card (I-4137-BLOG-NO-HOST-IDENTITY).
// The title is the EDITOR's displayTitle; the host's own event title, brand,
// flyer and cover never reach this component (the embeds RPC does not return
// them). The image is an optional licensed mood photo from blog media, never
// the event cover. The button opens the Explorer app through DeviceCta.

function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function offeringEyebrow(facts: BlogOfferingFacts, city: string | null, now = new Date()): string {
  const place = city ? ` · ${city.toUpperCase()}` : ''
  const start = facts.next_start_at ? new Date(facts.next_start_at) : null
  if (start && !Number.isNaN(start.getTime())) {
    let zone = 'UTC'
    try { zone = facts.timezone ? new Intl.DateTimeFormat('en', { timeZone: facts.timezone }).resolvedOptions().timeZone : 'UTC' } catch { zone = 'UTC' }
    if (dayKey(start, zone) === dayKey(now, zone)) return `Tonight in the Mingla app${place}`
    if (start.getTime() - now.getTime() <= 7 * 24 * 3600 * 1000) return `This week in the Mingla app${place}`
  }
  return `In the Mingla app${place}`
}

function subLine(eventType: string | null): string {
  if (eventType === 'trip') return 'Dates, prices and places live in the app'
  if (eventType === 'rsvp') return 'Dates and RSVPs live in the app'
  return 'Dates, prices and tickets live in the app'
}

export function OfferingCard({ facts, displayTitle, eyebrowCity, mood, moodAlt, moodSrc, hidePassed }: {
  readonly facts: BlogOfferingFacts | undefined
  readonly displayTitle: string
  readonly eyebrowCity?: string
  readonly mood: BlogMediaSize | null
  readonly moodAlt?: string
  readonly moodSrc: string | null
  readonly hidePassed: boolean
}) {
  if (!facts || !facts.is_public) return null
  if (facts.passed && hidePassed) return null
  const city = eyebrowCity?.trim() || facts.city
  const withImage = Boolean(mood && moodSrc && moodAlt)
  return (
    <div className={withImage ? 'blog-embed blog-embed-dark' : 'blog-embed blog-embed-dark blog-embed-text'} data-blog-block="offering">
      {withImage && mood && moodSrc ? (
        <div className="blog-embed-media">
          <Image src={moodSrc} alt={moodAlt ?? ''} width={mood.width} height={mood.height} sizes="200px" />
        </div>
      ) : null}
      <div>
        <div className="blog-eyebrow">{facts.passed ? 'In the Mingla app' : offeringEyebrow(facts, city ?? null)}</div>
        <h3>{displayTitle}</h3>
        <p className="blog-embed-sub">
          {facts.passed ? 'This one has passed. Open Mingla to see what’s on.' : subLine(facts.event_type)}
        </p>
        <div className="blog-actions">
          <DeviceCta surface="explorer" location="blog_event_card" label="Open in Mingla" variant="primary" size="md" />
        </div>
      </div>
    </div>
  )
}
