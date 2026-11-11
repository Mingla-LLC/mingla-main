// Issue #4255 (W2) — the two dialogs the board opens:
//   * CloseCardDialog: a card dropped in (or moved to) a Closed column asks
//     for proof first, with the same rules as Done with proof. A card with
//     open subtasks offers "Close the open subtasks too". Cancel puts the
//     card back where it was; nothing is saved until Close card.
//   * ArchiveColumnDialog: archiving a column asks which column of the same
//     group its cards move to (so no card changes group).
import { useState } from "react";
import { Modal, ModalBody } from "../ui/Modal";
import { Button } from "../ui/Button";
import { ProofForm } from "./ProofForm";
import { GROUP_LABELS, archiveTargets, subtaskProgress } from "../../lib/workBoardModel";

export function CloseCardDialog({ card, column, busy, onCancel, onClose }) {
  const sub = subtaskProgress(card?.subtasks);
  const open = sub.total - sub.done;
  const [children, setChildren] = useState(false);
  if (!card) return null;
  return (
    <Modal open onClose={onCancel} title={`Close #${card.number}`} size="sm">
      <ModalBody>
        <div data-close-sheet={card.id} className="flex min-w-0 flex-col gap-2">
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Moving <span className="font-semibold text-[var(--color-text-primary)]">{card.title}</span> to {column?.name || "a Closed column"} closes it. Add what shows it is done.
          </p>
          {open > 0 && (
            <label className="flex min-h-11 items-start gap-2 text-[13px] text-[var(--color-text-primary)]">
              <input type="checkbox" data-close-children="" checked={children} onChange={(e) => setChildren(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--color-brand-700)]" />
              <span>Close the {open} open {open === 1 ? "subtask" : "subtasks"} too</span>
            </label>
          )}
          <ProofForm busy={busy} onCancel={onCancel} onSubmit={(proof, result) => onClose(proof, result, children)} />
        </div>
      </ModalBody>
    </Modal>
  );
}

export function ArchiveColumnDialog({ column, columns, busy, onCancel, onArchive }) {
  const targets = archiveTargets(column, columns);
  const [to, setTo] = useState(targets[0]?.id || "");
  if (!column) return null;
  const count = Number(column.count) || 0;
  return (
    <Modal open onClose={onCancel} title={`Archive “${column.name}”?`} size="sm" destructive>
      <ModalBody>
        <div data-archive-column={column.id} className="flex min-w-0 flex-col gap-3">
          {targets.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">{column.name} is the only {GROUP_LABELS[column.grp]} column. Add another {GROUP_LABELS[column.grp]} column first.</p>
          ) : (
            <>
              <p className="text-[13px] text-[var(--color-text-secondary)]">
                {count ? `Its ${count} ${count === 1 ? "card moves" : "cards move"} to another ${GROUP_LABELS[column.grp]} column, so none of them changes what it counts as.` : `It has no cards. It counts as ${GROUP_LABELS[column.grp]}.`}
              </p>
              <label className="flex min-w-0 flex-col gap-1 text-[12.5px] font-semibold text-[var(--color-text-secondary)]">
                Move its cards to
                <select value={to} onChange={(e) => setTo(e.target.value)} className="min-h-11 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-[13px] font-normal text-[var(--color-text-primary)]">
                  {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            </>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button variant="danger" disabled={busy || !to || targets.length === 0} onClick={() => onArchive(to)}>{busy ? "Archiving…" : "Archive column"}</Button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}
