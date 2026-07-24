import type { Metadata } from 'next'
import { PricingAuditExperience } from './PricingAuditExperience'

// #1006 [The Undercharging Audit] — server shell. Metadata lives here; the whole
// experience (intake → running → report) is a client state machine.

export const metadata: Metadata = {
  title: 'The Undercharging Audit — free AI pricing report for experience hosts',
  description:
    'Priced by guilt? Find out what your experience should actually cost. A free AI pricing audit for supper clubs, workshops, classes and run clubs — your true cost per head including your own time, what comparable experiences charge, and the price you should be charging. Built by Mingla.',
}

export default function PricingAuditPage() {
  return <PricingAuditExperience />
}
