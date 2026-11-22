// Issue #4420 (step 6) — "Create ticket" from a Brand group message. It
// replaced Send to Product (the Product board is retired): the step 4 ticket
// form, pre-filled with the chosen messages quoted and the brand linked
// (created_from brand_group). The person making it picks the owner, like any
// card. Nothing is sent to the brand from here.
import { Modal, ModalBody } from "../ui/Modal";
import { TicketForm } from "../ops/TicketForm";
import { useOpsConfig } from "../../hooks/useOpsConfig";

/**
 * Props: prefill (from lib/supportInboxModel.js brandGroupTicketPrefill, or
 * null when closed), onClose, onCreated(card), onOpenCard(id).
 */
export function BrandGroupTicketModal({ prefill, onClose, onCreated, onOpenCard }) {
  const config = useOpsConfig();
  // The form starts with the owner suggestion once the config has answered (or failed).
  const settled = !config.loading || config.error != null;
  return (
    <Modal open={!!prefill} onClose={onClose} title={`Create ticket · from ${prefill?.label || "this Brand group"}`} size="lg">
      <ModalBody>
        {!prefill ? null : !settled ? (
          <p className="py-6 text-sm text-[var(--color-text-tertiary)]">Getting the form ready…</p>
        ) : (
          <TicketForm
            key={`${prefill.brandId}:${prefill.title}`}
            config={config.data || undefined}
            online
            createdFrom="brand_group"
            brandId={prefill.brandId}
            initialTitle={prefill.title}
            initialWhatIsWrong={prefill.whatIsWrong}
            onCancel={onClose}
            onCreated={onCreated}
            onOpenCard={onOpenCard}
          />
        )}
      </ModalBody>
    </Modal>
  );
}
