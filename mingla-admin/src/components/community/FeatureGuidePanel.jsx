import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, RefreshCw, Search } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SectionCard } from "../ui/Card";
import { Input, Textarea } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import {
  listFeatureGuide,
  recordFeatureEvidence,
  saveFeatureCapability,
} from "../../services/featureGuideService";

const EVIDENCE_KINDS = [
  "source",
  "test",
  "route",
  "pull_request",
  "release_record",
  "migration",
  "feature_flag",
  "deployment",
  "app_release",
  "live_check",
];

const STATUS_BADGE = {
  Live: "success",
  "Needs review": "warning",
  Planned: "info",
  Retired: "default",
};

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function editorFor(row = null) {
  return {
    capabilityKey: row?.capability_key || "",
    revision: row?.revision || 0,
    title: row?.title || "",
    outcomeSummary: row?.outcome_summary || "",
    whoCanUse: (row?.who_can_use || []).join("\n"),
    surfaces: (row?.surfaces || []).join("\n"),
    howTo: row?.how_to || "",
    limitations: row?.limitations || "",
    supportWording: row?.support_wording || "",
    claimedStatus: row?.claimed_status || "planned",
    requiredEvidenceKinds: (row?.required_evidence_kinds || [
      "source", "test", "release_record", "live_check",
    ]).join("\n"),
    verificationDueAt: localDateTime(row?.verification_due_at),
  };
}

