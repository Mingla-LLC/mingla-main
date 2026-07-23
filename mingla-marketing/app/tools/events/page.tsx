import type { Metadata } from 'next'
import { EventPredictorExperience } from './EventPredictorExperience'

// #1004 [Event Turnout Predictor] — server shell. Metadata lives here; the whole
// experience (intake → running → report) is a client state machine.

export const metadata: Metadata = {
  title: 'Event Turnout Predictor — free AI turnout & ad-spend forecast',
  description:
    'How many people will actually show up? Get a free AI turnout forecast — grounded in live research on your date, city and competition — and see exactly what your promo budget can buy. For event organisers and promoters. Built by Mingla.',
}

export default function EventPredictorPage() {
  return <EventPredictorExperience />
}
