import { useCallback, useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { AlertCard, SectionCard } from "../ui/Card";
import { Spinner } from "../ui/Spinner";
import {
  listCommunityModerationQueue,
  moderateCommunityItem,
} from "../../services/communityService";

function actionsFor(item) {
  if (item.queue_type === "post_review") return [["Approve", "approve"], ["Reject", "reject"]];
  if (item.queue_type === "report") return [["Remove content", "remove"], ["Dismiss report", "dismiss"]];
  return [["Restore content", "restore"], ["Uphold decision", "uphold"]];
}

export function ModerationPanel() {
  const [state, setState] = useState({ loading: true, error: false, rows: [] });
  const [saving, setSaving] = useState("");
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }));
    try {
      setState({ loading: false, error: false, rows: await listCommunityModerationQueue() });
    } catch {
      setState({ loading: false, error: true, rows: [] });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const decide = async (item, action) => {
    setSaving(`${item.queue_type}:${item.record_id}`);
    try {
      await moderateCommunityItem({ queueType: item.queue_type, recordId: item.record_id, action });
      await load();
    } finally { setSaving(""); }
  };
  if (state.loading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (state.error) return <AlertCard variant="error" title="Couldn’t load moderation" action={<Button variant="secondary" onClick={load}>Try again</Button>}>No decision was changed.</AlertCard>;
  return (
    <SectionCard title="Community moderation" subtitle="First-three-post review, member reports and appeals share one audited queue.">
      {state.rows.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">The queue is clear.</p> : <ul className="space-y-3">{state.rows.map((item) => <li key={`${item.queue_type}:${item.record_id}`} className="rounded-xl border border-[var(--gray-200)] p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><Badge variant="outline">{item.queue_type.replaceAll("_", " ")}</Badge>{item.title && <h3 className="mt-2 text-sm font-semibold text-[var(--color-text-primary)]">{item.title}</h3>}<p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{item.body || item.reason || "Review the linked content."}</p></div><div className="flex flex-wrap gap-2">{actionsFor(item).map(([label, action]) => <Button key={action} size="sm" variant={action === "approve" || action === "restore" ? "primary" : "secondary"} loading={saving === `${item.queue_type}:${item.record_id}`} disabled={!!saving} onClick={() => void decide(item, action)}>{label}</Button>)}</div></div></li>)}</ul>}
    </SectionCard>
  );
}
