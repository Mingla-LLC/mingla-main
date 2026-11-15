// ORCH-1317 → #4318 → #4339 — usemingla.com/links, the single link in Mingla's
// social bios: the Explore and Host banners, then the Admin Links strips in
// Admin order, then the socials.
//
// A thin SERVER Component. It owns the SEO metadata (public, noindex), reads
// the live Admin strips through lib/links-data.ts (cached 5 minutes), and hands
// plain data to the client <LinksExperience/>. There is no city section: the
// city week, the city list and the places reads were subtracted (#4339).
//
// ORCH-1399 — `?src=` is UNTRUSTED INPUT that reaches an OUTBOUND URL. It is
// sanitised HERE, once, at the boundary (sanitizeLinksSrc), and passed down as
// a page-level prop so every tap on the page carries the same bio pid.

import { LinksExperience } from '@/components/marketing/links-experience'
import { getLinksStrips } from '@/lib/links-data'
import { sanitizeLinksSrc } from '@/lib/links-src'
import { normalisePins, pinLive } from '@/lib/links-week'
import { publicNoindexMetadata } from '@/lib/search/metadata'
import { linksSans, linksMono, linksSerif } from './fonts'

export const metadata = publicNoindexMetadata('/links', {
  title: 'Mingla · Links',
  description: 'Get Mingla to explore your city, or Mingla Host to put on your own. The latest from Mingla, each a tap away.',
})

export default async function LinksPage({ searchParams }: { searchParams: Promise<{ src?: string | string[] }> }) {
  const { src } = await searchParams
  const strips = await getLinksStrips()
  const nowIso = new Date().toISOString()
  const pins = normalisePins(strips).filter((pin) => pinLive(pin, nowIso))

  return (
    <div className={`${linksSerif.variable} ${linksSans.variable} ${linksMono.variable}`}>
      <LinksExperience src={sanitizeLinksSrc(src)} nowIso={nowIso} pins={pins} />
    </div>
  )
}
