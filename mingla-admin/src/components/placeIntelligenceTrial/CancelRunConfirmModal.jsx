/**
 * CancelRunConfirmModal — ORCH-1008 Phase 4 (DESIGN §4.2)
 *
 * Replaces the window.confirm cancel prompt with a proper Modal. Destructive
 * primary modal (red title). "Keep running" is the safe default (secondary,
 * focused first). "Cancel run" is the danger button to the right.
 */

import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Button } from "../ui/Button";
import { AlertCard } from "../ui/Card";

export function CancelRunConfirmModal({
  open,
  onClose,
  onConfirm,
  cityName,
  processedCount,
  totalCount,
  loading = false,
}) {
  if (!open) return null;
  const pct = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;
  return (
    <Modal open={open} onClose={onClose} title="Cancel this run?" size="sm" destructive>
      <ModalBody>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--color-text-primary)] leading-6">
            You're about to stop the{" "}
            <span className="font-semibold">{cityName || "current"}</span> run at{" "}
            <span className="font-mono tabular-nums">
              {Number(processedCount || 0).toLocaleString()}
            </span>{" "}
            /{" "}
            <span className="font-mono tabular-nums">
              {Number(totalCount || 0).toLocaleString()}
            </span>{" "}
            places ({pct}% done).
          </p>
          <AlertCard variant="warning" title="In-flight calls will complete">
            In-flight Gemini calls (up to 5 in parallel) will COMPLETE and be
            billed — you'll see them as success or fail in the next 30–90
            seconds. No new places will start after you confirm.
          </AlertCard>
          <p className="text-sm text-[var(--color-text-secondary)] leading-6">
            Partial results are preserved. You can resume from the next place
            later with the "Remainder only" mode on the Overview tab.
          </p>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={loading} autoFocus>
          Keep running
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>
          Cancel run
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default CancelRunConfirmModal;