function evidenceEditor() {
  return {
    kind: "source",
    verdict: "verified",
    url: "",
    details: "",
    observedAt: localDateTime(new Date().toISOString()),
    expiresAt: "",
  };
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block text-sm font-medium text-[var(--color-text-primary)]">
      <span className="mb-1.5 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
      >
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

export function FeatureGuidePanel({ canManage = false }) {
  const { addToast } = useToast();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const [proof, setProof] = useState(null);

  const load = useCallback(async (nextQuery = "") => {
    setLoading(true);
    try {
      const data = await listFeatureGuide(nextQuery);
      setRows(data || []);
      setSelectedId((current) =>
        (data || []).some((row) => row.capability_id === current)
          ? current
          : data?.[0]?.capability_id || null
      );
    } catch (error) {
      addToast({ variant: "error", title: "Could not load Feature Guide", description: error?.message });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { void load(""); }, [load]);

  const selected = useMemo(
    () => rows.find((row) => row.capability_id === selectedId) || null,
    [rows, selectedId],
  );

  async function saveCapability() {
    if (!editor) return;
    setBusy(true);
    try {
      await saveFeatureCapability(editor);
      addToast({ variant: "success", title: "Capability saved", description: "Its displayed status still depends on current evidence." });
      setEditor(null);
      await load(query);
    } catch (error) {
      addToast({ variant: "error", title: "Could not save capability", description: error?.message });
    } finally {
      setBusy(false);
    }
  }

  async function saveEvidence() {
    if (!selected || !proof) return;
    setBusy(true);
    try {
      await recordFeatureEvidence(selected.capability_id, selected.revision, proof);
      addToast({ variant: "success", title: "Evidence recorded", description: "The Feature Guide status was recalculated from the complete current set." });
      setProof(null);
      await load(query);
    } catch (error) {
      addToast({ variant: "error", title: "Could not record evidence", description: error?.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Search verified capabilities"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void load(query); }}
            placeholder="Brand groups, files, Product Inbox…"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={Search} onClick={() => void load(query)} disabled={loading}>Search</Button>
          <Button variant="secondary" icon={RefreshCw} onClick={() => void load(query)} disabled={loading}>Refresh</Button>
          {canManage && <Button icon={Plus} onClick={() => setEditor(editorFor())}>New capability</Button>}
        </div>
      </div>

      <p className="text-sm text-[var(--color-text-secondary)]">
        Answers come from reviewed evidence. Missing, expired, or conflicting proof is shown as Needs review—never guessed.
      </p>

      {loading ? <div className="flex justify-center py-12"><Spinner /></div> : rows.length === 0 ? (
        <SectionCard title="No verified capability matched">
          <p className="text-sm text-[var(--color-text-secondary)]">Try a different search. Do not infer an answer from an empty result.</p>
        </SectionCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,2fr)]">
          <SectionCard title={`${rows.length} capabilit${rows.length === 1 ? "y" : "ies"}`}>
            <div className="space-y-2">
              {rows.map((row) => (
                <button
                  key={row.capability_id}
                  type="button"
                  onClick={() => { setSelectedId(row.capability_id); setEditor(null); setProof(null); }}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    row.capability_id === selectedId
                      ? "border-[var(--color-brand-400)] bg-[var(--color-brand-50)]"
                      : "border-[var(--gray-200)] hover:bg-[var(--gray-50)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)]">{row.title}</span>
                    <Badge variant={STATUS_BADGE[row.effective_status] || "default"}>{row.effective_status}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-[var(--color-text-secondary)]">{row.outcome_summary}</p>
                </button>
              ))}
            </div>
          </SectionCard>

          {selected && <div className="space-y-4">
            <SectionCard
              title={selected.title}
              badge={<Badge variant={STATUS_BADGE[selected.effective_status] || "default"}>{selected.effective_status}</Badge>}
              action={canManage ? <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditor(editorFor(selected))}>Edit</Button>
                <Button size="sm" variant="secondary" onClick={() => setProof(evidenceEditor())}>Add evidence</Button>
              </div> : null}
            >
              <div className="space-y-4 text-sm">
                <p className="text-[var(--color-text-secondary)]">{selected.outcome_summary}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><p className="text-xs font-semibold uppercase text-[var(--color-text-tertiary)]">Who can use it</p><p className="mt-1">{selected.who_can_use.join(", ")}</p></div>
                  <div><p className="text-xs font-semibold uppercase text-[var(--color-text-tertiary)]">Where it works</p><p className="mt-1">{selected.surfaces.join(", ")}</p></div>
                </div>
                <div><p className="text-xs font-semibold uppercase text-[var(--color-text-tertiary)]">How to use it</p><p className="mt-1 whitespace-pre-wrap">{selected.how_to}</p></div>
                <div><p className="text-xs font-semibold uppercase text-[var(--color-text-tertiary)]">Limitations</p><p className="mt-1 whitespace-pre-wrap">{selected.limitations}</p></div>
                <div className="rounded-lg border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] p-3">
                  <p className="text-xs font-semibold uppercase text-[var(--color-text-tertiary)]">Approved Support wording</p>
                  <p className="mt-1 whitespace-pre-wrap">{selected.support_wording}</p>
                </div>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  Last fully verified: {selected.last_verified_at ? new Date(selected.last_verified_at).toLocaleString() : "Never"}
                  {selected.verification_due_at ? ` · Review due ${new Date(selected.verification_due_at).toLocaleString()}` : ""}
                </p>
              </div>
            </SectionCard>

            <SectionCard title="Current evidence" subtitle="Open the cited proof before repeating a sensitive or time-dependent answer">
              <div className="space-y-2">
                {(selected.evidence || []).map((item) => (
                  <a
                    key={item.kind}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start justify-between gap-3 rounded-lg border border-[var(--gray-200)] p-3 hover:bg-[var(--gray-50)]"
                  >
                    <div><p className="text-sm font-semibold">{item.kind.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{item.details}</p></div>
                    <div className="flex items-center gap-2"><Badge variant={item.verdict === "verified" ? "success" : "warning"}>{item.verdict}</Badge><ExternalLink className="h-4 w-4" /></div>
                  </a>
                ))}
              </div>
            </SectionCard>
          </div>}
        </div>
      )}

      {canManage && editor && <SectionCard title={editor.revision ? "Edit capability" : "New capability"} subtitle="Claimed Live still fails closed until every required proof is current">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2"><Input label="Capability key" value={editor.capabilityKey} disabled={Boolean(editor.revision)} onChange={(event) => setEditor({ ...editor, capabilityKey: event.target.value })} /><Input label="Title" value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></div>
          <Textarea label="Outcome summary" value={editor.outcomeSummary} onChange={(event) => setEditor({ ...editor, outcomeSummary: event.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2"><Textarea label="Who can use it · one per line" value={editor.whoCanUse} onChange={(event) => setEditor({ ...editor, whoCanUse: event.target.value })} /><Textarea label="Surfaces · one per line" value={editor.surfaces} onChange={(event) => setEditor({ ...editor, surfaces: event.target.value })} /></div>
          <Textarea label="How to use it" value={editor.howTo} onChange={(event) => setEditor({ ...editor, howTo: event.target.value })} />
          <Textarea label="Limitations" value={editor.limitations} onChange={(event) => setEditor({ ...editor, limitations: event.target.value })} />
          <Textarea label="Approved Support wording" value={editor.supportWording} onChange={(event) => setEditor({ ...editor, supportWording: event.target.value })} />
          <div className="grid gap-3 sm:grid-cols-3"><SelectField label="Claimed status" value={editor.claimedStatus} onChange={(value) => setEditor({ ...editor, claimedStatus: value })} options={["planned", "live", "retired"]} /><Input label="Verification due" type="datetime-local" value={editor.verificationDueAt} onChange={(event) => setEditor({ ...editor, verificationDueAt: event.target.value })} /><Textarea label="Required evidence · one kind per line" value={editor.requiredEvidenceKinds} onChange={(event) => setEditor({ ...editor, requiredEvidenceKinds: event.target.value })} /></div>
          <div className="flex gap-2"><Button loading={busy} onClick={() => void saveCapability()}>Save capability</Button><Button variant="secondary" disabled={busy} onClick={() => setEditor(null)}>Cancel</Button></div>
        </div>
      </SectionCard>}

      {canManage && proof && selected && <SectionCard title="Record current evidence" subtitle={`This supersedes the current ${proof.kind.replaceAll("_", " ")} proof for ${selected.title}`}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2"><SelectField label="Evidence kind" value={proof.kind} onChange={(value) => setProof({ ...proof, kind: value })} options={EVIDENCE_KINDS} /><SelectField label="Verdict" value={proof.verdict} onChange={(value) => setProof({ ...proof, verdict: value })} options={["verified", "conflict"]} /></div>
          <Input label="Evidence URL" type="url" value={proof.url} onChange={(event) => setProof({ ...proof, url: event.target.value })} />
          <Textarea label="What this proves" value={proof.details} onChange={(event) => setProof({ ...proof, details: event.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2"><Input label="Observed at" type="datetime-local" value={proof.observedAt} onChange={(event) => setProof({ ...proof, observedAt: event.target.value })} /><Input label="Expires at · optional" type="datetime-local" value={proof.expiresAt} onChange={(event) => setProof({ ...proof, expiresAt: event.target.value })} /></div>
          <div className="flex gap-2"><Button loading={busy} onClick={() => void saveEvidence()}>Record evidence</Button><Button variant="secondary" disabled={busy} onClick={() => setProof(null)}>Cancel</Button></div>
        </div>
      </SectionCard>}
    </div>
  );
}

export default FeatureGuidePanel;
