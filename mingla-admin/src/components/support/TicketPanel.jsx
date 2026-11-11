// #4382 Wave 2 — the ticket side panel beside the inbox list: header, facts
// (from / about, owner with Take it, topic, device, next update), the thread
// with images, voice notes and internal notes, the Product box, and the
// Reply / Internal note composer.
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, UserCheck, X } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Select } from "../crm/fields";
import { SupportThread } from "./SupportThread";
import { SupportComposer } from "./SupportComposer";
import { replyTargetLabel } from "./supportComposerModel";
import { PRIORITY_OPTIONS, STATUS_BADGE, STATUS_LABEL, TOPIC_LABEL, deviceLine } from "./supportOptions";
import { productPrefillDetails, BOARD_COLUMNS, STAGE_LABEL, stageIndex } from "./productBoardModel";
import { isOverdueTicket, originChip, ticketNumberLabel } from "../../lib/supportTicketMetrics";
import { listTicketThread, signAttachmentUrls } from "../../services/supportDeskService";
import { fetchTicketEngineering } from "../../services/opsService";
import { githubChipClass } from "../../lib/opsModel";
import { supabase } from "../../lib/supabase";
import { formatDateTime } from "../../lib/formatters";

const STATUS_OPTIONS = ["new", "open", "pending", "resolved", "closed"].map((value) => ({ value, label: STATUS_LABEL[value] }));

// #3980 Wave 2 (Bridge C): one "Engineering" row from the Product item this
// ticket is linked to. Nothing shows when it is not linked.
function EngineeringRow({ sourceKind, sourceId }) {
  const [attempt, setAttempt] = useState(0);
  const key = `${sourceKind}:${sourceId}:${attempt}`;
  const [answer, setAnswer] = useState({ key: null, error: null, data: null });
  useEffect(() => {
    let live = true;
    fetchTicketEngineering(sourceKind, sourceId)
      .then((data) => { if (live) setAnswer({ key, error: null, data }); })
      .catch((error) => { if (live) setAnswer({ key, error, data: null }); });
    return () => { live = false; };
  }, [sourceKind, sourceId, key]);
  const state = answer.key === key ? answer : { error: null, data: null, loading: true };
  if (state.loading) {
    return <div aria-label="Reading engineering status" className="h-4 w-48 animate-pulse rounded bg-[var(--gray-100)]" />;
  }
  if (state.error) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span role="alert" className="text-[var(--color-error-700)]">Couldn't read engineering status.</span>
        <Button variant="ghost" size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
      </div>
    );
  }
  const data = state.data;
  if (!data?.linked) return null;
  const n = data.issue?.number;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <a href={data.issue?.url} target="_blank" rel="noopener noreferrer" title={data.issue?.title || undefined}
        className={`inline-flex min-h-8 items-center gap-1 self-start rounded-full px-2.5 font-medium hover:underline ${githubChipClass(data.label)}`}>
        <span className="break-normal [overflow-wrap:normal]">Engineering: {data.label} · #{n}</span>
        <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" />
        <span className="sr-only">(opens GitHub in a new tab)</span>
      </a>
      {data.live && <p className="text-[var(--color-success-700)]">Live: you can tell the host it is fixed.</p>}
    </div>
  );
}

