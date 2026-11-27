// #4640 — optional, secure form-to-scheduler hydration. Keep this transport in
// its own lazy chunk: visitors who open the shared scheduler directly do not
// need handoff parsing in their first-load JavaScript.

import { postGrowthTools } from './growth-tools-transport'

interface BookingHandoffPayload {
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

export async function hydrateBookingHandoff(
  handoffToken: string,
  schedulerKey: string,
  setters: Array<(value: string) => void>,
): Promise<void> {
  const result = await postGrowthTools('growth-tools-book', { action: 'handoff', handoff_token: handoffToken, scheduler_key: schedulerKey })
  if (!result.ok) return
  const body = result.body as { payload?: unknown; scheduler?: { key?: unknown } } | null
  if (!body?.payload || typeof body.payload !== 'object' || Array.isArray(body.payload) || typeof body.scheduler?.key !== 'string') return
  const p = body.payload as BookingHandoffPayload
  const values = [p.name, p.email, p.phone, p.icp, p.social_platform, p.social_handle, p.venue, p.website, p.city, p.makes, p.first_place]
  values.forEach((value, index) => { if (typeof value === 'string') setters[index]?.(value) })
}
