// #1086 / #4339 — Book a call: the live growth-tools-book function's slots and
// booking (Google Calendar + Meet invite, confirmation emails to both sides).
// Its own module so /schedule, /schedule/creators and /schedule/locals load
// only this and the transport, not every free tool (the first-load budget);
// lib/growth-tools-submit.ts re-exports it unchanged.

import { postGrowthTools, type GrowthToolsError } from './growth-tools-transport'

export interface BookingSlot {
  start: string
  end: string
}

export async function fetchBookingSlots(): Promise<
  { ok: true; slots: BookingSlot[] } | { ok: false; error: GrowthToolsError }
> {
  const result = await postGrowthTools('growth-tools-book', { action: 'slots' })
  if (!result.ok) return result
  const slots =
    result.body && typeof result.body === 'object' && 'slots' in result.body
      ? (result.body as { slots?: BookingSlot[] }).slots
      : undefined
  if (!Array.isArray(slots)) return { ok: false, error: 'server' }
  return { ok: true, slots }
}

/**
 * Book a call: creates the event + Meet link and emails the invite.
 *
 * #4339 §6 — `icp`, `social_platform` and `social_handle` are required (the
 * function refuses a booking without them); `website` is optional. On a refusal
 * the function names the field, returned here as `field`.
 */
// #4339 Creators and Locals calls: one booking function for three audiences.
// Host (/schedule, `audience` absent) sends icp + social (+ venue, website,
// report_url); a Creators or Locals call sends `audience`, city and social
// (+ makes and work_url, or first_place). `time_zone` is the booker's IANA zone,
// so the team sees their local time.
export type BookCallInput = {
  start: string
  name: string
  email: string
  /** #3601 — funnel/standalone-link origin tag; renders on the calendar invite. */
  source?: string
  time_zone?: string
} & (
  | {
      audience?: undefined
      icp: string
      social_platform: string
      social_handle: string
      venue?: string
      website?: string
      report_url?: string
    }
  | {
      audience: 'creator' | 'local'
      city: string
      social_platform: string
      social_handle: string
      makes?: string
      work_url?: string
      first_place?: string
    }
)

export async function bookCall(input: BookCallInput): Promise<
  | { ok: true; event_url: string | null; meet_url: string | null; start: string }
  | { ok: false; error: GrowthToolsError; field?: string }
> {
  const result = await postGrowthTools('growth-tools-book', {
    action: 'book',
    ...input,
  })
  if (!result.ok) {
    const field =
      result.body && typeof result.body === 'object' && 'field' in result.body
        ? (result.body as { field?: unknown }).field
        : undefined
    return { ok: false, error: result.error, ...(typeof field === 'string' ? { field } : {}) }
  }
  const b = result.body as
    | { ok?: boolean; event_url?: string | null; meet_url?: string | null; start?: string }
    | null
  if (!b || b.ok !== true || typeof b.start !== 'string') {
    return { ok: false, error: 'server' }
  }
  return { ok: true, event_url: b.event_url ?? null, meet_url: b.meet_url ?? null, start: b.start }
}

