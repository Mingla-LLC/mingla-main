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
 * Gemini 2.5 Flash pricing reference:
 * https://ai.google.dev/pricing/gemini-2-5-flash (verified 2026-05-29).
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
  estimateRemainderCostUsd,
  estimateRemainderMinutes,
} from "../../services/intelligenceCoverageService";

const COST_GUARD_USD = 5;
const COST_REVIEW_THRESHOLD_USD = 10;

export function RunRemainderConfirmModal({
  open,
  onClose,
  cityId,
  cityName,
  remainingCount,
  perPlaceCostUsd = 0.0040,
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
    () => estimateRemainderCostUsd(remainingCount, perPlaceCostUsd),
    [remainingCount, perPlaceCostUsd],
  );
  const estMinutes = useMemo(
    () => estimateRemainderMinutes(remainingCount),
    [remainingCount],
  );

  const requiresTypedConfirm = estCost > COST_REVIEW_THRESHOLD_USD;
  const sendConfirmHighCost = estCost > COST_GUARD_USD;
  const typedMatches = typedName.trim() === (cityName || "");
  const canRun =
    !submitting &&
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
      addToast({
        variant: "info",
        title: "Remainder run started",
        description:
          `${data.cityName} · ${data.totalPlaces} places · ~$${
            Number(data.estimatedCostUsd ?? 0).toFixed(2)
          } · run ${String(data.runId).slice(0, 8)}…`,
      });
      onStarted?.({ runId: data.runId, cityName: data.cityName });
      onClose?.();
    } catch (err) {
      setErrorMessage(err?.message || "Couldn't start remainder run");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const costColor =
    estCost > 10
      ? "text-[var(--color-error-700)]"
      : estCost > 5
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
            <span className="font-semibold">{cityName}</span> using Gemini 2.5 Flash.
          </p>

          {/* Cost breakdown box */}
          <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] p-4">
            <div className="text-[10px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)] mb-1.5">
              Cost breakdown
            </div>
            <div className="flex items-baseline justify-between font-mono tabular-nums text-sm">
              <span className="text-[var(--color-text-secondary)]">
                {Number(remainingCount || 0).toLocaleString()} places × ${perPlaceCostUsd.toFixed(4)}
              </span>
              <span className={["font-semibold", costColor].join(" ")}>
                ~${estCost.toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              Gemini 2.5 Flash, server-side. Pricing:{" "}
              <a
                href="https://ai.google.dev/pricing/gemini-2-5-flash"
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
                Cost exceeds ${COST_REVIEW_THRESHOLD_USD}
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

          {/* Acknowledgement checkbox */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              ref={checkboxRef}
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 cursor-pointer"
            />
            <span className="text-sm text-[var(--color-text-primary)]">
              I understand this will charge ~${estCost.toFixed(2)} on the Gemini API.
            </span>
          </label>

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
        >
          Run trial
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default RunRemainderConfirmModal;
