import type { Metadata } from 'next'
import { TripQuoterExperience } from './TripQuoterExperience'

// #1005 [Quote Any Trip] — server shell. Metadata lives here; the whole
// experience (intake → running → report) is a client state machine.

export const metadata: Metadata = {
  title: 'Quote Any Trip — free AI costed itinerary & price for travel organisers',
  description:
    'Describe a trip and get a fully-costed, client-ready quote in a minute — real named hotels and activities with current rate estimates, a line-item cost sheet, and exactly what to charge per person to hit your margin. For travel organisers. Built by Mingla.',
}

export default function TripQuoterPage() {
  return <TripQuoterExperience />
}
