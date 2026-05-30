/**
 * SeedStatusBadge — ORCH-1014 Finding B (JSX renderer)
 *
 * Thin renderer around getSeedStatusContent (pure JS, unit-tested separately
 * in __tests__/orch1014_seed_status_badge.test.js). Read-only: no CTA, no
 * button, no link. Dark + light mode both use Tailwind v4 var(--color-…)
 * tokens so the component inherits the active scheme.
 *
 * SPEC §3 B.3 contracts live in seedRefreshBadgeContent.js.
 */

import { getSeedStatusContent } from "./seedRefreshBadgeContent";

export function SeedStatusBadge({ firstSeededAt, lastSeededAt }) {
  const c = getSeedStatusContent({ firstSeededAt, lastSeededAt });
  return (
    <div
      className="text-xs"
      data-testid="seed-status-badge"
      data-state={c.state}
    >
      <div
        className="font-medium"
        style={{ color: c.primaryColorVar }}
        title={c.primaryTitle ?? undefined}
      >
        {c.primaryText}
      </div>
      {c.subText && (
        <div
          className="mt-0.5"
          style={{ color: "var(--color-text-tertiary)" }}
          title={c.subTitle ?? undefined}
        >
          {c.subText}
        </div>
      )}
    </div>
  );
}

export default SeedStatusBadge;
