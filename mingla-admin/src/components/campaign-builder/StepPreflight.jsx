/**
 * ISSUE-864 WP4 — Step 0: Preflight / Channel health (SPEC A4.a, blueprint
 * §1.0). One row per (platform, lane) from admin-ad-preflight: "if I launch
 * right now, will an ad actually run?" Per-channel Recheck + Recheck all.
 * Hard blockers exclude the channel; ambers annotate but never block the
 * BUILD ("Continue anyway (build paused)" — everything is created PAUSED).
 */

import { RefreshCw } from "lucide-react";
import { AlertCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { PLATFORM_LABELS, CREATE_WIRED, CREATE_GAP_REASONS } from "../../lib/adBuilder/channelPlan";

const OVERALL_BADGE = { green: "success", amber: "warning", red: "error", not_connected: "default" };
const CHECK_BADGE = { pass: "success", warn: "warning", fail: "error", "n/a": "default" };

export function StepPreflight({ rows, running, recheckBusy, onRecheck, onRecheckAll }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Channel health</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            If we launch right now, will an ad actually run? Red blockers exclude a channel;
            amber warnings don't stop the build — everything is created paused.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} loading={running} onClick={onRecheckAll}>
          Recheck all
        </Button>
      </div>

      {running && !rows && (
        <div className="flex items-center gap-2 py-6"><Spinner size="sm" /> Probing channels…</div>
      )}

      {!running && !rows && (
        <AlertCard variant="error" title="Preflight didn't run">
          We couldn't probe the channels. Hit "Recheck all" — the builder fail-closes until
          at least one channel reports healthy.
        </AlertCard>
      )}

      {rows && (
        <div className="space-y-3">
          {rows.map((row) => {
            const createWired = CREATE_WIRED.includes(row.platform);
            return (
              <div key={row.platform} className="border border-[var(--gray-200)] rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Badge variant={OVERALL_BADGE[row.overall] ?? "default"} dot>
                    {PLATFORM_LABELS[row.platform] ?? row.platform}
                  </Badge>
                  <span className="text-xs text-[var(--color-text-secondary)]">{row.overall}</span>
                  {!createWired && (
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      — {CREATE_GAP_REASONS[row.platform]}
                    </span>
                  )}
                  <span className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={RefreshCw}
                    loading={recheckBusy === row.platform}
                    onClick={() => onRecheck(row.platform)}
                  >
                    Recheck
                  </Button>
                </div>
                <ul className="space-y-1">
                  {(row.checks ?? []).map((check) => (
                    <li key={check.id} className="text-xs flex items-start gap-2">
                      <Badge variant={CHECK_BADGE[check.status] ?? "default"}>{check.id}</Badge>
                      <span>
                        <span className="font-medium">{check.label}</span>
                        {check.detail ? <> — {check.detail}</> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
