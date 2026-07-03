// ORCH-1271 [Admin authorization & audit FOUNDATION] — the reusable typed-reason
// + confirm modal that calls the audited-write primitive (D2). Built + unit-
// tested; NOT wired to any real business mutation in 1271 (only the placeholder's
// admin_audit_probe self-test exercises it).
//
// HARD contract:
//   - confirm is DISABLED until reason.trim().length > 0 (when requireReason)
//     AND, if confirmPhrase is set, the typed phrase matches it EXACTLY.
//   - on confirm → submitting (spinner, inputs disabled) → await onConfirm({reason})
//     → success Toast + close, OR inline error (stay open, reason preserved).
//   - onConfirm is NEVER called with an empty/whitespace reason.
//   - the client-side reason check is UX only — the server (admin_write_audit
//     reason_required) is the real gate.

import { useState, useCallback } from "react";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Button } from "../ui/Button";
import { AlertCard } from "../ui/Card";
import { useToast } from "../../context/ToastContext";

export function HighRiskActionModal({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  destructive = false,
  requireReason = true,
  reasonLabel = "Reason (required)",
  confirmPhrase,
  onConfirm,
  successMessage = "Action completed.",
}) {
  const { addToast } = useToast();
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Reset on close (event-driven, not in an effect) so a prior reason never
  // leaks into the next open. Every close path — Cancel, overlay/Escape (Modal
  // calls this onClose), and a successful confirm — routes through here.
  const handleClose = useCallback(() => {
    setReason("");
    setPhrase("");
    setSubmitting(false);
    setError(null);
    onClose();
  }, [onClose]);

  const reasonOk = !requireReason || reason.trim().length > 0;
  const phraseOk = !confirmPhrase || phrase === confirmPhrase;
  const canConfirm = reasonOk && phraseOk && !submitting;

  const handleConfirm = async () => {
    // Hard guard: never invoke onConfirm with an empty/whitespace reason.
    if (requireReason && reason.trim().length === 0) return;
    if (confirmPhrase && phrase !== confirmPhrase) return;
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({ reason: reason.trim() });
      addToast({ variant: "success", title: successMessage });
      handleClose();
    } catch (err) {
      // Stay open, preserve the reason, surface the error inline.
      setError(err?.message || "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  const textareaClass = [
    "w-full min-h-[88px] px-3 py-2 text-sm rounded-lg resize-y",
    "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
    "border border-[var(--gray-300)] outline-none transition-all duration-150",
    "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
    "disabled:opacity-50 disabled:cursor-not-allowed",
  ].join(" ");

  const inputClass = [
    "w-full h-10 px-3 text-sm rounded-lg",
    "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
    "border border-[var(--gray-300)] outline-none transition-all duration-150",
    "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
    "disabled:opacity-50 disabled:cursor-not-allowed",
  ].join(" ");

  return (
    <Modal open={open} onClose={handleClose} title={title} size="sm" destructive={destructive}>
      <ModalBody className="flex flex-col gap-4">
        {description && (
          <p className="text-sm text-[var(--color-text-secondary)]">{description}</p>
        )}

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="high-risk-reason"
            className="text-xs font-medium text-[var(--color-text-secondary)]"
          >
            {reasonLabel}
          </label>
          <textarea
            id="high-risk-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            placeholder="Why are you taking this action? (recorded in the audit log)"
            className={textareaClass}
          />
        </div>

        {confirmPhrase && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="high-risk-phrase"
              className="text-xs font-medium text-[var(--color-text-secondary)]"
            >
              Type <span className="font-semibold text-[var(--color-text-primary)]">{confirmPhrase}</span> to confirm
            </label>
            <input
              id="high-risk-phrase"
              type="text"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              disabled={submitting}
              className={inputClass}
              autoComplete="off"
            />
          </div>
        )}

        {error && (
          <AlertCard variant="error" title="Action failed">
            {error}
          </AlertCard>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" size="md" onClick={handleClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          size="md"
          onClick={handleConfirm}
          disabled={!canConfirm}
          loading={submitting}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
