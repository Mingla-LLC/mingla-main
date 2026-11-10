// #4339 phase 2b — the role and apply pages keep their careers chrome: this
// nested layout is the former app/careers/layout.tsx frame, moved down a level
// so the redesigned careers index (app/careers/page.tsx) can use the site nav
// and the canonical footer. The careers-root tokens and metadata stay on
// app/careers/layout.tsx. Job data and the apply flow are unchanged.
//
// META-ORCH-1222 [Careers site] — careers chrome (DESIGN §1). Reached ONLY via
// the host-based middleware rewrite (career.usemingla.com → /careers/*). The
// `.careers-root` class scopes the careers tokens (globals.css) so nothing here
// touches usemingla.com. Fonts (Mochiy/Nunito/Inter) are loaded by the root
// layout's <html> and inherited here — no new font load.
//
// Light-only by design (DESIGN §0). The header is a dedicated lightweight glass
// nav (NOT the product GlassNav). Web-only — no RN surface.

import Link from 'next/link'
import Image from 'next/image'
import { CareersHeader } from '../_components/careers-header'
import { LINKS_SOCIALS } from '@/lib/links-config'

// The approved @usemingla set, the same list /links shows (lib/links-config.ts).
// X and every @minglahost account are retired (#4318 feedback 16, #4339).
const SOCIAL_LINKS = LINKS_SOCIALS.map(({ href, label }) => ({ href, label }))

export default function CareersRolesLayout({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear()
  return (
    <div className="flex min-h-screen flex-col" style={{ background: 'var(--page-bg)', color: 'var(--ink)' }}>
      <CareersHeader />

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer
        style={{ background: 'var(--page-bg)', borderTop: '1px solid var(--border)' }}
      >
        <div className="mx-auto w-full max-w-[1120px] px-5 py-12 sm:px-6">
          {/* Every Mingla logo goes Home (#4339): the careers host's home is
              usemingla.com, the same target as the careers header logo. */}
          <a href="https://usemingla.com" aria-label="Mingla home" className="inline-block">
            <Image
              src="/brand/mingla-wordmark.svg"
              alt=""
              width={100}
              height={28}
              className="h-7 w-auto"
            />
          </a>
          <p className="mt-3 text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            Mingla — find something to do.
          </p>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {SOCIAL_LINKS.map((s) => (
              <li key={s.href}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[14px] transition-colors hover:text-[var(--coral-500)]"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            © {year} Mingla LLC ·{' '}
            <Link href="https://usemingla.com" className="hover:text-[var(--coral-500)]">
              usemingla.com
            </Link>
          </p>
        </div>
      </footer>
    </div>
  )
}
