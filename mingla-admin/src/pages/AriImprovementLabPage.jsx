import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  FlaskConical,
  Gauge,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Wrench,
} from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { AlertCard, SectionCard, StatCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Drawer } from "../components/ui/Drawer";
import { LoadError } from "../components/ui/LoadError";
import {
  cancelAriEvaluation,
  controlAriRollout,
  createAriRuntimeVersion,
  createAriImprovementProposal,
  finishAriEvaluation,
  loadAriImprovementWorkspace,
  loadAriQualityCase,
  startAriEvaluation,
  transitionAriImprovementProposal,
  updateAriQualityCase,
} from "../services/ariImprovementService";

const TABS = [
  ["overview", "Overview"],
  ["threads", "Message threads"],
  ["cases", "Quality cases"],
  ["proposals", "Improvement proposals"],
  ["evaluations", "Evaluations"],
  ["versions", "Versions & rollout"],
  ["audit", "Audit trail"],
];

const STATUS_VARIANT = {
  new: "warning",
  triaged: "info",
  investigating: "info",
  proposal_ready: "brand",
  evaluating: "brand",
  shipped: "success",
  dismissed: "default",
  passed: "success",
  failed: "error",
  running: "info",
  queued: "warning",
  draft: "default",
  approved_for_eval: "info",
  approved_for_rollout: "success",
  rejected: "error",
  rolled_back: "warning",
};

function words(value) {
  return String(value || "—").replaceAll("_", " ");
}

function number(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function when(value) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Empty({ icon = Sparkles, title, body }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center px-5 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--gray-100)]">
        {createElement(icon, { className: "h-4 w-4 text-[var(--color-text-secondary)]" })}
      </div>
      <p className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</p>
      <p className="mt-1 max-w-md text-[13px] leading-5 text-[var(--color-text-secondary)]">{body}</p>
    </div>
  );
}

function SignalList({ values = [] }) {
  if (!values.length) return <span className="text-[var(--color-text-tertiary)]">No automatic signal</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => <Badge key={value} variant="outline">{words(value)}</Badge>)}
    </div>
  );
}

function CaseRows({ cases, onOpen }) {
  if (!cases.length) {
    return <Empty icon={CheckCircle2} title="No cases in this view" body="Ari’s quality detector has not found anything matching these filters." />;
  }
  return (
    <div className="divide-y divide-[var(--gray-200)]">
      {cases.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpen(item)}
          className="grid w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-[var(--gray-50)] sm:grid-cols-[minmax(0,1fr)_120px_110px_150px] sm:items-center sm:px-5"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{item.title}</p>
              <Badge variant={item.severity === "critical" || item.severity === "high" ? "error" : item.severity === "medium" ? "warning" : "default"}>{item.severity}</Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-[var(--color-text-secondary)]">{item.redacted_summary || "No summary yet."}</p>
            <div className="mt-2"><SignalList values={item.signal_codes} /></div>
          </div>
          <Badge variant={STATUS_VARIANT[item.status] || "default"}>{words(item.status)}</Badge>
          <span className="text-xs text-[var(--color-text-secondary)]">{words(item.root_cause || "untriaged")}</span>
          <span className="text-xs text-[var(--color-text-tertiary)] sm:text-right">{when(item.detected_at)}</span>
        </button>
      ))}
    </div>
  );
}

