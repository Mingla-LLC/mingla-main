// Issue #4419 — the actions that fit an email's state, and their dialogs.
// Change time, Edit words and Cancel reuse #4383's pieces; Send test goes to
// the signed-in teammate only; Export is counts and reasons, never addresses.
import { Clock, Copy, Download, Pencil, Send, X } from "lucide-react";
import { Button } from "../../ui/Button";
import { Modal, ModalBody, ModalFooter } from "../../ui/Modal";
import { ConfirmCancel } from "../../communications/ConfirmCancel";
import { LaterInputs } from "../../communications/SchedulePicker";
import { actionsFor } from "./campaignModel";

const ICONS = { change_time: Clock, edit_words: Pencil, send_test: Send, cancel: X, duplicate: Copy, export: Download };

export function EmailActionButtons({ detail, isAdmin, busy, onAction }) {
  const actions = actionsFor(detail, { isAdmin });
  if (!actions.length) return null;
  return (
    <div className="flex flex-wrap gap-2" data-actions={actions.map((a) => a.id).join(",")}>
      {actions.map((action) => (
        <Button
          key={action.id}
          size="sm"
          variant={action.primary ? "primary" : action.danger ? "secondary" : "secondary"}
          className={action.danger ? "!text-[var(--color-error-700)]" : ""}
          icon={ICONS[action.id]}
          disabled={Boolean(action.disabled) || Boolean(busy)}
          loading={busy === action.id}
          title={action.title || undefined}
          onClick={() => onAction(action.id)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

export function ChangeTimeDialog({ open, subject, value, error, busy, onChange, onSave, onClose }) {
  return (
    <Modal open={open} onClose={() => (busy ? null : onClose())} title="Change send time">
      <ModalBody>
        <p className="mb-3 text-sm text-[var(--color-text-secondary)]">&ldquo;{subject}&rdquo;</p>
        {value ? <LaterInputs value={value} onChange={onChange} error={error} hint="To change who gets it, cancel and write a new email." /> : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={busy} onClick={onClose}>Back</Button>
        <Button loading={busy} onClick={onSave}>Save time</Button>
      </ModalFooter>
    </Modal>
  );
}

export function SendTestDialog({ open, exact, email, busy, onSend, onClose }) {
  return (
    <Modal open={open} onClose={() => (busy ? null : onClose())} title="Send a test to yourself">
      <ModalBody>
        <p className="text-sm text-[var(--color-text-secondary)]">
          We&apos;ll send {exact ? "the exact saved copy" : "the current preview"} to <b className="text-[var(--color-text-primary)]">{email || "your sign-in address"}</b>, with your own first name. It does not count as a send. Up to five tests an hour.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={busy} onClick={onClose}>Back</Button>
        <Button icon={Send} loading={busy} onClick={onSend}>Send test</Button>
      </ModalFooter>
    </Modal>
  );
}

export { ConfirmCancel };
