// Issue #4383 — "Cancel this …?" before anything scheduled is called off.
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Button } from "../ui/Button";

export function ConfirmCancel({ target, kindLabel, busy, onConfirm, onClose }) {
  return (
    <Modal open={Boolean(target)} onClose={() => (busy ? null : onClose())} title={`Cancel this ${kindLabel}?`}>
      <ModalBody>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {target?.title ? `"${target.title}" ` : "It "}will not go out. You can schedule it again later.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={busy} onClick={onClose}>Keep it</Button>
        <Button variant="danger" loading={busy} onClick={onConfirm}>Cancel it</Button>
      </ModalFooter>
    </Modal>
  );
}
