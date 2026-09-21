/**
 * RunRemainderConfirmModal — ORCH-1008
 *
 * Confirmation modal shown before firing start_run with mode='remainder' (also
 * used as the generic >$10 review-and-confirm modal for other modes per
 * DESIGN §2.7).
 *
 * 3-tier cost guard (SPEC §3 Phase 3a + §7-D5):
 *   - $0.00 - $5.00:  single Confirm checkbox enables Run.
 *   - $5.01 - $10.00: same UX + confirm_high_cost=true is sent to edge fn
 *                     (which requires it per its own $5 guard).
 *   - > $10.00:       additionally requires typed city-name match before
 *                     Run enables, in addition to confirm_high_cost=true.
 *
 * On success: closes, surfaces toast, calls onStarted({ runId, cityName }).
 * On error: stays open, surfaces inline AlertCard with extracted message;
 *   409 concurrent_run shows the "View running run" affordance via onConcurrentRun.
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
import { invokeWithRefresh } from "../../lib/supabase";
import { extractFunctionError } from "../../lib/edgeFunctionError";
import { useToast } from "../../context/ToastContext";
import {
  estimateCostUsd,
  estimateRemainderMinutes,
  formatPerPlaceCost,
  needsHighCostConfirmation,
} from "../../services/intelligenceCoverageService";

// issue #3526 — this modal holds NO dollar amount. The guard and the
// typed-confirmation threshold both arrive on the server's cost_model: a client
// copy of the guard is how Baltimore showed "$4.82, no confirmation needed" for
// a run the server priced at $10.72 and refused, and a client copy of the
// escalation threshold is the same defect wearing a different name (P1-R1).

export function RunRemainderConfirmModal({
  open,
  onClose,
  cityId,
  cityName,
  remainingCount,
  // issue #3526 P0-1 — the server's cost model. NO default: an absent model
  // means "we cannot price this run", and the modal says so instead of
  // inventing a rate.
  costModel,
  onStarted,
  onConcurrentRun,
}) {
  const { addToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [typedName, setTypedName] = useState("");
  const checkboxRef = useRef(null);
  const typedInputRef = useRef(null);

  const estCost = useMemo(
    () => estimateCostUsd(remainingCount, costModel),
    [remainingCount, costModel],
  );
  const estMinutes = useMemo(
    () => estimateRemainderMinutes(remainingCount),
    [remainingCount],
  );

  // issue #3526 P0-1 — costUnknown is a hard block, not a soft warning. If the
  // server has not told us the rate we cannot compute confirm_high_cost, and
  // starting the run would repeat exactly the mismatch this change fixes.
  const costUnknown = estCost === null;
  const reviewThreshold = costModel?.costReviewThresholdUsd ?? null;
  const requiresTypedConfirm = !costUnknown && reviewThreshold !== null &&
    estCost > reviewThreshold;
  const sendConfirmHighCost = needsHighCostConfirmation(remainingCount, costModel) === true;
  const typedMatches = typedName.trim() === (cityName || "");
  const canRun =
    !submitting &&
    !costUnknown &&
    remainingCount > 0 &&
    acknowledged &&
    (!requiresTypedConfirm || typedMatches);

  // Reset state each time the modal opens
  useEffect(() => {
    if (!open) return;
    setAcknowledged(false);
    setTypedName("");
    setErrorMessage(null);
    setErrorCode(null);
    setSubmitting(false);
    // Focus typed-confirm input if shown; otherwise focus checkbox
    requestAnimationFrame(() => {
      if (requiresTypedConfirm) typedInputRef.current?.focus();
      else checkboxRef.current?.focus();
    });
  }, [open, requiresTypedConfirm]);

  async function handleRun() {
    if (!canRun) return;
    setSubmitting(true);
    setErrorMessage(null);
    setErrorCode(null);
    try {
      const { data, error } = await invokeWithRefresh("run-place-intelligence-trial", {
        body: {
          action: "start_run",
          city_id: cityId,
          mode: "remainder",
          confirm_high_cost: sendConfirmHighCost,
        },
      });
      if (error) {
        const msg = await extractFunctionError(error, "start_run failed");
        // Try to surface 409 concurrent_run distinctly so the parent can offer
        // a "View running run" affordance instead of a generic red banner.
        let code = null;
        try {
          if (error.context?.json) {
            const j = await error.context.json();
            code = j?.error ?? null;
          }
        } catch {
          // ignore
        }
        setErrorMessage(msg);
        setErrorCode(code);
        return;
      }
      // ORCH-1032: a run started at capacity comes back queued — surface it as
      // a calm waiting state (info, never error/warning), not "started".
      if (data.queued) {
        addToast({
          variant: "info",
          title: "Queued — waiting for a free slot",
          description:
            `${data.cityName} · ${data.totalPlaces} places · will auto-start when a run finishes` +
            (data.aheadCount > 0 ? ` (${data.aheadCount} ahead)` : ""),
        });
      } else {
        addToast({
          variant: "info",
          title: "Remainder run started",
          description:
            `${data.cityName} · ${data.totalPlaces} places · ~$${
              Number(data.estimatedCostUsd ?? 0).toFixed(2)
            } · run ${String(data.runId).slice(0, 8)}…`,
        });
      }
      onStarted?.({ runId: data.runId, cityName: data.cityName });
      onClose?.();
    } catch (err) {
      setErrorMessage(err?.message || "Couldn't start remainder run");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  // issue #3526 — the amber/red thresholds key off the SERVER's guard, not a
  // client copy of 5. Unknown cost is amber: it is not safe and not zero.
  const guard = costModel?.costGuardUsd ?? null;
  const costColor = costUnknown
    ? "text-[var(--color-warning-700)]"
    : guard !== null && estCost > guard * 2
      ? "text-[var(--color-error-700)]"
      : guard !== null && estCost > guard
        ? "text-[var(--color-warning-700)]"
        : "text-[var(--color-text-primary)]";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Review and confirm — Remainder trial for ${cityName}`}
      size="md"
    >
      <ModalBody>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-primary)] leading-6">
            This will evaluate{" "}
            <span className="font-semibold tabular-nums">
              {Number(remainingCount || 0).toLocaleString()}
            </span>{" "}
            un-evaluated servable place{remainingCount === 1 ? "" : "s"} in{" "}
            <span className="font-semibold">{cityName}</span>
            {costModel?.modelId ? ` using ${costModel.modelId}` : ""}.
          </p>

          {/* Cost breakdown box */}
          <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] p-4">
            <div className="text-[10px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)] mb-1.5">
              Cost breakdown
            </div>
            <div className="flex items-baseline justify-between font-mono tabular-nums text-sm">
              <span className="text-[var(--color-text-secondary)]">
                {Number(remainingCount || 0).toLocaleString()} places
                {costModel ? ` × ${formatPerPlaceCost(costModel)}` : ""}
              </span>
              <span className={["font-semibold", costColor].join(" ")}>
                {costUnknown ? "cost unknown" : `~$${estCost.toFixed(2)}`}
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
            </p>
          </div>

          {/* Wall time box */}
          <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] p-4">
            <div className="text-[10px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)] mb-1.5">
              Wall time
            </div>
            <p className="text-sm font-mono tabular-nums text-[var(--color-text-primary)]">
              {estMinutes >= 60
                ? `~${(estMinutes / 60).toFixed(1)} hrs`
                : `~${estMinutes} min`}{" "}
              <span className="text-xs text-[var(--color-text-tertiary)] font-sans">
                (≈ 30 s/place, server-side, tab-close safe)
              </span>
            </p>
          </div>

          {/* High-cost typed-confirm gate (only > $10) */}
          {requiresTypedConfirm && (
            <div className="border-l-4 border-l-[var(--color-warning-500)] bg-[var(--color-warning-50)] p-4 rounded-r-lg">
              <h4 className="text-sm font-semibold text-[var(--color-warning-700)] mb-1">
                Cost exceeds ${reviewThreshold?.toFixed(2)}
              </h4>
              <p className="text-xs text-[var(--color-warning-700)] mb-2">
                Type the city name below to confirm.
              </p>
              <input
                ref={typedInputRef}
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder={cityName}
                className={[
                  "w-full h-10 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
                  "border border-[var(--gray-300)] rounded-lg outline-none transition-all duration-150 px-3",
                  "focus:border-[var(--color-warning-500)] focus:ring-2 focus:ring-[var(--color-warning-100,var(--color-warning-50))]",
                ].join(" ")}
                aria-label={`Type "${cityName}" to confirm`}
              />
              {typedMatches && (
                <p className="text-xs text-[var(--color-success-700)] mt-1.5">
                  ✓ matches
                </p>
              )}
            </div>
          )}

          {/* Acknowledgement checkbox.
              issue #3526 P3-R4 — when the cost is unknown the run can never
              start, so inviting a tick was a dead tap (Constitution #1) beside a
              disabled button that gave no reason (Constitution #3). The
              checkbox is unavailable and the modal says WHY, in one place. */}
          {costUnknown ? (
            <AlertCard
              variant="warning"
              title="Cost unavailable — this run cannot start"
              description={
                "The server did not return a per-place cost, so this run cannot be " +
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
                {`I understand this will charge ~$${estCost.toFixed(2)} on the Gemini API.`}
              </span>
            </label>
          )}

          {/* Error */}
          {errorMessage && (
            <AlertCard
              variant={errorCode === "concurrent_run" ? "warning" : "error"}
              title={
                errorCode === "concurrent_run"
                  ? "Run already in progress"
                  : "Couldn't start remainder run"
              }
              action={
                errorCode === "concurrent_run" && onConcurrentRun ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    iconRight={ArrowRight}
                    onClick={() => {
                      onConcurrentRun();
                      onClose?.();
                    }}
                  >
                    View running run
                  </Button>
                ) : undefined
              }
            >
              {errorMessage}
            </AlertCard>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          iconRight={ArrowRight}
          onClick={handleRun}
          loading={submitting}
          disabled={!canRun}
          title={
            costUnknown
              ? "The server did not return a per-place cost, so this run cannot be priced."
              : !acknowledged
                ? "Tick the acknowledgement to continue."
                : requiresTypedConfirm && !typedMatches
                  ? `Type "${cityName}" to confirm a run above $${reviewThreshold?.toFixed(2)}.`
                  : undefined
          }
        >
          Run trial
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default RunRemainderConfirmModal;
