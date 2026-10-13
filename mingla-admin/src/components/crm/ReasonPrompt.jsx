import { useEffect, useId, useRef, useState } from "react";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Button } from "../ui/Button";
import { CONTROL_CLASS, LABEL_CLASS } from "./fields";

const COPY = {
  lost: { title: "Why is this lost?", confirm: "Mark as lost" },
  passed: { title: "Why did we pass?", confirm: "Mark as passed" },
};

/**
 * Asks for the reason BEFORE a card moves to Lost or Passed (the server
 * requires one). Cancel changes nothing. The caller gives each ask its own
 * `key`, so the box always starts empty.
 */
export function ReasonPrompt({ open, stageId, recordName, busy = false, error = "", onConfirm, onCancel }) {
  const [reason, setReason] = useState("");
  const inputRef = useRef(null);
  const id = useId();
  const copy = COPY[stageId] || COPY.lost;

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const trimmed = reason.trim();
  const submit = (e) => {
    e.preventDefault();
    if (!trimmed || busy) return;
    onConfirm(trimmed);
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} title={copy.title} size="sm">
      <form onSubmit={submit} className="flex min-h-0 flex-col">
        <ModalBody>
          <label htmlFor={id} className={LABEL_CLASS}>
            Reason{recordName ? ` for ${recordName}` : ""}
          </label>
          <input
            id={id}
            ref={inputRef}
            type="text"
            value={reason}
            maxLength={300}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            placeholder="One line, so the next person knows"
            className={CONTROL_CLASS}
          />
          {error ? (
            // The move failed: the box stays open with what was typed.
            <p role="alert" className="mt-2 text-sm text-[var(--color-error-700)]">
              The card didn&apos;t move. {error} Your reason is still here.
            </p>
          ) : (
            <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">
              The card moves only after you add a reason. Cancel leaves it where it is.
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!trimmed}>
            {error ? "Try again" : copy.confirm}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
