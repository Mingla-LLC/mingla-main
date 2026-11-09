import { PricingAuditExperience } from './PricingAuditExperience'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { serializeStructuredData, toolStructuredData } from '@/lib/search/page-schema'

// #1006 [The Undercharging Audit] — server shell. Metadata lives here; the whole
// experience (intake → running → report) is a client state machine.

export const metadata = searchRouteMetadata('/tools/pricing')

export default function PricingAuditPage() {
  // #4339 round B: WebApplication + BreadcrumbList.
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(toolStructuredData('/tools/pricing', 'The Undercharging Audit')) }} />
      <PricingAuditExperience />
    </>
  )
}
