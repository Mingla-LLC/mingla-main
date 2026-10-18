import { useCallback, useEffect, useState } from "react";
import { AlertCard, SectionCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import {
  getCommunityCutoverStatus,
  recordCommunityCutoverEvidence,
} from "../../services/communityService";

const LABELS = {
  delivery_proof: "Controlled notification delivery",
  release_records: "Release records complete",
  clickup_export: "ClickUp export captured",
  clickup_reconciliation: "ClickUp reconciled to Avengers",
  clickup_archival: "Remaining ClickUp workflow archived",
  native_live_proof: "Approved native release live proof",
  board_progress: "Initiative and board progress refreshed",
  agent_seats: "Paid agent seats provisioned last",
};

export function CutoverPanel() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState("");
  const [references, setReferences] = useState({});
  const load = useCallback(async () => {
    setError(false);
    try { setStatus(await getCommunityCutoverStatus()); } catch { setError(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const verify = async (key) => {
    const evidenceRef = String(references[key] || "").trim();
    if (!evidenceRef) return;
    setSaving(key);
    try {
      await recordCommunityCutoverEvidence({ key, state: "verified", evidenceRef });
      await load();
    } finally { setSaving(""); }
  };
  if (!status && !error) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (error) return <AlertCard variant="error" title="Couldn’t load cutover proof" action={<Button variant="secondary" onClick={load}>Try again</Button>}>No evidence was changed.</AlertCard>;
  return (
    <div className="space-y-6">
      <AlertCard variant={status.ready ? "success" : "info"} title={status.ready ? "Cutover gates are complete" : "Cutover remains gated"}>Pending posts: {status.pending_posts}; reports: {status.open_reports}; appeals: {status.open_appeals}; evidence items: {status.pending_evidence}. Agent seats remain last.</AlertCard>
      <SectionCard title="Completion evidence" subtitle="Record only durable issue, release, deployment or live-proof references.">
        <ul className="space-y-4">{(status.evidence || []).map((item) => <li key={item.key} className="rounded-xl border border-[var(--gray-200)] p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-[var(--color-text-primary)]">{LABELS[item.key] || item.key}</p>{item.evidence_ref && <p className="mt-1 break-all text-xs text-[var(--color-text-tertiary)]">{item.evidence_ref}</p>}</div><Badge variant={item.state === "verified" ? "success" : "outline"}>{item.state}</Badge></div>{item.state === "pending" && <div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input label="Evidence reference" value={references[item.key] || ""} placeholder="Issue comment, run, deployment or release URL" onChange={(event) => setReferences((current) => ({ ...current, [item.key]: event.target.value }))} /><Button size="sm" loading={saving === item.key} disabled={!!saving || !String(references[item.key] || "").trim()} onClick={() => void verify(item.key)}>Verify</Button></div>}</li>)}</ul>
      </SectionCard>
    </div>
  );
}
