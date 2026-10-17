import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { AlertCard, SectionCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input, Textarea } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import {
  approveCustomerDraft,
  listProductAvengersWorkspace,
  recordCandidateDecision,
  runProductAvengersCommand,
  saveNoFitReason,
  savePublicProductReview,
  saveRoadmapWording,
  verifyProductRelease,
} from "../../services/productAvengersService";

const THEMES = ["Discovery & Deck", "Social Graph", "Payments", "Business Tooling", "Growth & Activation", "Trust & Safety", "Platform Health", "Place Intelligence"];
const PRODUCTS = ["Business", "Explorer", "Both", "Platform"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];
const ESTIMATES = ["1", "2", "3", "5", "8", "13"];
const HORIZONS = ["Now", "Next", "Later"];
const QUARTERS = ["Q4 2026", "Q1 2027", "Q2 2027", "Q3 2027", "Q4 2027"];

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block text-sm font-medium text-[var(--color-text-primary)]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
      >
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function initialReview(signal) {
  const review = signal?.review;
  const priority = { urgent: "P0", high: "P1", normal: "P2", low: "P3" }[signal?.priority] || "P2";
  return {
    publicTitle: review?.public_title || signal?.title || "",
    publicProblem: review?.public_problem_statement || signal?.problem_statement || "",
    publicOutcome: review?.public_outcome || signal?.impact_summary || "",
    acceptanceCriteria: (review?.public_acceptance_criteria || [signal?.next_step || ""]).join("\n"),
    product: review?.board_product || "Both",
    theme: review?.board_theme || "Business Tooling",
    priority: review?.board_priority || priority,
    estimate: review?.board_estimate || "3",
    horizon: review?.board_horizon || "Next",
    quarter: review?.board_quarter || "Q4 2026",
  };
}

function commandBadge(signal) {
  const command = signal.commands?.[0];
  if (!command) return null;
  const variant = command.state === "failed" ? "error" : command.state === "succeeded" ? "success" : "warning";
  return <Badge variant={variant}>{command.state === "failed" ? command.error_code || "Failed" : command.state}</Badge>;
}

