// #4382 Wave 2 / #4420 (step 5) — the conversation beside the inbox list:
// header (name, labels, Create ticket, Resolve or Reopen), facts (from / about,
// owner with Take it, topic, device, next update), the thread as chat bubbles
// with images, voice notes, internal notes and system lines, and the
// Reply / Internal note composer. A conversation is a customer thread; "ticket"
// means only the Work card linked to it.
import { useCallback, useEffect, useRef, useState } from "react";
import { UserCheck, X } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Select } from "../crm/fields";
import { SupportThread } from "./SupportThread";
import { SupportComposer } from "./SupportComposer";
import { WebsiteRequestBox } from "./WebsiteRequestBox";
import { isWebsiteRequestTicket } from "../../lib/websiteRequestModel";
import { replyTargetLabel } from "./supportComposerModel";
import { PRIORITY_OPTIONS, STATUS_BADGE, STATUS_LABEL, TOPIC_LABEL, deviceLine } from "./supportOptions";
import { isOverdueTicket } from "../../lib/supportTicketMetrics";
import { conversationRow, createTicketButton, rowLabels, rowTitle } from "../../lib/supportInboxModel";
import { LabelChips } from "./InboxLabels";
import { listTicketThread, signAttachmentUrls } from "../../services/supportDeskService";
import { supabase } from "../../lib/supabase";
import { formatDateTime } from "../../lib/formatters";

const STATUS_OPTIONS = ["new", "open", "pending", "resolved", "closed"].map((value) => ({ value, label: STATUS_LABEL[value] }));

/**
 * Props: ticket, linkedTickets (the Work tickets linked to this conversation),
 * profilesById, brandsById, myUserId, acting, createOpen, onClose, onClaim,
 * onSetStatus, onSetPriority, onCreateTicket(messages), onOpenLinkedTicket(linked),
 * onChanged (reload the inbox), onError(title, message), onSessionExpired,
 * onWebsiteReady(note) (#4453: "Ready for review" on a website change request).
 */
