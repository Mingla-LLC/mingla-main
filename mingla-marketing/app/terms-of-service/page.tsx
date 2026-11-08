import { TERMS_SECTIONS, TERMS_EFFECTIVE_DATE } from '@/lib/termsContent'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { LegalShell } from '@/components/site/legal-shell'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

export const metadata = searchRouteMetadata('/terms-of-service')

export default function TermsOfServicePage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <LegalShell current="terms">
        <p className="doc-meta">Effective Date: {TERMS_EFFECTIVE_DATE}</p>
        <h1>Terms of Service</h1>

        <div>
          {TERMS_SECTIONS.map((section) => {
            const hasContact = 'contact' in section

            return (
              <section key={section.title} className={hasContact ? 'doc-box' : undefined}>
                <h2>{section.title}</h2>
                <div>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {'bullets' in section ? (
                    <ul>
                      {section.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  ) : null}
                  {hasContact ? (
                    <div>
                      <p>{section.contact.name}</p>
                      <p>
                        Email: <a href={`mailto:${section.contact.email}`}>{section.contact.email}</a>
                      </p>
                      <p>
                        Website: <a href={section.contact.website}>{section.contact.website}</a>
                      </p>
                    </div>
                  ) : null}
                </div>
              </section>
            )
          })}
        </div>
      </LegalShell>
    </div>
  )
}
