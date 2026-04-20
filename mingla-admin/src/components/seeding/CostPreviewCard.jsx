// ORCH-0553 — Shared cost-preview card for SeedTab + RefreshTab.
// Spec: outputs/SPEC_ORCH-0553_REFRESH_PIPELINE.md §4.4
//
// Generic shell: caller passes the preview JSON (from preview_cost OR
// preview_refresh_cost) plus the primary action button props.
// Handles the field-name discrepancy between seed and refresh shapes.

import { AlertTriangle } from "lucide-react";
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { formatCost } from "../../lib/seedingFormat";

export function CostPreviewCard({
  preview,
  primaryAction,
  primaryLabel,
  primaryLoading,
  primaryDisabled,
  helperText,
}) {
  if (!preview) return null;

  // Normalize across seed/refresh shapes
  const totalPlaces = preview.totalPlaces ?? null;          // refresh-only
  const totalApiCalls = preview.totalApiCalls ?? null;      // seed-only
  const totalBatches = preview.totalBatches ?? null;
  const estimatedCost = preview.estimatedCostUsd ?? preview.estimatedTotalCost ?? 0;
  const perBatchCost = preview.perBatchCostUsd ?? null;
  const exceedsHardCap = !!preview.exceedsHardCap;
  const hardCapUsd = preview.hardCapUsd ?? 500;
  const breakdown = preview.breakdown ?? [];

  return (
    <SectionCard title="Cost Preview">
      <div
        className={`rounded-lg p-4 ${
          exceedsHardCap
            ? "bg-[var(--color-error-50)] border border-[var(--color-error-200)]"
            : "bg-[var(--color-success-50)]"
        }`}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          {totalPlaces !== null && (
            <div>
              <span className="text-[var(--color-text-secondary)]">Places:</span>{" "}
              <strong>{totalPlaces.toLocaleString()}</strong>
            </div>
          )}
          {totalApiCalls !== null && (
            <div>
              <span className="text-[var(--color-text-secondary)]">API Calls:</span>{" "}
              <strong>{totalApiCalls.toLocaleString()}</strong>
            </div>
          )}
          {totalBatches !== null && (
            <div>
              <span className="text-[var(--color-text-secondary)]">Batches:</span>{" "}
              <strong>{totalBatches.toLocaleString()}</strong>
            </div>
          )}
          {perBatchCost !== null && (
            <div>
              <span className="text-[var(--color-text-secondary)]">Per batch:</span>{" "}
              <strong>{formatCost(perBatchCost)}</strong>
            </div>
          )}
          <div className="font-semibold">
            Total: {formatCost(estimatedCost)}
          </div>
        </div>

        {exceedsHardCap && (
          <p className="mt-2 text-sm font-medium text-[var(--color-error-600)] flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            Exceeds {formatCost(hardCapUsd)} cap. Reduce filters or batch size.
          </p>
        )}
      </div>

      {breakdown.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
            Per-category breakdown
          </p>
          <div className="rounded border border-[var(--gray-200)] divide-y divide-[var(--gray-200)] max-h-48 overflow-y-auto">
            {breakdown.map((row, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                <span className="text-[var(--color-text-primary)]">{row.category}</span>
                <span className="text-[var(--color-text-secondary)]">
                  {(row.places ?? row.tiles ?? row.calls ?? 0).toLocaleString()}
                  {" · "}
                  {formatCost(row.cost ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <Button
          variant="primary"
          loading={primaryLoading}
          disabled={primaryDisabled || exceedsHardCap}
          onClick={primaryAction}
        >
          {primaryLabel}
        </Button>
        {helperText && (
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{helperText}</p>
        )}
      </div>
    </SectionCard>
  );
}
