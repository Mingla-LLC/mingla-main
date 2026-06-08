/**
 * META-ORCH-1104 Phase 2 — Admin Support Desk.
 *
 * A queue of support_tickets (mirroring the Users / Claims table) + a ticket
 * detail (left = the conversation thread; right = ticket meta + actions) + an
 * Agents panel (grant/revoke a user's support capability).
 *
 * Auth: the admin web client authenticates with the anon key under RLS. The
 * admin is treated as support staff everywhere via the `is_admin_user()`
 * umbrella (Phase 0 RLS), so it can read every support ticket, conversation,
 * and message and INSERT replies into a support conversation. Lifecycle writes
 * (claim / status / priority / staff-grant) flow through the deployed
 * `support-*` edge functions; reply is a direct message INSERT through the
 * `messages_support_staff_insert` RLS policy.
 *
 * The support-* edge functions are deployed by the orchestrator at close. Until
 * then every edge-fn action degrades gracefully (a clear toast, no crash) —
 * see `invokeSupportFn`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LifeBuoy, Send, UserCheck, RefreshCw, Shield, UserPlus, UserX, Users,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input } from "../components/ui/Input";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";
import { Avatar } from "../components/ui/Avatar";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { logAdminAction } from "../lib/auditLog";
import { extractFunctionError } from "../lib/edgeFunctionError";
import { timeAgo, formatDateTime } from "../lib/formatters";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "open", label: "Open" },
  { id: "pending", label: "Pending" },
  { id: "resolved", label: "Resolved" },
  { id: "closed", label: "Closed" },
];

const STATUS_BADGE = {
  new: "info",
  open: "brand",
  pending: "warning",
  resolved: "success",
  closed: "default",
};

const PRIORITY_BADGE = {
  low: "default",
  normal: "info",
  high: "warning",
  urgent: "error",
};

// The only legal next statuses (mirrors SPEC §2.1 / the support-set-status edge
// fn). The edge fn is the real enforcer; this just keeps the UI from offering an
// illegal jump.
const STATUS_OPTIONS = ["new", "open", "pending", "resolved", "closed"];
const PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"];

// ─── Edge-fn helper (graceful degradation while support-* is undeployed) ───────

/**
 * Invoke a support-* edge function and normalize the result to
 * { ok, error }. A 404 (function not deployed yet) surfaces a clear,
 * non-alarming message instead of a crash. Never throws.
 */
