import Link from 'next/link'
import { SMS_TERMS_SECTIONS, SMS_TERMS_EFFECTIVE_DATE } from '@/lib/smsTermsContent'
import { publicNoindexMetadata } from '@/lib/search/metadata'
import { LegalShell } from '@/components/site/legal-shell'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

export const metadata = publicNoindexMetadata('/sms-terms', {
  title: 'SMS Terms',
  description:
    'Mingla’s SMS messaging program terms — message types, frequency, rates, and how to reply STOP to opt out or HELP for help.',
})

export default function SmsTermsPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <LegalShell current="sms">
        <p className="doc-meta">Effective Date: {SMS_TERMS_EFFECTIVE_DATE}</p>
        <h1>SMS Terms</h1>
        <p>
          By providing your phone number to Mingla, you agree to the terms of our SMS messaging program described below.
          Reply <span>STOP</span> to any text to opt out, or <span>HELP</span> for help.
        </p>

        <div>
          {SMS_TERMS_SECTIONS.map((section) => {
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
                      <p>{section.contact.address}</p>
                      <p>
                        Email: <a href={`mailto:${section.contact.email}`}>{section.contact.email}</a>
                      </p>
                      <p>
                        Phone:{' '}
                        <a href={`tel:${section.contact.phone.replace(/[^+\d]/g, '')}`}>{section.contact.phone}</a>
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

        <div className="legal-links">
          <Link className="btn soft sm" href="/terms-of-service">
            Terms of Service
          </Link>
          <Link className="btn soft sm" href="/privacy-policy">
            Privacy Policy
          </Link>
          <Link className="btn soft sm" href="/unsubscribe">
            Unsubscribe / manage messages
          </Link>
        </div>
      </LegalShell>
    </div>
  )
}
