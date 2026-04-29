import { AudienceSwitcher } from './AudienceSwitcher';
import type { Zone } from '@/lib/zones';
import { cn } from '@/lib/cn';

type NavProps = {
  activeZone: Zone;
  isDev: boolean;
};

/**
 * Top navigation — present on every zone.
 *
 * Left: Mingla wordmark (Phase 2 will swap to the proper SVG logo with the
 * two-pretzel/people glyph above the "a"). For now, an editorial-serif text mark.
 * Right: AudienceSwitcher (fluid morph between Explorers ↔ Organisers).
 *
 * Floats above the canvas with no background — the page underneath is dark
 * so the chrome reads naturally. Glass treatment lives in the switcher itself.
 */
export function Nav({ activeZone, isDev }: NavProps): React.ReactElement {
  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full',
        'flex items-center justify-between',
        'px-mingla-md sm:px-mingla-lg py-mingla-md',
        'pointer-events-none'
      )}
    >
      <a
        href={isDev ? 'http://localhost:3000' : 'https://usemingla.com'}
        className={cn(
          'pointer-events-auto inline-flex items-center gap-2',
          'no-underline'
        )}
        aria-label="Mingla home"
      >
        <span
          style={{
            fontFamily: 'var(--font-fraunces)',
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'var(--mingla-text-inverse)',
          }}
        >
          mingla
        </span>
      </a>

      <div className="pointer-events-auto">
        <AudienceSwitcher activeZone={activeZone} isDev={isDev} />
      </div>
    </header>
  );
}
