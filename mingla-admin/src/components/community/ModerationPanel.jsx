import { useCallback, useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { AlertCard, SectionCard } from "../ui/Card";
import { Input } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";
import { listModerationWorkspace, runModerationAction } from "../../services/communityService";

const SECTIONS = [
  ["reports", "Reports"], ["first_posts", "First posts"], ["appeals", "Appeals"],
  ["hidden", "Hidden"], ["paused_hosts", "Paused hosts"], ["audit_log", "Audit log"],
];

function deadline(value) {
  if (!value) return null;
  const hours = Math.ceil((new Date(value).getTime() - Date.now()) / 3_600_000);
  if (hours <= 0) return { label: `${Math.abs(hours)}h overdue`, variant: "error" };
  if (hours < 2) return { label: `Due in ${hours}h`, variant: "error" };
  if (hours < 8) return { label: `Due in ${hours}h`, variant: "warning" };
  return { label: `Due in ${hours}h`, variant: "success" };
}

function actionsFor(section) {
  if (section === "reports") return [["Keep", "keep"], ["Hide", "hide"], ["Remove", "remove"], ["Pause posting", "pause"]];
  if (section === "first_posts") return [["Approve", "approve"], ["Reject", "reject"]];
  if (section === "appeals") return [["Restore", "restore"], ["Uphold", "uphold"]];
  if (section === "hidden" || section === "paused_hosts") return [["Restore", "restore"]];
  return [];
}

export function ModerationPanel() {
  const [section, setSection] = useState("reports");
  const [state, setState] = useState({ loading: true, error: false, rows: [] });
  const [saving, setSaving] = useState("");
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState("");
  const [pauseLength, setPauseLength] = useState("pause_7");
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }));
    try { setState({ loading: false, error: false, rows: await listModerationWorkspace(section) }); }
    catch { setState({ loading: false, error: true, rows: [] }); }
  }, [section]);
  useEffect(() => { void load(); }, [load]);

  async function decide() {
    if (!decision) return;
    const action = decision.action === "pause" ? pauseLength : decision.action;
    if ((decision.action === "pause" || decision.action === "reject") && !reason.trim()) return;
    const key = `${decision.item.queue_type}:${decision.item.record_id}`;
    setSaving(key);
    try {
      await runModerationAction({ queueType: decision.item.queue_type, recordId: decision.item.record_id, action, reason });
      setDecision(null); setReason(""); await load();
    } finally { setSaving(""); }
  }

  if (state.error) return <AlertCard variant="error" title="Couldn’t load moderation" action={<Button variant="secondary" onClick={load}>Try again</Button>}>No decision was changed.</AlertCard>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{SECTIONS.map(([id, label]) => <Button key={id} size="sm" variant={section === id ? "primary" : "secondary"} onClick={() => setSection(id)}>{label}</Button>)}</div>
      <SectionCard title={SECTIONS.find(([id]) => id === section)?.[1]} subtitle={section === "reports" ? "First-three-post review, reports and appeals are audited. Reports are answered within 24 hours." : undefined}>
        {state.loading ? <div className="flex justify-center py-12"><Spinner /></div> : state.rows.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">Nothing waiting. Reports are answered within 24 hours.</p> : (
          <ul className="space-y-3">{state.rows.map((item) => {
            const due = deadline(item.due_at);
            return <li key={`${item.queue_type}:${item.record_id}`} className="rounded-xl border border-[var(--gray-200)] p-4"><div className="flex flex-wrap items-start gap-3">
              {due ? <Badge variant={due.variant}>{due.label}</Badge> : null}
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{item.queue_type.replaceAll("_", " ")}</Badge>{item.author_label ? <span className="text-xs text-[var(--color-text-tertiary)]">{item.author_label}</span> : null}</div>{item.title ? <h3 className="mt-2 text-sm font-semibold text-[var(--color-text-primary)]">{item.title}</h3> : null}<p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{item.body || item.reason || "Review the linked content."}</p>{item.reason && item.body ? <p className="mt-1 text-xs text-[var(--color-warning-700)]">Report: {item.reason}</p> : null}{item.filter_match ? <p className="mt-1 text-xs font-medium text-[var(--color-warning-700)]">Word filter: {item.filter_match}</p> : null}</div>
              <div className="flex flex-wrap gap-2">{actionsFor(section).map(([label, action]) => <Button key={action} size="sm" variant={action === "approve" || action === "restore" || action === "keep" ? "primary" : "secondary"} disabled={Boolean(saving)} onClick={() => { setDecision({ item, action, label }); setReason(""); }}>{label}</Button>)}</div>
            </div></li>;
          })}</ul>
        )}
      </SectionCard>
      <p className="text-xs text-[var(--color-text-tertiary)]">Word filter checks phone numbers, email addresses and bank-detail phrases. Matches stay held for a person to review.</p>
      <Modal open={Boolean(decision)} onClose={() => setDecision(null)} title={decision?.label || "Moderation decision"} size="sm"><ModalBody className="space-y-3">{decision?.action === "pause" ? <label className="block text-sm font-medium">Pause length<select value={pauseLength} onChange={(event) => setPauseLength(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3"><option value="pause_7">7 days</option><option value="pause_30">30 days</option><option value="pause_permanent">Permanent</option></select></label> : null}<Input label={decision?.action === "pause" ? "Reason shown to the Host" : "Reason (required for rejection)"} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the decision clearly" /></ModalBody><ModalFooter><Button variant="secondary" onClick={() => setDecision(null)}>Cancel</Button><Button loading={Boolean(saving)} disabled={(decision?.action === "pause" || decision?.action === "reject") && !reason.trim()} onClick={() => void decide()}>Confirm</Button></ModalFooter></Modal>
    </div>
  );
}
