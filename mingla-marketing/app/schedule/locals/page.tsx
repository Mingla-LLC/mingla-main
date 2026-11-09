// #4339 Creators and Locals calls — Book a call with the Mingla Locals team.
// The /schedule booking flow with audience "local" (app/schedule/
// ProgramCallPage.tsx). Noindex like /schedule.

import { ProgramCallPage } from '../ProgramCallPage'
import { publicNoindexMetadata } from '@/lib/search/metadata'

export const metadata = publicNoindexMetadata('/schedule/locals', {
  title: 'Talk to the Mingla Locals team',
  description: 'Book 20 minutes on how the Mingla Locals monthly review works. You’ll get a calendar invite with a video link.',
})

export default function LocalCallPage() {
  return <ProgramCallPage audience="local" />
}
