// #4339 Creators and Locals calls — Book a call with the Mingla Creators team.
// The /schedule booking flow with audience "creator" (app/schedule/
// ProgramCallPage.tsx). Noindex like /schedule.

import { ProgramCallPage } from '../ProgramCallPage'
import { publicNoindexMetadata } from '@/lib/search/metadata'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

export const metadata = publicNoindexMetadata('/schedule/creators', {
  title: 'Talk to the Mingla Creators team',
  description: 'Book 20 minutes with the people who run Mingla Creators. You’ll get a calendar invite with a video link.',
})

export default function CreatorCallPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <ProgramCallPage audience="creator" />
    </div>
  )
}
