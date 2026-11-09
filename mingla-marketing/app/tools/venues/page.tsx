import { GraderExperience } from './GraderExperience'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { serializeStructuredData, toolStructuredData } from '@/lib/search/page-schema'

// #1003 [Venue Website Grader — growth tools, test cut] — server shell.
// Metadata lives here; the whole experience (intake → running → report) is a
// client state machine in GraderExperience.

export const metadata = searchRouteMetadata('/tools/venues')

export default function VenueGraderPage() {
  // #4339 round B: WebApplication + BreadcrumbList.
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(toolStructuredData('/tools/venues', 'Venue Website Grader')) }} />
      <GraderExperience />
    </>
  )
}
