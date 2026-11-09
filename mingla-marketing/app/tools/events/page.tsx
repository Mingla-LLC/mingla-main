import { EventPredictorExperience } from './EventPredictorExperience'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { serializeStructuredData, toolStructuredData } from '@/lib/search/page-schema'

// #1004 [Event Turnout Predictor] — server shell. Metadata lives here; the whole
// experience (intake → running → report) is a client state machine.

export const metadata = searchRouteMetadata('/tools/events')

export default function EventPredictorPage() {
  // #4339 round B: WebApplication + BreadcrumbList.
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(toolStructuredData('/tools/events', 'Event Turnout Predictor')) }} />
      <EventPredictorExperience />
    </>
  )
}
