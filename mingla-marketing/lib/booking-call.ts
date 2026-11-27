// #1086 / #4339 — Book a call: the live growth-tools-book function's slots and
// booking (Google Calendar + Meet invite, confirmation emails to both sides).
// Its own module so /schedule, /schedule/creators and /schedule/locals load
// only this and the transport, not every free tool (the first-load budget);
// lib/growth-tools-submit.ts re-exports it unchanged.

import { postGrowthTools, type GrowthToolsError } from './growth-tools-transport'
import { leadEventIdFrom, type MarketingAdContext } from './marketing-ad-context'

export interface BookingSlot {
  start: string
  end: string
}

export async function fetchBookingSlots(schedulerKey: string): Promise<
  { ok: true; slots: BookingSlot[]; durationMinutes: number } | { ok: false; error: GrowthToolsError }
> {
  const result = await postGrowthTools('growth-tools-book', { action: 'slots', scheduler_key: schedulerKey })
  if (!result.ok) return result
  const slots =
    result.body && typeof result.body === 'object' && 'slots' in result.body
      ? (result.body as { slots?: BookingSlot[] }).slots
      : undefined
  if (!Array.isArray(slots)) return { ok: false, error: 'server' }
  const duration = Number((result.body as { duration_minutes?: unknown })?.duration_minutes)
  return { ok: true, slots, durationMinutes: Number.isInteger(duration) && duration > 0 ? duration : 20 }
}

export interface BookingHandoffPayload {
  audience?: 'host' | 'creator' | 'local'
  name?: string
  email?: string
  phone?: string
  icp?: string
  social_platform?: string
  social_handle?: string
  venue?: string
  website?: string
  city?: string
  makes?: string
  first_place?: string
}

export async function fetchBookingHandoff(handoffToken: string, schedulerKey: string): Promise<
  { ok: true; payload: BookingHandoffPayload; schedulerKey: string } | { ok: false; error: GrowthToolsError }
> {
  const result = await postGrowthTools('growth-tools-book', { action: 'handoff', handoff_token: handoffToken, scheduler_key: schedulerKey })
  if (!result.ok) return result
  const body = result.body as { payload?: unknown; scheduler?: { key?: unknown } } | null
  if (!body?.payload || typeof body.payload !== 'object' || Array.isArray(body.payload) || typeof body.scheduler?.key !== 'string') return { ok: false, error: 'server' }
  return { ok: true, payload: body.payload as BookingHandoffPayload, schedulerKey: body.scheduler.key }
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
      /**
       * #4571 W4 — the host card's scheduler token (`/schedule?for=<token>`), so
       * the booking links itself to that card in Admin. Only a UUID is sent
       * (scheduleTokenFrom); the booker is never told either way.
       */
      for?: string
      /**
       * #4238 W3-3 — the page's ad context (lib/marketing-ad-context.ts). A
       * Host call only: the server records the host lead and answers its
       * `lead_event_id` for the browser Lead twin.
       */
      ad?: MarketingAdContext
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

/** #4452 §4.6 / A1: phone, UTM, the form link, the ads context and the optional consent box, for every audience. */
export interface BookCallExtras {
  phone: string
  utm?: Record<string, string>
  form_submission_id?: string
  marketing_consent?: boolean
  consent_text?: string
  ad?: MarketingAdContext
  scheduler_key?: string
  handoff_token?: string
}

const SCHEDULE_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** #4571 W4 — the `for` token from the page URL when it is a UUID, else undefined. */
export function scheduleTokenFrom(value: string | null | undefined): string | undefined {
  const v = typeof value === 'string' ? value.trim() : ''
  return SCHEDULE_TOKEN_RE.test(v) ? v.toLowerCase() : undefined
}

export async function bookCall(input: BookCallInput & BookCallExtras): Promise<
  | {
      ok: true
      event_url: string | null
      meet_url: string | null
      start: string
      /** #4238 W3-3 — `lead:<id>` when the server recorded a host lead, else null. */
      lead_event_id: string | null
      /** #4452: `<label>_call:<id>` when the server recorded the booked call. */
      goal_event_id: string | null
    }
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
  return {
    ok: true,
    event_url: b.event_url ?? null,
    meet_url: b.meet_url ?? null,
    start: b.start,
    lead_event_id: leadEventIdFrom(b),
    goal_event_id: typeof (b as { goal_event_id?: unknown }).goal_event_id === 'string'
      ? (b as { goal_event_id: string }).goal_event_id
      : null,
  }
}

