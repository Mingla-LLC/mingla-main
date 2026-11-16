// #4452 §2.8 / SC-116 — in-form booking after a submission. The booking is
// built from the answers the person just sent (name, email, phone, city,
// social), so nothing is retyped; the server ties it to the submission
// (form_submission_id, same email only) and fires no second Lead. Pure.

export interface BookingBasics {
  audience: 'creator' | 'local'
  name: string
  email: string
  phone: { dial: string; number: string } | string
  city: string
  social_platform: string
  social_handle: string
  makes?: string
}

type Field = { key: string; type: string; label?: string; options?: string[]; source?: string }

/**
 * The basics for a Creators or Locals call, or null when the form did not ask
 * for something the booking needs (then the screen links to /schedule/<audience>).
 * Host calls need the venue and its ICP, so they always book on /schedule.
 */
export function bookingFromAnswers(fields: Field[], answers: Record<string, unknown>, audience: 'host' | 'creator' | 'local'): BookingBasics | null {
  if (audience === 'host') return null
  const of = (type: string) => fields.find((f) => f.type === type)
  const name = typeof answers[of('name')?.key ?? ''] === 'string' ? String(answers[of('name')!.key]).trim() : ''
  const email = typeof answers[of('email')?.key ?? ''] === 'string' ? String(answers[of('email')!.key]).trim().toLowerCase() : ''
  const phoneRaw = answers[of('phone')?.key ?? '']
  const phone = phoneRaw && typeof phoneRaw === 'object' && typeof (phoneRaw as { dial?: unknown }).dial === 'string'
    ? { dial: (phoneRaw as { dial: string }).dial, number: String((phoneRaw as { number?: unknown }).number ?? '') }
    : null
  const cityField = fields.find((f) => f.type === 'dropdown' && (f.source === 'google_city' || /city/i.test(f.key)))
  const cityRaw = cityField ? answers[cityField.key] : null
  const city = typeof cityRaw === 'string' ? cityRaw
    : cityRaw && typeof cityRaw === 'object' ? String((cityRaw as { city?: unknown; label?: unknown }).city ?? (cityRaw as { label?: unknown }).label ?? '') : ''
  const socialRaw = answers[of('social')?.key ?? '']
  const social = socialRaw && typeof socialRaw === 'object' ? socialRaw as { platform?: unknown; value?: unknown } : null
  const platform = typeof social?.platform === 'string' ? social.platform : ''
  const handle = typeof social?.value === 'string' ? social.value.trim() : ''
  if (name.length < 2 || !email.includes('@') || !phone || city.trim().length < 2 || !platform || !handle) return null
  const makesField = fields.find((f) => f.type === 'single' && /make/i.test(f.key))
  const makes = makesField && typeof answers[makesField.key] === 'string' ? String(answers[makesField.key]).toLowerCase() : undefined
  return { audience, name, email, phone, city: city.trim().slice(0, 120), social_platform: platform, social_handle: handle, ...(makes ? { makes } : {}) }
}

export interface Slot { start: string; end: string }

/** Slots grouped by the person's local day, in order. */
export function slotsByDay(slots: Slot[], timeZone?: string): Array<{ day: string; label: string; slots: Slot[] }> {
  const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const fmtLabel = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' })
  const out = new Map<string, { day: string; label: string; slots: Slot[] }>()
  for (const s of [...slots].sort((a, b) => a.start.localeCompare(b.start))) {
    const d = new Date(s.start)
    if (Number.isNaN(d.getTime())) continue
    const key = fmtKey.format(d)
    if (!out.has(key)) out.set(key, { day: key, label: fmtLabel.format(d), slots: [] })
    out.get(key)!.slots.push(s)
  }
  return [...out.values()]
}

export function timeLabel(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

/** "<Day DD Mon> at <HH:MM>" for the booked screen. */
export function bookedLine(iso: string, timeZone?: string): string {
  const d = new Date(iso)
  return `${new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: '2-digit', month: 'short' }).format(d)} at ${timeLabel(iso, timeZone)}`
}

export const TEAM_WORDS: Record<'host' | 'creator' | 'local', string> = { host: 'Mingla', creator: 'Creators', local: 'Locals' }
export const SLOT_TAKEN = 'That time was just taken. Pick another.'
export const calendarDown = (audience: 'host' | 'creator' | 'local') =>
  `We couldn't reach the calendar. Try again, or book at /schedule${audience === 'host' ? '' : audience === 'creator' ? '/creators' : '/locals'}.`

/** In-memory hand-off from a form page to its thanks page (never stored, never in the URL). */
let HANDOFF: { basics: BookingBasics | null; submissionId: string; first: string | null; audience: 'host' | 'creator' | 'local'; booked?: string } | null = null
export function setBookingHandoff(v: typeof HANDOFF): void { HANDOFF = v }
export function bookingHandoff(): typeof HANDOFF { return HANDOFF }
