// #4452 — the page's campaign tags for forms and Book a call (its own module, so
// /schedule does not load the forms submit code just to read them).
import { isMarketingAdsOn } from '@/components/marketing/marketing-capture'
import { readLandingCampaign } from '@/lib/landing-campaign'

export function sessionUtm(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const c = readLandingCampaign(isMarketingAdsOn())
    const u = c.utm as Record<string, string | undefined>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries({ source: u.utm_source, medium: u.utm_medium, campaign: u.utm_campaign, content: u.utm_content, term: u.utm_term })) {
      if (v) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}
