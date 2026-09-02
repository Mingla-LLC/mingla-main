import type { HostGuideKind } from '@/content/page-system/shared'
import { EventPredictorExperience } from '@/app/tools/events/EventPredictorExperience'
import { TripQuoterExperience } from '@/app/tools/trips/TripQuoterExperience'
import { GraderExperience } from '@/app/tools/venues/GraderExperience'
import { PricingAuditExperience } from '@/app/tools/pricing/PricingAuditExperience'

export function GrowthToolEmbed({ tool }: { readonly tool: HostGuideKind }) {
  if (tool === 'event') return <EventPredictorExperience embedded />
  if (tool === 'trip') return <TripQuoterExperience embedded />
  if (tool === 'venue') return <GraderExperience embedded />
  return <PricingAuditExperience embedded />
}

