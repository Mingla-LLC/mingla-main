import { useCallback, useEffect, useState } from "react";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Toggle } from "../components/ui/Input";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";
import * as collaboration from "../services/teamCollaborationService";

export function NotificationsPage() {
  const [state, setState] = useState({ loading: true, error: false, mentions: [], unread: 0, email: false });
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }));
    try {
      const [mentions, preferences] = await Promise.all([
        collaboration.listTeamMentions(),
        collaboration.getTeamNotificationPreferences(),
      ]);
      setState({
        loading: false,
        error: false,
        mentions: Array.isArray(mentions?.mentions) ? mentions.mentions : [],
        unread: Number(mentions?.unread) || 0,
        email: preferences?.mention_email === true,
      });
    } catch {
      setState((current) => ({ ...current, loading: false, error: true }));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const changeEmail = async (enabled) => {
    setSaving(true);
    try {
      const preferences = await collaboration.setMentionEmail(enabled);
      setState((current) => ({ ...current, email: preferences?.mention_email === true }));
    } finally { setSaving(false); }
  };
  const openMention = async (mention) => {
    if (!mention.read_at) {
      const marked = await collaboration.markMentionRead(mention.id).catch(() => false);
      if (marked) setState((current) => ({ ...current, unread: Math.max(0, current.unread - 1), mentions: current.mentions.map((row) => row.id === mention.id ? { ...row, read_at: new Date().toISOString() } : row) }));
    }
    window.location.href = mention.deep_link;
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="Notifications" description="Mentions from your Mingla teammates." />
      {state.error && <AlertCard variant="error" title="Couldn’t load notifications" action={<Button variant="secondary" onClick={load}>Try again</Button>}>No preferences were changed.</AlertCard>}
      <SectionCard title="Email" subtitle="In-app mentions are always on.">
        <Toggle label="Email me when a teammate mentions me" checked={state.email} disabled={state.loading || saving} onChange={changeEmail} />
        <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">Email is off until you opt in here.</p>
      </SectionCard>
      <SectionCard title="Mentions" action={<Badge variant={state.unread ? "brand" : "outline"}>{state.unread} unread</Badge>} noPadding>
        {state.loading ? <p role="status" className="p-5 text-sm text-[var(--color-text-secondary)]">Loading mentions…</p> : state.mentions.length === 0 ? <p className="p-5 text-sm text-[var(--color-text-secondary)]">No mentions yet.</p> : <ul className="divide-y divide-[var(--gray-200)]">{state.mentions.map((mention) => <li key={mention.id}><button type="button" onClick={() => openMention(mention)} className="min-h-11 w-full px-4 py-3 text-left hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-700)] sm:px-5"><span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">{mention.actor_name || "A teammate"}{!mention.read_at && <Badge variant="brand">New</Badge>}</span><span className="mt-1 block text-sm text-[var(--color-text-secondary)]">{mention.body_excerpt}</span><span className="mt-1 block text-xs text-[var(--color-text-tertiary)]">{new Date(mention.created_at).toLocaleString()}</span></button></li>)}</ul>}
      </SectionCard>
    </div>
  );
}
