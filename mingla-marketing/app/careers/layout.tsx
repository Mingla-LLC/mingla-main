// META-ORCH-1222 [Careers site] — reached ONLY via the host-based middleware
// rewrite (career.usemingla.com → /careers/*). The `.careers-root` class scopes
// the careers tokens (globals.css) so nothing here touches usemingla.com.
//
// #4339 phase 2b — the careers index (app/careers/page.tsx) is redesigned and
// brings the site nav and the canonical footer, with every link absolute on
// usemingla.com. The role and apply pages keep the careers header and footer
// through app/careers/roles/layout.tsx.

import type { Metadata } from 'next'
import { CAREERS_DEFAULT_TITLE, CAREERS_TITLE_TEMPLATE } from '@/lib/careers-seo'

// #4339 round B: ONE title template for the careers host ("<page> | Mingla
// Careers"); the index has its own absolute title, never a doubled brand.
export const metadata: Metadata = {
  title: { default: CAREERS_DEFAULT_TITLE, template: CAREERS_TITLE_TEMPLATE },
  description:
    "Build Mingla with us. Open roles on a small, fast team making it easier to find something to do — in the US and Nigeria.",
  metadataBase: new URL('https://career.usemingla.com'),
}

export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="careers-root flex min-h-screen flex-col" style={{ background: 'var(--page-bg)', color: 'var(--ink)' }}>
      {children}
    </div>
  )
}