async function invokeSupportFn(fnName, body) {
  try {
    const { data, error } = await supabase.functions.invoke(fnName, { body });
    if (error) {
      const status = error?.context?.status ?? error?.status;
      if (status === 404) {
        return {
          ok: false,
          error: `Support actions aren't live yet — "${fnName}" isn't deployed. The queue + thread are read-only until the support functions ship.`,
        };
      }
      const msg = await extractFunctionError(error, `${fnName} failed`);
      return { ok: false, error: msg };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err?.message ?? `${fnName} failed` };
  }
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function profileLabel(p) {
  if (!p) return "Unknown user";
  return p.display_name || p.username || p.email || "Unknown user";
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SupportDeskPage() {
  const { addToast } = useToast();
  const { session } = useAuth();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const myUserId = session?.user?.id ?? null;

  // Queue state
  const [tickets, setTickets] = useState([]);
  const [profilesById, setProfilesById] = useState({}); // user_id → { ...profile, segment }
  const [brandsById, setBrandsById] = useState({});       // brand_id → { id, name }
  const [statusFilter, setStatusFilter] = useState("all");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState(null);

  // Detail state
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState(null);
  const [reply, setReply] = useState("");
  const [acting, setActing] = useState(false);

  // Agents panel state
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [staff, setStaff] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [grantEmail, setGrantEmail] = useState("");
  const [granting, setGranting] = useState(false);

  // ─── Queue fetch ────────────────────────────────────────────────────────────

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      let query = supabase
        .from("support_tickets")
        .select("id, requester_user_id, requester_segment, subject, status, priority, assigned_staff_id, conversation_id, brand_id, created_at, first_response_at, resolved_at, last_message_at")
        .order("last_message_at", { ascending: false })
        .limit(200);
      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (unassignedOnly) query = query.is("assigned_staff_id", null);

      const { data, error } = await query;
      if (error) throw error;
      const rows = data || [];

      // Batch-resolve the requester + assigned-staff profiles (with segment) and
      // brands. support_tickets FKs point at auth.users, so we can't embed
      // profiles directly — resolve by id instead.
      const userIds = [
        ...new Set(
          rows.flatMap((t) => [t.requester_user_id, t.assigned_staff_id]).filter(Boolean),
        ),
      ];
      const brandIds = [...new Set(rows.map((t) => t.brand_id).filter(Boolean))];

      const [profilesRes, brandsRes] = await Promise.all([
        userIds.length
          ? supabase
              .from("profiles_with_segment")
              .select("id, display_name, username, email, avatar_url, segment")
              .in("id", userIds)
          : Promise.resolve({ data: [], error: null }),
        brandIds.length
          ? supabase.from("brands").select("id, name").in("id", brandIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (!mountedRef.current) return;
      const pMap = {};
      (profilesRes.data || []).forEach((p) => { pMap[p.id] = p; });
      const bMap = {};
      (brandsRes.data || []).forEach((b) => { bMap[b.id] = b; });
      setProfilesById(pMap);
      setBrandsById(bMap);
      setTickets(rows);
    } catch (err) {
      if (!mountedRef.current) return;
      setQueueError(err.message);
      setTickets([]);
      addToast({ variant: "error", title: "Couldn't load the support queue", description: err.message });
    } finally {
      if (mountedRef.current) setQueueLoading(false);
    }
  }, [statusFilter, unassignedOnly, addToast]);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  // ─── Realtime: new tickets + activity bump the queue to the top ───────────────

  useEffect(() => {
    const channel = supabase
      .channel("admin-support-queue")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_tickets" },
        () => { if (mountedRef.current) void loadQueue(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadQueue]);

  // ─── Thread fetch + realtime ──────────────────────────────────────────────────

  const loadThread = useCallback(async (conversationId) => {
    setThreadLoading(true);
    setThreadError(null);
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, content, message_type, created_at, deleted_at")
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      if (!mountedRef.current) return;
      setMessages(data || []);
    } catch (err) {
      if (!mountedRef.current) return;
      setThreadError(err.message);
      setMessages([]);
    } finally {
      if (mountedRef.current) setThreadLoading(false);
    }
  }, []);

  const openTicket = useCallback((ticket) => {
    setSelectedTicket(ticket);
    setReply("");
    setMessages([]);
    void loadThread(ticket.conversation_id);
  }, [loadThread]);

  const closeTicket = useCallback(() => {
    setSelectedTicket(null);
    setMessages([]);
    setReply("");
  }, []);

  // Live message stream for the open thread.
  useEffect(() => {
    if (!selectedTicket?.conversation_id) return undefined;
    const convId = selectedTicket.conversation_id;
    const channel = supabase
      .channel(`admin-support-thread-${convId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
        () => { if (mountedRef.current) void loadThread(convId); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [selectedTicket?.conversation_id, loadThread]);

  // ─── Actions ──────────────────────────────────────────────────────────────────

  const handleClaim = useCallback(async () => {
    if (!selectedTicket) return;
    setActing(true);
    const res = await invokeSupportFn("support-claim", { ticketId: selectedTicket.id });
    if (res.ok) {
      addToast({ variant: "success", title: "Ticket claimed" });
      await logAdminAction("support.claim", "support_ticket", selectedTicket.id);
      // Optimistic local reflect; realtime + reload settle the rest.
      setSelectedTicket((t) => (t ? { ...t, assigned_staff_id: myUserId, status: t.status === "new" ? "open" : t.status } : t));
      await loadQueue();
    } else {
      addToast({ variant: "error", title: "Couldn't claim ticket", description: res.error });
    }
    if (mountedRef.current) setActing(false);
  }, [selectedTicket, myUserId, addToast, loadQueue]);

  const handleReply = useCallback(async () => {
    if (!selectedTicket) return;
    const body = reply.trim();
    if (!body) return;
    setActing(true);
    try {
      // Admin inserts directly via the messages_support_staff_insert RLS policy
      // (scoped to linked_entity_type='support' + is_admin_user()). sender_id
      // MUST be auth.uid() for the WITH CHECK to pass.
      const { error } = await supabase.from("messages").insert({
        conversation_id: selectedTicket.conversation_id,
        sender_id: myUserId,
        content: body,
        message_type: "text",
      });
      if (error) throw error;
      // Bump last_message_at / first_response_at via the edge fn (service-role
      // side-effects + push). The message is already persisted above, so a
      // missing edge fn doesn't lose the reply — just the push + timestamp bump.
      const sideEffect = await invokeSupportFn("support-send", {
        ticketId: selectedTicket.id,
        notifyOnly: true,
      });
      if (!sideEffect.ok) {
        // Non-fatal: the reply landed; only the push/timestamp side-effect is
        // pending the undeployed function.
        console.warn("[support] reply persisted; side-effect deferred:", sideEffect.error);
      }
      await logAdminAction("support.reply", "support_ticket", selectedTicket.id);
      if (!mountedRef.current) return;
      setReply("");
      await loadThread(selectedTicket.conversation_id);
      await loadQueue();
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't send reply", description: err.message });
    } finally {
      if (mountedRef.current) setActing(false);
    }
  }, [selectedTicket, reply, myUserId, addToast, loadThread, loadQueue]);

  const handleSetStatus = useCallback(async (nextStatus) => {
    if (!selectedTicket || nextStatus === selectedTicket.status) return;
    setActing(true);
    const res = await invokeSupportFn("support-set-status", {
      ticketId: selectedTicket.id,
      status: nextStatus,
    });
    if (res.ok) {
      addToast({ variant: "success", title: `Status → ${nextStatus}` });
      await logAdminAction("support.set_status", "support_ticket", selectedTicket.id, { status: nextStatus });
      setSelectedTicket((t) => (t ? { ...t, status: nextStatus } : t));
      await loadQueue();
    } else {
      addToast({ variant: "error", title: "Couldn't change status", description: res.error });
    }
    if (mountedRef.current) setActing(false);
  }, [selectedTicket, addToast, loadQueue]);

  const handleSetPriority = useCallback(async (nextPriority) => {
    if (!selectedTicket || nextPriority === selectedTicket.priority) return;
    setActing(true);
    const res = await invokeSupportFn("support-set-status", {
      ticketId: selectedTicket.id,
      priority: nextPriority,
    });
    if (res.ok) {
      addToast({ variant: "success", title: `Priority → ${nextPriority}` });
      await logAdminAction("support.set_priority", "support_ticket", selectedTicket.id, { priority: nextPriority });
      setSelectedTicket((t) => (t ? { ...t, priority: nextPriority } : t));
      await loadQueue();
    } else {
      addToast({ variant: "error", title: "Couldn't change priority", description: res.error });
    }
    if (mountedRef.current) setActing(false);
  }, [selectedTicket, addToast, loadQueue]);

  // ─── Agents panel ─────────────────────────────────────────────────────────────

  const loadStaff = useCallback(async () => {
    setStaffLoading(true);
    try {
      const { data, error } = await supabase
        .from("support_staff")
        .select("user_id, enabled, available, display_name, role, created_at, updated_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = data || [];
      // Resolve staff profile labels.
      const ids = rows.map((r) => r.user_id);
      const profRes = ids.length
        ? await supabase
            .from("profiles_with_segment")
            .select("id, display_name, username, email, avatar_url, segment")
            .in("id", ids)
        : { data: [] };
      if (!mountedRef.current) return;
      const pMap = {};
      (profRes.data || []).forEach((p) => { pMap[p.id] = p; });
      setStaff(rows.map((r) => ({ ...r, profile: pMap[r.user_id] ?? null })));
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't load agents", description: err.message });
      setStaff([]);
    } finally {
      if (mountedRef.current) setStaffLoading(false);
    }
  }, [addToast]);

  const openAgents = useCallback(() => {
    setAgentsOpen(true);
    setGrantEmail("");
    void loadStaff();
  }, [loadStaff]);

  const handleGrant = useCallback(async (e) => {
    e?.preventDefault?.();
    const email = grantEmail.trim().toLowerCase();
    if (!email) return;
    setGranting(true);
    const res = await invokeSupportFn("support-grant-staff", { email, enabled: true });
    if (res.ok) {
      addToast({ variant: "success", title: "Support access granted", description: email });
      await logAdminAction("support.grant_staff", "support_staff", email, { enabled: true });
      setGrantEmail("");
      await loadStaff();
    } else {
      addToast({ variant: "error", title: "Couldn't grant access", description: res.error });
    }
    if (mountedRef.current) setGranting(false);
  }, [grantEmail, addToast, loadStaff]);

  const handleRevoke = useCallback(async (member) => {
    setGranting(true);
    const res = await invokeSupportFn("support-grant-staff", {
      userId: member.user_id,
      enabled: false,
    });
    if (res.ok) {
      addToast({ variant: "success", title: "Support access revoked", description: profileLabel(member.profile) });
      await logAdminAction("support.revoke_staff", "support_staff", member.user_id, { enabled: false });
      await loadStaff();
    } else {
      addToast({ variant: "error", title: "Couldn't revoke access", description: res.error });
    }
    if (mountedRef.current) setGranting(false);
  }, [addToast, loadStaff]);

  // ─── Derived ──────────────────────────────────────────────────────────────────

  const unassignedCount = useMemo(
    () => tickets.filter((t) => !t.assigned_staff_id).length,
    [tickets],
  );

  const requester = selectedTicket ? profilesById[selectedTicket.requester_user_id] : null;
  const assignee = selectedTicket?.assigned_staff_id ? profilesById[selectedTicket.assigned_staff_id] : null;
  const brand = selectedTicket?.brand_id ? brandsById[selectedTicket.brand_id] : null;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <LifeBuoy className="h-8 w-8 text-[var(--color-brand-500)]" />
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Support</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Answer business support tickets. {unassignedCount} unassigned.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={Shield} onClick={openAgents}>
            Agents
          </Button>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void loadQueue()}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Status filter tabs + unassigned toggle */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatusFilter(tab.id)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              statusFilter === tab.id
                ? "border-[var(--color-brand-500)] bg-[var(--color-brand-500)] text-white"
                : "border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={unassignedOnly}
            onChange={(e) => setUnassignedOnly(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--gray-300)] accent-[var(--color-brand-500)] cursor-pointer"
          />
          Unassigned only
        </label>
      </div>

      {/* Queue */}
      <SectionCard
        title={`Tickets (${tickets.length})`}
        subtitle="Newest activity first"
        noPadding
      >
        {queueLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : queueError ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-[var(--color-text-primary)] font-medium">Couldn't load the queue</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">{queueError}</p>
            <Button variant="link" onClick={() => void loadQueue()}>Try again</Button>
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <LifeBuoy className="h-10 w-10 text-[var(--gray-300)]" />
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {statusFilter === "all" && !unassignedOnly
                ? "No support tickets yet."
                : "No tickets match this filter."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--gray-200)] text-left text-[var(--color-text-tertiary)]">
                  <th className="py-2.5 px-4">Requester</th>
                  <th className="py-2.5 px-4">Subject</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Priority</th>
                  <th className="py-2.5 px-4">Assigned</th>
                  <th className="py-2.5 px-4">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => {
                  const r = profilesById[t.requester_user_id];
                  const a = t.assigned_staff_id ? profilesById[t.assigned_staff_id] : null;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => openTicket(t)}
                      className="border-b border-[var(--gray-100)] hover:bg-[var(--gray-50)] cursor-pointer"
                    >
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar src={r?.avatar_url} name={profileLabel(r)} size="sm" />
                          <span className="truncate text-[var(--color-text-primary)]">{profileLabel(r)}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 max-w-[260px]">
                        <span className="truncate block text-[var(--color-text-primary)]">{t.subject}</span>
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge variant={STATUS_BADGE[t.status] || "default"} dot>{t.status}</Badge>
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge variant={PRIORITY_BADGE[t.priority] || "default"}>{t.priority}</Badge>
                      </td>
                      <td className="py-2.5 px-4">
                        {a ? (
                          <span className="text-[var(--color-text-secondary)] truncate">{profileLabel(a)}</span>
                        ) : (
                          <Badge variant="warning">Unassigned</Badge>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-[var(--color-text-tertiary)] whitespace-nowrap">
                        {timeAgo(t.last_message_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Ticket detail modal: left thread + right meta/actions */}
      <Modal
        open={!!selectedTicket}
        onClose={closeTicket}
        title={selectedTicket?.subject ?? "Ticket"}
        size="lg"
      >
        <ModalBody className="!p-0">
          {selectedTicket && (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_280px]">
              {/* Thread */}
              <div className="flex flex-col border-r border-[var(--gray-200)] min-h-[320px]">
                <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[52vh]">
                  {threadLoading ? (
                    <div className="flex justify-center py-8"><Spinner /></div>
                  ) : threadError ? (
                    <div className="rounded-lg border border-[var(--color-error-200,#fecaca)] bg-[var(--color-error-50)] p-3 text-xs text-[var(--color-error-700)]">
                      Couldn't load the conversation: {threadError}
                    </div>
                  ) : messages.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-tertiary)] text-center py-8">
                      No messages yet in this ticket.
                    </p>
                  ) : (
                    messages.map((m) => {
                      const mine = m.sender_id === myUserId;
                      const isSystem = m.message_type === "system" || !m.sender_id;
                      const sender = m.sender_id ? profilesById[m.sender_id] : null;
                      if (isSystem) {
                        return (
                          <p key={m.id} className="text-center text-xs text-[var(--color-text-tertiary)] italic">
                            {m.content}
                          </p>
                        );
                      }
                      return (
                        <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                          <div
                            className={[
                              "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                              mine
                                ? "bg-[var(--color-brand-500)] text-white"
                                : "bg-[var(--gray-100)] text-[var(--color-text-primary)]",
                            ].join(" ")}
                          >
                            {m.content}
                          </div>
                          <span className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                            {mine ? "You" : profileLabel(sender)} · {timeAgo(m.created_at)}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
                {/* Composer */}
                <div className="border-t border-[var(--gray-200)] p-3 flex items-end gap-2">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void handleReply();
                      }
                    }}
                    placeholder="Reply to the business…"
                    rows={2}
                    disabled={acting}
                    className="flex-1 resize-none rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] outline-none"
                  />
                  <Button
                    variant="primary"
                    icon={Send}
                    loading={acting}
                    disabled={acting || !reply.trim()}
                    onClick={() => void handleReply()}
                  >
                    Send
                  </Button>
                </div>
              </div>

              {/* Meta + actions */}
              <div className="p-4 space-y-4 text-sm">
                <div className="space-y-1">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase tracking-wide">Requester</div>
                  <div className="flex items-center gap-2">
                    <Avatar src={requester?.avatar_url} name={profileLabel(requester)} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-[var(--color-text-primary)]">{profileLabel(requester)}</div>
                      {requester?.email && (
                        <div className="truncate text-xs text-[var(--color-text-tertiary)]">{requester.email}</div>
                      )}
                    </div>
                  </div>
                  {requester?.segment && (
                    <Badge variant="info">{requester.segment}</Badge>
                  )}
                </div>

                {brand && (
                  <div className="space-y-1">
                    <div className="text-[var(--color-text-tertiary)] text-xs uppercase tracking-wide">Brand</div>
                    <div className="text-[var(--color-text-primary)] truncate">{brand.name}</div>
                  </div>
                )}

                <div className="space-y-1">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase tracking-wide">Assigned</div>
                  {assignee ? (
                    <div className="text-[var(--color-text-primary)] truncate">{profileLabel(assignee)}</div>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      icon={UserCheck}
                      loading={acting}
                      disabled={acting}
                      onClick={() => void handleClaim()}
                    >
                      Claim ticket
                    </Button>
                  )}
                </div>

                <label className="block space-y-1">
                  <span className="text-[var(--color-text-tertiary)] text-xs uppercase tracking-wide">Status</span>
                  <select
                    value={selectedTicket.status}
                    onChange={(e) => void handleSetStatus(e.target.value)}
                    disabled={acting}
                    className="w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[var(--color-text-tertiary)] text-xs uppercase tracking-wide">Priority</span>
                  <select
                    value={selectedTicket.priority}
                    onChange={(e) => void handleSetPriority(e.target.value)}
                    disabled={acting}
                    className="w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </label>

                <div className="pt-2 border-t border-[var(--gray-200)] space-y-1 text-xs text-[var(--color-text-tertiary)]">
                  <div>Opened {formatDateTime(selectedTicket.created_at)}</div>
                  {selectedTicket.first_response_at && (
                    <div>First reply {timeAgo(selectedTicket.first_response_at)}</div>
                  )}
                  {selectedTicket.resolved_at && (
                    <div>Resolved {timeAgo(selectedTicket.resolved_at)}</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={closeTicket}>Close</Button>
        </ModalFooter>
      </Modal>

      {/* Agents panel */}
      <Modal open={agentsOpen} onClose={() => setAgentsOpen(false)} title="Support agents" size="md">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            Grant or revoke a user's support capability. Granted staff see the
            Support console in the business app and can answer tickets.
          </p>

          <form onSubmit={handleGrant} className="flex items-end gap-2 mb-5">
            <div className="flex-1">
              <Input
                label="Grant by email"
                type="email"
                placeholder="teammate@company.com"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
              />
            </div>
            <Button type="submit" variant="primary" icon={UserPlus} loading={granting} disabled={!grantEmail.trim()}>
              Grant
            </Button>
          </form>

          <div className="text-[var(--color-text-tertiary)] text-xs uppercase tracking-wide mb-2">
            Current agents
          </div>
          {staffLoading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : staff.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <Users className="h-8 w-8 text-[var(--gray-300)]" />
              <p className="text-sm text-[var(--color-text-tertiary)]">No support agents yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--gray-200)]">
              {staff.map((member) => (
                <div key={member.user_id} className="flex items-center gap-3 py-3">
                  <Avatar src={member.profile?.avatar_url} name={profileLabel(member.profile)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-[var(--color-text-primary)]">
                      {member.display_name || profileLabel(member.profile)}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant={member.enabled ? "success" : "default"} dot>
                        {member.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                      {member.enabled && (
                        <Badge variant={member.available ? "brand" : "default"}>
                          {member.available ? "Available" : "Off shift"}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {member.enabled ? (
                    <Button variant="ghost" size="sm" icon={UserX} disabled={granting} onClick={() => void handleRevoke(member)}>
                      Revoke
                    </Button>
                  ) : (
                    <span className="text-xs text-[var(--color-text-tertiary)]">revoked</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setAgentsOpen(false)}>Done</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

export default SupportDeskPage;
