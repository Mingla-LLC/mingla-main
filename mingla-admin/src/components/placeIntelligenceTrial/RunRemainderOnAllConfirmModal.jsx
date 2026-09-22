/**
 * RunRemainderOnAllConfirmModal — ORCH-1013 Finding B + ORCH-1015 Finding C
 *
 * Bulk-launch confirmation modal for "Run remainder on all ready cities" (was
 * "…un-evaluated cities" pre-1015). Mirrors the cost-guard shape of
 * RunRemainderConfirmModal (single city) but with a city-list body + a single
 * typed-confirm phrase ("RUN ALL") for totals >$10.
 *
 * ORCH-1015 adds `skippedCities` prop — cities with remainder that are NOT
 * fully ready (boundary or details ⚠). Rendered in a sibling panel below the
 * totals block so the operator sees them, but they NEVER enter the dispatcher
 * (onConfirm fires with safeCities only). Per SPEC §3 C.2 + C.3.
 *
 * issue #3526 — the model name, the per-place rate, the cost guard and the
 * pricing link all arrive on the server's cost_model. This file pins none of
 * them; see services/intelligenceCostModel.js.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Button } from "../ui/Button";
import { AlertCard } from "../ui/Card";
import {
  estimateCostUsd,
  formatPerPlaceCost,
} from "../../services/intelligenceCoverageService";

// issue #3526 P1-R1 — the typed-confirmation threshold is a DOLLAR amount and
// it moved to the server's cost_model with the rate and the guard. A client
// copy of it is the same defect as a client copy of the rate.
const TYPED_CONFIRM_PHRASE = "RUN ALL";
// issue #3526 P0-1 — the client-side default rate is gone. It was one of five
// copies of a number the server had already moved, and a default is exactly how
// a stale rate survives a repin. The cost model arrives from the server; see
// services/intelligenceCostModel.js.

export function RunRemainderOnAllConfirmModal({
  open,
  onClose,
  candidateCities = [],
  skippedCities = [],
  costModel,
  onConfirm,
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState("");
  const checkboxRef = useRef(null);
  const typedInputRef = useRef(null);

  const safeCities = useMemo(
    () => candidateCities.filter((c) => c?.remaining_count > 0),
    [candidateCities],
  );

  const sumRemaining = useMemo(
    () => safeCities.reduce((sum, c) => sum + Number(c.remaining_count || 0), 0),
    [safeCities],
  );
  const totalCost = useMemo(
    () => estimateCostUsd(sumRemaining, costModel),
    [sumRemaining, costModel],
  );

  // issue #3526 P0-1 — an unknown cost blocks the bulk launcher outright. This
  // dialog queues every eligible city at once; guessing the rate here is the
  // most expensive place in the app to be wrong.
  const costUnknown = totalCost === null;
  const reviewThreshold = costModel?.costReviewThresholdUsd ?? null;
  const requiresTypedConfirm = !costUnknown && reviewThreshold !== null &&
    totalCost > reviewThreshold;
  const typedMatches = typed.trim() === TYPED_CONFIRM_PHRASE;
  const canConfirm =
    safeCities.length > 0 &&
    !costUnknown &&
    acknowledged &&
    (!requiresTypedConfirm || typedMatches);

  // Reset state each time the modal opens (mirrors RunRemainderConfirmModal).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setAcknowledged(false);
    setTyped("");
    requestAnimationFrame(() => {
      if (requiresTypedConfirm) typedInputRef.current?.focus();
      else checkboxRef.current?.focus();
    });
  }, [open, requiresTypedConfirm]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!open) return null;

  // issue #3526 — thresholds key off the SERVER's guard, not a client copy.
  const guard = costModel?.costGuardUsd ?? null;
  const costColor = costUnknown
    ? "text-[var(--color-warning-700)]"
    : guard !== null && totalCost > guard * 2
      ? "text-[var(--color-error-700)]"
      : guard !== null && totalCost > guard
        ? "text-[var(--color-warning-700)]"
        : "text-[var(--color-text-primary)]";

  const cityWord = safeCities.length === 1 ? "city" : "cities";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Run remainder on ${safeCities.length} ready ${cityWord}`}
      size="md"
    >
      <ModalBody>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-primary)] leading-6">
            This will queue a remainder run for every city where Boundary +
            Details are both current
            {costModel?.modelId ? `, using ${costModel.modelId}` : ""}. Cities
            needing reseed or detail refresh are listed below as skipped — fix
            those in Place Pool first.
          </p>

          {/* Per-city list */}
          <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] divide-y divide-[var(--gray-200)] max-h-[220px] overflow-y-auto">
            {safeCities.map((c) => (
              <div
                key={c.city_id}
                className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="text-[var(--color-text-primary)] font-medium truncate">
                  {c.city_name}
                </span>
                <span className="text-xs font-mono tabular-nums text-[var(--color-text-secondary)] shrink-0">
                  {Number(c.remaining_count || 0).toLocaleString()} places
                  {costUnknown
                    ? ""
                    : ` · ~$${estimateCostUsd(c.remaining_count, costModel).toFixed(2)}`}
                </span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] p-4">
            <div className="text-[10px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)] mb-1.5">
              Totals
            </div>
            <div className="flex items-baseline justify-between font-mono tabular-nums text-sm">
              <span className="text-[var(--color-text-secondary)]">
                {sumRemaining.toLocaleString()} places
                {costModel ? ` × ${formatPerPlaceCost(costModel)}` : ""}
              </span>
              <span className={["font-semibold", costColor].join(" ")}>
                {costUnknown ? "cost unknown" : `~$${totalCost.toFixed(2)}`}
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              {costModel?.modelId ?? "Model"}, server-side
              {costModel?.pricingVersion ? ` (${costModel.pricingVersion})` : ""}. Pricing:{" "}
              <a
                href={costModel?.pricingReferenceUrl || "https://ai.google.dev/gemini-api/docs/pricing"}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--color-text-secondary)]"
              >
                ai.google.dev/pricing
                <ExternalLink className="inline w-3 h-3 ml-0.5" aria-hidden="true" />
              </a>
              <span className="ml-1">(verified 2026-05-30)</span>
            </p>
          </div>

          {/* ORCH-1015 Finding C — skipped cities panel. Cities with remainder
              that are NOT fully ready (boundary or details ⚠). Listed for
              visibility; NEVER passed to onConfirm. Per SPEC §3 C.3. */}
          {skippedCities.length > 0 && (
            <div className="rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)]">
              <div className="px-3 py-2 text-[10px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)] border-b border-[var(--gray-200)]">
                Skipped — needs prep first ({skippedCities.length})
              </div>
              <div className="divide-y divide-[var(--gray-200)] max-h-[160px] overflow-y-auto">
                {skippedCities.map((c) => (
                  <div
                    key={c.city_id}
                    className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="text-[var(--color-text-secondary)] font-medium truncate">
                      {c.city_name}
                    </span>
                    <span className="text-xs text-[var(--color-warning-700)] shrink-0">
                      {c.skip_reason}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* High-cost gate: typed phrase */}
          {requiresTypedConfirm && (
            <div className="border-l-4 border-l-[var(--color-warning-500)] bg-[var(--color-warning-50)] p-4 rounded-r-lg">
              <h4 className="text-sm font-semibold text-[var(--color-warning-700)] mb-1">
                Cost exceeds ${reviewThreshold?.toFixed(2)}
              </h4>
              <p className="text-xs text-[var(--color-warning-700)] mb-2">
                Type <span className="font-mono">{TYPED_CONFIRM_PHRASE}</span>{" "}
                below to confirm.
              </p>
              <input
                ref={typedInputRef}
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={TYPED_CONFIRM_PHRASE}
                className={[
                  "w-full h-10 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
                  "border border-[var(--gray-300)] rounded-lg outline-none transition-all duration-150 px-3",
                  "focus:border-[var(--color-warning-500)] focus:ring-2 focus:ring-[var(--color-warning-100,var(--color-warning-50))]",
                ].join(" ")}
                aria-label={`Type "${TYPED_CONFIRM_PHRASE}" to confirm`}
              />
              {typedMatches && (
                <p className="text-xs text-[var(--color-success-700)] mt-1.5">
                  ✓ matches
                </p>
              )}
            </div>
          )}

          {/* Acknowledgement checkbox.
              issue #3526 P3-R4 — an unknown cost blocks the launcher outright,
              so inviting a tick that can never enable "Queue all" was a dead tap
              (Constitution #1) beside a disabled button with no stated reason
              (Constitution #3). */}
          {costUnknown ? (
            <AlertCard
              variant="warning"
              title="Cost unavailable — nothing can be queued"
              description={
                "The server did not return a per-place cost, so these runs cannot be " +
                "priced and the spend cannot be authorised. Reload the page; if it " +
                "persists the intelligence edge function needs redeploying."
              }
            />
          ) : (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                ref={checkboxRef}
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 cursor-pointer"
              />
              <span className="text-sm text-[var(--color-text-primary)]">
                {`I understand this will charge ~$${totalCost.toFixed(2)} on the Gemini API.`}
              </span>
            </label>
          )}

          <p className="text-xs text-[var(--color-text-tertiary)] italic">
            Up to 3 cities will run at a time. Remaining cities queue
            automatically and start as slots free up.
          </p>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          iconRight={ArrowRight}
          onClick={() => {
            if (!canConfirm) return;
            onConfirm?.(safeCities);
            onClose?.();
          }}
          disabled={!canConfirm}
          title={
            costUnknown
              ? "The server did not return a per-place cost, so these runs cannot be priced."
              : safeCities.length === 0
                ? "No city has un-evaluated places to run."
                : !acknowledged
                  ? "Tick the acknowledgement to continue."
                  : requiresTypedConfirm && !typedMatches
                    ? `Type "${TYPED_CONFIRM_PHRASE}" to confirm a run above $${reviewThreshold?.toFixed(2)}.`
                    : undefined
          }
        >
          Queue all
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default RunRemainderOnAllConfirmModal;
