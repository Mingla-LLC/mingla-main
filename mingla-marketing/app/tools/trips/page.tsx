import { TripQuoterExperience } from './TripQuoterExperience'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { serializeStructuredData, toolStructuredData } from '@/lib/search/page-schema'

// #1005 [Quote Any Trip] — server shell. Metadata lives here; the whole
// experience (intake → running → report) is a client state machine.

export const metadata = searchRouteMetadata('/tools/trips')

export default function TripQuoterPage() {
  // #4339 round B: WebApplication + BreadcrumbList.
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(toolStructuredData('/tools/trips', 'Quote Any Trip')) }} />
      <TripQuoterExperience />
    </>
  )
}
