import { HostSellingGuide } from '@/components/page-system/host-selling-guide'
import { PageSystemShell } from '@/components/page-system/page-system-shell'
import { HOST_GUIDE_FAMILY } from '@/content/page-system/host-guide-family'
import { publicNoindexMetadata } from '@/lib/search/metadata'

const CURRENT_PATH = '/internal/page-system/host-event-promoter-guide' as const
const FUTURE_PATH = '/guides/event-promotion'

export const metadata = publicNoindexMetadata('/internal/page-system/host-event-promoter-guide', {
  title: 'How to promote an event — Mingla Host',
  description: 'Three practical event-selling tips and Mingla’s working turnout predictor in one short guide.',
})

export default function HostEventPromoterGuideReviewPage() {
  return (
    <PageSystemShell currentPath={CURRENT_PATH} futurePath={FUTURE_PATH} audience="host">
      <HostSellingGuide guide={HOST_GUIDE_FAMILY.event} />
    </PageSystemShell>
  )
}
