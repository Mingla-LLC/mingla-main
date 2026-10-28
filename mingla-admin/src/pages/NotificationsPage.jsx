// Issue #4130 (Wave 4a) — Notifications: one inbox first, settings behind the
// gear.
//
//   - Tabs All / Mentions / Support / System. A real mention (a note or
//     comment that names you) shows who wrote it; Work card changes are one
//     grouped row that opens Work (team_inbox, lib/notificationsInbox.js).
//   - A support alert whose ticket is resolved is never "New".
//   - Mark all read marks the open tab, on the server, for this person only.
//   - System lists the platform problems the Dashboard lists (owner/admin).
//   - Email alerts: one switch per alert type (#3988), in a panel behind the
//     gear.
// A failed load is an error with Retry, never an empty inbox.
import { useCallback, useMemo, useState } from "react";
import { CheckCheck, Settings } from "lucide-react";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Toggle } from "../components/ui/Input";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Tabs } from "../components/ui/Tabs";
import { Drawer } from "../components/ui/Drawer";
import { LoadError } from "../components/ui/LoadError";
import { Skeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { canOpenPage } from "../lib/access";
import * as collaboration from "../services/teamCollaborationService";
import { getInbox, markInboxRead } from "../services/dashboardService";
import { getApiHealth } from "../services/apiHealthService";
import { getQueueHealth } from "../services/queueHealthService";
import { alertHashRoute, emailAlertRows, SUPPORT_ALERT_TYPES } from "../lib/emailAlerts";
import { INBOX_TABS, inAppRoute, inboxRows, markScope, tabCounts } from "../lib/notificationsInbox";
import { healthProblems, queueHealthItem } from "../lib/dashboardToday";
import { timeAgo } from "../lib/formatters";
import { useServerRead } from "../hooks/useServerRead";

const TONE_BADGE = { mention: "brand", work_group: "default", support: "info", system: "error" };

function goToHash(hash) {
  window.location.hash = hash;
}
function goToUrl(url) {
  window.location.href = url;
}

function EmailSettings({ open, onClose }) {
  const { addToast } = useToast();
  const [savingKey, setSavingKey] = useState(null);
  const [saved, setSaved] = useState(null);
  const loadPreferences = useCallback(() => collaboration.getEmailAlertPreferences(), []);
  const read = useServerRead(loadPreferences);
  const state = {
    loading: read.status === "loading" || read.status === "refreshing",
    error: read.status === "error" ? read.error : null,
    rows: saved ?? emailAlertRows(read.data),
  };
  const load = () => { setSaved(null); read.retry(); };

  const changeEmail = async (row, enabled) => {
    setSavingKey(row.key);
    try {
      const next = await collaboration.setEmailAlertPreference(row.key, enabled);
      setSaved(emailAlertRows(next));
    } catch (err) {
      addToast({
        variant: "error",
        title: `Couldn’t change “${row.label}”`,
        description: err?.message || "Nothing was changed. Try again.",
      });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title="Email alerts">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--color-text-secondary)]">Choose which alerts also reach your inbox. Alerts always show here in the app.</p>
        {state.error ? (
          <LoadError title="Couldn’t load your email alerts" message={state.error?.message} onRetry={load} retrying={state.loading} />
        ) : state.loading && state.rows.length === 0 ? (
          <p role="status" className="text-sm text-[var(--color-text-secondary)]">Loading email alerts…</p>
        ) : state.rows.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">There are no email alerts for your role.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {state.rows.map((row) => (
              <li key={row.key} data-alert-key={row.key} className="flex flex-col gap-1">
                <Toggle
                  label={row.label}
                  checked={row.enabled}
                  disabled={state.loading || savingKey !== null}
                  onChange={(enabled) => changeEmail(row, enabled)}
                />
                <p className="pl-14 text-xs text-[var(--color-text-tertiary)]">{row.description}</p>
              </li>
            ))}
          </ul>
        )}
        {/* #4130: the old line said every alert "starts on" and that email is
            off until you opt in, which contradicted itself. */}
        <p className="text-xs text-[var(--color-text-tertiary)]">Every alert except Mentions emails you unless you switch it off. Mentions email you only after you switch them on here.</p>
      </div>
    </Drawer>
  );
}

