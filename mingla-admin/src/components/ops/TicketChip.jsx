// Issue #4420 (step 4) — the "Ticket" chip a ticket carries on every card
// face and list row: Ticket, its T-number, its type and its reporter count.
// Nothing is drawn for an ordinary card.
import { ticketChipWords } from "../../lib/ticketModel";

export function TicketChip({ card, compact = false }) {
  const t = ticketChipWords(card);
  if (!t) return null;
  const words = compact ? [t.number, t.type].filter(Boolean).join(" · ") : [t.label, t.number, t.type, t.reporterWords].filter(Boolean).join(" · ");
  return <span data-ticket-chip="" className="rounded-full bg-[var(--color-info-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-info-700)]">{words}</span>;
}
