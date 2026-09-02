import { EventPredictorExperience } from './EventPredictorExperience'
import { searchRouteMetadata } from '@/lib/search/metadata'

// #1004 [Event Turnout Predictor] — server shell. Metadata lives here; the whole
// experience (intake → running → report) is a client state machine.

export const metadata = searchRouteMetadata('/tools/events')

export default function EventPredictorPage() {
  return <EventPredictorExperience />
}
