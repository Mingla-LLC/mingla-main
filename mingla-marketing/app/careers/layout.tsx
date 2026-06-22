// META-ORCH-1222 [Careers site] — careers chrome (DESIGN §1). Reached ONLY via
// the host-based middleware rewrite (career.usemingla.com → /careers/*). The
// `.careers-root` class scopes the careers tokens (globals.css) so nothing here
// touches usemingla.com. Fonts (Mochiy/Nunito/Inter) are loaded by the root
// layout's <html> and inherited here — no new font load.
//
// Light-only by design (DESIGN §0). The header is a dedicated lightweight glass
// nav (NOT the product GlassNav). Web-only — no RN surface.

import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { CareersHeader } from './_components/careers-header'

export const metadata: Metadata = {
  title: { default: 'Careers — Mingla', template: '%s — Mingla Careers' },
  description:
    "Build Mingla with us. Open roles on a small, fast team making it easier to find something to do — in the US and Nigeria.",
  metadataBase: new URL('https://career.usemingla.com'),
}

const SOCIAL_LINKS = [
  { href: 'https://www.instagram.com/usemingla', label: 'Instagram' },
  { href: 'https://www.tiktok.com/@usemingla', label: 'TikTok' },
  { href: 'https://x.com/usemingla', label: 'X' },
  { href: 'https://www.facebook.com/usemingla', label: 'Facebook' },
  { href: 'https://www.threads.net/@usemingla', label: 'Threads' },
]

export default function CareersLayout({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear()
  return (
    <div
      className="careers-root flex min-h-screen flex-col"
      style={{ background: 'var(--page-bg)', color: 'var(--ink)' }}
    >
      <CareersHeader />

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer
        style={{ background: 'var(--page-bg)', borderTop: '1px solid var(--border)' }}
      >
        <div className="mx-auto w-full max-w-[1120px] px-5 py-12 sm:px-6">
          <Image
            src="/brand/mingla-wordmark.svg"
            alt="Mingla"
            width={100}
            height={28}
            className="h-7 w-auto"
          />
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
