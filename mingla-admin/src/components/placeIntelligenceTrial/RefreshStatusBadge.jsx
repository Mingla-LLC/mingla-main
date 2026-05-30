/**
 * RefreshStatusBadge — ORCH-1014 Finding B (JSX renderer)
 *
 * Thin renderer around getRefreshStatusContent (pure JS, unit-tested
 * separately in __tests__/orch1014_refresh_status_badge.test.js). Read-only:
 * no CTA, no button, no link. Dark + light mode both use Tailwind v4
 * var(--color-…) tokens so the component inherits the active scheme.
 *
 * SPEC §3 B.3 contracts live in seedRefreshBadgeContent.js.
 */

import { getRefreshStatusContent } from "./seedRefreshBadgeContent";

export function RefreshStatusBadge({
  missingFieldsCount = 0,
  staleRefreshCount = 0,
}) {
  const c = getRefreshStatusContent({ missingFieldsCount, staleRefreshCount });
  return (
    <div
      className="text-xs"
      data-testid="refresh-status-badge"
      data-state={c.state}
    >
      <div
        className="font-medium"
        style={{ color: c.primaryColorVar }}
        title={c.tooltip}
      >
        {c.primaryText}
      </div>
      {c.subText && (
        <div
          className="mt-0.5"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          {c.subText}
        </div>
      )}
    </div>
  );
}

export default RefreshStatusBadge;
