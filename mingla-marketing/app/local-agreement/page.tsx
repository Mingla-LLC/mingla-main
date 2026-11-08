import Link from 'next/link'
import type { Metadata } from 'next'
import { searchRouteMetadata } from '@/lib/search/metadata'
import type { ReactNode } from 'react'
import {
  LOCAL_AGREEMENT_SHA256,
  LOCAL_AGREEMENT_SECTIONS,
  LOCAL_AGREEMENT_STATUS,
  LOCAL_AGREEMENT_VERSION,
  localAgreementHeading,
} from '@/lib/localAgreementContent'
import { LegalShell } from '@/components/site/legal-shell'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 round B: registered in lib/search/route-registry.ts (canonical, sitemap).
export const metadata: Metadata = {
  ...searchRouteMetadata('/local-agreement'),
  robots: { index: true, follow: true },
}

function inline(text: string): ReactNode[] {
  return text.split('**').map((part, index) =>
    index % 2 === 1 ? (
      <strong key={index} className="font-semibold text-white">
        {part}
      </strong>
    ) : (
      part
    ),
  )
}

export default function LocalAgreementPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <LegalShell current="local">
        <p className="doc-meta">
          {LOCAL_AGREEMENT_STATUS} · Version {LOCAL_AGREEMENT_VERSION}
        </p>
        <h1>Mingla Local Agreement</h1>
        <p>Nigeria programme · UseMingla Limited · Read every section before accepting in Mingla Explorer.</p>
        <p className="fine">Agreement fingerprint: {LOCAL_AGREEMENT_SHA256}</p>

        <nav className="doc-box" aria-labelledby="local-agreement-contents">
          <h2 id="local-agreement-contents">Contents</h2>
          <ol>
            {LOCAL_AGREEMENT_SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{localAgreementHeading(section)}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div>
          {LOCAL_AGREEMENT_SECTIONS.map((section) => (
            <section key={section.id} id={section.id}>
              <h2>{localAgreementHeading(section)}</h2>
              <div>
                {section.blocks.map((block, index) =>
                  block.type === 'list' ? (
                    <ul key={index}>
                      {block.items.map((item) => (
                        <li key={item}>{inline(item)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p key={index}>
                      {block.lead ? (
                        <>
                          <strong>{block.lead}</strong>{' '}
                        </>
                      ) : null}
                      {inline(block.text)}
                    </p>
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
