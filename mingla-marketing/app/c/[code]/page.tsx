import { headers } from 'next/headers'
import { publicNoindexMetadata } from '@/lib/search/metadata'
import { resolvePlatformFromUa } from '@/lib/device-platform'
import { ClaimLinkClient } from './ClaimLinkClient'

export const dynamic = 'force-dynamic'

export const metadata = publicNoindexMetadata('/c', {
  title: 'Open your Mingla purchase',
  description: 'Open your ticket, pass, booking or receipt in Mingla.',
})

export default async function ClaimLinkPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const [{ code }, requestHeaders] = await Promise.all([params, headers()])
  const detected = resolvePlatformFromUa(requestHeaders.get('user-agent') ?? '')
  const platform = detected === 'other' ? 'desktop' : detected
  return <ClaimLinkClient code={code} platform={platform} />
}