export function ProductInboxPanel() {
  const { addToast } = useToast();
  const [signals, setSignals] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(initialReview(null));
  const [noFitReason, setNoFitReason] = useState("");
  const [roadmapTitle, setRoadmapTitle] = useState("");
  const [roadmapBody, setRoadmapBody] = useState("");
  const [releaseEvidence, setReleaseEvidence] = useState("");
  const [draftBodies, setDraftBodies] = useState({});
  const [candidateReasons, setCandidateReasons] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listProductAvengersWorkspace();
      setSignals(rows);
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || null);
    } catch (error) {
      addToast({ variant: "error", title: "Could not load Product Inbox", description: error?.message });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);
  const selected = useMemo(() => signals.find((row) => row.id === selectedId) || null, [signals, selectedId]);
  useEffect(() => {
    if (!selected) return;
    const next = initialReview(selected);
    setReview(next);
    setNoFitReason(selected.review?.no_fit_reason || "");
    setRoadmapTitle(selected.roadmap?.public_title || next.publicTitle);
    setRoadmapBody(selected.roadmap?.public_body || next.publicOutcome);
    setReleaseEvidence(selected.item?.release_evidence_url || "");
    setDraftBodies(Object.fromEntries((selected.drafts || []).map((draft) => [draft.id, draft.body])));
    setCandidateReasons(Object.fromEntries((selected.candidates || []).map((candidate) => [candidate.issue_number, candidate.decision_reason || ""])));
  }, [selected]);

  async function act(title, action) {
    setBusy(true);
    try {
      await action();
      addToast({ variant: "success", title });
      await load();
    } catch (error) {
      addToast({ variant: "error", title: "Action did not complete", description: error?.message });
    } finally {
      setBusy(false);
    }
  }

  if (loading && !signals.length) return <div className="flex min-h-48 items-center justify-center"><Spinner /></div>;
  if (!signals.length) return (
    <SectionCard title="Product Inbox">
      <p className="text-sm text-[var(--color-text-secondary)]">No bug or feature signals are waiting for Product review.</p>
    </SectionCard>
  );

  return (
    <div className="space-y-4">
      <AlertCard variant="info" title="Existing issue first · public-safe fields only">
        Search Mingla Avengers before linking or creating. Only the reviewed wording below can cross into GitHub. Customer updates remain drafts and are never sent from this screen.
      </AlertCard>
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <SectionCard title="Signals" subtitle={`${signals.length} Product items`} noPadding>
          <div className="max-h-[72vh] overflow-y-auto divide-y divide-[var(--gray-200)]">
            {signals.map((signal) => (
              <button
                type="button"
                key={signal.id}
                onClick={() => setSelectedId(signal.id)}
                className={`w-full p-4 text-left transition-colors ${signal.id === selectedId ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--gray-50)]"}`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant={signal.signal_kind === "bug" ? "error" : "brand"}>{signal.signal_kind}</Badge>
                  {signal.item ? <Badge variant="success">#{signal.item.issue_number}</Badge> : commandBadge(signal)}
                </div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">{signal.title}</p>
                <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{signal.affected_people} affected · {signal.product_area}</p>
              </button>
            ))}
          </div>
        </SectionCard>

        {selected && <div className="space-y-4">
          <SectionCard
            title="Public-safe Product review"
            subtitle={`Private source stays in Mingla · revision ${selected.review?.revision || 0}`}
            action={<Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void load()} disabled={busy}>Refresh</Button>}
          >
            <div className="mb-4 rounded-lg bg-[var(--gray-50)] p-3 text-sm text-[var(--color-text-secondary)]">
              <p><strong>Private context:</strong> {selected.problem_statement}</p>
              <p className="mt-1"><strong>Journey:</strong> {selected.user_journey}</p>
            </div>
            <div className="space-y-4">
              <Input label="Public issue title" value={review.publicTitle} onChange={(event) => setReview({ ...review, publicTitle: event.target.value })} />
              <Textarea label="Public problem statement" value={review.publicProblem} onChange={(event) => setReview({ ...review, publicProblem: event.target.value })} />
              <Textarea label="Public intended outcome" value={review.publicOutcome} onChange={(event) => setReview({ ...review, publicOutcome: event.target.value })} />
              <Textarea label="Acceptance criteria · one per line" value={review.acceptanceCriteria} onChange={(event) => setReview({ ...review, acceptanceCriteria: event.target.value })} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <SelectField label="Product" value={review.product} onChange={(value) => setReview({ ...review, product: value })} options={PRODUCTS} />
                <SelectField label="Theme" value={review.theme} onChange={(value) => setReview({ ...review, theme: value })} options={THEMES} />
                <SelectField label="Priority" value={review.priority} onChange={(value) => setReview({ ...review, priority: value })} options={PRIORITIES} />
                <SelectField label="Estimate" value={review.estimate} onChange={(value) => setReview({ ...review, estimate: value })} options={ESTIMATES} />
                <SelectField label="Horizon" value={review.horizon} onChange={(value) => setReview({ ...review, horizon: value })} options={HORIZONS} />
                <SelectField label="Quarter" value={review.quarter} onChange={(value) => setReview({ ...review, quarter: value })} options={QUARTERS} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button loading={busy} onClick={() => void act("Public-safe review saved", () => savePublicProductReview(selected.id, review, selected.review?.revision || 0))}>Save reviewed fields</Button>
                <Button variant="secondary" disabled={busy || !selected.review} onClick={() => void act("Candidate search completed", () => runProductAvengersCommand(selected.id, "search"))}>Search existing Avengers issues</Button>
              </div>
            </div>
          </SectionCard>

          {!selected.item && selected.review && <SectionCard title="Existing-issue decision" subtitle="Review candidates before creating anything">
            <div className="space-y-3">
              {selected.candidates.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)]">Run the candidate search. If nothing fits, record why before creating a new issue.</p>
              ) : selected.candidates.map((candidate) => (
                <div key={candidate.issue_number} className="rounded-lg border border-[var(--gray-200)] p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                    <a href={candidate.issue_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-[var(--color-brand-600)] hover:underline">#{candidate.issue_number} · {candidate.issue_title}</a>
                    <div className="mt-1 flex gap-2"><Badge>{candidate.issue_state}</Badge><Badge variant={candidate.decision === "selected" ? "success" : "default"}>{candidate.decision}</Badge></div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act("Candidate selected", () => recordCandidateDecision(selected.id, candidate.issue_number, "selected"))}>Select</Button>
                    <Button size="sm" disabled={busy || candidate.decision !== "selected"} onClick={() => void act("Existing Avengers issue linked", () => runProductAvengersCommand(selected.id, "link_existing", { issue_number: candidate.issue_number }))}>Link selected issue</Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <Input label="Why this issue is not an accurate fit" value={candidateReasons[candidate.issue_number] || ""} onChange={(event) => setCandidateReasons({ ...candidateReasons, [candidate.issue_number]: event.target.value })} />
                    <Button size="sm" variant="secondary" disabled={busy || (candidateReasons[candidate.issue_number] || "").trim().length < 10} onClick={() => void act("Candidate marked not a fit", () => recordCandidateDecision(selected.id, candidate.issue_number, "not_fit", candidateReasons[candidate.issue_number]))}>Not a fit</Button>
                  </div>
                </div>
              ))}
              <Textarea label="Why none of these issues is an accurate fit" value={noFitReason} onChange={(event) => setNoFitReason(event.target.value)} helper="Required before creating a new issue; at least 20 characters." />
              <Button disabled={busy || !selected.review?.candidates_checked_at || noFitReason.trim().length < 20 || selected.candidates.some((candidate) => candidate.decision !== "not_fit")} onClick={() => void act("New Avengers issue created", async () => {
                await saveNoFitReason(selected.id, noFitReason);
                await runProductAvengersCommand(selected.id, "create_issue");
              })}>Confirm no fit and create issue</Button>
            </div>
          </SectionCard>}

          {selected.item && <SectionCard
            title={`Avengers #${selected.item.issue_number}`}
            badge={<Badge variant={selected.item.sync_state === "synced" ? "success" : "warning"}>{selected.item.sync_state}</Badge>}
            action={<a href={selected.item.issue_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand-600)] hover:underline">Open issue <ExternalLink className="h-4 w-4" /></a>}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[["Engineering", selected.item.board_status || "Todo"], ["Customer", selected.item.customer_status], ["Horizon", selected.item.board_horizon || "Unassigned"], ["Priority", selected.item.board_priority || "Unassigned"]].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-[var(--gray-50)] p-3"><p className="text-xs text-[var(--color-text-tertiary)]">{label}</p><p className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">{value}</p></div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void act("Avengers status refreshed", () => runProductAvengersCommand(selected.id, "refresh"))}>Refresh from Avengers</Button>
              <Button variant="secondary" disabled={busy} onClick={() => void act("Reviewed board fields updated", () => runProductAvengersCommand(selected.id, "update_board"))}>Update reviewed board fields</Button>
            </div>
          </SectionCard>}

          {selected.item && <SectionCard title="Customer-safe roadmap wording" subtitle="Saved as a draft; publishing remains a separate Roadmap action">
            <div className="space-y-3">
              <Input label="Roadmap title" value={roadmapTitle} onChange={(event) => setRoadmapTitle(event.target.value)} />
              <Textarea label="Roadmap description" value={roadmapBody} onChange={(event) => setRoadmapBody(event.target.value)} />
              <Button disabled={busy} onClick={() => void act("Roadmap draft saved", () => saveRoadmapWording(selected.id, roadmapTitle, roadmapBody))}>Save Roadmap draft</Button>
            </div>
          </SectionCard>}

          {selected.item?.board_status === "Done" && selected.item?.customer_status !== "Live" && <SectionCard title="Verify live release" subtitle="Done on Avengers is not enough by itself">
            <div className="space-y-3">
              <Input label="Exact shipping-issue release-record comment URL" value={releaseEvidence} onChange={(event) => setReleaseEvidence(event.target.value)} placeholder="https://github.com/Mingla-LLC/mingla-main/issues/…#issuecomment-…" />
              <Button disabled={busy || !releaseEvidence.trim()} onClick={() => void act("Release verified live", () => verifyProductRelease(selected.id, releaseEvidence))}>Verify production release</Button>
            </div>
          </SectionCard>}

          {selected.drafts?.length > 0 && <SectionCard title="Customer update drafts" subtitle="Approval changes the draft state; it does not send anything">
            <div className="space-y-4">
              {selected.drafts.map((draft) => (
                <div key={draft.id} className="rounded-lg border border-[var(--gray-200)] p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant="info">{draft.customer_status}</Badge><Badge variant={draft.state === "product_approved" ? "success" : "default"}>{draft.state}</Badge></div>
                  <Textarea value={draftBodies[draft.id] || ""} onChange={(event) => setDraftBodies({ ...draftBodies, [draft.id]: event.target.value })} disabled={draft.state !== "draft"} />
                  {draft.state === "draft" && <Button className="mt-2" size="sm" disabled={busy} onClick={() => void act("Customer-safe wording approved", () => approveCustomerDraft(draft.id, draftBodies[draft.id]))}>Approve wording only</Button>}
                </div>
              ))}
            </div>
          </SectionCard>}
        </div>}
      </div>
    </div>
  );
}