function ProductBox({ ticket, signal, messages, onSendToProduct }) {
  if (!signal) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--gray-200)] p-3 text-sm">
        <span className="text-[var(--color-text-tertiary)]">Not linked to product work</span>
        <Button size="sm" variant="secondary" onClick={() => onSendToProduct(ticket, productPrefillDetails(ticket, messages))}>Send to Product</Button>
      </div>
    );
  }
  const index = stageIndex(signal.state);
  return (
    <div className="space-y-2 rounded-xl border border-[var(--color-info-200,#bfdbfe)] bg-[var(--color-info-50)] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-[var(--color-text-primary)]">Product: {STAGE_LABEL[signal.state] || signal.state}</strong>
        <span className="text-xs text-[var(--color-text-secondary)]">{signal.affected_people} reporter{signal.affected_people === 1 ? "" : "s"}</span>
      </div>
      <p className="truncate text-xs text-[var(--color-text-secondary)]">{signal.title}</p>
      {signal.state === "wont_do" ? (
        <p className="text-xs text-[var(--color-text-secondary)]">Won't do: {signal.wont_do_reason}</p>
      ) : (
        <>
          <div className="grid grid-cols-5 gap-1" aria-hidden="true">
            {BOARD_COLUMNS.map((column, i) => (
              <span key={column.id} className={`h-1.5 rounded-full ${i < index ? "bg-[var(--color-brand-500)]" : "bg-[var(--gray-200)]"}`} />
            ))}
          </div>
          <div className="grid grid-cols-5 gap-1 text-[10px] text-[var(--color-text-tertiary)]">
            {BOARD_COLUMNS.map((column) => <span key={column.id}>{column.label}</span>)}
          </div>
        </>
      )}
      <EngineeringRow sourceKind="support_ticket" sourceId={ticket.id} />
      <a href={`#/community?tab=product&signal=${encodeURIComponent(signal.id)}`} className="inline-block text-xs font-semibold text-[var(--color-brand-600)] underline-offset-2 hover:underline">
        Open on the Product board
      </a>
    </div>
  );
}

/**
 * Props: ticket, profilesById, brandsById, staffRoster, signal, myUserId,
 * acting, onClose, onClaim, onSetStatus, onSetPriority, onSendToProduct,
 * onChanged (reload the inbox), onError(title, message), onSessionExpired.
 */
export function TicketPanel({
  ticket, profilesById, brandsById, signal, myUserId, acting,
  onClose, onClaim, onSetStatus, onSetPriority, onSendToProduct, onChanged, onError, onSessionExpired,
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
  const chip = originChip(ticket);
  const overdue = isOverdueTicket(ticket);
  const device = deviceLine(ticket);
  const target = replyTargetLabel(ticket, { personName: personName.split(" ")[0], brandName: brand?.name });

  return (
    // #4382 runtime P3a: the header, the compact facts and the thread scroll
    // together; the thread keeps at least ~55% of the panel's height and the
    // composer stays pinned at the bottom.
    <aside aria-label={`Ticket ${ticketNumberLabel(ticket)}`} className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] lg:h-[calc(100vh-180px)]">
      <div data-testid="ticket-panel-scroll" className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-[var(--gray-200)] p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-[var(--color-text-tertiary)]">{ticketNumberLabel(ticket)}</span>
          <div className="flex items-center gap-1">
            {!ticket.assigned_staff_id && (
              <Button size="sm" variant="primary" icon={UserCheck} loading={acting} disabled={acting} onClick={onClaim}>Take it</Button>
            )}
            <Button size="sm" variant="ghost" icon={X} onClick={onClose} aria-label="Close ticket" />
          </div>
        </div>
        <h3 className="mt-1 text-base font-semibold text-[var(--color-text-primary)]">{ticket.subject}</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant={STATUS_BADGE[ticket.status] || "default"}>{STATUS_LABEL[ticket.status] || ticket.status}</Badge>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${chip.kind === "staff" ? "bg-[#f3e8ff] text-[#6b21a8]" : "bg-[var(--gray-100)] text-[var(--gray-700)]"}`}>{chip.label}</span>
          {ticket.priority === "urgent" && <Badge variant="error">Urgent</Badge>}
          {ticket.priority === "high" && <Badge variant="warning">High</Badge>}
          {overdue && <Badge variant="error">Update overdue</Badge>}
          {ticket.imported_from === "beta_feedback" && <Badge variant="outline">From beta feedback</Badge>}
        </div>
      </div>

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
        <ProductBox ticket={ticket} signal={signal} messages={messages} onSendToProduct={onSendToProduct} />
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
