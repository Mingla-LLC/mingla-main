import { useState, useEffect, useCallback, useRef } from "react";
import {
  Shield, UserPlus, UserX, Mail, AlertCircle, Crown, Clock, Send, Undo2, Loader2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { ListItemSkeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { formatRelativeTime } from "../lib/formatters";
import { INVITABLE_ROLES, ROLE_LABELS } from "../lib/access";
import { INVITE_STATE_COPY, findInviteState, inviteRowState } from "../lib/inviteLink";
import { PageHeader } from "../components/ui/PageHeader";
import { useOnline } from "../hooks/useCrmPipeline";
import { useTeamAgentOverview } from "../hooks/useTeamAgentOverview";
import { overviewRows, agentErrorWords } from "../lib/agentConnect";
import { revokeKey } from "../services/teamAgentService";
import { AgentStatusList } from "../components/agent/AgentTeamList";
import { listProfiles, setProfile } from "../services/teamProfileService";
import { opsErrorWords } from "../lib/opsModel";

// Issue #3802 — Team and roles (owner only).
//
// Every read and write on this page goes through the server: the roster and
// the invitation states are read with two owner-only functions, membership is
// changed with admin_team_set_member, and invitations are sent by the
// admin-team-invite function. The page never writes a membership table and
// never logs team actions itself (the server records them).

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOTICE_MS = 8000;
const HIGHLIGHT_MS = 2500;

const ROLE_OPTION_TEXT = {
  admin: "Admin — everything except changing roles",
  growth: "Sales and marketing — their own home; outreach and content tools as they launch",
  partner: "Founding partner — their own home; company view as it launches",
};

const TEAM_ERRORS = {
  forbidden: "Only the owner can change team access.",
  cannot_change_self: "You can't change your own access.",
  cannot_change_owner: "The owner's access can't be changed here.",
  invalid_email: "That doesn't look like an email address.",
  never_activated: "They haven't signed in yet, so there is nothing to restore. Send a new invite instead.",
  team_membership_conflict: "They already have access under another role. Reload and try again.",
  already_active: "They already have access. Change their role on their row instead.",
  invalid_token: "Something went wrong. Try again.",
  // The address belongs to an account that signs in another way (issue #3802).
  address_in_use: "That address can't be used for team access.",
};

/** Why an address was refused as "in use", and what to do. Stays on screen. */
function addressInUseLine(email) {
  return `${email} already has a Mingla account that signs in another way (a phone number, or Google or Apple). Invite them on an address that has no Mingla account.`;
}

/** A server refusal (its message starts with a short code) as toast text. */
function teamError(raw) {
  const text = String(raw ?? "").trim();
  const code = text.match(/^[a-z_]+/)?.[0];
  if (code && Object.hasOwn(TEAM_ERRORS, code)) {
    return { title: TEAM_ERRORS[code] };
  }
  return { title: "Something went wrong. Try again.", description: text || undefined };
}

const SELECT_CLASS =
  "h-10 px-3 text-sm rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed";
const ROW_SELECT_CLASS =
  "h-8 px-2 text-xs rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed";

function shortDate(value) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : "";
}

export function AdminPage() {
  const { addToast } = useToast();
  const online = useOnline();
  const agentOverview = useTeamAgentOverview();
  const mountedRef = useRef(true);
  const noticeTimersRef = useRef({});
  const highlightTimerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    const timers = noticeTimersRef.current;
    return () => {
      mountedRef.current = false;
      Object.values(timers).forEach(clearTimeout);
      clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const [people, setPeople] = useState([]);
  const [inviteStates, setInviteStates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [inviting, setInviting] = useState(false);

  // Per-row state, keyed by email
  const [busy, setBusy] = useState({});            // email -> name of the action in flight
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [notices, setNotices] = useState({});      // email -> { text, undo }
  const [reinvite, setReinvite] = useState({});    // email -> role picked for "Invite again"
  const [highlight, setHighlight] = useState(null);
  const [busyAgentKeyId, setBusyAgentKeyId] = useState(null);
  // Addresses the server refused as "in use": the one typed in the invite
  // form, and people on the list a re-send was refused for. Each line stays
  // until the address is edited or an invite to it goes through.
  const [formInUse, setFormInUse] = useState("");
  const [rowsInUse, setRowsInUse] = useState({});  // email -> true

  // #3980 Display names and GitHub usernames (owner only), keyed by email:
  // { name, login, savedName, savedLogin, fallback, state, error }.
  const [profiles, setProfiles] = useState({});
  const [profilesError, setProfilesError] = useState("");

  // Activity modal
  const [activityTarget, setActivityTarget] = useState(null);
  const [activityLogs, setActivityLogs] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState(false);

  /** Loads the roster and the invitation states together. */
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const [listRes, statesRes] = await Promise.all([
        supabase.rpc("admin_team_list"),
        supabase.rpc("admin_team_invite_states"),
      ]);
      if (!mountedRef.current) return;
      const failed = listRes.error || statesRes.error;
      if (failed) {
        // A refresh after an action keeps the list already on screen.
        if (!quiet) {
          setPeople([]);
          setInviteStates([]);
          setError(teamError(failed.message));
        }
        return;
      }
      setPeople(listRes.data || []);
      setInviteStates(statesRes.data || []);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      if (!quiet) {
        setPeople([]);
        setInviteStates([]);
        setError({ title: "Check your connection and try again.", description: err?.message });
      }
    } finally {
      if (mountedRef.current && !quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Names load beside the roster; admin_team_list stays as it is.
  useEffect(() => {
    let live = true;
    listProfiles().then((rows) => {
      if (!live) return;
      const next = {};
      for (const p of rows) {
        next[p.email] = { name: p.display_name || "", login: p.github_login || "", savedName: p.display_name || "", savedLogin: p.github_login || "", fallback: p.fallback_name || "", state: "", error: "" };
      }
      setProfiles(next);
      setProfilesError("");
    }).catch((err) => { if (live) setProfilesError(opsErrorWords(err)); });
    return () => { live = false; };
  }, []);

  const editProfile = (email, field, value) =>
    setProfiles((prev) => ({ ...prev, [email]: { ...(prev[email] || { name: "", login: "", savedName: "", savedLogin: "", fallback: "" }), [field]: value, state: "", error: "", warning: "" } }));

  const saveProfile = async (email) => {
    const p = profiles[email];
    if (!p || (p.name.trim() === p.savedName && p.login.trim() === p.savedLogin)) return;
    setProfiles((prev) => ({ ...prev, [email]: { ...prev[email], state: "saving", error: "" } }));
    try {
      const saved = await setProfile(email, p.name, p.login);
      if (!mountedRef.current) return;
      setProfiles((prev) => ({ ...prev, [email]: { ...prev[email], name: saved?.display_name || "", login: saved?.github_login || "", savedName: saved?.display_name || "", savedLogin: saved?.github_login || "", state: "saved", error: "", warning: saved?.warning || "" } }));
    } catch (err) {
      if (!mountedRef.current) return;
      setProfiles((prev) => ({ ...prev, [email]: { ...prev[email], state: "", error: opsErrorWords(err) } }));
    }
  };

  const setRowBusy = (email, action) =>
    setBusy((prev) => {
      const next = { ...prev };
      if (action) next[email] = action;
      else delete next[email];
      return next;
    });

  const clearNotice = useCallback((email) => {
    clearTimeout(noticeTimersRef.current[email]);
    delete noticeTimersRef.current[email];
    setNotices((prev) => {
      if (!Object.hasOwn(prev, email)) return prev;
      const next = { ...prev };
      delete next[email];
      return next;
    });
  }, []);

  /** An inline notice on a row for 8 seconds, optionally with Undo. */
  const showNotice = useCallback((email, notice) => {
    clearTimeout(noticeTimersRef.current[email]);
    setNotices((prev) => ({ ...prev, [email]: notice }));
    noticeTimersRef.current[email] = setTimeout(() => clearNotice(email), NOTICE_MS);
  }, [clearNotice]);

  const setMember = async (email, role, status) => {
    const { data, error: rpcError } = await supabase.rpc("admin_team_set_member", {
      p_email: email, p_role: role, p_status: status,
    });
    if (rpcError) return { ok: false, message: rpcError.message };
    return { ok: true, data };
  };

  /**
   * Sends (or re-sends) an invitation. Nothing else on this page sends one.
   * Returns { outcome }: "sent" | "not_sent" (invited, email failed) |
   * "refused" (with the server's code) | "unreachable".
   */
  const sendInvite = async (email, role) => {
    try {
      const { data, error: fnError } = await supabase.functions.invoke("admin-team-invite", {
        body: { email, role },
      });
      if (fnError || !data) return { outcome: "unreachable" };
      if (!data.ok) return { outcome: "refused", code: data.code };
      return { outcome: data.email_sent ? "sent" : "not_sent", data };
    } catch {
      return { outcome: "unreachable" };
    }
  };

  const markRowInUse = (email, on) =>
    setRowsInUse((prev) => {
      if (!!prev[email] === on) return prev;
      const next = { ...prev };
      if (on) next[email] = true;
      else delete next[email];
      return next;
    });

  /** The toast for an invitation that could not be sent at all. */
  const toastInviteFailure = (result) => {
    if (result.outcome === "refused") {
      addToast({ variant: "error", ...teamError(result.code) });
    } else {
      addToast({
        variant: "error",
        title: "Couldn't send the invite",
        description: "Check your connection and try again.",
      });
    }
  };

  const toastNotSent = (email) =>
    addToast({
      variant: "warning",
      title: "Invited, but the email didn't send",
      description: `Use "Resend invite" on ${email}'s row.`,
    });

  // ── Invite form ─────────────────────────────────────────────────────────
  const typedEmail = inviteEmail.trim().toLowerCase();
  const typedMatch = typedEmail ? people.find((p) => p.email === typedEmail) : null;
  const typedHasAccess = !!typedMatch && typedMatch.status !== "revoked";
  const canSend = EMAIL_PATTERN.test(typedEmail) && !!inviteRole && !typedHasAccess;

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!canSend || inviting) return;
    const email = typedEmail;
    const role = inviteRole;
    setInviting(true);
    try {
      const result = await sendInvite(email, role);
      if (result.outcome === "sent" || result.outcome === "not_sent") {
        if (result.outcome === "sent") {
          addToast({
            variant: "success",
            title: "Invite sent",
            description: `${email} was invited as ${ROLE_LABELS[role]}. The link expires in 7 days.`,
          });
        } else {
          toastNotSent(email);
        }
        setInviteEmail("");
        setInviteRole("");
        setFormInUse("");
        await load({ quiet: true });
      } else {
        toastInviteFailure(result);
        // The typed address stays in the field, with the reason under it.
        if (result.outcome === "refused" && result.code === "address_in_use") setFormInUse(email);
      }
    } finally {
      if (mountedRef.current) setInviting(false);
    }
  };

  const showPerson = (email) => {
    setHighlight(email);
    document.getElementById(`team-row-${email}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
  };

  // ── Row actions ─────────────────────────────────────────────────────────

  /**
   * Changes a role. For someone who is still invited the old link stops
   * working, so a new invitation goes out in the same action.
   */
  const changeRole = async (row, newRole, { isUndo = false } = {}) => {
    if (newRole === row.role) return;
    const email = row.email;
    const label = ROLE_LABELS[newRole];
    setRowBusy(email, "role");
    clearNotice(email);
    try {
      const changed = await setMember(email, newRole, row.status);
      if (!changed.ok) {
        addToast({ variant: "error", ...teamError(changed.message) });
        return;
      }
      const previousRole = changed.data?.previous?.role || row.role;

      if (row.status === "invited") {
        const sent = await sendInvite(email, newRole);
        if (sent.outcome === "sent") {
          addToast({
            variant: "success",
            title: isUndo ? "Role change undone" : "Role changed",
            description: `${email} is now invited as ${label}. A new link is on its way; the old one no longer works.`,
          });
        } else {
          addToast({
            variant: "warning",
            title: "Role changed, but the new invite didn't send",
            description: `Use "Resend invite" on ${email}'s row.`,
          });
        }
      } else {
        addToast({
          variant: "success",
          title: isUndo ? "Role change undone" : "Role changed",
          description: `${email} is now ${label}.`,
        });
      }

      if (!isUndo) {
        showNotice(email, {
          text: `Changed to ${label}.`,
          undo: { kind: "role", role: previousRole },
        });
      }
      await load({ quiet: true });
    } finally {
      if (mountedRef.current) setRowBusy(email, null);
    }
  };

  const removeAccess = async (row) => {
    const email = row.email;
    setRowBusy(email, "remove");
    clearNotice(email);
    try {
      const removed = await setMember(email, row.role, "revoked");
      if (!removed.ok) {
        addToast({ variant: "error", ...teamError(removed.message) });
        return;
      }
      setConfirmRemove(null);
      addToast({
        variant: "success",
        title: "Access removed",
        description: `${email} can no longer open Mingla Admin. Their agent keys were turned off.`,
      });
      const previous = removed.data?.previous || { role: row.role, status: row.status };
      showNotice(email, {
        text: "Access removed.",
        undo: { kind: "removal", role: previous.role, status: previous.status },
      });
      agentOverview.retry();
      await load({ quiet: true });
    } finally {
      if (mountedRef.current) setRowBusy(email, null);
    }
  };

  const undoRemoval = async (email, previous) => {
    setRowBusy(email, "undo");
    clearNotice(email);
    try {
      const restored = await setMember(email, previous.role, previous.status);
      if (!restored.ok) {
        addToast({ variant: "error", ...teamError(restored.message) });
        return;
      }
      addToast({
        variant: "success",
        title: "Access restored",
        description: previous.status === "invited"
          ? `${email}'s old link no longer works. Send a new invite from their row. They can connect a new agent.`
          : `${email} can open Mingla Admin again as ${ROLE_LABELS[previous.role]}. They can connect a new agent.`,
      });
      agentOverview.retry();
      await load({ quiet: true });
    } finally {
      if (mountedRef.current) setRowBusy(email, null);
    }
  };

  const runUndo = (row, undo) => {
    if (undo.kind === "role") {
      changeRole(row, undo.role, { isUndo: true });
    } else {
      undoRemoval(row.email, undo);
    }
  };

  const resendInvite = async (row) => {
    const email = row.email;
    setRowBusy(email, "resend");
    try {
      const result = await sendInvite(email, row.role);
      if (result.outcome === "sent") {
        addToast({
          variant: "success",
          title: "Invite resent",
          description: `A new link is on its way to ${email}. The old one no longer works.`,
        });
        markRowInUse(email, false);
        await load({ quiet: true });
      } else if (result.outcome === "not_sent") {
        toastNotSent(email);
        markRowInUse(email, false);
        await load({ quiet: true });
      } else {
        toastInviteFailure(result);
        if (result.outcome === "refused" && result.code === "address_in_use") markRowInUse(email, true);
      }
    } finally {
      if (mountedRef.current) setRowBusy(email, null);
    }
  };

  const inviteAgain = async (row) => {
    const email = row.email;
    const role = reinvite[email] || row.role;
    setRowBusy(email, "reinvite");
    clearNotice(email);
    try {
      const result = await sendInvite(email, role);
      if (result.outcome === "sent" || result.outcome === "not_sent") {
        if (result.outcome === "sent") {
          addToast({
            variant: "success",
            title: "Invite sent",
            description: `${email} was invited as ${ROLE_LABELS[role]}. The link expires in 7 days.`,
          });
        } else {
          toastNotSent(email);
        }
        setReinvite((prev) => {
          const next = { ...prev };
          delete next[email];
          return next;
        });
        markRowInUse(email, false);
        await load({ quiet: true });
      } else {
        toastInviteFailure(result);
        if (result.outcome === "refused" && result.code === "address_in_use") markRowInUse(email, true);
      }
    } finally {
      if (mountedRef.current) setRowBusy(email, null);
    }
  };

  // ── Activity ────────────────────────────────────────────────────────────
  const openActivity = async (row) => {
    setActivityTarget(row);
    setActivityLogs([]);
    setActivityError(false);
    setActivityLoading(true);
    try {
      const { data, error: queryError } = await supabase
        .from("admin_audit_log")
        .select("*")
        .eq("admin_email", row.email)
        .order("created_at", { ascending: false })
        .limit(50);
      if (queryError) throw queryError;
      if (mountedRef.current) setActivityLogs(data || []);
    } catch (err) {
      console.error("Activity load failed:", err?.message || err);
      if (mountedRef.current) setActivityError(true);
    } finally {
      if (mountedRef.current) setActivityLoading(false);
    }
  };

  const closeActivity = () => {
    setActivityTarget(null);
    setActivityLogs([]);
    setActivityError(false);
  };

  // ── Groups ──────────────────────────────────────────────────────────────
  const withAccess = people.filter((p) => p.status === "active");
  const invited = people.filter((p) => p.status === "invited");
  const removed = people.filter((p) => p.status === "revoked");
  const needNewLink = invited.filter(
    (p) => INVITE_STATE_COPY[inviteRowState(p, inviteStates)].needsNewLink
  ).length;
  const onlyOwner = !loading && !error && people.length > 0 && people.every((p) => p.role === "owner");
  const agentRows = overviewRows(agentOverview.data);
  const disconnectAgent = async (keyId, name, label) => {
    if (busyAgentKeyId) return { ok: false, message: "Another disconnect is still running." };
    if (!online) return { ok: false, message: "Reconnect to disconnect an agent." };
    setBusyAgentKeyId(keyId);
    try {
      const result = await revokeKey(keyId);
      const already = result?.changed === false;
      addToast({
        variant: already ? "info" : "success",
        title: already ? "This agent was already disconnected." : `${name}'s ${label} is disconnected`,
        description: "Its key stopped working. They can connect a new agent.",
      });
      agentOverview.retry();
      return { ok: true, already };
    } catch (agentError) {
      const message = agentErrorWords(agentError);
      addToast({ variant: "error", title: `Couldn't disconnect ${name}'s ${label}`, description: message });
      return { ok: false, message };
    } finally {
      if (mountedRef.current) setBusyAgentKeyId(null);
    }
  };

  const renderNotice = (row) => {
    const notice = notices[row.email];
    if (!notice) return null;
    return (
      <div
        role="status"
        className="mx-5 mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-background-secondary)] px-3 py-2 text-xs text-[var(--color-text-secondary)]"
      >
        <span>{notice.text}</span>
        {notice.undo && (
          <Button
            variant="link"
            size="sm"
            icon={Undo2}
            disabled={!!busy[row.email]}
            onClick={() => runUndo(row, notice.undo)}
          >
            Undo
          </Button>
        )}
      </div>
    );
  };

  const renderRoleSelect = (row, rowBusy, saving) => (
    <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
      {saving && (
        <Loader2 className="h-3.5 w-3.5 animate-[spin_0.6s_linear_infinite]" aria-label="Saving" />
      )}
      <span>Role</span>
      <select
        className={ROW_SELECT_CLASS}
        value={row.role}
        disabled={rowBusy}
        onChange={(e) => changeRole(row, e.target.value)}
      >
        {INVITABLE_ROLES.map((r) => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </select>
    </label>
  );

  const renderRow = (row) => {
    const email = row.email;
    const isOwner = row.role === "owner";
    const locked = isOwner || row.is_self;
    const action = busy[email];
    const rowBusy = !!action;
    const confirming = confirmRemove === email;
    const stateKey = row.status === "invited" ? inviteRowState(row, inviteStates) : null;
    const stateCopy = stateKey ? INVITE_STATE_COPY[stateKey] : null;
    const agentRow = row.status === "active" ? agentRows.find((candidate) => candidate.email === email) || { email, name: email, role: row.role, agents: [] } : { email, name: email, role: row.role, agents: [] };
    const Icon = isOwner ? Crown : row.status === "invited" ? Mail : row.status === "revoked" ? UserX : Shield;

    let controls;
    if (locked) {
      controls = (
        <span className="text-xs text-[var(--color-text-tertiary)]">{isOwner ? "Owner" : "You"}</span>
      );
    } else if (confirming) {
      controls = (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Remove access for ${email}? Their agent keys will be turned off.`}>
          <span className="text-xs text-[var(--color-text-primary)]">{`Remove access for ${email}? Their agent keys will be turned off.`}</span>
          <Button variant="danger" size="sm" loading={action === "remove"} onClick={() => removeAccess(row)}>
            Remove
          </Button>
          <Button variant="secondary" size="sm" disabled={rowBusy} onClick={() => setConfirmRemove(null)}>
            Keep
          </Button>
        </div>
      );
    } else if (row.status === "revoked") {
      const picking = Object.hasOwn(reinvite, email);
      controls = picking ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
            <span>Role</span>
            <select
              className={ROW_SELECT_CLASS}
              value={reinvite[email]}
              disabled={rowBusy}
              onChange={(e) => setReinvite((prev) => ({ ...prev, [email]: e.target.value }))}
            >
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </label>
          <Button variant="primary" size="sm" icon={Send} loading={action === "reinvite"} onClick={() => inviteAgain(row)}>
            Send invite
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={rowBusy}
            onClick={() => setReinvite((prev) => {
              const next = { ...prev };
              delete next[email];
              return next;
            })}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          icon={UserPlus}
          disabled={rowBusy}
          loading={action === "undo"}
          onClick={() => setReinvite((prev) => ({
            ...prev,
            [email]: INVITABLE_ROLES.includes(row.role) ? row.role : INVITABLE_ROLES[0],
          }))}
        >
          Invite again
        </Button>
      );
    } else {
      controls = (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {renderRoleSelect(row, rowBusy, action === "role" || action === "undo")}
          {row.status === "active" && (
            <Button variant="ghost" size="sm" icon={Clock} disabled={rowBusy} onClick={() => openActivity(row)}>
              Activity
            </Button>
          )}
          {row.status === "invited" && (
            <Button
              variant="secondary"
              size="sm"
              icon={Send}
              loading={action === "resend"}
              disabled={rowBusy}
              onClick={() => resendInvite(row)}
            >
              Resend invite
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={UserX}
            disabled={rowBusy}
            onClick={() => setConfirmRemove(email)}
          >
            Remove access
          </Button>
        </div>
      );
    }

    return (
      <div
        key={email}
        id={`team-row-${email}`}
        aria-busy={rowBusy}
        className={[
          "transition-colors duration-300",
          highlight === email ? "bg-[var(--color-brand-50)]" : "",
        ].join(" ")}
      >
        <div className="grid min-w-0 grid-cols-1 gap-4 px-5 py-3.5 lg:grid-cols-[minmax(200px,1fr)_minmax(220px,.8fr)_auto] lg:items-start">
          <div className="flex min-w-0 items-start gap-4">
            <div
              className={[
                "flex h-9 w-9 items-center justify-center rounded-full shrink-0",
                isOwner
                  ? "bg-[var(--color-brand-50)] text-[var(--color-brand-500)]"
                  : row.status === "active"
                    ? "bg-[var(--color-success-50)] text-[var(--color-success-700)]"
                    : row.status === "invited"
                      ? "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
                      : "bg-[var(--gray-100)] text-[var(--color-text-muted)]",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p
                className={[
                  "text-sm font-medium break-all",
                  row.status === "revoked"
                    ? "text-[var(--color-text-tertiary)]"
                    : "text-[var(--color-text-primary)]",
                ].join(" ")}
              >
                {email}
              </p>
              {row.is_self && <Badge variant="info">you</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              <Badge variant={isOwner ? "brand" : row.status === "revoked" ? "default" : "outline"}>
                {ROLE_LABELS[row.role] || row.role}
              </Badge>
              {stateCopy && <Badge variant={stateCopy.variant} dot>{stateCopy.badge}</Badge>}
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {row.status === "active" && row.accepted_at && `since ${shortDate(row.accepted_at)}`}
                {row.status === "invited" &&
                  [row.invited_by ? `invited by ${row.invited_by}` : "invited", shortDate(row.created_at)]
                    .filter(Boolean)
                    .join(" · ")}
              </span>
            </div>
            {stateCopy && (
              <p className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
                {stateCopy.line(row, findInviteState(row, inviteStates))}
              </p>
            )}
            {(row.status === "active" || row.status === "invited") && profiles[email] && (
              <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Name</span>
                  <input
                    value={profiles[email].name}
                    maxLength={40}
                    placeholder={profiles[email].fallback}
                    disabled={!online || profiles[email].state === "saving"}
                    aria-invalid={profiles[email].error ? "true" : undefined}
                    aria-describedby={`profile-state-${email}`}
                    onChange={(e) => editProfile(email, "name", e.target.value.replace(/[\r\n]+/g, " "))}
                    onBlur={() => saveProfile(email)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                    className="min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]"
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">GitHub username</span>
                  <input
                    value={profiles[email].login}
                    maxLength={39}
                    placeholder="github username"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={!online || profiles[email].state === "saving"}
                    aria-invalid={profiles[email].error ? "true" : undefined}
                    aria-describedby={`profile-state-${email}`}
                    onChange={(e) => editProfile(email, "login", e.target.value.trim())}
                    onBlur={() => saveProfile(email)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                    className="min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]"
                  />
                </label>
                <p id={`profile-state-${email}`} role="status" className={`text-xs sm:col-span-2 ${profiles[email].error ? "text-[var(--color-error-700)]" : profiles[email].warning ? "text-[var(--color-warning-700)]" : "text-[var(--color-text-tertiary)]"}`}>
                  {profiles[email].error || (profiles[email].state === "saving" ? "Saving…" : profiles[email].state === "saved" ? (profiles[email].warning ? `Saved. ${profiles[email].warning}` : "Saved") : !online ? "You're offline. Names save when you're back online." : "")}
                </p>
              </div>
            )}
            </div>
          </div>
          <AgentStatusList
            row={agentRow}
            loading={row.status === "active" && agentOverview.loading}
            unavailable={row.status === "active" && !!agentOverview.error}
            busyKeyId={busyAgentKeyId}
            offline={!online}
            onDisconnect={disconnectAgent}
          />
          <div className="max-w-full lg:justify-self-end">{controls}</div>
        </div>
        {renderNotice(row)}
        {rowsInUse[row.email] && (
          <p
            role="status"
            className="mx-5 mb-3 rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]"
          >
            {addressInUseLine(row.email)}
          </p>
        )}
        {isOwner && onlyOwner && (
          <p className="px-5 pb-4 text-sm text-[var(--color-text-tertiary)]">
            It&apos;s just you so far. Invite your first teammate above.
          </p>
        )}
      </div>
    );
  };

  const renderGroup = (heading, rows) =>
    rows.length === 0 ? null : (
      <div key={heading}>
        <h4 className="px-5 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          {heading}
        </h4>
        <div className="divide-y divide-[var(--gray-200)]">{rows.map(renderRow)}</div>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team and roles"
        actions={<Badge variant="outline">{`${withAccess.length} with access`}</Badge>}
      />

      {/* Invite */}
      <SectionCard
        title="Invite someone"
        subtitle="They get an email with a one-time link that expires in 7 days, and choose their own password."
      >
        <form onSubmit={handleInvite} className="flex flex-col gap-3 md:flex-row md:items-start">
          <div className="flex-1 min-w-0">
            <Input
              label="Email address"
              type="email"
              placeholder="teammate@company.com"
              value={inviteEmail}
              disabled={inviting}
              onChange={(e) => {
                setInviteEmail(e.target.value);
                setFormInUse("");
              }}
            />
            <div className="mt-1 min-h-[18px] text-xs text-[var(--color-text-tertiary)]" aria-live="polite">
              {typedMatch && typedHasAccess && (
                <span>
                  {`${typedEmail} already has access as ${ROLE_LABELS[typedMatch.role] || typedMatch.role}.`}{" "}
                  <Button type="button" variant="link" size="sm" onClick={() => showPerson(typedEmail)}>
                    Show them
                  </Button>
                </span>
              )}
              {typedMatch && !typedHasAccess && (
                <span>
                  {`${typedEmail} had access before. Sending this invite gives it back as ${
                    inviteRole ? ROLE_LABELS[inviteRole] : "the role you choose"
                  }.`}
                </span>
              )}
            </div>
          </div>
          <div className="md:w-[320px]">
            <label
              htmlFor="team-invite-role"
              className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5"
            >
              Role
            </label>
            <select
              id="team-invite-role"
              className={`w-full ${SELECT_CLASS}`}
              value={inviteRole}
              disabled={inviting}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              <option value="">Choose a role</option>
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_OPTION_TEXT[r]}</option>
              ))}
            </select>
          </div>
          <div className="md:pt-[26px]">
            <Button type="submit" variant="primary" icon={UserPlus} loading={inviting} disabled={!canSend}>
              Send invite
            </Button>
          </div>
        </form>
        {formInUse && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]"
          >
            {addressInUseLine(formInUse)}
          </p>
        )}
      </SectionCard>

      {/* People */}
      <SectionCard
        title="People"
        subtitle="Names show in every picker, in agent messages and in the agent log. Without one, Mingla uses the first part of the email."
        noPadding
      >
        {profilesError && (
          <div className="px-5 pt-4">
            <AlertCard variant="warning" title="Names couldn’t load">{profilesError}</AlertCard>
          </div>
        )}
        {loading ? (
          <div className="p-5">
            {Array.from({ length: 3 }).map((_, i) => <ListItemSkeleton key={i} />)}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 px-5 gap-3 text-center" role="alert">
            <AlertCircle className="w-10 h-10 text-[#ef4444]" aria-hidden="true" />
            <p className="text-sm text-[var(--color-text-primary)] font-medium">Couldn&apos;t load the team</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {[error.title, error.description].filter(Boolean).join(" ")}
            </p>
            <Button variant="secondary" onClick={() => load()}>Try again</Button>
          </div>
        ) : (
          <div className="pb-2">
            {agentOverview.error ? (
              <div className="px-5 pt-4">
                <AlertCard
                  variant="warning"
                  title="Agent status unavailable"
                  action={<Button type="button" variant="secondary" size="sm" highContrastFocus disabled={!online} onClick={agentOverview.retry} className="min-h-11 max-sm:h-11">Try again</Button>}
                >
                  Team access controls still work.
                </AlertCard>
              </div>
            ) : null}
            {renderGroup("Has access", withAccess)}
            {renderGroup(
              needNewLink > 0
                ? `Invited · ${needNewLink} ${needNewLink === 1 ? "needs" : "need"} a new link`
                : "Invited",
              invited
            )}
            {renderGroup("Removed", removed)}
          </div>
        )}
      </SectionCard>

      {/* Activity Modal */}
      <Modal
        open={!!activityTarget}
        onClose={closeActivity}
        title={activityTarget ? `Activity: ${activityTarget.email}` : "Activity"}
        size="lg"
      >
        <ModalBody>
          {activityLoading ? (
            <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-[var(--color-brand-500)] border-t-transparent rounded-full animate-spin" /></div>
          ) : activityError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-[var(--color-text-primary)]">Couldn&apos;t load their activity.</p>
              <Button variant="secondary" size="sm" onClick={() => openActivity(activityTarget)}>Try again</Button>
            </div>
          ) : activityLogs.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)] text-center py-8">No activity recorded.</p>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {activityLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--color-background-secondary)]">
                  <Clock className="h-4 w-4 text-[var(--color-text-tertiary)] mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--color-text-primary)]">{log.action}</p>
                    {log.target_type && (
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        {log.target_type}{log.target_id ? `: ${log.target_id}` : ""}
                      </p>
                    )}
                    {log.metadata && Object.keys(log.metadata).length > 0 && (
                      <p className="text-xs text-[var(--color-text-tertiary)] font-mono mt-0.5">
                        {JSON.stringify(log.metadata)}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)] shrink-0 whitespace-nowrap">
                    {formatRelativeTime(log.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={closeActivity}>Close</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
