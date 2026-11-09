import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  ORGANISER_TERMS_COMPANIES,
  ORGANISER_TERMS_LAST_UPDATED,
  ORGANISER_TERMS_SECTIONS,
  ORGANISER_TERMS_VERSION,
  organiserTermsHeading,
} from '@/lib/organiserTermsContent'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { LegalShell } from '@/components/site/legal-shell'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #3645 — search_ready since legal review cleared it (4 Oct 2026): the title,
// description, self-canonical and index robots come from the route registry.
export const metadata = searchRouteMetadata('/organiser-terms')

// The content module's only markup is `**bold**`.
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

export default function OrganiserTermsPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <LegalShell current="organiser">
        <p className="doc-meta">
          Last updated {ORGANISER_TERMS_LAST_UPDATED} · Version {ORGANISER_TERMS_VERSION}
        </p>
        <h1>Organiser Terms</h1>
        <p>
          For anyone who lists, sells, messages or advertises with Mingla Host. They sit on top of our{' '}
          <Link href="/terms-of-service">Terms of Service</Link> and <Link href="/privacy-policy">Privacy Policy</Link>.
        </p>

        <section className="doc-box" aria-labelledby="which-company">
          <h2 id="which-company">Which company am I agreeing with?</h2>
          <div className="doc-grid">
            {ORGANISER_TERMS_COMPANIES.map((company) => (
              <div key={company.name}>
                <p className="who">{company.who}</p>
                <p>{company.name}</p>
                {company.registration ? <p>{company.registration}.</p> : null}
                <p>{company.address}</p>
                <p>{company.law}</p>
              </div>
            ))}
          </div>
          <p>
            Details in <a href="#section-1">section 1</a>.
          </p>
        </section>

        <nav className="doc-box" aria-labelledby="contents">
          <h2 id="contents">Contents</h2>
          <ol>
            {ORGANISER_TERMS_SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{organiserTermsHeading(section)}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div>
          {ORGANISER_TERMS_SECTIONS.map((section) => (
            <section key={section.id} id={section.id}>
              <h2>{organiserTermsHeading(section)}</h2>
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
      </LegalShell>
    </div>
  )
}
