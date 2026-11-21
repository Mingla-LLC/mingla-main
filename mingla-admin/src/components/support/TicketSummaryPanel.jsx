// Issue #4420 (step 5) — the read-only summary of a ticket linked to a Support
// conversation (title, type, status), beside the thread. Work board people get
// "Open on the Work board"; for anyone else that address lands on this same
// summary (lib/adminRoutes). The Work card is the only "ticket"; this panel
// changes nothing.
import { X } from "lucide-react";
import { Button } from "../ui/Button";
import { ticketNumber, ticketTypeLabel } from "../../lib/ticketModel";

const STATUS_WORDS = Object.freeze({ todo: "To do", doing: "In progress", person: "With a person", done: "Done" });

/** Props: linked ({ card_id, number, title, type, status }), onClose. */
export function TicketSummaryPanel({ linked, onClose }) {
  return (
    <aside aria-label={`Ticket ${ticketNumber(linked.number)}`} data-ticket-summary="" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] lg:h-[calc(100vh-180px)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--gray-200)] px-4 py-3">
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">Ticket T{linked.number}</p>
        <Button size="sm" variant="ghost" icon={X} onClick={onClose} aria-label="Close ticket summary" />
      </div>
      <div className="flex flex-col gap-3 p-4 text-sm">
        <p className="break-words text-base font-semibold text-[var(--color-text-primary)]">{linked.title}</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-[var(--color-text-tertiary)]">Type</dt><dd>{ticketTypeLabel(linked.type) || "Ticket"}</dd>
          <dt className="text-[var(--color-text-tertiary)]">Status</dt><dd>{STATUS_WORDS[linked.status] || linked.status}</dd>
        </dl>
        <a href={`#/work-board?card=${encodeURIComponent(linked.card_id)}`} className="self-start text-sm font-semibold text-[var(--color-brand-700)] underline-offset-2 hover:underline">Open on the Work board</a>
      </div>
    </aside>
  );
}
