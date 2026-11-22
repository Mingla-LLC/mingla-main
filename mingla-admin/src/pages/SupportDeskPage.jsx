/**
 * #4382 Wave 2 / #4420 (step 5) — the Admin Support chat inbox.
 *
 * Left: every conversation with a host or an explorer, and every reported
 * enquiry, in one list: "Open · N" on top, a "Resolved · N" section folded at
 * the bottom, search and label chips. Right: the conversation as chat bubbles
 * (components/support/TicketPanel.jsx) with the Reply / Internal note composer,
 * Create ticket and Resolve / Reopen. "Create ticket" opens a side panel beside
 * the thread (components/support/CreateTicketPanel.jsx) over the Work board's
 * ticket form. Labels, Open vs Resolved and the order are derived in
 * lib/supportInboxModel.js; nothing is stored client-side.
 *
 * Every write goes through support-send, support-claim, support-set-status or
 * a gated RPC; nothing writes a table from the browser.
 *
 * Addresses: #/support?conversation=<id> (and the older ?ticket=<id>),
 * ?reported=<id>, ?filter= / ?view= (a chip, or resolved). Unknown values open
 * the default list, never a blank page.
 *
 * Props (the Support page mounts this): embedded, canManageAgents, onCounts.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MessageSquare, Plus, RefreshCw } from "lucide-react";
import { SESSION_EXPIRED_MESSAGE, supabase } from "../lib/supabase";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { logAdminAction } from "../lib/auditLog";
import { TicketPanel } from "../components/support/TicketPanel";
import { NewTicketModal } from "../components/support/NewTicketModal";
import { InboxList } from "../components/support/InboxList";
import { CreateTicketPanel } from "../components/support/CreateTicketPanel";
import { TicketSummaryPanel } from "../components/support/TicketSummaryPanel";
import { ReportedEnquiryThread } from "../components/support/ReportedEnquiryThread";
import { STATUS_LABEL } from "../components/support/supportOptions";
import { listSupportStaffRoster, blockEnquirySenderEverywhere, dismissEnquiryReport, listReportedEnquiries } from "../services/communityService";
import {
  getSupportTicket,
  invokeSupportFunction,
  listSupportTickets,
  loadInboxLookups,
  loadLastPublicMessages,
  markWebsiteRequestReady,
} from "../services/supportDeskService";
import { fetchConversationTickets } from "../services/opsService";
import {
  CLOSED_PAGE_SIZE,
  coverageNote,
  inboxViewCoverage,
} from "../lib/supportTicketMetrics";
import {
  DISCARD_TICKET_WORDS,
  conversationRow,
  hashForSelection,
  inboxLoadErrorText,
  inboxLookupNotice,
  inboxParamsFromHash,
  needsReplyCount,
  sidePanelPlacement,
  reportedRow,
  sidePanelOnSwitch,
  splitInbox,
} from "../lib/supportInboxModel";
import {
  INITIAL_REPORTED_ENQUIRIES_STATE,
  loadReportedEnquiries,
  reportedEnquiriesReducer,
  runReportedEnquiryAction,
} from "../lib/reportedEnquiries";

// #3988 — Support access is granted in People and roles, not from this desk.
// #4130 Wave 6: People and roles is a tab of the Support page.
const MANAGE_SUPPORT_PEOPLE_HREF = "#/support?tab=team";
const MANAGE_SUPPORT_PEOPLE_CLASS =
  "inline-flex min-h-[32px] items-center px-2 text-sm font-medium text-[var(--color-brand-700)] underline-offset-2 hover:underline";
const REPORTED_SERVICE = Object.freeze({ listReportedEnquiries, dismissEnquiryReport, blockEnquirySenderEverywhere });
const PREVIEW_ROWS = 150;

function chunk(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}


// #4420 rework (P3-c) / rework 3 (G3): the Create ticket / ticket summary slot.
// As an overlay it is a fixed panel on the right edge, fully in view without
// scrolling; as a column it is the grid's third column. Which one comes from
// the grid's measured width (sidePanelPlacement), never one breakpoint, so the
// thread never shrinks below its minimum.
const SIDE_SLOT_OVERLAY = "fixed inset-y-0 right-0 flex w-full max-w-[420px] min-w-0 flex-col bg-[var(--color-background-primary)] p-3 shadow-[var(--shadow-xl)] [&>aside]:h-full";
const SIDE_SLOT_COLUMN = "static col-start-3 block min-w-0 [&>aside]:h-[calc(100vh-180px)]";
const GRID_TWO = "lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]";
const GRID_THREE = "lg:grid-cols-[minmax(300px,380px)_minmax(480px,1fr)_minmax(340px,420px)]";
const SIDE_SLOT_STYLE = { zIndex: "var(--z-modal)" };

export function SupportDeskPage({ embedded = false, canManageAgents = true, onCounts } = {}) {
  const { addToast } = useToast();
  const { session, signOut } = useAuth();
  const myUserId = session?.user?.id ?? null;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const initial = useMemo(() => inboxParamsFromHash(typeof window === "undefined" ? "" : window.location.hash), []);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [fetchedTicket, setFetchedTicket] = useState(null);
  const [profilesById, setProfilesById] = useState({});
  const [brandsById, setBrandsById] = useState({});
  const [staffRoster, setStaffRoster] = useState([]);
  const [linkedByConversation, setLinkedByConversation] = useState({});
  const [previews, setPreviews] = useState({});
  const [notice, setNotice] = useState(null);
  // #4420 rework 3 (G1): names or brands that did not load (never an error).
  const [lookupNotice, setLookupNotice] = useState(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState(null);
  // #4382 (tester P3d): every active conversation loads; resolved and closed load in
  // pages. The ref keeps realtime reloads at the depth already loaded.
  const [coverage, setCoverage] = useState({ activeLoaded: 0, activeTotal: 0, closedLoaded: 0, closedTotal: 0 });
  const closedLimitRef = useRef(CLOSED_PAGE_SIZE);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reported, dispatchReported] = useReducer(reportedEnquiriesReducer, INITIAL_REPORTED_ENQUIRIES_STATE);

  const [chip, setChip] = useState(initial.chip);
  const [search, setSearch] = useState("");
  const [resolvedOpen, setResolvedOpen] = useState(initial.showResolved);
  const [selected, setSelected] = useState({ conversationId: initial.conversationId, reportedId: initial.reportedId });
  const [acting, setActing] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  // The side panel beside the thread: Create ticket, or a linked ticket's summary.
  const [side, setSide] = useState(null);
  // #4420 rework 2: whether the open Create ticket form has edits, and the
  // latest selection and panel for the address listener below.
  const createDirtyRef = useRef(false);
  const latestRef = useRef({ selected, side });
  useEffect(() => {
    latestRef.current = { selected, side };
    if (side?.kind !== "create") createDirtyRef.current = false;
  }, [selected, side]);
  // Opening another conversation never re-fills a Create ticket form: an
  // untouched one closes; one with edits asks first. Returns false when the
  // person keeps their form (the selection does not change).
  const switchSelection = useCallback((next) => {
    const { selected: cur, side: open } = latestRef.current;
    const same = cur.conversationId === next.conversationId && cur.reportedId === next.reportedId;
    const decision = sidePanelOnSwitch({ sideKind: open?.kind || null, dirty: createDirtyRef.current, same });
    if (decision === "ask" && !window.confirm(DISCARD_TICKET_WORDS)) return false;
    if (decision !== "keep") { setSide(null); createDirtyRef.current = false; }
    setSelected(next);
    return true;
  }, []);

  const loadLinked = useCallback(async (rows) => {
    const ids = rows.map((t) => t.id);
    if (ids.length === 0) { setLinkedByConversation({}); return; }
    try {
      const out = {};
      for (const part of chunk(ids, 2000)) {
        const answer = await fetchConversationTickets(part);
        for (const item of Array.isArray(answer) ? answer : []) (out[item.support_ticket_id] ||= []).push(item);
      }
      if (mountedRef.current) { setLinkedByConversation(out); setNotice(null); }
    } catch (err) {
      if (mountedRef.current) setNotice(`Ticket labels didn't load (${err.message}). Conversations are unaffected.`);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setQueueError(null);
    try {
      const [{ tickets: rows, coverage: loadedCoverage }, roster] = await Promise.all([
        listSupportTickets({ closedLimit: closedLimitRef.current }),
        listSupportStaffRoster(),
      ]);
      const userIds = [...new Set(rows.flatMap((t) => [t.requester_user_id, t.assigned_staff_id, t.created_by, t.website_request?.ready_by]).concat((roster || []).map((r) => r.user_id)).filter(Boolean))];
      const lookups = await loadInboxLookups(userIds);
      if (!mountedRef.current) return;
      setTickets(rows);
      setCoverage(loadedCoverage);
      setStaffRoster((roster || []).filter((row) => row.enabled));
      setProfilesById(lookups.profilesById);
      setBrandsById(lookups.brandsById);
      setLookupNotice(inboxLookupNotice(lookups.missing));
      void loadLinked(rows);
      // Snippets for the rows the person sees first (the rest show their subject).
      const first = splitInbox(rows.map(conversationRow), { me: myUserId }).open
        .filter((r) => r.kind === "conversation" && r.ticket.conversation_id)
        .slice(0, PREVIEW_ROWS).map((r) => r.ticket.conversation_id);
      try {
        const latest = await loadLastPublicMessages(first);
        if (mountedRef.current) setPreviews((current) => ({ ...current, ...latest }));
      } catch (previewError) {
        if (mountedRef.current) setNotice(`Message previews didn't load (${previewError.message}). Subjects are shown instead.`);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      // #4420 rework 3 (G1): a plain sentence with Try again, never a server code.
      console.warn("[support desk] inbox load failed:", err?.message);
      setQueueError(inboxLoadErrorText(err));
      addToast({ variant: "error", title: "Couldn't load the support inbox", description: inboxLoadErrorText(err) });
    } finally {
      if (mountedRef.current) setQueueLoading(false);
    }
  }, [addToast, loadLinked, myUserId]);

  const reloadReported = useCallback(() => loadReportedEnquiries(dispatchReported, REPORTED_SERVICE), []);

  const loadOlder = useCallback(async () => {
    closedLimitRef.current += CLOSED_PAGE_SIZE;
    setLoadingOlder(true);
    try {
      await loadQueue();
    } finally {
      if (mountedRef.current) setLoadingOlder(false);
    }
  }, [loadQueue]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load on open, like the other admin pages
  useEffect(() => { void loadQueue(); void reloadReported(); }, [loadQueue, reloadReported]);

  // Realtime: conversation changes refresh the inbox.
  useEffect(() => {
    const channel = supabase
      .channel("admin-support-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, () => { if (mountedRef.current) void loadQueue(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadQueue]);

  // The address follows the selection; an address that names a conversation opens it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = hashForSelection(window.location.hash, selected);
    if (next !== window.location.hash) window.history.replaceState(null, "", next);
  }, [selected]);
  useEffect(() => {
    const onHash = () => {
      const p = inboxParamsFromHash(window.location.hash);
      if ((p.conversationId || p.reportedId) && !switchSelection({ conversationId: p.conversationId, reportedId: p.reportedId })) {
        // Kept the form: the address names the conversation still open.
        window.history.replaceState(null, "", hashForSelection(window.location.hash, latestRef.current.selected));
        return;
      }
      if (p.chip) setChip(p.chip);
      if (p.showResolved) setResolvedOpen(true);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [switchSelection]);

  // A conversation the loaded list does not hold (an old resolved one) is read by id.
  const inList = selected.conversationId ? tickets.find((t) => t.id === selected.conversationId) || null : null;
  useEffect(() => {
    if (!selected.conversationId || inList || queueLoading) return undefined;
    let live = true;
    getSupportTicket(selected.conversationId)
      .then((row) => { if (live) setFetchedTicket(row); })
      .catch((err) => { if (live) { setFetchedTicket(null); addToast({ variant: "error", title: "Couldn't open that conversation", description: err.message }); } });
    return () => { live = false; };
  }, [selected.conversationId, inList, queueLoading, addToast]);
  const selectedTicket = inList || (fetchedTicket?.id === selected.conversationId ? fetchedTicket : null);
  const selectedReported = selected.reportedId ? reported.rows.find((r) => r.id === selected.reportedId) || null : null;

  const lookups = useMemo(() => ({ profilesById, brandsById }), [profilesById, brandsById]);
  const allRows = useMemo(() => [...tickets.map(conversationRow), ...reported.rows.map(reportedRow)], [tickets, reported.rows]);
  const inbox = useMemo(() => splitInbox(allRows, { chip, search, lookups, me: myUserId }), [allRows, chip, search, lookups, myUserId]);
  const filtersActive = Boolean(chip || search.trim());
  const badge = useMemo(() => needsReplyCount(allRows), [allRows]);
  useEffect(() => {
    if (!queueLoading && !queueError) onCounts?.({ open: badge, needs: badge });
  }, [badge, queueLoading, queueError, onCounts]);

  // A resolved conversation that is open (by address or click) shows its section.
  const selectedIsResolved = selectedTicket && (selectedTicket.status === "resolved" || selectedTicket.status === "closed");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- show the section a selected resolved conversation is in
  useEffect(() => { if (selectedIsResolved) setResolvedOpen(true); }, [selectedIsResolved]);

  const noteResult = useCallback((res) => {
    if (res?.sessionExpired) { setSessionExpired(true); return true; }
    return false;
  }, []);
  const showError = useCallback((title, description) => addToast({ variant: "error", title, description }), [addToast]);

  const select = useCallback((row) => {
    switchSelection(row.kind === "reported" ? { conversationId: null, reportedId: row.id } : { conversationId: row.id, reportedId: null });
  }, [switchSelection]);
  const closeSelection = useCallback(() => { switchSelection({ conversationId: null, reportedId: null }); }, [switchSelection]);

  const handleClaim = useCallback(async () => {
    if (!selectedTicket) return;
    setActing(true);
    const res = await invokeSupportFunction("support-claim", { ticketId: selectedTicket.id });
    if (res.ok) {
      setSessionExpired(false);
      addToast({ variant: "success", title: "You own this conversation now" });
      await logAdminAction("support.claim", "support_ticket", selectedTicket.id);
      await loadQueue();
    } else if (!noteResult(res)) {
      showError("Couldn't take this conversation", res.error);
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

  // #4453: "Ready for review" on a website change request. Returns the
  // result so the request box can show a refusal next to the button.
  const handleWebsiteReady = useCallback(async (note) => {
    if (!selectedTicket) return { ok: false, error: "No conversation is open" };
    const ticketId = selectedTicket.id;
    const res = await markWebsiteRequestReady(ticketId, note);
    if (res.ok) {
      setSessionExpired(false);
      const told = Number(res.data?.notified || 0);
      addToast({
        variant: "success",
        title: "Marked ready for review",
        description: told > 0 ? `${told} ${told === 1 ? "person" : "people"} on the brand's team told.` : "Nobody new to tell.",
      });
      await logAdminAction("support.website_request_ready", "support_ticket", ticketId, { notified: told, has_note: Boolean(note) });
      await loadQueue();
    } else {
      noteResult(res);
    }
    return res;
  }, [selectedTicket, addToast, loadQueue, noteResult]);

  const handleWorkflowError = useCallback((error) => {
    const message = error?.message || "The action didn't finish";
    const stale = message.includes("stale_revision");
    addToast({
      variant: "error",
      title: stale ? "This changed in another tab" : "Couldn't save that",
      description: stale ? "Refresh, check the latest version and try again." : message,
    });
  }, [addToast]);

  const refreshAll = useCallback(() => { void loadQueue(); void reloadReported(); }, [loadQueue, reloadReported]);

  const headerActions = (
    <>
      <Button variant="primary" size="sm" icon={Plus} onClick={() => setNewConversationOpen(true)}>New conversation</Button>
      {canManageAgents && (
        <a href={MANAGE_SUPPORT_PEOPLE_HREF} className={MANAGE_SUPPORT_PEOPLE_CLASS}>Manage who's on Support</a>
      )}
      <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refreshAll}>Refresh</Button>
    </>
  );
  const resolvedCoverage = inboxViewCoverage(coverage, "resolved");
  const activeCoverage = inboxViewCoverage(coverage, "needs");
  const note = [activeCoverage.partial ? coverageNote(activeCoverage) : null, resolvedCoverage.partial ? coverageNote(resolvedCoverage) : null].filter(Boolean)[0] || null;
  const brandOptions = useMemo(() => Object.values(brandsById).sort((a, b) => String(a.name).localeCompare(String(b.name))), [brandsById]);
  const description = `Every conversation with hosts and explorers. ${badge} ${badge === 1 ? "needs" : "need"} a reply.`;
  const showSide = Boolean(side && selectedTicket);
  // #4420 rework 3 (G3): the grid's width decides column or overlay.
  const gridRef = useRef(null);
  const [gridWidth, setGridWidth] = useState(0);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return undefined;
    const measure = () => setGridWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const sideDocked = showSide && sidePanelPlacement(gridWidth) === "column";
  const SIDE_SLOT = sideDocked ? SIDE_SLOT_COLUMN : SIDE_SLOT_OVERLAY;
  const SIDE_SLOT_Z = sideDocked ? undefined : SIDE_SLOT_STYLE;
  // #4420 rework (P3-c): Escape closes the side panel (it overlays the thread under xl).
  useEffect(() => {
    if (!showSide) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented) setSide(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showSide]);
  const selectedKey = selectedReported ? `reported:${selectedReported.id}` : selected.conversationId;

  return (
    <div className="space-y-6">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--color-text-secondary)]">{description}</p>
          <div className="flex flex-wrap items-center gap-2">{headerActions}</div>
        </div>
      ) : (
        <PageHeader title="Support" description={description} actions={headerActions} />
      )}

      {sessionExpired && (
        <div role="alert" className="rounded-lg border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] px-4 py-3 text-sm text-[var(--color-text-primary)]">
          {SESSION_EXPIRED_MESSAGE}{" "}
          <button type="button" className="font-medium underline" onClick={() => void signOut()}>Sign in again</button>
        </div>
      )}
      {reported.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-warning-50)] px-4 py-2 text-sm text-[var(--color-warning-700)]">
          <span>Reported enquiries didn't load: {reported.loadError}</span>
          <Button size="sm" variant="secondary" onClick={() => void reloadReported()}>Try again</Button>
        </div>
      )}

      <div ref={gridRef} data-side-placement={showSide ? (sideDocked ? "column" : "overlay") : undefined} className={`grid gap-4 ${sideDocked ? GRID_THREE : GRID_TWO}`}>
        <div className={`min-w-0 ${selectedTicket || selectedReported ? "hidden lg:block" : ""}`}>
          <InboxList
            loading={queueLoading}
            error={queueError}
            onRetry={() => { setQueueLoading(true); void loadQueue(); }}
            open={inbox.open}
            resolved={inbox.resolved}
            chip={chip}
            onChip={setChip}
            search={search}
            onSearch={setSearch}
            resolvedOpen={resolvedOpen}
            onToggleResolved={() => setResolvedOpen((v) => !v)}
            selectedKey={selectedKey}
            onSelect={select}
            linkedByConversation={linkedByConversation}
            previews={previews}
            lookups={lookups}
            coverageNote={resolvedOpen ? note : null}
            canLoadOlder={resolvedCoverage.canLoadOlder}
            loadingOlder={loadingOlder}
            onLoadOlder={() => void loadOlder()}
            filtersActive={filtersActive}
            notice={notice || lookupNotice || (!resolvedOpen && note ? note : null)}
          />
        </div>

        <div className="min-w-0">
          {selectedTicket ? (
            <TicketPanel
              key={selectedTicket.id}
              ticket={selectedTicket}
              linkedTickets={linkedByConversation[selectedTicket.id] || []}
              profilesById={profilesById}
              brandsById={brandsById}
              myUserId={myUserId}
              acting={acting}
              createOpen={side?.kind === "create"}
              onClose={closeSelection}
              onClaim={() => void handleClaim()}
              onSetStatus={(status) => void handleSetStatus(status)}
              onSetPriority={(priority) => void handleSetPriority(priority)}
              onCreateTicket={(messages) => setSide({ kind: "create", messages })}
              onOpenLinkedTicket={(linked) => setSide({ kind: "summary", linked })}
              onChanged={async ({ mode, waiting }) => {
                setSessionExpired(false);
                await logAdminAction(mode === "note" ? "support.note" : "support.reply", "support_ticket", selectedTicket.id, { waiting });
                if (mode !== "note") addToast({ variant: "success", title: waiting ? "Sent. Waiting on the customer." : "Reply sent" });
                await loadQueue();
              }}
              onError={showError}
              onSessionExpired={() => setSessionExpired(true)}
              onWebsiteReady={handleWebsiteReady}
            />
          ) : selectedReported ? (
            <ReportedEnquiryThread
              key={selectedReported.id}
              row={reportedRow(selectedReported)}
              state={reported}
              onClose={closeSelection}
              onDismiss={async (id) => { if (await runReportedEnquiryAction(dispatchReported, REPORTED_SERVICE, { id, kind: "dismiss" })) closeSelection(); }}
              onAskBlock={(id) => dispatchReported({ type: "ask_block", id })}
              onCancelBlock={() => dispatchReported({ type: "cancel_block" })}
              onConfirmBlock={async (id) => { if (await runReportedEnquiryAction(dispatchReported, REPORTED_SERVICE, { id, kind: "block" })) closeSelection(); }}
            />
          ) : selected.conversationId && !queueLoading && !queueError ? (
            <p role="status" className="rounded-2xl border border-[var(--gray-200)] p-6 text-sm text-[var(--color-text-tertiary)]">
              That conversation isn't available to you, or it doesn't exist.{" "}
              <button type="button" className="font-medium underline" onClick={closeSelection}>Close</button>
            </p>
          ) : selected.reportedId && reported.status === "ready" ? (
            <p role="status" className="rounded-2xl border border-[var(--gray-200)] p-6 text-sm text-[var(--color-text-tertiary)]">
              That reported enquiry is no longer open.{" "}
              <button type="button" className="font-medium underline" onClick={closeSelection}>Close</button>
            </p>
          ) : (
            <div className="hidden h-full min-h-[240px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--gray-200)] text-center lg:flex">
              <MessageSquare className="h-9 w-9 text-[var(--gray-300)]" aria-hidden="true" />
              <p className="text-sm text-[var(--color-text-tertiary)]">Pick a conversation to read it and reply.</p>
            </div>
          )}
        </div>

        {showSide && !sideDocked ? (
          // #4420 rework (P3-c): below 1280 px there is no third column, so the
          // side panel slides over the thread from the right (like the Work
          // card drawer) instead of stacking under the fold. The dimmed
          // backdrop and the panel's own Cancel / Close both dismiss it.
          <button type="button" aria-label="Close the side panel" data-side-backdrop="" onClick={() => setSide(null)}
            className="fixed inset-0 h-full w-full cursor-default bg-black/40" style={{ zIndex: "var(--z-modal)" }} />
        ) : null}
        {showSide && side.kind === "create" ? (
          <div data-side-slot="" className={SIDE_SLOT} style={SIDE_SLOT_Z}>
            <CreateTicketPanel
              docked={sideDocked}
              ticket={selectedTicket}
              messages={side.messages}
              onClose={() => setSide(null)}
              onDirtyChange={(dirty) => { createDirtyRef.current = dirty; }}
              onMade={() => { void loadLinked(tickets); }}
              onLinked={() => { void loadLinked(tickets); }}
            />
          </div>
        ) : null}
        {showSide && side.kind === "summary" ? (
          <div data-side-slot="" className={SIDE_SLOT} style={SIDE_SLOT_Z}>
            <TicketSummaryPanel linked={side.linked} onClose={() => setSide(null)} />
          </div>
        ) : null}
      </div>

      <NewTicketModal
        open={newConversationOpen}
        brands={brandOptions}
        staffRoster={staffRoster}
        myUserId={myUserId}
        onClose={() => setNewConversationOpen(false)}
        onCreated={async (id, imageCount) => {
          addToast({ variant: "success", title: `Conversation started${imageCount ? ` · ${imageCount} image${imageCount === 1 ? "" : "s"}` : ""}` });
          await logAdminAction("support.create_staff_ticket", "support_ticket", id);
          await loadQueue();
          setChip("");
          setSearch("");
          switchSelection({ conversationId: id, reportedId: null });
        }}
        onError={handleWorkflowError}
      />
    </div>
  );
}

export default SupportDeskPage;
