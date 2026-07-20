/**
 * ISSUE-864 WP4 — Step 0: Preflight / Channel health (SPEC A4.a, blueprint
 * §1.0). One row per (platform, lane) from admin-ad-preflight: "if I launch
 * right now, will an ad actually run?" Per-channel Recheck + Recheck all.
 * Hard blockers exclude the channel; ambers annotate but never block the
 * BUILD ("Continue anyway (build paused)" — everything is created PAUSED).
 *
 * ISSUE-980 [Campaign Builder clarity] finding #2: `check.detail` used to
 * render RAW engineering text verbatim — proof-tags (T-P2, S-P4), platform
 * error codes (1885183, pixel_no_signal, BALANCE_EXCEED), and internal issue
 * numbers (#865) straight to the operator (ISSUE-977 Lane B F-2). The primary
 * line now always renders `translatePreflightDetail`'s plain-English
 * `friendly` text; the raw string survives ONLY behind a collapsed
 * "Technical details" disclosure — a support affordance, never the default
 * view.
 *
 * ISSUE-986 [Campaign Builder platform picker]: the channel set is no longer
 * silently auto-derived. Each eligible channel is now a SELECTABLE toggle here
 * (default = all eligible picked) and the picked set is the single source of
 * truth for the whole build. Ineligible channels are shown but disabled WITH
 * their plain-English reason — selection can only narrow WITHIN the eligible
 * set, never force a blocked channel in. A special ad category auto-excludes
 * the platforms that can't declare it (Meta only), with a warning.
 */

import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import { AlertCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { PLATFORM_LABELS, CREATE_WIRED, CREATE_GAP_REASONS } from "../../lib/adBuilder/channelPlan";
import { translatePreflightDetail } from "../../lib/adBuilder/preflightCopy";
import { isSpecialCategoryActive, specialCategoryLabel } from "../../lib/adBuilder/compliance";

const OVERALL_BADGE = { green: "success", amber: "warning", red: "error", not_connected: "default" };
const CHECK_BADGE = { pass: "success", warn: "warning", fail: "error", "n/a": "default" };

export function StepPreflight({
  rows,
  running,
  recheckBusy,
  onRecheck,
  onRecheckAll,
  channelRows = [],
  selectedPlatforms = [],
  onTogglePlatform,
  complianceExcluded = {},
  specialAdCategory = "NONE",
}) {
  const [expandedChecks, setExpandedChecks] = useState(() => new Set());
  const toggleExpanded = (key) => {
    setExpandedChecks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ISSUE-986: the candidate channel-plan row per platform drives selectability
  // (eligible + not compliance-excluded) and the plain-English disabled reason.
  const candidateByPlatform = new Map(channelRows.map((r) => [r.platform, r]));
  const selectedSet = new Set(selectedPlatforms);
  const buildingLabels = channelRows
    .filter((r) => selectedSet.has(r.platform))
    .map((r) => PLATFORM_LABELS[r.platform] ?? r.platform);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Channel health &amp; platform picker</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Pick which platforms to build for. If we launch right now, will an ad actually run?
            Red blockers exclude a channel; amber warnings don't stop the build — everything is
            created paused.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} loading={running} onClick={onRecheckAll}>
          Recheck all
        </Button>
      </div>

      {/* ISSUE-986: which platforms this build will actually go to. */}
      {rows && (
        <p className="text-xs text-[var(--color-text-secondary)]" data-testid="picker-building-summary">
          {buildingLabels.length > 0
            ? <>Building for <span className="font-medium">{buildingLabels.join(", ")}</span>. Untick any you don't want.</>
            : "No platforms selected yet — tick at least one eligible platform below to build."}
        </p>
      )}

      {/* ISSUE-986: special-ad-category compliance — Meta is the only platform
          that can DECLARE one, so the others are auto-excluded (never a silent
          undeclared special-category ad). */}
      {isSpecialCategoryActive(specialAdCategory) && Object.keys(complianceExcluded).length > 0 && (
        <AlertCard variant="warning" title={`"${specialCategoryLabel(specialAdCategory)}" excludes non-Meta platforms`}>
          A special ad category is a legal declaration only Meta can make, so{" "}
          {Object.keys(complianceExcluded).map((p) => PLATFORM_LABELS[p] ?? p).join(", ")} are excluded
          from this build. Clear the category (Policy step) to build them, or continue on Meta only.
        </AlertCard>
      )}

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
            const candidate = candidateByPlatform.get(row.platform);
            const complianceReason = complianceExcluded[row.platform] ?? null;
            const selectable = Boolean(candidate?.eligible) && !complianceReason;
            const checked = selectedSet.has(row.platform);
            // The plain-English reason a channel can't be picked (safety gate or
            // compliance) — reused from the channel-plan row / compliance guard.
            const disabledReason = complianceReason ?? (candidate && !candidate.eligible ? candidate.excludedReason : null);
            return (
              <div
                key={row.platform}
                className={[
                  "border rounded-xl p-4",
                  checked ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]/40" : "border-[var(--gray-200)]",
                ].join(" ")}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {/* ISSUE-986: the platform-picker toggle. Eligible → checkbox;
                      ineligible/compliance-excluded → disabled with the reason. */}
                  <label className="inline-flex items-center gap-2 cursor-pointer" title={selectable ? undefined : (disabledReason ?? undefined)}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-brand-500)] disabled:cursor-not-allowed"
                      checked={selectable ? checked : false}
                      disabled={!selectable}
                      aria-label={`Build for ${PLATFORM_LABELS[row.platform] ?? row.platform}`}
                      onChange={() => selectable && onTogglePlatform?.(row.platform)}
                    />
                    <Badge variant={OVERALL_BADGE[row.overall] ?? "default"} dot>
                      {PLATFORM_LABELS[row.platform] ?? row.platform}
                    </Badge>
                  </label>
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

                {/* ISSUE-986: why this platform can't be picked (never silent). */}
                {!selectable && disabledReason && (
                  <p className="text-xs text-[var(--color-text-tertiary)] mb-2" data-testid={`picker-disabled-reason-${row.platform}`}>
                    Can't build here — {disabledReason}
                  </p>
                )}
                <ul className="space-y-1">
                  {(row.checks ?? []).map((check) => {
                    const { friendly, technical } = translatePreflightDetail({
                      platform: row.platform,
                      checkId: check.id,
                      status: check.status,
                      detail: check.detail,
                    });
                    const expandKey = `${row.platform}:${check.id}`;
                    const isOpen = expandedChecks.has(expandKey);
                    return (
                      <li key={check.id} className="text-xs">
                        <div className="flex items-start gap-2">
                          <Badge variant={CHECK_BADGE[check.status] ?? "default"}>{check.id}</Badge>
                          <span>
                            <span className="font-medium">{check.label}</span> — {friendly}
                          </span>
                        </div>
                        {technical && (
                          <div className="pl-[52px] mt-0.5">
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              onClick={() => toggleExpanded(expandKey)}
                              className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                            >
                              {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                              Technical details
                            </button>
                            {isOpen && (
                              <p className="mt-1 text-[10px] font-mono text-[var(--color-text-tertiary)] break-words">
                                {technical}
                              </p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
