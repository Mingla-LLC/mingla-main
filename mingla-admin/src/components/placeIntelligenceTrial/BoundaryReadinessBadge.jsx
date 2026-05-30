/**
 * BoundaryReadinessBadge — ORCH-1015 Finding A (JSX renderer)
 *
 * Thin renderer around boundaryStatus() from readinessBadgeContent.js (pure
 * JS, unit-tested separately). Read-only: NO button, NO link, NO CTA. Dark +
 * light mode both use Tailwind v4 var(--color-…) tokens so the component
 * inherits the active scheme. Operator acts on this signal from the Place
 * Pool page — not here.
 *
 * SPEC §3 A.1.
 */

import { boundaryStatus } from "./readinessBadgeContent";

export function BoundaryReadinessBadge({ regeocoded }) {
  const c = boundaryStatus({ regeocoded });
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      data-testid="boundary-readiness-badge"
      data-state={c.state}
      style={{ backgroundColor: c.bgVar, color: c.fgVar }}
      title={c.tooltip}
    >
      {c.label}
    </span>
  );
}

export default BoundaryReadinessBadge;
