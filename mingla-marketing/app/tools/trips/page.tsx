import { TripQuoterExperience } from './TripQuoterExperience'
import { searchRouteMetadata } from '@/lib/search/metadata'

// #1005 [Quote Any Trip] — server shell. Metadata lives here; the whole
// experience (intake → running → report) is a client state machine.

export const metadata = searchRouteMetadata('/tools/trips')

export default function TripQuoterPage() {
  return <TripQuoterExperience />
}
