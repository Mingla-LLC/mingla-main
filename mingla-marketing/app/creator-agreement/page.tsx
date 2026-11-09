import Link from 'next/link'
import type { Metadata } from 'next'
import { searchRouteMetadata } from '@/lib/search/metadata'
import {
  CREATOR_AGREEMENT_SECTIONS,
  CREATOR_AGREEMENT_SHA256,
  CREATOR_AGREEMENT_STATUS,
  CREATOR_AGREEMENT_VERSION,
  creatorAgreementHeading,
} from '@/lib/creatorAgreementContent'
import { LegalShell } from '@/components/site/legal-shell'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 round B: registered in lib/search/route-registry.ts (canonical, sitemap).
export const metadata: Metadata = {
  ...searchRouteMetadata('/creator-agreement'),
  robots: { index: true, follow: true },
}

export default function CreatorAgreementPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <LegalShell current="creator">
        <p className="doc-meta">
          {CREATOR_AGREEMENT_STATUS} · Version {CREATOR_AGREEMENT_VERSION}
        </p>
        <h1>Mingla Creator Program Agreement</h1>
        <p>Read every section before accepting in Mingla Explorer.</p>
        <p className="fine">Agreement fingerprint: {CREATOR_AGREEMENT_SHA256}</p>
        <nav className="doc-box" aria-labelledby="creator-agreement-contents">
          <h2 id="creator-agreement-contents">Contents</h2>
          <ol>
            {CREATOR_AGREEMENT_SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{creatorAgreementHeading(section)}</a>
              </li>
            ))}
          </ol>
        </nav>
        <div>
          {CREATOR_AGREEMENT_SECTIONS.map((section) => (
            <section key={section.id} id={section.id}>
              <h2>{creatorAgreementHeading(section)}</h2>
              <div>
                {section.blocks.map((block, index) =>
                  block.type === 'list' ? (
                    <ul key={index}>
                      {block.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p key={index}>{block.text}</p>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
        <footer className="doc-foot">
          This page adds to Mingla’s <Link href="/terms-of-service">Terms of Service</Link> and{' '}
          <Link href="/privacy-policy">Privacy Policy</Link>. Questions:{' '}
          <a href="mailto:legal@usemingla.com">legal@usemingla.com</a>.
        </footer>
      </LegalShell>
    </div>
  )
}
