// Issue #4420 (step 4) — what a ticket's card shows above its Description:
// Type and product area (editable by Work board users), Reporters and the
// conversations (TicketConversations), and Send to GitHub. Owner, watcher and
// due sit in the card's ordinary People and dates line; nothing here locks or
// assigns an owner.
import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { useToast } from "../../context/ToastContext";
import * as ops from "../../services/opsService";
import { opsErrorWords } from "../../lib/opsModel";
import { TICKET_TYPES, isTicketCard, ticketTypeLabel } from "../../lib/ticketModel";
import { PRODUCT_AREAS } from "../support/supportOptions";
import { TicketConversations } from "./TicketConversations";
import { TicketGithubSection } from "./TicketGithubSection";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";
const INPUT = `min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] text-[var(--color-text-primary)] ${FOCUS}`;

function TypeAndArea({ card, canEdit, onChanged }) {
  const { addToast } = useToast();
  const t = card.ticket || {};
  const [type, setType] = useState(t.type || "bug");
  const [area, setArea] = useState(t.product_area || "");
  const [busy, setBusy] = useState(false);
  // A newer read of the card replaces what was typed.
  useEffect(() => { setType(t.type || "bug"); setArea(t.product_area || ""); }, [t.type, t.product_area, card.revision]); // eslint-disable-line react-hooks/set-state-in-effect
  const dirty = type !== t.type || area.trim() !== (t.product_area || "");
  const save = async () => {
    setBusy(true);
    try {
      await ops.updateTicket(card.id, { type, product_area: area.trim() }, card.revision);
      addToast({ variant: "success", title: "Ticket updated" });
      await onChanged?.();
    } catch (error) {
      if (error?.token === "stale_write") { addToast({ variant: "warning", title: "This card changed. Showing the latest." }); await onChanged?.(); }
      else addToast({ variant: "error", title: "That didn’t save", description: opsErrorWords(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Type and product area" data-ticket-type="" className="flex min-w-0 flex-col gap-2">
      <h3 className={LABEL}>Type and product area</h3>
      {canEdit ? (
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="sr-only">Type</span>
            <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className={INPUT}>
              {TICKET_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <span className="sr-only">Product area</span>
            <input aria-label="Product area" value={area} maxLength={120} list="ticket-detail-areas" onChange={(e) => setArea(e.target.value)} className={INPUT} />
            <datalist id="ticket-detail-areas">{PRODUCT_AREAS.map((a) => <option key={a} value={a} />)}</datalist>
          </label>
          {dirty && <Button className="min-h-11" loading={busy} disabled={busy || !area.trim()} onClick={save}>Save</Button>}
        </div>
      ) : (
        <p className="text-[13px] text-[var(--color-text-primary)]">{ticketTypeLabel(t.type)} · {t.product_area}</p>
      )}
    </section>
  );
}

/** Props: card (a ticket), canEdit, isOperator (product operator), locked, onChanged. */
export function TicketSections({ card, canEdit, isOperator, locked = false, onChanged }) {
  if (!isTicketCard(card) || !card.ticket) return null;
  return (
    <div data-ticket-sections="" className="flex min-w-0 flex-col gap-4">
      <TypeAndArea card={card} canEdit={canEdit && card.status !== "done"} onChanged={onChanged} />
      <TicketConversations cardId={card.id} reporterCount={Number(card.ticket.reporter_count) || 0} />
      <TicketGithubSection card={card} isOperator={isOperator} disabled={locked} onChanged={onChanged} />
    </div>
  );
}
