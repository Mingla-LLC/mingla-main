// Issue #4130 (Wave 4a) — "Reset due dates" for stale cards: a confirmation
// that says how many cards change and to what date. The server changes only
// the cards that are still stale (outreach_reset_stale_due) and audits each.
import { useState } from "react";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Button } from "../ui/Button";
import { defaultResetDue } from "../../lib/outreachView";

export function ResetDueModal({ open, count, singular, today, busy, error, onConfirm, onCancel }) {
  const [due, setDue] = useState(() => defaultResetDue(today));
  const valid = typeof due === "string" && due >= today;
  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} title="Reset stale due dates" size="sm">
      <ModalBody>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {count.toLocaleString()} {count === 1 ? singular : `${singular}s`} {count === 1 ? "is" : "are"} past their due date.
          They all get the new date below, so the Due badges mean something again. Their stage, owner and next step stay the same.
        </p>
        <label htmlFor="reset-due-date" className="mt-4 mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">New due date</label>
        <input
          id="reset-due-date"
          type="date"
          min={today}
          value={due}
          disabled={busy}
          onChange={(e) => setDue(e.target.value)}
          className="min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm"
        />
        {error && <p role="alert" className="mt-3 text-sm text-[var(--color-error-700)]">{error}</p>}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" className="min-h-11" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button className="min-h-11" loading={busy} disabled={!valid || count === 0} onClick={() => onConfirm(due)}>
          Reset {count.toLocaleString()} due {count === 1 ? "date" : "dates"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
