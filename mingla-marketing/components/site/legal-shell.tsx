import type { ReactNode } from 'react'
import Link from 'next/link'
import { SitePage } from './site-page'

// #4339 phase 2b — the legal reading layout (design: "The fine print."): the
// site nav, a document switcher (the six documents, the current one marked),
// the document on a white sheet (Instrument Serif title, Geist body) and the
// canonical footer.
//
// THE WORDS DO NOT CHANGE. Each legal page renders its own text exactly as
// before, inside <article data-legal-doc>; only the frame and the type around
// it are new. lib/__tests__/issue-4339-pages.implementor.test.mjs hashes the
// article text of every built document against its pre-redesign hash.

export type LegalDoc = 'privacy' | 'terms' | 'organiser' | 'sms' | 'creator' | 'local'

export const LEGAL_DOCS: readonly { key: LegalDoc; href: string; label: string }[] = [
  { key: 'privacy', href: '/privacy-policy', label: 'Privacy policy' },
  { key: 'terms', href: '/terms-of-service', label: 'Terms of service' },
  { key: 'organiser', href: '/organiser-terms', label: 'Organiser terms' },
  { key: 'sms', href: '/sms-terms', label: 'SMS terms' },
  { key: 'creator', href: '/creator-agreement', label: 'Creator agreement' },
  { key: 'local', href: '/local-agreement', label: 'Local agreement' },
]

interface LegalShellProps {
  current: LegalDoc
  /** The document itself: its own metadata line, h1 and text. */
  children: ReactNode
}

export function LegalShell({ current, children }: LegalShellProps) {
  return (
    // #4339 (Seth): only the Organiser terms are a Host page; Creators sign up
    // in Explorer, so the Creator agreement sits on the Explorer surface.
    <SitePage surface={current === 'organiser' ? 'host' : 'explorer'}>
      <section className="page-hero legal-hero" aria-hidden="true">
        <div className="wrap">
          <p className="legal-kicker">
            The <em>fine print.</em>
          </p>
        </div>
      </section>
      <section className="pb-100">
        <div className="wrap legal">
          <nav className="legal-nav" aria-label="Legal documents">
            <ul>
              {LEGAL_DOCS.map((doc) => (
                <li key={doc.key}>
                  <Link href={doc.href} aria-current={doc.key === current ? 'page' : undefined}>
                    {doc.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <article className="doc" data-legal-doc={current}>
            {children}
          </article>
        </div>
      </section>
    </SitePage>
  )
}
