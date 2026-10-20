import { useCallback, useEffect, useState } from "react";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Toggle } from "../components/ui/Input";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";
import { useToast } from "../context/ToastContext";
import * as collaboration from "../services/teamCollaborationService";
import { alertHashRoute, emailAlertRows, SUPPORT_ALERT_TYPES } from "../lib/emailAlerts";

// #3988 — "Email alerts": one switch per alert type, the teammate's in-app
// support and product alerts, and their mentions.
const EMPTY = { loading: true, error: false, rows: [], alerts: [], mentions: [], unread: 0 };

export function NotificationsPage() {
  const { addToast } = useToast();
  const [state, setState] = useState(EMPTY);
  const [savingKey, setSavingKey] = useState(null);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }));
    const [preferences, alerts, mentions] = await Promise.allSettled([
      collaboration.getEmailAlertPreferences(),
      collaboration.listSupportAlerts(SUPPORT_ALERT_TYPES),
      collaboration.listTeamMentions(),
    ]);
    setState((current) => ({
      loading: false,
      error: [preferences, alerts, mentions].some((result) => result.status === "rejected"),
      rows: preferences.status === "fulfilled" ? emailAlertRows(preferences.value) : current.rows,
      alerts: alerts.status === "fulfilled" && Array.isArray(alerts.value) ? alerts.value : current.alerts,
      mentions: mentions.status === "fulfilled" && Array.isArray(mentions.value?.mentions) ? mentions.value.mentions : current.mentions,
      unread: mentions.status === "fulfilled" ? Number(mentions.value?.unread) || 0 : current.unread,
    }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const changeEmail = async (row, enabled) => {
    setSavingKey(row.key);
    try {
      const saved = await collaboration.setEmailAlertPreference(row.key, enabled);
      setState((current) => ({ ...current, rows: emailAlertRows(saved) }));
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

  const openAlert = async (alert, route) => {
    if (!alert.read_at) {
      const marked = await collaboration.markSupportAlertRead(alert.id).catch(() => false);
      if (marked) {
        setState((current) => ({
          ...current,
          alerts: current.alerts.map((row) => (row.id === alert.id ? { ...row, read_at: new Date().toISOString() } : row)),
        }));
      }
    }
    window.location.hash = route;
  };

  const openMention = async (mention) => {
    if (!mention.read_at) {
      const marked = await collaboration.markMentionRead(mention.id).catch(() => false);
      if (marked) setState((current) => ({ ...current, unread: Math.max(0, current.unread - 1), mentions: current.mentions.map((row) => row.id === mention.id ? { ...row, read_at: new Date().toISOString() } : row) }));
    }
    window.location.href = mention.deep_link;
  };

  const unreadAlerts = state.alerts.filter((alert) => !alert.read_at).length;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="Notifications" description="Email alerts, support alerts and mentions from your Mingla teammates." />
      {state.error && <AlertCard variant="error" title="Couldn’t load everything" action={<Button variant="secondary" onClick={load}>Try again</Button>}>No settings were changed.</AlertCard>}

      <SectionCard title="Email alerts" subtitle="Choose which alerts also reach your inbox. In-app alerts are always on.">
        {state.loading && state.rows.length === 0 ? (
          <p role="status" className="text-sm text-[var(--color-text-secondary)]">Loading email alerts…</p>
        ) : state.rows.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">Email alerts aren’t available right now.</p>
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
        <p className="mt-4 text-xs text-[var(--color-text-tertiary)]">Every alert starts on except Mentions. Email is off until you opt in here.</p>
      </SectionCard>

      <SectionCard title="Support alerts" action={<Badge variant={unreadAlerts ? "brand" : "outline"}>{unreadAlerts} unread</Badge>} noPadding>
        {state.loading && state.alerts.length === 0 ? (
          <p role="status" className="p-5 text-sm text-[var(--color-text-secondary)]">Loading support alerts…</p>
        ) : state.alerts.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-text-secondary)]">No support alerts yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--gray-200)]">
            {state.alerts.map((alert) => {
              const route = alertHashRoute(alert);
              const content = (
                <>
                  <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">{alert.title}{!alert.read_at && <Badge variant="brand">New</Badge>}</span>
                  {alert.body && <span className="mt-1 block text-sm text-[var(--color-text-secondary)]">{alert.body}</span>}
                  <span className="mt-1 block text-xs text-[var(--color-text-tertiary)]">{new Date(alert.created_at).toLocaleString()}</span>
                </>
              );
              return (
                <li key={alert.id}>
                  {route ? (
                    <button type="button" onClick={() => openAlert(alert, route)} className="min-h-11 w-full px-4 py-3 text-left hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-700)] sm:px-5">{content}</button>
                  ) : (
                    <div className="px-4 py-3 sm:px-5">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Mentions" action={<Badge variant={state.unread ? "brand" : "outline"}>{state.unread} unread</Badge>} noPadding>
        {state.loading && state.mentions.length === 0 ? <p role="status" className="p-5 text-sm text-[var(--color-text-secondary)]">Loading mentions…</p> : state.mentions.length === 0 ? <p className="p-5 text-sm text-[var(--color-text-secondary)]">No mentions yet.</p> : <ul className="divide-y divide-[var(--gray-200)]">{state.mentions.map((mention) => <li key={mention.id}><button type="button" onClick={() => openMention(mention)} className="min-h-11 w-full px-4 py-3 text-left hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-700)] sm:px-5"><span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">{mention.actor_name || "A teammate"}{!mention.read_at && <Badge variant="brand">New</Badge>}</span><span className="mt-1 block text-sm text-[var(--color-text-secondary)]">{mention.body_excerpt}</span><span className="mt-1 block text-xs text-[var(--color-text-tertiary)]">{new Date(mention.created_at).toLocaleString()}</span></button></li>)}</ul>}
      </SectionCard>
    </div>
  );
}