export function TicketPanel({
  ticket, linkedTickets = [], profilesById, brandsById, myUserId, acting, createOpen = false,
  onClose, onClaim, onSetStatus, onSetPriority, onCreateTicket, onOpenLinkedTicket, onChanged, onError, onSessionExpired,
  onWebsiteReady,
}) {
  const [messages, setMessages] = useState([]);
  const [factsOpen, setFactsOpen] = useState(true);
  const [urls, setUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const liveRef = useRef(true);
  const bottomRef = useRef(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await listTicketThread(ticket);
      const paths = rows.flatMap((message) => message.attachments.map((attachment) => attachment.storage_path));
      let signed = {};
      try {
        signed = await signAttachmentUrls(paths);
      } catch (signError) {
        onError?.("Couldn't open the attachments", signError.message);
      }
      if (!liveRef.current) return;
      setMessages(rows);
      setUrls(signed);
    } catch (loadError) {
      if (liveRef.current) setError(loadError.message);
    } finally {
      if (liveRef.current) setLoading(false);
    }
  }, [ticket, onError]);

  useEffect(() => {
    liveRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load on open, like the other admin pages
    setLoading(true);
    setMessages([]);
    void load();
    return () => { liveRef.current = false; };
  }, [ticket.id, ticket.conversation_id]); // eslint-disable-line react-hooks/exhaustive-deps -- reload per ticket, not per prop identity

  useEffect(() => {
    if (!ticket.conversation_id) return undefined;
    const channel = supabase
      .channel(`admin-support-thread-${ticket.conversation_id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${ticket.conversation_id}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "support_attachments", filter: `ticket_id=eq.${ticket.id}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [ticket.conversation_id, ticket.id, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length]);

  const requester = ticket.requester_user_id ? profilesById[ticket.requester_user_id] : null;
  const owner = ticket.assigned_staff_id ? profilesById[ticket.assigned_staff_id] : null;
  const brand = ticket.brand_id ? brandsById[ticket.brand_id] : null;
  const creator = ticket.created_by ? profilesById[ticket.created_by] : null;
  const personName = requester?.display_name || requester?.username || requester?.email || "";
  const row = conversationRow(ticket);
  const labels = rowLabels(row, linkedTickets);
  const title = rowTitle(row, { profilesById, brandsById });
  const ticketButton = createTicketButton(linkedTickets);
  const isDone = ticket.status === "resolved" || ticket.status === "closed";
  const overdue = isOverdueTicket(ticket);
  const device = deviceLine(ticket);
  const target = replyTargetLabel(ticket, { personName: personName.split(" ")[0], brandName: brand?.name });

  return (
    // #4382 runtime P3a: the header, the compact facts and the thread scroll
    // together; the thread keeps at least ~55% of the panel's height and the
    // composer stays pinned at the bottom.
    <aside aria-label={`Conversation ${ticket.ticket_number ?? ""}`} className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] lg:h-[calc(100vh-180px)]">
      <div data-testid="ticket-panel-scroll" className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-[var(--gray-200)] p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-[var(--color-text-primary)]">{title}</h3>
            <p className="truncate text-xs text-[var(--color-text-tertiary)]">Conversation {ticket.ticket_number ?? ""} · {ticket.subject}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {!ticket.assigned_staff_id && !isDone && (
              <Button size="sm" variant="secondary" icon={UserCheck} loading={acting} disabled={acting} onClick={onClaim}>Take it</Button>
            )}
            {ticketButton.linked ? (
              <Button size="sm" variant="secondary" aria-label={`Open ticket T${linkedTickets[0].number}`} onClick={() => onOpenLinkedTicket?.(linkedTickets[0])}>{ticketButton.text}</Button>
            ) : (
              <Button size="sm" variant="primary" disabled={createOpen} onClick={() => onCreateTicket?.(messages)}>{ticketButton.text}</Button>
            )}
            {isDone ? (
              <Button size="sm" variant="secondary" loading={acting} disabled={acting} onClick={() => onSetStatus("open")}>Reopen</Button>
            ) : (
              <Button size="sm" variant="secondary" loading={acting} disabled={acting} onClick={() => onSetStatus("resolved")}>Resolve</Button>
            )}
            <Button size="sm" variant="ghost" icon={X} onClick={onClose} aria-label="Close conversation" />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <LabelChips labels={labels} onOpenTicket={onOpenLinkedTicket} />
          {ticket.priority === "urgent" && <Badge variant="error">Urgent</Badge>}
          {ticket.priority === "high" && <Badge variant="warning">High</Badge>}
          {overdue && <Badge variant="error">Update overdue</Badge>}
          {ticket.imported_from === "beta_feedback" && <Badge variant="outline">From beta feedback</Badge>}
        </div>
      </div>

      {isWebsiteRequestTicket(ticket) && (
        <WebsiteRequestBox
          key={ticket.id}
          ticket={ticket}
          profilesById={profilesById}
          onReady={async (note) => {
            const result = await onWebsiteReady?.(note);
            if (result?.ok) await load();
            return result;
          }}
        />
      )}

      <div className="flex items-center justify-between border-b border-[var(--gray-200)] px-4 py-1.5">
        <span className="text-xs font-medium text-[var(--color-text-tertiary)]">Details</span>
        <button
          type="button"
          aria-expanded={factsOpen}
          aria-controls={`ticket-facts-${ticket.id}`}
          onClick={() => setFactsOpen((open) => !open)}
          className="rounded px-2 py-0.5 text-xs font-medium text-[var(--color-brand-600)] hover:bg-[var(--gray-100)]"
        >
          {factsOpen ? "Hide details" : "Show details"}
        </button>
      </div>
      {factsOpen && (
      <dl id={`ticket-facts-${ticket.id}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-[var(--gray-200)] px-4 py-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <dt className="text-[var(--color-text-tertiary)]">{ticket.origin === "staff" ? "About" : "From"}</dt>
        <dd className="min-w-0 truncate text-[var(--color-text-primary)]">
          {[personName || (ticket.visibility === "brand" ? null : ticket.imported_from === "beta_feedback" ? "Explorer (beta feedback)" : null), brand?.name].filter(Boolean).join(" · ") || "No customer linked"}
          {requester?.email && <span className="block truncate text-xs text-[var(--color-text-tertiary)]">{requester.email}</span>}
        </dd>
        {ticket.origin === "staff" && (
          <>
            <dt className="text-[var(--color-text-tertiary)]">Opened by</dt>
            <dd className="min-w-0 truncate">{creator?.display_name || creator?.email || "Mingla staff"}</dd>
          </>
        )}
        <dt className="text-[var(--color-text-tertiary)]">Owner</dt>
        <dd className="min-w-0 truncate">{owner ? (owner.id === myUserId ? "You" : owner.display_name || owner.email) : "Nobody yet"}</dd>
        {ticket.topic && (
          <>
            <dt className="text-[var(--color-text-tertiary)]">Topic</dt>
            <dd>{TOPIC_LABEL[ticket.topic] || ticket.topic}</dd>
          </>
        )}
        {ticket.product_area && (
          <>
            <dt className="text-[var(--color-text-tertiary)]">Area</dt>
            <dd className="min-w-0 truncate">{ticket.product_area}</dd>
          </>
        )}
        {device && (
          <>
            <dt className="text-[var(--color-text-tertiary)]">Device</dt>
            <dd className="min-w-0 truncate">{device}</dd>
          </>
        )}
        <dt className="text-[var(--color-text-tertiary)]">Next update</dt>
        <dd className={overdue ? "font-medium text-[var(--color-error-700)]" : ""}>
          {ticket.visibility === "internal" && !ticket.next_update_at
            ? "Not needed (internal)"
            : ticket.next_update_at ? `${formatDateTime(ticket.next_update_at)}${ticket.next_update_note ? ` · ${ticket.next_update_note}` : ""}` : "Not set"}
        </dd>
        <dt className="self-center text-[var(--color-text-tertiary)]">Status</dt>
        <dd>
          <Select aria-label="Status" value={ticket.status} disabled={acting} onChange={(event) => onSetStatus(event.target.value)} options={STATUS_OPTIONS} className="!min-h-8 !py-0.5 !text-xs" />
        </dd>
        <dt className="self-center text-[var(--color-text-tertiary)]">Priority</dt>
        <dd>
          <Select aria-label="Priority" value={ticket.priority} disabled={acting} onChange={(event) => onSetPriority(event.target.value)} options={PRIORITY_OPTIONS} className="!min-h-8 !py-0.5 !text-xs" />
        </dd>
      </dl>
      )}

      <div data-testid="ticket-thread" className="min-h-[320px] space-y-3 p-4 lg:min-h-[calc((100vh-180px)*0.55)]">
        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : error ? (
          <div role="alert" className="space-y-2 rounded-lg bg-[var(--color-error-50)] p-3 text-xs text-[var(--color-error-700)]">
            <p>Couldn't load the conversation: {error}</p>
            <Button size="sm" variant="secondary" onClick={() => { setLoading(true); void load(); }}>Try again</Button>
          </div>
        ) : (
          <SupportThread ticket={ticket} messages={messages} urls={urls} profilesById={profilesById} myUserId={myUserId} />
        )}
        {linkedTickets.map((linked) => (
          <p key={linked.card_id || linked.number} data-system-line="" className="text-center text-xs italic text-[var(--color-text-tertiary)]">
            Ticket T{linked.number} created{linked.status === "done" ? " and closed" : ""}
          </p>
        ))}
        <div ref={bottomRef} />
      </div>
      </div>

      <SupportComposer
        key={ticket.id}
        ticket={ticket}
        customerName={target}
        onSent={async (data, { mode, waiting }) => {
          await load();
          await onChanged?.({ data, mode, waiting });
        }}
        onError={(message) => onError?.("Couldn't send", message)}
        onSessionExpired={onSessionExpired}
      />
    </aside>
  );
}
