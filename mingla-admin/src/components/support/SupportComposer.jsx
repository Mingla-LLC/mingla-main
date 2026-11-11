// #4382 Wave 2 — the Reply / Internal note composer.
//
// Reply: the customer (or brand team) gets a push. Send replies straight
// away with no promise; "Send and wait" sets Waiting on customer and asks when
// Support will check back. Internal note: yellow and dashed, only staff see
// it, it can carry images and it sends no push. On an internal ticket only
// notes exist. Images: paste, drop or the picker; Send waits for every upload.
import { useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { TEXTAREA_CLASS } from "../crm/fields";
import { AddImagesButton, UploadThumbnails } from "./AttachmentUploader";
import { useSupportUploads } from "./useSupportUploads";
import { sendSupportMessage } from "../../services/supportDeskService";
import { buildSendBody } from "./supportComposerModel";

function localInput(date) {
  const copy = new Date(date.getTime());
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}

function tomorrowNoon() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(12, 0, 0, 0);
  return date;
}

function SendWaitForm({ customerName, sending, onBack, onConfirm }) {
  const [at, setAt] = useState(() => localInput(tomorrowNoon()));
  const [note, setNote] = useState("We'll check back on this.");
  const [openedAt] = useState(() => Date.now());
  const iso = at ? new Date(at).toISOString() : null;
  const valid = iso && Date.parse(iso) > openedAt && note.trim();
  const shown = iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <>
      <ModalBody>
        <div className="space-y-4">
          <Input label="When will you check back?" type="datetime-local" min={localInput(new Date(openedAt))} value={at} onChange={(event) => setAt(event.target.value)} />
          <Input label="What you'll do before then" value={note} onChange={(event) => setNote(event.target.value)} />
          <p className="rounded-lg bg-[var(--gray-50)] p-3 text-sm text-[var(--color-text-secondary)]">
            Shown to {customerName} as "Waiting on you · we'll check back by {shown}". If they reply first, the ticket goes back to Needs reply. If the time passes with no reply, it moves to Overdue for the owner.
          </p>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onBack} disabled={sending}>Back</Button>
        <Button variant="primary" loading={sending} disabled={!valid || sending} onClick={() => onConfirm({ nextUpdateAt: iso, note: note.trim() })}>
          Send and set Waiting
        </Button>
      </ModalFooter>
    </>
  );
}

export function SendWaitModal({ open, onBack, ...props }) {
  return (
    <Modal open={open} onClose={onBack} title="Send and wait" size="sm">
      {open && <SendWaitForm onBack={onBack} {...props} />}
    </Modal>
  );
}

/**
 * ticket: the open ticket. customerName: who a reply goes to.
 * onSent(result): reload after a send. onError(message), onSessionExpired().
 */
export function SupportComposer({ ticket, customerName, onSent, onError, onSessionExpired }) {
  const internalOnly = ticket.visibility === "internal";
  const closed = ticket.status === "closed";
  const [mode, setMode] = useState(internalOnly ? "note" : "reply");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [waitOpen, setWaitOpen] = useState(false);
  const uploads = useSupportUploads({ ticketId: ticket.id, isInternal: false });
  const note = mode === "note";

  const canSend = useMemo(
    () => !sending && !closed && uploads.ready && !uploads.busy && (text.trim().length > 0 || uploads.attachmentIds.length > 0),
    [sending, closed, uploads.ready, uploads.busy, text, uploads.attachmentIds.length],
  );

  async function send(waiting = null) {
    if (!canSend) return;
    setSending(true);
    const body = buildSendBody({ ticketId: ticket.id, mode, content: text, attachmentIds: uploads.attachmentIds, waiting });
    const result = await sendSupportMessage(body);
    setSending(false);
    if (!result.ok) {
      if (result.sessionExpired) onSessionExpired?.();
      onError?.(result.error);
      return;
    }
    setWaitOpen(false);
    setText("");
    uploads.clear();
    await onSent?.(result.data, { mode, waiting: Boolean(waiting) });
  }

  if (closed) {
    return (
      <div className="border-t border-[var(--gray-200)] p-3 text-sm text-[var(--color-text-secondary)]">
        This ticket is closed, so it can't take new messages.
      </div>
    );
  }

  return (
    <div
      className={`border-t p-3 ${note ? "border-[#d4a72c] bg-[#fffbea]" : "border-[var(--gray-200)]"}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer?.files?.length) uploads.addFiles(event.dataTransfer.files);
      }}
    >
      <div className="mb-2 inline-flex rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-0.5" role="group" aria-label="Message type">
        <button
          type="button"
          aria-pressed={!note}
          disabled={internalOnly || sending}
          onClick={() => setMode("reply")}
          className={`rounded-md px-3 py-1 text-xs font-semibold ${!note ? "bg-[var(--color-brand-500)] text-white" : "text-[var(--color-text-secondary)]"} disabled:cursor-not-allowed disabled:opacity-50`}
          title={internalOnly ? "Internal tickets take notes only" : undefined}
        >
          Reply to {customerName}
        </button>
        <button
          type="button"
          aria-pressed={note}
          disabled={sending}
          onClick={() => setMode("note")}
          className={`rounded-md px-3 py-1 text-xs font-semibold ${note ? "bg-[#d4a72c] text-white" : "text-[var(--color-text-secondary)]"}`}
        >
          Internal note
        </button>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={uploads.onPaste}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
          }
        }}
        rows={3}
        disabled={sending}
        aria-label={note ? "Internal note" : `Reply to ${customerName}`}
        placeholder={note ? "Internal note. Only staff will see this…" : `Write a reply. ${customerName} gets a push…`}
        className={`${TEXTAREA_CLASS} ${note ? "border-dashed border-[#d4a72c] bg-[#fff8db]" : ""}`}
      />
      {uploads.notice && <p role="status" className="mt-1 text-xs text-[var(--color-warning-700)]">{uploads.notice}</p>}
      <div className="mt-2"><UploadThumbnails uploads={uploads} disabled={sending} /></div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <AddImagesButton uploads={uploads} disabled={sending} />
          <span className="text-[11px] text-[var(--color-text-tertiary)]">paste works here too</span>
        </div>
        <div className="flex gap-2">
          {!note && (
            <Button variant="secondary" size="sm" disabled={!canSend} onClick={() => setWaitOpen(true)}>
              Send and wait
            </Button>
          )}
          <Button variant="primary" size="sm" loading={sending && !waitOpen} disabled={!canSend} onClick={() => void send()}>
            {note ? "Add note" : "Send"}
          </Button>
        </div>
      </div>
      {uploads.busy && <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Send unlocks when every image has uploaded.</p>}
      <SendWaitModal
        open={waitOpen}
        customerName={customerName}
        sending={sending}
        onBack={() => setWaitOpen(false)}
        onConfirm={(waiting) => void send(waiting)}
      />
    </div>
  );
}
