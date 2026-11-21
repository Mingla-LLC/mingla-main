// Issue #4420 (step 5) — "Create ticket" from a Support conversation: a side
// panel BESIDE the thread (not a modal) that wraps the step 4 TicketForm,
// pre-filled from the conversation. The person making it chooses the owner
// (nothing is automatic) and the due date starts at 7 days. Similar open
// tickets come first with "Link here". When it is made, the panel says the
// ticket number, that it is on the Work board, and gives the line a person may
// send the customer. Nothing is sent to the customer from here.
import { useLayoutEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "../ui/Button";
import { TicketForm } from "../ops/TicketForm";
import { useOpsConfig } from "../../hooks/useOpsConfig";
import { useToast } from "../../context/ToastContext";
import { customerLineFor, sidePanelFitHeight, ticketPrefill } from "../../lib/supportInboxModel";
import { ticketNumber } from "../../lib/ticketModel";

/**
 * Props: ticket (the conversation), messages (its thread, for the pre-fill),
 * onClose, onMade({ number, id }) after a ticket is made, onLinked(cardId)
 * after "Link here" or an existing ticket was opened, onDirtyChange(dirty)
 * whenever the form gains or loses edits (the page asks before discarding them).
 */
export function CreateTicketPanel({ ticket, messages, onClose, onMade, onLinked, onDirtyChange }) {
  const config = useOpsConfig();
  const { addToast } = useToast();
  const [done, setDone] = useState(null);
  const prefill = ticketPrefill(ticket, messages);
  // The form starts with the owner suggestion once the config has answered (or failed):
  // a failed config still lets a person pick an owner from the people list.
  const settled = !config.loading || config.error != null;
  // In the third column (1280 px and wider) the panel is as tall as the room
  // left under its top, so the header and the Create / Cancel row stay in
  // view and the form scrolls inside. Narrower, it is the full-height overlay.
  const asideRef = useRef(null);
  const [fitHeight, setFitHeight] = useState(null);
  useLayoutEffect(() => {
    const el = asideRef.current;
    if (!el || typeof window === "undefined") return undefined;
    const wide = window.matchMedia?.("(min-width: 1280px)");
    const fit = () => setFitHeight(wide?.matches ? sidePanelFitHeight(el.getBoundingClientRect().top, window.innerHeight) : null);
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, { passive: true });
    return () => { window.removeEventListener("resize", fit); window.removeEventListener("scroll", fit); };
  }, []);

  async function copyLine(text) {
    try {
      await navigator.clipboard.writeText(text);
      addToast({ variant: "success", title: "Copied" });
    } catch {
      addToast({ variant: "error", title: "Couldn't copy", description: "Select the line and copy it by hand." });
    }
  }

  return (
    <aside aria-label="Create ticket" data-create-ticket-panel="" ref={asideRef} style={fitHeight ? { height: fitHeight } : undefined} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] lg:h-[calc(100vh-180px)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--gray-200)] px-4 py-3">
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">Create ticket from {prefill.source.label}</p>
        <Button size="sm" variant="ghost" icon={X} onClick={onClose} aria-label="Close create ticket" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {done ? (
          <div role="status" data-ticket-made="" className="flex flex-col gap-3 rounded-xl bg-[var(--color-success-50)] p-4 text-sm text-[var(--color-success-700)]">
            <p className="flex items-center gap-2 font-semibold"><Check className="h-4 w-4" aria-hidden="true" />{done.number ? `Ticket ${ticketNumber(done.number)} is made` : "Linked to the ticket"}</p>
            <p>It is on the Work board, and this conversation is linked to it as a reporter.</p>
            {done.number ? (
              <div className="flex flex-col gap-1.5 rounded-lg bg-[var(--color-background-primary)] p-3 text-[var(--color-text-primary)]">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Nothing was sent to the customer. A line you can send</p>
                <p data-customer-line="" className="break-words">{customerLineFor(done.number)}</p>
                <Button size="sm" variant="secondary" className="self-start" onClick={() => void copyLine(customerLineFor(done.number))}>Copy line</Button>
              </div>
            ) : null}
            <Button size="sm" variant="secondary" className="self-start" onClick={onClose}>Done</Button>
          </div>
        ) : !settled ? (
          <p className="px-1 py-6 text-sm text-[var(--color-text-tertiary)]">Getting the form ready…</p>
        ) : (
          <TicketForm
            key={ticket.id}
            config={config.data || undefined}
            online
            conversation={prefill.source}
            createdFrom="conversation"
            initialTitle={prefill.title}
            initialWhatIsWrong={prefill.whatIsWrong}
            initialType={prefill.type}
            initialProductArea={prefill.productArea}
            onCancel={onClose}
            onDirtyChange={onDirtyChange}
            stickyActions
            onCreated={(card) => { onDirtyChange?.(false); setDone({ number: card?.number, id: card?.id }); onMade?.(card); }}
            onOpenCard={(id) => { if (id) { setDone({ number: null, id }); onLinked?.(id); } }}
          />
        )}
      </div>
    </aside>
  );
}