function MessageThreads({ turns = [] }) {
  const threads = useMemo(() => {
    const grouped = new Map();
    for (const turn of turns) {
      const key = turn.thread_key || "unlinked";
      const current = grouped.get(key) || [];
      current.push(turn);
      grouped.set(key, current);
    }
    return [...grouped.entries()].map(([key, values]) => [
      key,
      values.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    ]);
  }, [turns]);

  if (!threads.length) {
    return <Empty icon={Activity} title="No captured threads yet" body="Sanitized Ari turns will appear here as local conversations happen." />;
  }

  return (
    <div className="space-y-4">
      {threads.map(([key, values]) => {
        const last = values[values.length - 1];
        const sourceDeleted = values.every((turn) => !!turn.source_deleted_at);
        return (
          <SectionCard
            key={key}
            title={`Thread ${key}`}
            subtitle={`${values.length} captured ${values.length === 1 ? "turn" : "turns"} · last activity ${when(last.created_at)}`}
            action={<Badge variant={sourceDeleted ? "default" : "success"}>{sourceDeleted ? "Source deleted" : "Source active"}</Badge>}
          >
            <div className="space-y-4">
              {values.map((turn) => (
                <div key={turn.id} className="space-y-2 border-b border-[var(--gray-200)] pb-4 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
                    <span>{when(turn.created_at)}</span>
                    {turn.model_version && <Badge variant="outline">{turn.model_version}</Badge>}
                    {(turn.signal_codes || []).map((signal) => <Badge key={signal} variant="warning">{words(signal)}</Badge>)}
                  </div>
                  <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-md bg-[var(--color-brand-500)] px-4 py-3 text-sm leading-5 text-white">
                    {turn.user_text || "[empty user turn]"}
                  </div>
                  <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-[var(--gray-100)] px-4 py-3 text-sm leading-5 text-[var(--color-text-primary)]">
                    {turn.assistant_text || "[empty Ari reply]"}
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-[var(--color-text-tertiary)]">
                    {turn.latency_ms != null && <span>{number(turn.latency_ms)} ms</span>}
                    {(turn.capability_ids || []).length > 0 && <span>{turn.capability_ids.length} capabilities</span>}
                    {turn.estimated_cost_micros != null && <span>${(Number(turn.estimated_cost_micros) / 1_000_000).toFixed(4)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        );
      })}
    </div>
  );
}

function ProposalComposer({ cases = [], gaps = [], onSaved }) {
  const evidence = [
    ...cases.map((item) => ({ value: `case:${item.id}`, label: `Case · ${item.title}` })),
    ...gaps.map((item) => ({ value: `gap:${item.id}`, label: `Gap · ${item.title}` })),
  ];
  const [form, setForm] = useState({
    evidence: evidence[0]?.value || "",
    proposal_type: "tool",
    risk_level: "medium",
    title: "",
    hypothesis: "",
    expected_outcome: "",
    change_spec: "",
    evaluation_gate: "All active scenarios pass; no protected-action regression; latency and cost remain inside the approved budget.",
    reason: "Creating an evidence-backed Ari improvement proposal",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    const selectedEvidence = form.evidence || evidence[0]?.value || "";
    const [evidenceType, evidenceId] = selectedEvidence.split(":");
    setSaving(true);
    setError(null);
    try {
      await createAriImprovementProposal({
        case_id: evidenceType === "case" ? evidenceId : null,
        capability_gap_id: evidenceType === "gap" ? evidenceId : null,
        proposal_type: form.proposal_type,
        risk_level: form.risk_level,
        title: form.title.trim(),
        hypothesis: form.hypothesis.trim(),
        expected_outcome: form.expected_outcome.trim(),
        change_spec: { summary: form.change_spec.trim() },
        evaluation_gate: { contract: form.evaluation_gate.trim() },
      }, form.reason.trim());
      setForm((current) => ({ ...current, title: "", hypothesis: "", expected_outcome: "", change_spec: "" }));
      await onSaved();
    } catch (err) {
      setError(err.message || "Couldn’t create the proposal");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Draft an improvement" subtitle="Every proposal starts from captured evidence">
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="text-xs font-medium text-[var(--color-text-secondary)] lg:col-span-2">Evidence<select value={form.evidence || evidence[0]?.value || ""} onChange={(event) => setForm({ ...form, evidence: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]"><option value="">Choose a case or capability gap</option>{evidence.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Change type<select value={form.proposal_type} onChange={(event) => setForm({ ...form, proposal_type: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]">{["prompt", "policy", "tool", "model", "product", "ui", "knowledge", "reliability"].map((value) => <option key={value} value={value}>{words(value)}</option>)}</select></label>
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Risk<select value={form.risk_level} onChange={(event) => setForm({ ...form, risk_level: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]">{["low", "medium", "high"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="text-xs font-medium text-[var(--color-text-secondary)] lg:col-span-2">Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]" /></label>
        <label className="text-xs font-medium text-[var(--color-text-secondary)] lg:col-span-2">Hypothesis<textarea rows={2} value={form.hypothesis} onChange={(event) => setForm({ ...form, hypothesis: event.target.value })} className="mt-1 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)]" /></label>
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Change specification<textarea rows={3} value={form.change_spec} onChange={(event) => setForm({ ...form, change_spec: event.target.value })} className="mt-1 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)]" /></label>
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Expected user outcome<textarea rows={3} value={form.expected_outcome} onChange={(event) => setForm({ ...form, expected_outcome: event.target.value })} className="mt-1 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)]" /></label>
        <label className="text-xs font-medium text-[var(--color-text-secondary)] lg:col-span-2">Evaluation gate<textarea rows={2} value={form.evaluation_gate} onChange={(event) => setForm({ ...form, evaluation_gate: event.target.value })} className="mt-1 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)]" /></label>
        <label className="text-xs font-medium text-[var(--color-text-secondary)] lg:col-span-2">Audit reason<input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]" /></label>
      </div>
      {error && <AlertCard variant="error" className="mt-4">{error}</AlertCard>}
      <div className="mt-4 flex justify-end"><Button loading={saving} disabled={!form.evidence && !evidence[0]?.value || form.title.trim().length < 3 || form.reason.trim().length < 3} onClick={submit}>Create proposal</Button></div>
    </SectionCard>
  );
}

function ProposalRows({ proposals = [], onSaved }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!proposals.length) return <Empty icon={Target} title="No proposals yet" body="Create the first evidence-backed improvement from a quality case or capability gap." />;

  const transition = async (proposal, status) => {
    setBusy(`${proposal.id}:${status}`);
    setError(null);
    try {
      await transitionAriImprovementProposal(proposal.id, status, `${words(status)} from the Ari Improvement Lab`);
      await onSaved();
    } catch (err) {
      setError(err.message || "Couldn’t update the proposal");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {error && <AlertCard variant="error" className="m-4">{error}</AlertCard>}
      <div className="divide-y divide-[var(--gray-200)]">
        {proposals.map((proposal) => (
          <div key={proposal.id} className="px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-[var(--color-text-primary)]">{proposal.title}</p><Badge variant={STATUS_VARIANT[proposal.status] || "default"}>{words(proposal.status)}</Badge><Badge variant="outline">{words(proposal.proposal_type)}</Badge><Badge variant={proposal.risk_level === "high" ? "error" : proposal.risk_level === "medium" ? "warning" : "default"}>{proposal.risk_level} risk</Badge></div>
                <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">{proposal.hypothesis || "No hypothesis recorded."}</p>
                <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Created {when(proposal.created_at)}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {proposal.status === "draft" && <Button size="sm" loading={busy === `${proposal.id}:approved_for_eval`} onClick={() => transition(proposal, "approved_for_eval")}>Approve for evaluation</Button>}
                {proposal.status === "evaluating" && <Button size="sm" loading={busy === `${proposal.id}:approved_for_rollout`} onClick={() => transition(proposal, "approved_for_rollout")}>Approve for pilot</Button>}
                {["draft", "approved_for_eval", "evaluating"].includes(proposal.status) && <Button size="sm" variant="secondary" loading={busy === `${proposal.id}:rejected`} onClick={() => transition(proposal, "rejected")}>Reject</Button>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function RuntimeVersionComposer({ proposals = [], versions = [], onSaved }) {
  const eligible = proposals.filter((item) => ["approved_for_eval", "evaluating", "approved_for_rollout"].includes(item.status));
  const parent = versions.find((item) => item.status === "active") || versions[0] || null;
  const [form, setForm] = useState({
    proposal_id: eligible[0]?.id || "",
    version_key: `ari-candidate-${new Date().toISOString().slice(0, 10)}`,
    kind: "combined",
    parent_version_id: parent?.id || "",
    config: '{\n  "prompt_version": "local-candidate",\n  "toolset_version": "3355"\n}',
    reason: "Creating a reproducible local Ari runtime candidate",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const config = JSON.parse(form.config);
      const canonicalConfig = JSON.stringify(config);
      await createAriRuntimeVersion({
        proposal_id: form.proposal_id || eligible[0]?.id,
        version_key: form.version_key.trim(),
        kind: form.kind,
        parent_version_id: form.parent_version_id || null,
        config,
        config_digest: await sha256Hex(canonicalConfig),
      }, form.reason.trim());
      setForm((current) => ({ ...current, version_key: `${current.version_key}-next` }));
      await onSaved();
    } catch (err) {
      setError(err.message || "Couldn’t create the runtime candidate");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Create runtime candidate" subtitle="Immutable config plus a verified SHA-256 digest">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Approved proposal<select value={form.proposal_id || eligible[0]?.id || ""} onChange={(event) => setForm({ ...form, proposal_id: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]"><option value="">Choose proposal</option>{eligible.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Kind<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]">{["prompt", "toolset", "policy", "model", "combined"].map((value) => <option key={value} value={value}>{words(value)}</option>)}</select></label>
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Version key<input value={form.version_key} onChange={(event) => setForm({ ...form, version_key: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]" /></label>
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Parent version<select value={form.parent_version_id} onChange={(event) => setForm({ ...form, parent_version_id: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]"><option value="">No parent</option>{versions.map((item) => <option key={item.id} value={item.id}>{item.version_key} · {words(item.status)}</option>)}</select></label>
        <label className="text-xs font-medium text-[var(--color-text-secondary)] sm:col-span-2">Runtime configuration<textarea rows={5} value={form.config} onChange={(event) => setForm({ ...form, config: event.target.value })} spellCheck={false} className="mt-1 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]" /></label>
        <label className="text-xs font-medium text-[var(--color-text-secondary)] sm:col-span-2">Audit reason<input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]" /></label>
      </div>
      {error && <AlertCard variant="error" className="mt-4">{error}</AlertCard>}
      <div className="mt-4 flex justify-end"><Button loading={saving} disabled={!eligible.length || form.version_key.trim().length < 3 || form.reason.trim().length < 3} onClick={submit}>Create candidate</Button></div>
    </SectionCard>
  );
}

function EvaluationControls({ proposals = [], versions = [], runs = [], onSaved }) {
  const eligibleProposals = proposals.filter((item) => ["approved_for_eval", "evaluating"].includes(item.status));
  const candidates = versions.filter((item) => ["candidate", "pilot", "active"].includes(item.status));
  const running = runs.filter((item) => item.status === "running");
  const [form, setForm] = useState({
    mode: "deterministic",
    proposal_id: eligibleProposals[0]?.id || "",
    candidate_version_id: candidates.find((item) => item.status === "candidate")?.id || "",
    reason: "Starting a governed local Ari evaluation",
  });
  const [finishForm, setFinishForm] = useState({
    run_id: running[0]?.id || "",
    results: "[]",
    reason: "Recording the complete local evaluation result set",
  });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const start = async () => {
    setBusy("start");
    setError(null);
    try {
      await startAriEvaluation({
        mode: form.mode,
        proposal_id: form.proposal_id || null,
        candidate_version_id: form.candidate_version_id || null,
      }, form.reason.trim());
      await onSaved();
    } catch (err) {
      setError(err.message || "Couldn’t start the evaluation");
    } finally {
      setBusy(null);
    }
  };

  const finish = async () => {
    setBusy("finish");
    setError(null);
    try {
      const results = JSON.parse(finishForm.results);
      if (!Array.isArray(results) || results.length === 0) throw new Error("Paste a non-empty evaluation result array");
      await finishAriEvaluation(finishForm.run_id || running[0]?.id, results, finishForm.reason.trim());
      setFinishForm((current) => ({ ...current, results: "[]" }));
      await onSaved();
    } catch (err) {
      setError(err.message || "Couldn’t record the evaluation");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (run) => {
    setBusy(`cancel:${run.id}`);
    setError(null);
    try {
      await cancelAriEvaluation(run.id, "Cancelling the incomplete local Ari evaluation");
      await onSaved();
    } catch (err) {
      setError(err.message || "Couldn’t cancel the evaluation");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <SectionCard title="Start evaluation" subtitle="Deterministic, model, local-live and pilot runs stay distinct">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Mode<select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]">{["deterministic", "model", "local_live", "pilot"].map((value) => <option key={value} value={value}>{words(value)}</option>)}</select></label>
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Proposal<select value={form.proposal_id || eligibleProposals[0]?.id || ""} onChange={(event) => setForm({ ...form, proposal_id: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]"><option value="">Unlinked diagnostic run</option>{eligibleProposals.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Candidate<select value={form.candidate_version_id} onChange={(event) => setForm({ ...form, candidate_version_id: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]"><option value="">Current runtime</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.version_key} · {words(item.status)}</option>)}</select></label>
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Audit reason<input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]" /></label>
        </div>
        <div className="mt-4 flex justify-end"><Button loading={busy === "start"} disabled={form.reason.trim().length < 3} onClick={start}>Start evaluation</Button></div>
      </SectionCard>
      <SectionCard title="Import measured results" subtitle="The local runner records scenario traces, scores, latency and cost; no run can pass on an incomplete suite">
        <div className="grid gap-3">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Running evaluation<select value={finishForm.run_id || running[0]?.id || ""} onChange={(event) => setFinishForm({ ...finishForm, run_id: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]"><option value="">Choose run</option>{running.map((item) => <option key={item.id} value={item.id}>{words(item.mode)} · {when(item.started_at || item.created_at)}</option>)}</select></label>
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Result JSON<textarea rows={6} value={finishForm.results} onChange={(event) => setFinishForm({ ...finishForm, results: event.target.value })} spellCheck={false} className="mt-1 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]" /></label>
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Audit reason<input value={finishForm.reason} onChange={(event) => setFinishForm({ ...finishForm, reason: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]" /></label>
        </div>
        {error && <AlertCard variant="error" className="mt-4">{error}</AlertCard>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">{running.map((run) => <Button key={run.id} size="sm" variant="secondary" loading={busy === `cancel:${run.id}`} onClick={() => cancel(run)}>Cancel {words(run.mode)} run</Button>)}<Button loading={busy === "finish"} disabled={!running.length || finishForm.reason.trim().length < 3} onClick={finish}>Record results</Button></div>
      </SectionCard>
    </div>
  );
}

function RolloutControls({ versions = [], rollouts = [], onSaved }) {
  const candidates = versions.filter((item) => item.status === "candidate");
  const rollbackTargets = versions.filter((item) => ["active", "pilot"].includes(item.status));
  const [form, setForm] = useState({
    runtime_version_id: candidates[0]?.id || "",
    rollback_version_id: rollbackTargets[0]?.id || "",
    rollout_percent: 5,
    reason: "Starting a bounded local Ari pilot with instant rollback",
  });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const mutate = async (input, reason = form.reason) => {
    setBusy(`${input.action}:${input.rollout_id || "new"}`);
    setError(null);
    try {
      await controlAriRollout(input, reason.trim());
      await onSaved();
    } catch (err) {
      setError(err.message || "Couldn’t update the rollout");
    } finally {
      setBusy(null);
    }
  };

  const createPilot = () => mutate({
    action: "create_pilot",
    runtime_version_id: form.runtime_version_id || candidates[0]?.id,
    rollback_version_id: form.rollback_version_id || rollbackTargets[0]?.id,
    rollout_percent: Number(form.rollout_percent),
    audience: { environment: "local", brands: ["Harmattan Club", "Lantern Room"] },
    guardrails: { stop_on_failure: true, max_flagged_rate: 0.05, max_latency_ms: 15000 },
  });

  return (
    <div className="space-y-5">
      <SectionCard title="Start bounded pilot" subtitle="A candidate cannot start without a passing evaluation and a known-good rollback version">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Approved candidate<select value={form.runtime_version_id || candidates[0]?.id || ""} onChange={(event) => setForm({ ...form, runtime_version_id: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]"><option value="">Choose candidate</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.version_key}</option>)}</select></label>
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Rollback version<select value={form.rollback_version_id || rollbackTargets[0]?.id || ""} onChange={(event) => setForm({ ...form, rollback_version_id: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]"><option value="">Choose known-good version</option>{rollbackTargets.map((item) => <option key={item.id} value={item.id}>{item.version_key} · {words(item.status)}</option>)}</select></label>
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Initial percentage<input type="number" min="1" max="10" value={form.rollout_percent} onChange={(event) => setForm({ ...form, rollout_percent: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]" /></label>
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Audit reason<input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]" /></label>
        </div>
        {error && <AlertCard variant="error" className="mt-4">{error}</AlertCard>}
        <div className="mt-4 flex justify-end"><Button loading={busy === "create_pilot:new"} disabled={!candidates.length || !rollbackTargets.length || form.reason.trim().length < 3} onClick={createPilot}>Start local pilot</Button></div>
      </SectionCard>
      <SectionCard title="Rollout controls" subtitle="Every change is audited and rollback is immediate" noPadding>
        {rollouts.length ? <div className="divide-y divide-[var(--gray-200)]">{rollouts.map((item) => {
          const nextPercent = item.rollout_percent < 10 ? 10 : item.rollout_percent < 25 ? 25 : item.rollout_percent < 50 ? 50 : 100;
          return <div key={item.id} className="space-y-3 px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Badge variant={STATUS_VARIANT[item.status] || "default"}>{words(item.status)}</Badge><span className="text-xs text-[var(--color-text-secondary)]">{item.rollout_percent}%</span></div><span className="text-xs text-[var(--color-text-tertiary)]">{when(item.updated_at)}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--gray-200)]"><div className="h-full rounded-full bg-[var(--color-brand-500)]" style={{ width: `${item.rollout_percent}%` }} /></div>
            <div className="flex flex-wrap justify-end gap-2">
              {["pilot", "expanding"].includes(item.status) && item.rollout_percent < 100 && <Button size="sm" loading={busy === `expand:${item.id}`} onClick={() => mutate({ action: "expand", rollout_id: item.id, rollout_percent: nextPercent }, `Expanding the measured local Ari pilot to ${nextPercent}%`)}>Expand to {nextPercent}%</Button>}
              {["pilot", "expanding", "active"].includes(item.status) && <Button size="sm" variant="secondary" loading={busy === `pause:${item.id}`} onClick={() => mutate({ action: "pause", rollout_id: item.id }, "Pausing the local Ari rollout for review")}>Pause</Button>}
              {item.status === "paused" && <Button size="sm" loading={busy === `resume:${item.id}`} onClick={() => mutate({ action: "resume", rollout_id: item.id }, "Resuming the reviewed local Ari rollout")}>Resume</Button>}
              {["pilot", "expanding", "active", "paused"].includes(item.status) && <Button size="sm" variant="secondary" loading={busy === `rollback:${item.id}`} onClick={() => mutate({ action: "rollback", rollout_id: item.id }, "Rolling Ari back to the known-good runtime after review")}>Rollback</Button>}
              {item.status === "active" && item.rollout_percent === 100 && <Button size="sm" loading={busy === `complete:${item.id}`} onClick={() => mutate({ action: "complete", rollout_id: item.id }, "Completing the fully measured Ari rollout")}>Complete</Button>}
            </div>
          </div>;
        })}</div> : <Empty icon={ShieldCheck} title="Nothing is rolling out" body="A pilot appears here after a candidate passes its required evaluation and receives approval." />}
      </SectionCard>
    </div>
  );
}

function AuditRows({ rows = [] }) {
  if (!rows.length) return <Empty icon={ShieldCheck} title="No audited action yet" body="Protected reads and every improvement control change appear here." />;
  return <div className="divide-y divide-[var(--gray-200)]">{rows.map((item) => <div key={item.id} className="grid gap-2 px-4 py-3.5 sm:grid-cols-[170px_minmax(0,1fr)_180px] sm:px-5"><Badge variant="outline">{words(item.action)}</Badge><div><p className="text-sm text-[var(--color-text-primary)]">{item.reason}</p>{item.metadata && Object.keys(item.metadata).length > 0 && <p className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]">{JSON.stringify(item.metadata)}</p>}</div><span className="text-xs text-[var(--color-text-tertiary)] sm:text-right">{when(item.created_at)}</span></div>)}</div>;
}

function CaseDrawer({ summary, onClose, onSaved }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState("Reviewing Ari quality case");
  const [form, setForm] = useState({
    status: summary?.status || "new",
    severity: summary?.severity || "medium",
    root_cause: summary?.root_cause || "",
    capability_id: summary?.capability_id || "",
    linked_issue_number: summary?.linked_issue_number || "",
  });

  useEffect(() => {
    if (!summary?.id) return;
    let live = true;
    loadAriQualityCase(summary.id, "Reviewing Ari quality case")
      .then((value) => {
        if (!live) return;
        setDetail(value);
        setForm({
          status: value.status || "new",
          severity: value.severity || "medium",
          root_cause: value.root_cause || "",
          capability_id: value.capability_id || "",
          linked_issue_number: value.linked_issue_number || "",
        });
      })
      .catch((err) => live && setError(err.message || "Couldn’t load the case"))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [summary?.id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateAriQualityCase(summary.id, {
        ...form,
        root_cause: form.root_cause || null,
        capability_id: form.capability_id.trim() || null,
        linked_issue_number: form.linked_issue_number ? Number(form.linked_issue_number) : null,
      }, reason);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Couldn’t save the case");
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex w-full justify-end gap-2">
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={saving} disabled={reason.trim().length < 3} onClick={save}>Save review</Button>
    </div>
  );

  return (
    <Drawer open={!!summary} onClose={onClose} title="Review quality case" footer={footer}>
      {loading ? <p className="text-sm text-[var(--color-text-secondary)]">Loading the sanitized evidence…</p> : error && !detail ? <LoadError title="Couldn’t load this case" message={error} /> : (
        <div className="space-y-5">
          {error && <AlertCard variant="error">{error}</AlertCard>}
          <div>
            <p className="text-base font-semibold text-[var(--color-text-primary)]">{detail?.title || summary.title}</p>
            <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">{detail?.redacted_summary || summary.redacted_summary}</p>
          </div>
          <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Signals</p><SignalList values={detail?.signal_codes || summary.signal_codes} /></div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]">{["new", "triaged", "investigating", "proposal_ready", "evaluating", "shipped", "dismissed"].map((value) => <option key={value} value={value}>{words(value)}</option>)}</select></label>
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">Severity<select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]">{["low", "medium", "high", "critical"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          </div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)]">Root cause<select value={form.root_cause} onChange={(e) => setForm({ ...form, root_cause: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]"><option value="">Not classified</option>{["reasoning", "prompt", "missing_tool", "tool_defect", "product_gap", "knowledge", "provider", "reliability", "presentation", "policy", "expectation"].map((value) => <option key={value} value={value}>{words(value)}</option>)}</select></label>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)]">Capability ID<input value={form.capability_id} onChange={(e) => setForm({ ...form, capability_id: e.target.value })} placeholder="e.g. host.onboarding.publish" className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]" /></label>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)]">Linked issue<input type="number" value={form.linked_issue_number} onChange={(e) => setForm({ ...form, linked_issue_number: e.target.value })} placeholder="3355" className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]" /></label>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)]">Audit reason<input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]" /></label>
          <SectionCard title="Sanitized transcript" subtitle="Raw customer messages are not copied here">
            <div className="space-y-3">
              {(detail?.sanitized_transcript || []).map((message, index) => <div key={`${message.role}-${index}`} className="rounded-lg bg-[var(--gray-50)] p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{message.role}</p><p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-[var(--color-text-primary)]">{message.text}</p></div>)}
            </div>
          </SectionCard>
        </div>
      )}
    </Drawer>
  );
}

export function AriImprovementLabPage() {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");
  const [status, setStatus] = useState("open");
  const [severity, setSeverity] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedCase, setSelectedCase] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorkspace(await loadAriImprovementWorkspace());
    } catch (err) {
      setError(err.message || "Couldn’t load Ari’s improvement workspace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    loadAriImprovementWorkspace()
      .then((value) => {
        if (live) setWorkspace(value);
      })
      .catch((err) => {
        if (live) setError(err.message || "Couldn’t load Ari’s improvement workspace");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => { live = false; };
  }, []);

  const dashboard = workspace?.dashboard || {};
  const cases = useMemo(() => (workspace?.cases || []).filter((item) => {
    const open = !["shipped", "dismissed"].includes(item.status);
    if (status === "open" && !open) return false;
    if (status === "closed" && open) return false;
    if (severity !== "all" && item.severity !== severity) return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${item.title} ${item.redacted_summary} ${(item.signal_codes || []).join(" ")}`.toLowerCase().includes(needle);
  }), [workspace, status, severity, query]);

  return (
    <div className="space-y-6">
      <PageHeader title="Ari Improvement Lab" description="See how Ari is performing, investigate weak replies, turn evidence into evaluated upgrades, and keep every rollout reversible." actions={<Button variant="secondary" icon={RefreshCw} loading={loading} onClick={load}>Refresh</Button>} />

      <AlertCard variant="info" title="Evidence-led improvement">
        Every candidate upgrade must pass the scenario suite before it can enter a bounded, reversible rollout.
      </AlertCard>

      {error ? <LoadError title="Couldn’t load Ari Improvement Lab" message={error} onRetry={load} retrying={loading} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Activity} label="Sanitized turns" value={loading ? "—" : number(dashboard.captured_turns)} />
            <StatCard icon={AlertTriangle} label="Open quality cases" value={loading ? "—" : number(dashboard.open_cases)} />
            <StatCard icon={Wrench} label="Capability gaps" value={loading ? "—" : number(dashboard.capability_gaps)} />
            <StatCard icon={Gauge} label="Latest evaluation pass" value={loading || dashboard.latest_pass_rate == null ? "—" : `${Math.round(Number(dashboard.latest_pass_rate) * 100)}%`} />
          </div>

          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1" role="tablist" aria-label="Improvement Lab sections">
            {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`min-h-9 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors ${tab === id ? "bg-[var(--color-brand-500)] text-white" : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]"}`}>{label}</button>)}
          </div>

          {tab === "overview" && <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
            <SectionCard title="Needs attention now" subtitle="Highest-signal cases first" noPadding>
              <CaseRows cases={(workspace?.cases || []).filter((item) => !["shipped", "dismissed"].includes(item.status)).slice(0, 8)} onOpen={setSelectedCase} />
            </SectionCard>
            <div className="space-y-5">
              <SectionCard title="Improvement pipeline">
                <div className="space-y-3">
                  {[[Search, "Detect", "Sanitized turns are scored for failures, unsupported claims and corrections."], [BrainCircuit, "Diagnose", "Cases are classified by reasoning, prompt, tool, product, provider, policy or presentation."], [FlaskConical, "Evaluate", "Candidate changes run against the real scenario suite before any pilot."], [ShieldCheck, "Roll out", "Approved versions move through a bounded pilot with rollback guardrails."]].map(([icon, title, body]) => <div key={title} className="flex gap-3"><div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-50)]">{createElement(icon, { className: "h-4 w-4 text-[var(--color-brand-600)]" })}</div><div><p className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</p><p className="mt-0.5 text-[13px] leading-5 text-[var(--color-text-secondary)]">{body}</p></div></div>)}
                </div>
              </SectionCard>
              <SectionCard title="Control state">
                <div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-[var(--gray-50)] p-3"><p className="text-[var(--color-text-secondary)]">Proposals waiting</p><p className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">{number(dashboard.proposals_waiting)}</p></div><div className="rounded-lg bg-[var(--gray-50)] p-3"><p className="text-[var(--color-text-secondary)]">Critical open</p><p className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">{number(dashboard.critical_cases)}</p></div></div>
              </SectionCard>
              <SectionCard title="Last 7 days" subtitle="Cost and performance">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-[var(--gray-50)] p-3"><p className="text-[var(--color-text-secondary)]">Turns</p><p className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">{number(dashboard.turns_last_7d)}</p></div>
                  <div className="rounded-lg bg-[var(--gray-50)] p-3"><p className="text-[var(--color-text-secondary)]">Flagged</p><p className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">{dashboard.flagged_turn_rate_7d == null ? "—" : `${Math.round(Number(dashboard.flagged_turn_rate_7d) * 100)}%`}</p></div>
                  <div className="rounded-lg bg-[var(--gray-50)] p-3"><p className="text-[var(--color-text-secondary)]">Avg latency</p><p className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">{dashboard.average_latency_ms_7d == null ? "—" : `${number(dashboard.average_latency_ms_7d)} ms`}</p></div>
                  <div className="rounded-lg bg-[var(--gray-50)] p-3"><p className="text-[var(--color-text-secondary)]">Estimated cost</p><p className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">${(Number(dashboard.estimated_cost_micros_7d || 0) / 1_000_000).toFixed(4)}</p></div>
                </div>
              </SectionCard>
            </div>
          </div>}

          {tab === "threads" && <MessageThreads turns={workspace?.training_turns || []} />}

          {tab === "cases" && <SectionCard title="Quality cases" subtitle={`${cases.length} shown`} noPadding action={<div className="flex flex-wrap gap-2"><div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--color-text-tertiary)]" /><input aria-label="Search cases" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="h-9 w-44 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] pl-9 pr-3 text-sm text-[var(--color-text-primary)]" /></div><select aria-label="Case status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2.5 text-sm text-[var(--color-text-primary)]"><option value="open">Open</option><option value="closed">Closed</option><option value="all">All</option></select><select aria-label="Case severity" value={severity} onChange={(e) => setSeverity(e.target.value)} className="h-9 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2.5 text-sm text-[var(--color-text-primary)]"><option value="all">All severity</option>{["critical", "high", "medium", "low"].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>}><CaseRows cases={cases} onOpen={setSelectedCase} /></SectionCard>}

          {tab === "proposals" && <div className="space-y-5">
            <ProposalComposer cases={workspace?.cases || []} gaps={workspace?.capability_gaps || []} onSaved={load} />
            <SectionCard title="Proposal pipeline" subtitle="Human approval is required at every gate" noPadding><ProposalRows proposals={workspace?.proposals || []} onSaved={load} /></SectionCard>
            <SectionCard title="Observed capability gaps" subtitle={`${(workspace?.capability_gaps || []).length} tracked`} noPadding>{(workspace?.capability_gaps || []).length ? <div className="divide-y divide-[var(--gray-200)]">{workspace.capability_gaps.map((item) => <div key={item.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:px-5"><div><p className="text-sm font-semibold text-[var(--color-text-primary)]">{item.title}</p><p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">{item.description || item.example_request || "No description recorded."}</p><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Seen {number(item.occurrence_count)} times · {item.capability_key}</p></div><Badge variant={item.status === "shipped" ? "success" : "warning"}>{words(item.status)}</Badge></div>)}</div> : <Empty icon={Wrench} title="No capability gap detected" body="Unsupported requests and repeated missing-tool signals will be grouped here." />}</SectionCard>
          </div>}

          {tab === "evaluations" && <div className="space-y-5">
            <EvaluationControls proposals={workspace?.proposals || []} versions={workspace?.runtime_versions || []} runs={workspace?.evaluation_runs || []} onSaved={load} />
            <div className="grid gap-5 xl:grid-cols-2"><SectionCard title="Scenario library" subtitle={`${(workspace?.evaluation_scenarios || []).length} loaded`} noPadding>{(workspace?.evaluation_scenarios || []).length ? <div className="max-h-[640px] divide-y divide-[var(--gray-200)] overflow-y-auto">{workspace.evaluation_scenarios.map((item) => <div key={item.id} className="px-4 py-3.5 sm:px-5"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[var(--color-text-primary)]">{item.scenario_key} · {item.title}</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{words(item.mode)}{item.market ? ` · ${item.market}` : ""}</p></div><Badge variant={item.status === "active" ? "success" : "warning"}>{words(item.status)}</Badge></div></div>)}</div> : <Empty icon={FlaskConical} title="Scenario library unavailable" body="The approved product, mechanics and adversarial cases must be loaded before a full evaluation can pass." />}</SectionCard><SectionCard title="Evaluation runs" subtitle="Accuracy, completion, latency and cost" noPadding>{(workspace?.evaluation_runs || []).length ? <div className="divide-y divide-[var(--gray-200)]">{workspace.evaluation_runs.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5"><div><p className="text-sm font-semibold text-[var(--color-text-primary)]">{words(item.mode)} run</p><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{when(item.created_at)}{item.summary?.total ? ` · ${item.summary.passed}/${item.summary.total} passed` : ""}</p></div><Badge variant={STATUS_VARIANT[item.status] || "default"}>{words(item.status)}</Badge></div>)}</div> : <Empty icon={Clock3} title="No evaluation run yet" body="Start a governed run above, execute it through the local runner, then record its measured traces." />}</SectionCard></div>
          </div>}

          {tab === "versions" && <div className="space-y-5">
            <RuntimeVersionComposer proposals={workspace?.proposals || []} versions={workspace?.runtime_versions || []} onSaved={load} />
            <div className="grid gap-5 xl:grid-cols-[minmax(300px,.7fr)_minmax(0,1.3fr)]"><SectionCard title="Runtime versions" subtitle="Prompt, tools, policies and model config" noPadding>{(workspace?.runtime_versions || []).length ? <div className="divide-y divide-[var(--gray-200)]">{workspace.runtime_versions.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5"><div><p className="text-sm font-semibold text-[var(--color-text-primary)]">{item.version_key}</p><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{words(item.kind)} · {when(item.created_at)}</p></div><Badge variant={STATUS_VARIANT[item.status] || (item.status === "active" ? "success" : "default")}>{words(item.status)}</Badge></div>)}</div> : <Empty icon={BrainCircuit} title="No runtime version yet" body="The known-good baseline and reviewed candidates appear here." />}</SectionCard><RolloutControls versions={workspace?.runtime_versions || []} rollouts={workspace?.rollouts || []} onSaved={load} /></div>
          </div>}

          {tab === "audit" && <SectionCard title="Protected access and control changes" subtitle="Newest first" noPadding><AuditRows rows={workspace?.access_audit || []} /></SectionCard>}
        </>
      )}

      {selectedCase && <CaseDrawer summary={selectedCase} onClose={() => setSelectedCase(null)} onSaved={load} />}
    </div>
  );
}
