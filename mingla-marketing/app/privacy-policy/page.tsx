import { PRIVACY_SECTIONS, PRIVACY_EFFECTIVE_DATE } from '@/lib/privacyContent'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { LegalShell } from '@/components/site/legal-shell'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

export const metadata = searchRouteMetadata('/privacy-policy')

export default function PrivacyPolicyPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <LegalShell current="privacy">
        <p className="doc-meta">Effective Date: {PRIVACY_EFFECTIVE_DATE}</p>
        <h1>Privacy Policy</h1>

        <div>
          {PRIVACY_SECTIONS.map((section) => {
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
                  {'footer' in section ? <p>{section.footer}</p> : null}
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
