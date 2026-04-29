'use client';

import { motion } from 'motion/react';
import { glassChrome } from '@/lib/tokens';
import { ZONE_LABEL, zoneUrl, type Zone } from '@/lib/zones';
import { cn } from '@/lib/cn';

type AudienceSwitcherProps = {
  /** Currently active zone. `umbrella` shows neither pill highlighted. */
  activeZone: Zone;
  /** True when running on localhost. Determines URL protocol + host. */
  isDev: boolean;
};

/**
 * Audience switcher — the navigation centerpiece.
 *
 * Two pill-shaped options (Explorers | Organisers). A sliding orange
 * "spotlight" backdrop morphs between them via Framer Motion's `layoutId`.
 * The active pill reflects the current subdomain.
 *
 * Visual reference: GlassSessionSwitcher in app-mobile (glass.chrome.switcher.*).
 */
export function AudienceSwitcher({ activeZone, isDev }: AudienceSwitcherProps): React.ReactElement {
  const pills: Array<{ zone: Exclude<Zone, 'umbrella'>; label: string }> = [
    { zone: 'explore', label: ZONE_LABEL.explore },
    { zone: 'business', label: ZONE_LABEL.business },
  ];

  const spring = {
    type: 'spring' as const,
    damping: glassChrome.motion.springDamping,
    stiffness: glassChrome.motion.springStiffness,
    mass: glassChrome.motion.springMass,
  };

  return (
    <div
      className={cn(
        'inline-flex items-center gap-mingla-sm',
        'backdrop-blur-[28px]'
      )}
      style={{
        height: glassChrome.switcher.height,
        borderRadius: glassChrome.switcher.radius,
        padding: `${glassChrome.switcher.paddingVertical}px ${glassChrome.switcher.paddingHorizontal}px`,
        background: glassChrome.tintFloor,
        border: `1px solid ${glassChrome.hairline}`,
        boxShadow: glassChrome.shadow,
      }}
    >
      {pills.map(({ zone, label }) => {
        const isActive = activeZone === zone;
        const href = zoneUrl(zone, isDev);
        return (
          <a
            key={zone}
            href={href}
            className={cn(
              'relative inline-flex items-center justify-center',
              'transition-transform duration-150 ease-out',
              'hover:scale-[1.02] active:scale-[0.96]',
              'no-underline'
            )}
            style={{
              height: glassChrome.pill.height,
              borderRadius: glassChrome.pill.radius,
              padding: `0 ${isActive ? glassChrome.pill.paddingHorizontalActive : glassChrome.pill.paddingHorizontal}px`,
              minWidth: 100,
            }}
            aria-current={isActive ? 'page' : undefined}
            aria-label={`Go to ${label} site`}
          >
            {isActive && (
              <motion.span
                layoutId="audience-spotlight"
                transition={spring}
                className="absolute inset-0 -z-0"
                style={{
                  borderRadius: glassChrome.pill.radius,
                  background: glassChrome.active.tint,
                  border: `1px solid ${glassChrome.active.border}`,
                  boxShadow: `0 0 ${glassChrome.active.glowRadius}px ${glassChrome.active.glowColor}`,
                  opacity: 1,
                }}
              />
            )}
            <span
              className="relative z-10 font-medium"
              style={{
                fontSize: 14,
                color: isActive ? glassChrome.active.labelColor : glassChrome.inactive.labelColor,
                fontFamily: 'var(--font-inter)',
              }}
            >
              {label}
            </span>
          </a>
        );
      })}
    </div>
  );
}
