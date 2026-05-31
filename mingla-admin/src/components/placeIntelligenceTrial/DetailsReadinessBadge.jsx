/**
 * DetailsReadinessBadge — ORCH-1015 Finding A (JSX renderer)
 *
 * Thin renderer around detailsStatus() from readinessBadgeContent.js. Same
 * read-only contract as BoundaryReadinessBadge.
 *
 * SPEC §3 A.2.
 */

import { detailsStatus } from "./readinessBadgeContent";

export function DetailsReadinessBadge({ refreshed, needs_refresh_count }) {
  const c = detailsStatus({ refreshed, needs_refresh_count });
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      data-testid="details-readiness-badge"
      data-state={c.state}
      style={{ backgroundColor: c.bgVar, color: c.fgVar }}
      title={c.tooltip}
    >
      {c.label}
    </span>
  );
}

export default DetailsReadinessBadge;
