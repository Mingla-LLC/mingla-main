import type { Metadata } from 'next'
import Link from 'next/link'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { LandingMedia } from '@/components/landing/landing-media'
import { SitePage } from '@/components/site/site-page'
import { Wordmark } from '@/components/site/wordmark'
import { CORE_PAGES } from '@/content/core-pages'
import { corePageMetadata } from '@/lib/search/metadata'
import { corePageStructuredData, serializeCorePageStructuredData } from '@/lib/search/core-page-schema'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — About, in the approved design: the centred headline, the
// wide ambient clip, the three paragraphs, and the two video text cards with
// the ink wash: "For people going out" (the Explorer hand-off, §3: a phone
// goes to the store, a computer gets the scan-to-download sheet) and "For
// places with soul" (→ /host). The SEO contract is unchanged: the record's
// metadata and its AboutPage/Breadcrumb JSON-LD.

const record = CORE_PAGES.about
export const metadata: Metadata = corePageMetadata(record)

export default function AboutPage() {
  const schema = corePageStructuredData(record)
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer">
        {schema ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeCorePageStructuredData(schema) }} /> : null}
        <section className="page-hero about-hero">
          <div className="wrap">
            <h1>
              Making real life <em>easier to find.</em>
            </h1>
            <p className="lead">
              Mingla is the app for what to do, and the operating system for the places that make a city worth going out
              in.
            </p>
          </div>
        </section>

        <section className="about-clip" aria-hidden="true">
          <div className="wrap">
            <div className="ph reveal">
              <LandingMedia media="v:amb-about" />
            </div>
          </div>
        </section>

        <section className="sec" aria-labelledby="about-why">
          <div className="wrap split about-split">
            <h2 className="h2 reveal" id="about-why">
              Good plans shouldn’t be <em>hard to find.</em>
            </h2>
            <div className="about-copy reveal">
              <p>
                The best places in a city are often the hardest to find: the class with ten spots, the gallery late night,
                the café everyone’s friend knows about. Mingla puts them where people plan.
              </p>
              <p>
                We don’t match strangers. Mingla is for couples, friends, groups and solo plans: the people you already
                have, and the plans you haven’t made yet.
              </p>
              <p>And for hosts, Mingla is the growth and operating system that helps places with soul get found and booked.</p>
            </div>
          </div>
        </section>

        <section className="sec sandbg" aria-label="Mingla and Mingla Host">
          <div className="wrap grid2">
            <ExplorerHandoffButton location="about_explorer" className="vcard text-card reveal">
              <LandingMedia media="v:ab-explorer" />
              <span className="vc-top">
                <Wordmark height={26} title="Mingla" />
              </span>
              <span className="h2">
                For people <em>going out.</em>
              </span>
              <span className="card-line">Find plans that fit the vibe. Save them, schedule them, go.</span>
            </ExplorerHandoffButton>
            <Link className="vcard text-card reveal" href="/host">
              <LandingMedia media="v:ab-host" />
              <span className="vc-top">
                <Wordmark height={26} title="Mingla Host" />
              </span>
              <span className="h2">
                For places <em>with soul.</em>
              </span>
              <span className="card-line">Get found, sell out and bring people back.</span>
            </Link>
          </div>
        </section>
      </SitePage>
    </div>
  )
}