export function NotificationsPage() {
  const { access } = useAuth();
  const { addToast } = useToast();
  const seesSystem = canOpenPage(access, "platform-health");
  const [tab, setTab] = useState("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [openGroup, setOpenGroup] = useState(false);

  const loadInbox = useCallback(() => getInbox(SUPPORT_ALERT_TYPES), []);
  const inbox = useServerRead(loadInbox);
  const reloadInbox = inbox.retry;

  // System: the platform problems the Dashboard lists, for whoever may open
  // Platform health. A failed check is listed as failed, never as "all fine".
  const loadSystem = useCallback(async () => {
    if (!seesSystem) return [];
    const [health, queue] = await Promise.allSettled([getApiHealth(), getQueueHealth()]);
    const items = [];
    if (health.status === "fulfilled") items.push(...healthProblems(health.value?.services ?? health.value));
    else items.push({ id: "health-failed", title: "Couldn’t check platform health", detail: "Try again from Platform health.", href: "#/platform-health", tone: "error" });
    const q = queueHealthItem(queue.status === "rejected" ? { status: "error", error: queue.reason } : { status: "ready" });
    if (q) items.push(q);
    return items;
  }, [seesSystem]);
  const systemRead = useServerRead(loadSystem);
  const system = { status: systemRead.status, items: Array.isArray(systemRead.data) ? systemRead.data : [] };

  const counts = useMemo(() => tabCounts(inbox.data, system.items), [inbox.data, system.items]);
  const rows = useMemo(() => inboxRows(inbox.data, tab, system.items), [inbox.data, tab, system.items]);
  const tabs = INBOX_TABS
    .filter((t) => t.id !== "system" || seesSystem)
    .map((t) => ({ id: t.id, label: counts[t.id] ? `${t.label} · ${counts[t.id]}` : t.label }));

  const markAll = async () => {
    setMarking(true);
    try {
      await markInboxRead(markScope(tab), SUPPORT_ALERT_TYPES);
      reloadInbox();
      addToast({ variant: "success", title: "Marked as read" });
    } catch (err) {
      addToast({ variant: "error", title: "Couldn’t mark them read", description: err?.message || "Nothing was changed. Try again." });
    } finally {
      setMarking(false);
    }
  };

  const openRow = async (row) => {
    if (row.type === "work_group") {
      setOpenGroup((v) => !v);
      return;
    }
    const route = row.type === "support" ? alertHashRoute(row.source) : inAppRoute(row.link);
    if (row.type === "mention" && !row.source.read_at) {
      await collaboration.markMentionRead(row.source.id).catch(() => false);
    }
    if (row.type === "support" && !row.source.read_at) {
      await collaboration.markSupportAlertRead(row.source.id).catch(() => false);
    }
    if (route) goToHash(route);
    else if (row.link) goToUrl(row.link);
    else reloadInbox();
  };

  const canOpen = (row) =>
    row.type === "work_group" || (row.type === "support" ? !!alertHashRoute(row.source) : !!(inAppRoute(row.link) || row.link));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Your alerts in one inbox. Email settings sit behind the gear."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={CheckCheck} className="min-h-11" loading={marking} disabled={!inbox.data || counts[tab] === 0} onClick={markAll}>
              Mark all read
            </Button>
            <Button variant="secondary" icon={Settings} className="min-h-11" onClick={() => setSettingsOpen(true)}>
              Email settings
            </Button>
          </div>
        }
      />

      <Tabs tabs={tabs} activeTab={tab} onChange={(id) => { setTab(id); setOpenGroup(false); }} />

      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {inbox.status === "error" ? (
          <LoadError title="Couldn’t load your notifications" message={inbox.error?.message} onRetry={reloadInbox} />
        ) : inbox.status === "loading" ? (
          <SectionCard>
            <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading notifications">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={48} />)}
            </div>
          </SectionCard>
        ) : rows.length === 0 ? (
          <SectionCard>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {tab === "mentions"
                ? "No mentions yet. When a teammate names you in a note or comment, it shows here."
                : tab === "support"
                  ? "No support alerts. New tickets and replies show here."
                  : tab === "system"
                    ? system.status === "loading" ? "Checking the platform…" : "Nothing is down. Problems with providers or the queue show here."
                    : "You're all caught up. Mentions, support alerts and Work updates show here."}
            </p>
          </SectionCard>
        ) : (
          <SectionCard noPadding>
            <ul className="divide-y divide-[var(--gray-200)]">
              {rows.map((row) => (
                <li key={row.id} data-inbox-row={row.type}>
                  {canOpen(row) ? (
                    <button
                      type="button"
                      onClick={() => openRow(row)}
                      aria-expanded={row.type === "work_group" ? openGroup : undefined}
                      className="flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-700)] sm:px-5"
                    >
                      <InboxRow row={row} />
                    </button>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3 sm:px-5"><InboxRow row={row} /></div>
                  )}
                  {row.type === "work_group" && openGroup && (
                    <ul className="border-t border-[var(--gray-100)] bg-[var(--gray-50)]">
                      {row.items.slice(0, 50).map((m) => (
                        <li key={m.id} className="px-4 py-2 text-sm sm:px-8">
                          <span className="font-medium text-[var(--color-text-primary)]">{m.actor_name || "A teammate"}</span>
                          <span className="text-[var(--color-text-secondary)]"> · {m.body_excerpt}</span>
                          <span className="ml-2 text-xs text-[var(--color-text-tertiary)]">{timeAgo(m.created_at)}</span>
                        </li>
                      ))}
                      <li className="px-4 py-2 sm:px-8">
                        <a href="#/work-board" className="text-sm font-medium text-[var(--color-brand-700)] hover:underline">Open Work</a>
                      </li>
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>

      {/* Mounted only while open, so the settings are read when they are looked at. */}
      {settingsOpen && <EmailSettings open onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function InboxRow({ row }) {
  return (
    <>
      <span className="mt-0.5 shrink-0">
        <Badge variant={row.tone === "warn" ? "warning" : TONE_BADGE[row.type] || "default"}>{row.label}</Badge>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
          {row.title}
          {row.isNew && row.type !== "system" && <Badge variant="brand">New</Badge>}
        </span>
        {row.detail && <span className="mt-0.5 block text-sm text-[var(--color-text-secondary)]">{row.detail}</span>}
        {row.at && <span className="mt-0.5 block text-xs text-[var(--color-text-tertiary)]">{timeAgo(row.at)}</span>}
      </span>
    </>
  );
}
