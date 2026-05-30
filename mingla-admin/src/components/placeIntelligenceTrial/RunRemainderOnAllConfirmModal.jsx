/**
 * RunRemainderOnAllConfirmModal — ORCH-1013 Finding B
 *
 * Bulk-launch confirmation modal for "Run remainder on all un-evaluated cities".
 * Mirrors the cost-guard shape of RunRemainderConfirmModal (single city) but
 * with a city-list body + a single typed-confirm phrase ("RUN ALL") for
 * totals >$10 (typing every city name is hostile UX — SPEC §7-D6).
 *
 * Gemini 2.5 Flash pricing reference (COMMS-0003):
 * https://ai.google.dev/pricing/gemini-2-5-flash (verified 2026-05-30).
 *
 * SPEC §3 B.5.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Button } from "../ui/Button";

const COST_REVIEW_THRESHOLD_USD = 10;
const TYPED_CONFIRM_PHRASE = "RUN ALL";
const DEFAULT_PER_PLACE_COST_USD = 0.004;

export function RunRemainderOnAllConfirmModal({
  open,
  onClose,
  candidateCities = [],
  perPlaceCostUsd = DEFAULT_PER_PLACE_COST_USD,
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
    () => +(sumRemaining * perPlaceCostUsd).toFixed(2),
    [sumRemaining, perPlaceCostUsd],
  );

  const requiresTypedConfirm = totalCost > COST_REVIEW_THRESHOLD_USD;
  const typedMatches = typed.trim() === TYPED_CONFIRM_PHRASE;
  const canConfirm =
    safeCities.length > 0 &&
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

  const costColor =
    totalCost > 10
      ? "text-[var(--color-error-700)]"
      : totalCost > 5
        ? "text-[var(--color-warning-700)]"
        : "text-[var(--color-text-primary)]";

  const cityWord = safeCities.length === 1 ? "city" : "cities";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Run remainder on ${safeCities.length} un-evaluated ${cityWord}`}
      size="md"
    >
      <ModalBody>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-primary)] leading-6">
            This will queue a remainder run for every city with un-evaluated
            servable places, using Gemini 2.5 Flash.
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
                  {Number(c.remaining_count || 0).toLocaleString()} places · ~$
                  {(c.remaining_count * perPlaceCostUsd).toFixed(2)}
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
                {sumRemaining.toLocaleString()} places × $
                {perPlaceCostUsd.toFixed(4)}
              </span>
              <span className={["font-semibold", costColor].join(" ")}>
                ~${totalCost.toFixed(2)}
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
              <span className="ml-1">(verified 2026-05-30)</span>
            </p>
          </div>

          {/* High-cost gate: typed phrase */}
          {requiresTypedConfirm && (
            <div className="border-l-4 border-l-[var(--color-warning-500)] bg-[var(--color-warning-50)] p-4 rounded-r-lg">
              <h4 className="text-sm font-semibold text-[var(--color-warning-700)] mb-1">
                Cost exceeds ${COST_REVIEW_THRESHOLD_USD}
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
              I understand this will charge ~${totalCost.toFixed(2)} on the Gemini API.
            </span>
          </label>

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
        >
          Queue all
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default RunRemainderOnAllConfirmModal;
