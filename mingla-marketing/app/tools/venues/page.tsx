import { GraderExperience } from './GraderExperience'
import { searchRouteMetadata } from '@/lib/search/metadata'

// #1003 [Venue Website Grader — growth tools, test cut] — server shell.
// Metadata lives here; the whole experience (intake → running → report) is a
// client state machine in GraderExperience.

export const metadata = searchRouteMetadata('/tools/venues')

export default function VenueGraderPage() {
  return <GraderExperience />
}
