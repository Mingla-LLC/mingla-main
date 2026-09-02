import { PricingAuditExperience } from './PricingAuditExperience'
import { searchRouteMetadata } from '@/lib/search/metadata'

// #1006 [The Undercharging Audit] — server shell. Metadata lives here; the whole
// experience (intake → running → report) is a client state machine.

export const metadata = searchRouteMetadata('/tools/pricing')

export default function PricingAuditPage() {
  return <PricingAuditExperience />
}
