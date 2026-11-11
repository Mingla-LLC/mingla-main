/**
 * #4382 Wave 2 — Admin Support Desk.
 *
 * One inbox over support_tickets (customer tickets and staff tickets alike):
 * a rail of views (Needs reply, Mine, Unassigned, Overdue, Waiting on
 * customer, Resolved, All), an Opened-by switch (Everyone, Customers, Staff),
 * filters for product area, priority, owner and brand, and search by subject,
 * person, brand or S-number. Every count is worked out from the same rows the
 * list shows (lib/supportTicketMetrics.js).
 *
 * A ticket opens in a side panel beside the list (components/support/
 * TicketPanel.jsx) with its thread, images, voice notes, internal notes, the
 * Product box and the Reply / Internal note composer. Every write goes
 * through support-send, support-claim, support-set-status or a gated RPC;
 * nothing writes a table from the browser.
 *
 * Props (the Support page mounts this): embedded, canManageAgents, onCounts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LifeBuoy, Plus, RefreshCw } from "lucide-react";
import { SESSION_EXPIRED_MESSAGE, supabase } from "../lib/supabase";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Spinner } from "../components/ui/Spinner";
import { SearchInput } from "../components/ui/SearchInput";
import { PageHeader } from "../components/ui/PageHeader";
import { Segmented, Select } from "../components/crm/fields";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { logAdminAction } from "../lib/auditLog";
import { TicketPanel } from "../components/support/TicketPanel";
import { NewTicketModal } from "../components/support/NewTicketModal";
import { SendToProductModal } from "../components/support/SendToProductModal";
import { PRIORITY_OPTIONS, STATUS_BADGE, STATUS_LABEL } from "../components/support/supportOptions";
import { signalForTicket, STAGE_LABEL } from "../components/support/productBoardModel";
import { listProductSignals } from "../services/supportProductWorkflowService";
import { listSupportStaffRoster } from "../services/communityService";
import {
  invokeSupportFunction,
  listSupportTickets,
  loadInboxLookups,
} from "../services/supportDeskService";
import {
  OPENED_BY_OPTIONS,
  SUPPORT_INBOX_VIEWS,
  formatVoiceLength,
  isOverdueTicket,
  originChip,
  supportInboxCounts,
  supportInboxRows,
  ticketNumberLabel,
  waitLabel,
} from "../lib/supportTicketMetrics";

// #3988 — Support access is granted in People and roles, not from this desk.
// #4130 Wave 6: People and roles is a tab of the Support page.
const MANAGE_SUPPORT_PEOPLE_HREF = "#/support?tab=team";
const MANAGE_SUPPORT_PEOPLE_CLASS =
  "inline-flex min-h-[32px] items-center px-2 text-sm font-medium text-[var(--color-brand-700)] underline-offset-2 hover:underline";

const EMPTY_FILTERS = { productArea: "", priority: "", owner: "", brand: "" };

function ticketIdFromHash() {
  if (typeof window === "undefined") return null;
  const query = window.location.hash.split("?")[1] || "";
  return new URLSearchParams(query).get("ticket");
}

function setTicketInHash(ticketId) {
  if (typeof window === "undefined") return;
  const [path, query = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(query);
  if (ticketId) params.set("ticket", ticketId);
  else params.delete("ticket");
  const next = `${path || "#/support"}${params.toString() ? `?${params}` : ""}`;
  if (next !== window.location.hash) window.history.replaceState(null, "", next);
}

function personName(profile) {
  return profile?.display_name || profile?.username || profile?.email || "";
}

function rowWho(ticket, profilesById, brandsById) {
  const person = personName(ticket.requester_user_id ? profilesById[ticket.requester_user_id] : null);
  const brand = ticket.brand_id ? brandsById[ticket.brand_id]?.name : "";
  if (ticket.origin === "staff") {
    const creator = personName(ticket.created_by ? profilesById[ticket.created_by] : null) || "Staff";
    const about = brand || person;
    return about ? `${creator} → ${about}` : creator;
  }
  if (ticket.imported_from === "beta_feedback") return `${person || "Explorer"} · from beta feedback`;
  return [person || (ticket.requester_segment === "explorer" ? "Explorer" : "Host"), brand].filter(Boolean).join(" · ");
}

function initials(text) {
  return String(text || "?").split(/[\s·→]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function TicketRowChips({ ticket, signal }) {
  const chip = originChip(ticket);
  return (
    <>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.kind === "staff" ? "bg-[#f3e8ff] text-[#6b21a8]" : "bg-[var(--gray-100)] text-[var(--gray-700)]"}`}>{chip.label}</span>
      {ticket.priority === "urgent" && <Badge variant="error">Urgent</Badge>}
      {ticket.priority === "high" && <Badge variant="warning">High</Badge>}
      {signal && <Badge variant="info">{`Product · ${STAGE_LABEL[signal.state] || signal.state}`}</Badge>}
      {ticket.image_count > 0 && <span className="text-[11px] text-[var(--color-text-tertiary)]" aria-label={`${ticket.image_count} images`}>📎 {ticket.image_count}</span>}
      {ticket.voice_ms > 0 && <span className="text-[11px] text-[var(--color-text-tertiary)]" aria-label={`Voice note ${formatVoiceLength(ticket.voice_ms)}`}>🎙 {formatVoiceLength(ticket.voice_ms)}</span>}
      {ticket.imported_from === "beta_feedback" && <Badge variant="outline">From beta feedback</Badge>}
    </>
  );
}

export function SupportDeskPage({ embedded = false, canManageAgents = true, onCounts } = {}) {
  const { addToast } = useToast();
  const { session, signOut } = useAuth();
  const myUserId = session?.user?.id ?? null;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [sessionExpired, setSessionExpired] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [signals, setSignals] = useState([]);
  const [profilesById, setProfilesById] = useState({});
  const [brandsById, setBrandsById] = useState({});
  const [staffRoster, setStaffRoster] = useState([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState(null);

  const [view, setView] = useState(SUPPORT_INBOX_VIEWS[0].id);
  const [openedBy, setOpenedBy] = useState("all");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(() => ticketIdFromHash());
  const [acting, setActing] = useState(false);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [productSource, setProductSource] = useState(null);

  const loadQueue = useCallback(async () => {
    setQueueError(null);
    try {
      const [rows, signalRows, roster] = await Promise.all([
        listSupportTickets(),
        listProductSignals(),
        listSupportStaffRoster(),
      ]);
      const userIds = [...new Set(rows.flatMap((t) => [t.requester_user_id, t.assigned_staff_id, t.created_by]).concat((roster || []).map((r) => r.user_id)).filter(Boolean))];
      const lookups = await loadInboxLookups(userIds);
      if (!mountedRef.current) return;
      setTickets(rows);
      setSignals(signalRows);
      setStaffRoster((roster || []).filter((row) => row.enabled));
      setProfilesById(lookups.profilesById);
      setBrandsById(lookups.brandsById);
    } catch (err) {
      if (!mountedRef.current) return;
      setQueueError(err.message);
      addToast({ variant: "error", title: "Couldn't load the support inbox", description: err.message });
    } finally {
      if (mountedRef.current) setQueueLoading(false);
    }
  }, [addToast]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load on open, like the other admin pages
  useEffect(() => { void loadQueue(); }, [loadQueue]);

  // Realtime: ticket changes and Product changes refresh the inbox.
  useEffect(() => {
    const channel = supabase
      .channel("admin-support-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, () => { if (mountedRef.current) void loadQueue(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "support_product_signals" }, () => { if (mountedRef.current) void loadQueue(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadQueue]);

  useEffect(() => { setTicketInHash(selectedId); }, [selectedId]);

  const ctx = useMemo(() => ({ openedBy, filters, search, profilesById, brandsById, me: myUserId }), [openedBy, filters, search, profilesById, brandsById, myUserId]);
  // #4382: the rail counts and the list come from the same rows, after the
  // same Opened-by switch, filters and search.
  const inboxCounts = useMemo(() => supportInboxCounts(tickets, ctx), [tickets, ctx]);
  const visibleTickets = useMemo(() => supportInboxRows(tickets, view, ctx), [tickets, view, ctx]);
  // The page's Inbox badge reads the unfiltered Needs reply count.
  const badgeCounts = useMemo(() => supportInboxCounts(tickets, { me: myUserId }), [tickets, myUserId]);
  useEffect(() => {
    if (!queueLoading && !queueError) onCounts?.(badgeCounts);
  }, [badgeCounts, queueLoading, queueError, onCounts]);

  const selectedTicket = useMemo(() => tickets.find((t) => t.id === selectedId) || null, [tickets, selectedId]);
  const selectedSignal = useMemo(() => (selectedTicket ? signalForTicket(signals, selectedTicket.id) : null), [signals, selectedTicket]);
  const signalByTicket = useMemo(() => {
    const map = new Map();
    for (const signal of signals) {
      for (const source of signal.sources || []) {
        if (source.source_kind === "support_ticket") map.set(source.source_id, signal);
      }
    }
    return map;
  }, [signals]);

  const brandOptions = useMemo(() => Object.values(brandsById).sort((a, b) => String(a.name).localeCompare(String(b.name))), [brandsById]);
  const productAreas = useMemo(() => [...new Set(tickets.map((t) => t.product_area).filter(Boolean))].sort(), [tickets]);
  const ticketBrandOptions = useMemo(() => {
    const ids = new Set(tickets.map((t) => t.brand_id).filter(Boolean));
    return brandOptions.filter((b) => ids.has(b.id));
  }, [tickets, brandOptions]);
  const filtersActive = Object.values(filters).some(Boolean) || search.trim() || openedBy !== "all";

  const noteResult = useCallback((res) => {
    if (res?.sessionExpired) { setSessionExpired(true); return true; }
    return false;
  }, []);

  const showError = useCallback((title, description) => {
    addToast({ variant: "error", title, description });
  }, [addToast]);

  const handleClaim = useCallback(async () => {
    if (!selectedTicket) return;
    setActing(true);
    const res = await invokeSupportFunction("support-claim", { ticketId: selectedTicket.id });
    if (res.ok) {
      setSessionExpired(false);
      addToast({ variant: "success", title: "You own this ticket now" });
      await logAdminAction("support.claim", "support_ticket", selectedTicket.id);
      await loadQueue();
    } else if (!noteResult(res)) {
      showError("Couldn't take this ticket", res.error);
    }
    if (mountedRef.current) setActing(false);
  }, [selectedTicket, addToast, loadQueue, noteResult, showError]);

  const handleSetStatus = useCallback(async (status) => {
    if (!selectedTicket || status === selectedTicket.status) return;
    setActing(true);
    const res = await invokeSupportFunction("support-set-status", { ticketId: selectedTicket.id, status });
    if (res.ok) {
      setSessionExpired(false);
      addToast({ variant: "success", title: `Status: ${STATUS_LABEL[status] || status}` });
      await logAdminAction("support.set_status", "support_ticket", selectedTicket.id, { status });
      await loadQueue();
    } else if (!noteResult(res)) {
      showError("Couldn't change the status", res.error);
    }
    if (mountedRef.current) setActing(false);
  }, [selectedTicket, addToast, loadQueue, noteResult, showError]);

  const handleSetPriority = useCallback(async (priority) => {
    if (!selectedTicket || priority === selectedTicket.priority) return;
    setActing(true);
    const res = await invokeSupportFunction("support-set-status", { ticketId: selectedTicket.id, priority });
    if (res.ok) {
      setSessionExpired(false);
      addToast({ variant: "success", title: `Priority: ${priority}` });
      await logAdminAction("support.set_priority", "support_ticket", selectedTicket.id, { priority });
      await loadQueue();
    } else if (!noteResult(res)) {
      showError("Couldn't change the priority", res.error);
    }
    if (mountedRef.current) setActing(false);
  }, [selectedTicket, addToast, loadQueue, noteResult, showError]);

  const handleWorkflowError = useCallback((error) => {
    const message = error?.message || "The action didn't finish";
    const stale = message.includes("stale_revision");
    addToast({
      variant: "error",
      title: stale ? "This changed in another tab" : "Couldn't save that",
      description: stale ? "Refresh, check the latest version and try again." : message,
    });
  }, [addToast]);

  const openProductFor = useCallback((ticket) => {
    setProductSource({
      id: ticket.id,
      source_kind: "support_ticket",
      label: ticketNumberLabel(ticket),
      subject: ticket.subject,
      details: ticket.subject,
      priority: ticket.priority,
      product_area: ticket.product_area,
    });
  }, []);

  const headerActions = (
    <>
      <Button variant="primary" size="sm" icon={Plus} onClick={() => setNewTicketOpen(true)}>New ticket</Button>
      {canManageAgents && <a href={MANAGE_SUPPORT_PEOPLE_HREF} className={MANAGE_SUPPORT_PEOPLE_CLASS}>Manage who's on Support</a>}
      <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void loadQueue()}>Refresh</Button>
    </>
  );
  const currentView = SUPPORT_INBOX_VIEWS.find((v) => v.id === view) || SUPPORT_INBOX_VIEWS[0];
  const customerRows = visibleTickets.filter((t) => t.origin !== "staff").length;

  return (
    <div className="space-y-4">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--color-text-secondary)]">Every support ticket, from customers and staff. {badgeCounts.unassigned} unassigned.</p>
          <div className="flex flex-wrap items-center gap-2">{headerActions}</div>
        </div>
      ) : (
        <PageHeader title="Support" description={`Every support ticket, from customers and staff. ${badgeCounts.unassigned} unassigned.`} actions={headerActions} />
      )}

      {sessionExpired && (
        <div role="alert" className="rounded-lg border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] px-4 py-3 text-sm text-[var(--color-text-primary)]">
          {SESSION_EXPIRED_MESSAGE}{" "}
          <button type="button" className="font-medium underline" onClick={() => void signOut()}>Sign in again</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Opened by" options={OPENED_BY_OPTIONS} value={openedBy} onChange={setOpenedBy} />
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch("")}
          placeholder="Search subject, person, brand or S-number"
          aria-label="Search tickets"
          className="min-w-[220px] flex-1"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-label="Filters">
        <Select aria-label="Product area" className="!w-auto" value={filters.productArea} onChange={(e) => setFilters((f) => ({ ...f, productArea: e.target.value }))} placeholder="Any product area" options={productAreas.map((a) => ({ value: a, label: a }))} />
        <Select aria-label="Priority" className="!w-auto" value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))} placeholder="Any priority" options={PRIORITY_OPTIONS} />
        <Select aria-label="Owner" className="!w-auto" value={filters.owner} onChange={(e) => setFilters((f) => ({ ...f, owner: e.target.value }))} placeholder="Any owner" options={[{ value: "none", label: "Nobody" }, ...staffRoster.map((r) => ({ value: r.user_id, label: r.user_id === myUserId ? "Me" : r.display_name || personName(profilesById[r.user_id]) || r.user_id.slice(0, 8) }))]} />
        <Select aria-label="Brand" className="!w-auto" value={filters.brand} onChange={(e) => setFilters((f) => ({ ...f, brand: e.target.value }))} placeholder="Any brand" options={ticketBrandOptions.map((b) => ({ value: b.id, label: b.name }))} />
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={() => { setFilters(EMPTY_FILTERS); setSearch(""); setOpenedBy("all"); }}>Clear filters</Button>
        )}
      </div>

      <div className={`grid gap-4 ${selectedTicket ? "lg:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-[180px_minmax(0,1fr)_minmax(380px,460px)]" : "lg:grid-cols-[180px_minmax(0,1fr)]"}`}>
        <nav aria-label="Inbox views" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {["Work", "Done"].map((group) => (
            <div key={group} className="flex gap-1 lg:flex-col">
              <span className="hidden px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)] lg:block">{group}</span>
              {SUPPORT_INBOX_VIEWS.filter((v) => v.group === group).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={view === option.id}
                  onClick={() => setView(option.id)}
                  className={`flex min-h-9 shrink-0 items-center justify-between gap-3 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${view === option.id ? "bg-[var(--color-brand-500)] text-white" : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]"}`}
                >
                  <span>{option.label}</span>
                  <span className={`text-xs tabular-nums ${view === option.id ? "text-white/90" : "text-[var(--color-text-tertiary)]"}`}>{queueLoading || queueError ? "–" : inboxCounts[option.id]}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <section aria-label={`${currentView.label} tickets`} className={`min-w-0 overflow-hidden rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] ${selectedTicket ? "hidden xl:block" : ""}`}>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-[var(--gray-200)] px-4 py-2.5 text-xs text-[var(--color-text-secondary)]">
            <span><b className="text-[var(--color-text-primary)]">{visibleTickets.length}</b> in {currentView.label}</span>
            <span>{customerRows} from customers</span>
            <span>{visibleTickets.length - customerRows} from staff</span>
          </div>
          {queueLoading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : queueError ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">Couldn't load the inbox</p>
              <p className="text-xs text-[var(--color-text-tertiary)]">{queueError}</p>
              <Button variant="link" onClick={() => { setQueueLoading(true); void loadQueue(); }}>Try again</Button>
            </div>
          ) : visibleTickets.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <LifeBuoy className="h-10 w-10 text-[var(--gray-300)]" aria-hidden="true" />
              <p className="px-4 text-sm text-[var(--color-text-tertiary)]">
                {filtersActive ? "Nothing here for these filters." : view === "needs" ? "Nobody is waiting on a reply." : "No tickets in this view."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--gray-100)]">
              {visibleTickets.map((t) => {
                const who = rowWho(t, profilesById, brandsById);
                const owner = t.assigned_staff_id ? profilesById[t.assigned_staff_id] : null;
                const selected = t.id === selectedId;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      aria-current={selected ? "true" : undefined}
                      aria-label={`Open ${ticketNumberLabel(t)}: ${t.subject}`}
                      className={`grid w-full grid-cols-[56px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left hover:bg-[var(--gray-50)] ${selected ? "bg-[var(--color-brand-50)]" : ""}`}
                    >
                      <span className="pt-0.5 font-mono text-xs text-[var(--color-text-tertiary)]">{ticketNumberLabel(t)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{t.subject}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                          <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-100)] text-[9px] font-bold text-[var(--color-brand-700)]">{initials(who)}</span>
                          <span className="max-w-[220px] truncate">{who}</span>
                          <TicketRowChips ticket={t} signal={signalByTicket.get(t.id)} />
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1 text-xs">
                        <Badge variant={STATUS_BADGE[t.status] || "default"}>{STATUS_LABEL[t.status] || t.status}</Badge>
                        {isOverdueTicket(t) && <Badge variant="error">Overdue</Badge>}
                        <span className="text-[var(--color-text-tertiary)]">{owner ? (owner.id === myUserId ? "You" : personName(owner)) : "No owner"}</span>
                        <span className="tabular-nums text-[var(--color-text-tertiary)]">{waitLabel(t)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {selectedTicket && (
          <div className="min-w-0 lg:col-start-2 xl:col-start-3">
            <TicketPanel
              ticket={selectedTicket}
              profilesById={profilesById}
              brandsById={brandsById}
              signal={selectedSignal}
              myUserId={myUserId}
              acting={acting}
              onClose={() => setSelectedId(null)}
              onClaim={() => void handleClaim()}
              onSetStatus={(status) => void handleSetStatus(status)}
              onSetPriority={(priority) => void handleSetPriority(priority)}
              onSendToProduct={openProductFor}
              onChanged={async ({ mode, waiting }) => {
                setSessionExpired(false);
                await logAdminAction(mode === "note" ? "support.note" : "support.reply", "support_ticket", selectedTicket.id, { waiting });
                if (mode !== "note") addToast({ variant: "success", title: waiting ? "Sent. Waiting on the customer." : "Reply sent" });
                await loadQueue();
              }}
              onError={showError}
              onSessionExpired={() => setSessionExpired(true)}
            />
          </div>
        )}
        {!queueLoading && selectedId && !selectedTicket && !queueError && (
          <p role="status" className="text-sm text-[var(--color-text-tertiary)] lg:col-start-2">
            That ticket isn't in the newest 300.{" "}
            <button type="button" className="font-medium underline" onClick={() => setSelectedId(null)}>Close</button>
          </p>
        )}
      </div>

      <NewTicketModal
        open={newTicketOpen}
        brands={brandOptions}
        staffRoster={staffRoster}
        myUserId={myUserId}
        onClose={() => setNewTicketOpen(false)}
        onCreated={async (id, imageCount) => {
          addToast({ variant: "success", title: `Ticket created${imageCount ? ` · ${imageCount} image${imageCount === 1 ? "" : "s"}` : ""}` });
          await logAdminAction("support.create_staff_ticket", "support_ticket", id);
          await loadQueue();
          setOpenedBy("staff");
          setView("all");
          setSelectedId(id);
        }}
        onError={handleWorkflowError}
      />

      <SendToProductModal
        source={productSource}
        signals={signals}
        onClose={() => setProductSource(null)}
        onCreated={async () => {
          addToast({ variant: "success", title: "Sent to Product" });
          await loadQueue();
        }}
        onLinked={async () => {
          addToast({ variant: "success", title: "Linked to the Product item (+1 reporter)" });
          await loadQueue();
        }}
        onError={handleWorkflowError}
      />
    </div>
  );
}

export default SupportDeskPage;
