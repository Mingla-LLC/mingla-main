import type { Metadata } from 'next'
import { GraderExperience } from './GraderExperience'

// #1003 [Venue Website Grader — growth tools, test cut] — server shell.
// Metadata lives here; the whole experience (intake → running → report) is a
// client state machine in GraderExperience.

export const metadata: Metadata = {
  title: 'Venue Website Grader — free AI website report',
  description:
    'Your website is costing you customers. See exactly how — free, in 60 seconds. For restaurants, bars, cafés, clubs and activity spaces. Built by Mingla.',
}

export default function VenueGraderPage() {
  return <GraderExperience />
}
