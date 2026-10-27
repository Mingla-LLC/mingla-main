import type { Metadata } from 'next'
import { Suspense } from 'react'
import { EarningsClaimClient } from './EarningsClaimClient'

export const metadata: Metadata = {
  title: 'Claim referral rewards | Mingla',
  description: 'Securely claim referral rewards with the verified email that received the private link.',
  robots: { index: false, follow: false },
}

export default function ClaimEarningsPage() {
  return <Suspense fallback={null}><EarningsClaimClient /></Suspense>
}
