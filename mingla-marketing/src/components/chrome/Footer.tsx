import { cn } from '@/lib/cn';

/**
 * Minimal footer — Phase 1 placeholder.
 *
 * Phase 5 will add: real social links, App Store / Play Store badges, locale
 * switcher (if i18n added), legal links to actual policy pages, press kit link.
 */
export function Footer(): React.ReactElement {
  const year = new Date().getFullYear();

  return (
    <footer
      className={cn(
        'w-full mt-mingla-xxl px-mingla-md sm:px-mingla-lg py-mingla-xl',
        'border-t'
      )}
      style={{ borderColor: 'rgb(255 255 255 / 0.06)' }}
    >
      <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-mingla-md">
        <div
          style={{
            fontSize: 13,
            color: 'rgb(255 255 255 / 0.55)',
          }}
        >
          © {year} Mingla. All rights reserved.
        </div>
        <nav
          aria-label="Footer navigation"
          className="flex items-center gap-mingla-lg"
          style={{ fontSize: 13 }}
        >
          {/* Phase 5 — replace `#` with real legal page routes */}
          <a href="#" className="no-underline hover:underline" style={{ color: 'rgb(255 255 255 / 0.55)' }}>
            Privacy
          </a>
          <a href="#" className="no-underline hover:underline" style={{ color: 'rgb(255 255 255 / 0.55)' }}>
            Terms
          </a>
          <a href="#" className="no-underline hover:underline" style={{ color: 'rgb(255 255 255 / 0.55)' }}>
            Press
          </a>
        </nav>
      </div>
    </footer>
  );
}
