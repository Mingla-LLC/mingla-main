// #4382 Wave 3 — the Product card's side panel, one step per stage:
//   Triage   private context, public wording, existing-issue candidates,
//            Link → Planned, or confirm no fit and create the issue
//   Planned  GitHub status (copied from the Avengers board), back to Triaged
//   Verify   paste the release record that proves it's live → Shipped
//   Tell     edit the live wording, see who gets it, "Send to N people", once
//   Won't do any stage before Told, with a reason written for reporters
// Public wording is the only thing that crosses into GitHub (unchanged rule).
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input, Textarea } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { SearchInput } from "../ui/SearchInput";
import {
  BOARD_COLUMNS,
  STAGE_LABEL,
  signalTypeLabel,
  stageIndex,
  tellButtonLabel,
  tellReportersState,
} from "./productBoardModel";
import { ticketNumberLabel } from "../../lib/supportTicketMetrics";
import {
  approveCustomerDraft,
  recordCandidateDecision,
  runProductAvengersCommand,
  saveNoFitReason,
  savePublicProductReview,
  saveRoadmapWording,
  setProductWontDo,
  tellProductReporters,
  verifyProductRelease,
} from "../../services/productAvengersService";
import { linkSourceToProductSignal, updateProductSignal } from "../../services/supportProductWorkflowService";
import { fetchGithubStatuses } from "../../services/opsService";

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

function Step({ title, hint, children }) {
  return (
    <section className="space-y-3 rounded-xl border border-[var(--gray-200)] p-4">
      <div>
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h4>
        {hint && <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function reporterLine(ticket) {
  return [ticketNumberLabel(ticket), ticket.person_name || (ticket.visibility === "internal" ? "Internal" : null), ticket.brand_name].filter(Boolean).join(" · ");
}

export function LinkIdeaModal({ open, ideas, linkedIds, onClose, onLink }) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState(null);
  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return (ideas || [])
      .filter((idea) => !linkedIds.has(idea.id))
      .filter((idea) => !text || String(idea.title || "").toLowerCase().includes(text))
      .slice(0, 12);
  }, [ideas, linkedIds, query]);
  return (
    <Modal open={open} onClose={onClose} title="Link a Community idea" size="md">
      <ModalBody>
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text-secondary)]">The idea keeps its public voting page. Its votes count as reporters on this item, and when the item is Told, voters get the existing "shipped" notification, not a second message.</p>
          <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} placeholder="Search ideas" aria-label="Search ideas" />
          {rows.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">No published ideas match.</p>
          ) : (
            <ul className="divide-y divide-[var(--gray-100)] rounded-xl border border-[var(--gray-200)]">
              {rows.map((idea) => (
                <li key={idea.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0"><span className="block truncate font-medium">{idea.title}</span><span className="text-xs text-[var(--color-text-tertiary)]">{idea.vote_count} votes</span></span>
                  <Button size="sm" variant="secondary" loading={busyId === idea.id} disabled={!!busyId} onClick={async () => {
                    setBusyId(idea.id);
                    try { await onLink(idea); } finally { setBusyId(null); }
                  }}>Link</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ModalBody>
      <ModalFooter><Button variant="secondary" onClick={onClose}>Done</Button></ModalFooter>
    </Modal>
  );
}

/**
 * Props: signal, ticketsById, ideasById, ideas, onClose, onChanged() (reload),
 * notify({ variant, title, description }).
 */
export function ProductCardPanel({ signal, ticketsById, ideasById, ideas, onClose, onChanged, notify }) {
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(() => initialReview(signal));
  const [noFitReason, setNoFitReason] = useState(signal.review?.no_fit_reason || "");
  const [candidateReasons, setCandidateReasons] = useState(() => Object.fromEntries((signal.candidates || []).map((c) => [c.issue_number, c.decision_reason || ""])));
  const [roadmapTitle, setRoadmapTitle] = useState(signal.roadmap?.public_title || initialReview(signal).publicTitle);
  const [roadmapBody, setRoadmapBody] = useState(signal.roadmap?.public_body || initialReview(signal).publicOutcome);
  const [releaseEvidence, setReleaseEvidence] = useState(signal.item?.release_evidence_url || "");
  const [wontDoOpen, setWontDoOpen] = useState(false);
  const [wontDoReason, setWontDoReason] = useState("");
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [telling, setTelling] = useState(false);
  const [sentOnce, setSentOnce] = useState(false);
  const tell = tellReportersState(signal, ticketsById, { sending: telling, sentOnce });
  const [draftBody, setDraftBody] = useState(tell.draft?.body || "");

  // #3980 Wave 2: the D-15 word for the linked issue once Mingla's bridge has
  // read it; until then the board status shows as before.
  const [engineering, setEngineering] = useState(null);
  const linkedIssue = signal.item?.issue_number || null;
  useEffect(() => {
    let live = true;
    if (!linkedIssue) return undefined;
    fetchGithubStatuses([linkedIssue])
      .then((data) => {
        const item = data?.items?.[0];
        if (live && item?.checked && !item.not_found) setEngineering(item.label);
      })
      .catch(() => { if (live) setEngineering(null); });
    return () => { live = false; };
  }, [linkedIssue]);

  async function act(title, action) {
    setBusy(true);
    try {
      await action();
      notify({ variant: "success", title });
      await onChanged();
    } catch (error) {
      notify({ variant: "error", title: "That didn't finish", description: error?.message });
    } finally {
      setBusy(false);
    }
  }

  async function sendTell() {
    if (!tell.canSend || !tell.draft) return;
    setTelling(true);
    try {
      if (tell.draft.state === "draft") await approveCustomerDraft(tell.draft.id, draftBody);
      const result = await tellProductReporters(signal.id, tell.draft.id);
      setSentOnce(true);
      notify({ variant: "success", title: `Told ${result?.tickets_told ?? tell.recipients.length} ${(result?.tickets_told ?? tell.recipients.length) === 1 ? "person" : "people"}` });
      await onChanged();
    } catch (error) {
      const message = String(error?.message || "");
      if (message.includes("already_told")) setSentOnce(true);
      notify({ variant: "error", title: message.includes("already_told") ? "Already told" : "Couldn't tell the reporters", description: message.includes("already_told") ? "This item was told already. Nobody was messaged twice." : message });
    } finally {
      setTelling(false);
    }
  }

  const reporters = (signal.sources || []).filter((source) => source.source_kind === "support_ticket").map((source) => ticketsById[source.source_id]).filter(Boolean);
  const linkedIdeas = (signal.sources || []).filter((source) => source.source_kind === "community_idea");
  const linkedIdeaIds = new Set(linkedIdeas.map((source) => source.source_id));
  const productWork = signal.signal_kind === "bug" || signal.signal_kind === "feature";
  const triage = signal.state === "new" || signal.state === "triaged";
  const index = stageIndex(signal.state);
  const done = signal.item?.board_status === "Done";

  return (
    <aside aria-label={`Product item: ${signal.title}`} className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] lg:max-h-[calc(100vh-180px)]">
      <div className="border-b border-[var(--gray-200)] p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={signal.signal_kind === "bug" ? "error" : "brand"}>{signalTypeLabel(signal.signal_kind)}</Badge>
              <Badge variant="info">{STAGE_LABEL[signal.state] || signal.state}</Badge>
              <span className="text-xs text-[var(--color-text-secondary)]">{signal.affected_people} reporter{signal.affected_people === 1 ? "" : "s"}</span>
            </div>
            <h3 className="mt-1.5 text-base font-semibold text-[var(--color-text-primary)]">{signal.title}</h3>
          </div>
          <Button size="sm" variant="ghost" icon={X} onClick={onClose} aria-label="Close item" />
        </div>
        {signal.state !== "wont_do" && (
          <div className="mt-3 grid grid-cols-5 gap-1" aria-label={`Stage ${index} of 5`}>
            {BOARD_COLUMNS.map((column, i) => (
              <div key={column.id}>
                <span className={`block h-1.5 rounded-full ${i < index ? "bg-[var(--color-brand-500)]" : "bg-[var(--gray-200)]"}`} />
                <span className="mt-1 block text-[10px] text-[var(--color-text-tertiary)]">{column.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Step title="Private, never sent to GitHub" hint="Who reported it and what they said. Names, money and private details stay here.">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{signal.problem_statement}</p>
          {reporters.length > 0 && (
            <ul className="space-y-1 text-sm">
              {reporters.map((ticket) => (
                <li key={ticket.id}><a className="text-[var(--color-brand-600)] underline-offset-2 hover:underline" href={`#/support?ticket=${encodeURIComponent(ticket.id)}`}>{reporterLine(ticket)}</a></li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {linkedIdeas.map((source) => (
              <Badge key={source.source_id} variant="outline">Idea: {ideasById[source.source_id]?.title || "Community idea"} · +{ideasById[source.source_id]?.vote_count ?? 0} votes</Badge>
            ))}
            {signal.state !== "told" && signal.state !== "wont_do" && (
              <Button size="sm" variant="ghost" onClick={() => setIdeaOpen(true)}>Link a Community idea</Button>
            )}
          </div>
        </Step>

        {triage && !productWork && (
          <Step title="Triage" hint="Questions and account help don't go to GitHub.">
            <p className="text-sm text-[var(--color-text-secondary)]">Answer the reporter in their ticket. When nothing more is needed here, mark it Won't do with a reason.</p>
          </Step>
        )}

        {triage && productWork && (
          <Step title="Triage: public wording, existing issue first" hint={`Revision ${signal.review?.revision || 0}. Only this wording can cross into the public GitHub repo.`}>
            <Input label="Public issue title" value={review.publicTitle} onChange={(event) => setReview({ ...review, publicTitle: event.target.value })} />
            <Textarea label="Public problem" value={review.publicProblem} onChange={(event) => setReview({ ...review, publicProblem: event.target.value })} />
            <Textarea label="Public intended outcome" value={review.publicOutcome} onChange={(event) => setReview({ ...review, publicOutcome: event.target.value })} />
            <Textarea label="Acceptance criteria · one per line" value={review.acceptanceCriteria} onChange={(event) => setReview({ ...review, acceptanceCriteria: event.target.value })} />
            <details className="rounded-lg bg-[var(--gray-50)] p-3">
              <summary className="cursor-pointer text-sm font-medium text-[var(--color-text-primary)]">Board fields</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <SelectField label="Product" value={review.product} onChange={(value) => setReview({ ...review, product: value })} options={PRODUCTS} />
                <SelectField label="Theme" value={review.theme} onChange={(value) => setReview({ ...review, theme: value })} options={THEMES} />
                <SelectField label="Priority" value={review.priority} onChange={(value) => setReview({ ...review, priority: value })} options={PRIORITIES} />
                <SelectField label="Estimate" value={review.estimate} onChange={(value) => setReview({ ...review, estimate: value })} options={ESTIMATES} />
                <SelectField label="Horizon" value={review.horizon} onChange={(value) => setReview({ ...review, horizon: value })} options={HORIZONS} />
                <SelectField label="Quarter" value={review.quarter} onChange={(value) => setReview({ ...review, quarter: value })} options={QUARTERS} />
              </div>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={busy} onClick={() => void act("Public wording saved · Triaged", () => savePublicProductReview(signal.id, review, signal.review?.revision || 0))}>Save public wording</Button>
              <Button size="sm" variant="secondary" disabled={busy || !signal.review} onClick={() => void act("Searched the Avengers board", () => runProductAvengersCommand(signal.id, "search"))}>Search existing issues</Button>
            </div>
            {!signal.review && <p className="text-xs text-[var(--color-text-tertiary)]">Save the public wording first; the search uses only that wording.</p>}

            {signal.review && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">Existing issues on the Avengers board</p>
                {(signal.candidates || []).length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">Run the search. If nothing fits, say why before creating a new issue.</p>
                ) : signal.candidates.map((candidate) => (
                  <div key={candidate.issue_number} className="space-y-2 rounded-lg border border-[var(--gray-200)] p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <a href={candidate.issue_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-[var(--color-brand-600)] hover:underline">#{candidate.issue_number} · {candidate.issue_title}</a>
                        <div className="mt-1 flex gap-2"><Badge>{candidate.issue_state}</Badge><Badge variant={candidate.decision === "selected" ? "success" : "default"}>{candidate.decision === "selected" ? "chosen" : candidate.decision}</Badge></div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act("Issue chosen", () => recordCandidateDecision(signal.id, candidate.issue_number, "selected"))}>Choose</Button>
                        <Button size="sm" disabled={busy || candidate.decision !== "selected"} onClick={() => void act(`Linked to #${candidate.issue_number} · Planned`, () => runProductAvengersCommand(signal.id, "link_existing", { issue_number: candidate.issue_number }))}>Link to #{candidate.issue_number} → Planned</Button>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <Input label="Why this issue doesn't fit" value={candidateReasons[candidate.issue_number] || ""} onChange={(event) => setCandidateReasons({ ...candidateReasons, [candidate.issue_number]: event.target.value })} />
                      <Button size="sm" variant="secondary" disabled={busy || (candidateReasons[candidate.issue_number] || "").trim().length < 10} onClick={() => void act("Marked not a fit", () => recordCandidateDecision(signal.id, candidate.issue_number, "not_fit", candidateReasons[candidate.issue_number]))}>Not a fit</Button>
                    </div>
                  </div>
                ))}
                <Textarea label="Why none of these fits" value={noFitReason} onChange={(event) => setNoFitReason(event.target.value)} helper="Needed before creating a new issue; at least 20 characters." />
                <Button size="sm" disabled={busy || !signal.review?.candidates_checked_at || noFitReason.trim().length < 20 || (signal.candidates || []).some((c) => c.decision !== "not_fit")} onClick={() => void act("New Avengers issue created · Planned", async () => {
                  await saveNoFitReason(signal.id, noFitReason);
                  await runProductAvengersCommand(signal.id, "create_issue");
                })}>Confirm no fit and create the issue</Button>
              </div>
            )}
          </Step>
        )}

        {signal.item && (signal.state === "planned" || signal.state === "shipped" || signal.state === "told") && (
          <Step title={`GitHub · #${signal.item.issue_number}`} hint="Copied from the Avengers board. Support sees this on every linked ticket.">
            <div className="grid gap-2 sm:grid-cols-2">
              {[["Engineering", engineering || signal.item.board_status || "Todo"], ["Customer", signal.item.customer_status], ["Horizon", signal.item.board_horizon || "Unassigned"], ["Synced", signal.item.sync_state]].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-[var(--gray-50)] p-2.5"><p className="text-xs text-[var(--color-text-tertiary)]">{label}</p><p className="mt-0.5 text-sm font-semibold text-[var(--color-text-primary)]">{value}</p></div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={signal.item.issue_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand-600)] hover:underline">Open issue <ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act("Refreshed from the Avengers board", () => runProductAvengersCommand(signal.id, "refresh"))}>Refresh from GitHub</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act("Board fields updated", () => runProductAvengersCommand(signal.id, "update_board"))}>Update board fields</Button>
              {signal.state === "planned" && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("Back to Triaged", () => updateProductSignal({
                  signalId: signal.id,
                  expectedRevision: signal.revision,
                  state: "triaged",
                  priority: signal.priority,
                  nextUpdateAt: Date.parse(signal.next_update_at || 0) > Date.now() + 15 * 60 * 1000 ? signal.next_update_at : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                  nextStep: signal.next_step || "Product triages this item again.",
                  customerReplyDraft: signal.customer_reply_draft || "We're looking at this again.",
                }))}>Wrong issue? Back to Triaged</Button>
              )}
            </div>
            <div className="space-y-2 border-t border-[var(--gray-200)] pt-3">
              <Input label="Roadmap title" value={roadmapTitle} onChange={(event) => setRoadmapTitle(event.target.value)} />
              <Textarea label="Roadmap description" value={roadmapBody} onChange={(event) => setRoadmapBody(event.target.value)} />
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act("Roadmap draft saved", () => saveRoadmapWording(signal.id, roadmapTitle, roadmapBody))}>Save Roadmap draft</Button>
            </div>
          </Step>
        )}

        {signal.state === "planned" && (
          <Step title="Verify live" hint="GitHub saying Done isn't enough on its own. Paste the release record that proves it's live.">
            {done ? (
              <>
                <Input label="Release record link" value={releaseEvidence} onChange={(event) => setReleaseEvidence(event.target.value)} placeholder="https://github.com/Mingla-LLC/mingla-main/issues/…#issuecomment-…" />
                <Button size="sm" disabled={busy || !releaseEvidence.trim()} onClick={() => void act("Verified live · Shipped", () => verifyProductRelease(signal.id, releaseEvidence.trim()))}>Mark Shipped</Button>
              </>
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">Waiting for GitHub to say Done. Refresh from GitHub to check.</p>
            )}
          </Step>
        )}

        {(signal.state === "shipped" || signal.state === "told") && (
          <Step title="Tell reporters" hint="Your decision D2: an admin approves the wording and sends it once.">
            {signal.state === "told" || sentOnce ? (
              <p className="text-sm text-[var(--color-text-secondary)]">
                Told {signal.told_ticket_count ?? tell.recipients.length} {(signal.told_ticket_count ?? tell.recipients.length) === 1 ? "person" : "people"}{signal.told_at ? ` on ${new Date(signal.told_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}. This can only be sent once.
              </p>
            ) : (
              <>
                <Textarea
                  label="Message (draft written for you, edit freely)"
                  value={draftBody}
                  onChange={(event) => setDraftBody(event.target.value)}
                  disabled={!tell.draft || tell.draft.state !== "draft" || telling}
                  helper={tell.draft?.state === "product_approved" ? "Approved already; it goes out exactly as written." : "At least 20 characters."}
                />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">Goes to {tell.recipients.length} {tell.recipients.length === 1 ? "person" : "people"}, in their ticket thread with a push</p>
                  {tell.recipients.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-sm text-[var(--color-text-secondary)]">
                      {tell.recipients.map((ticket) => <li key={ticket.id}>{reporterLine(ticket)}</li>)}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">No customer-visible ticket is linked. Sending marks the item Told without messaging anyone.</p>
                  )}
                  <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Each ticket is marked Resolved. This can only be sent once.{linkedIdeas.length ? " Idea voters get the existing shipped notification." : ""}</p>
                </div>
                {!tell.canSend && tell.reason && <p className="text-xs text-[var(--color-warning-700)]">{tell.reason}</p>}
                <div className="flex flex-wrap justify-end gap-2">
                  {tell.draft?.state === "draft" && (
                    <Button size="sm" variant="secondary" disabled={busy || telling || draftBody.trim().length < 20} onClick={() => void act("Wording approved", () => approveCustomerDraft(tell.draft.id, draftBody))}>Approve wording</Button>
                  )}
                  <Button size="sm" loading={telling} disabled={!tell.canSend || busy || (tell.draft?.state === "draft" && draftBody.trim().length < 20)} onClick={() => void sendTell()}>
                    {tellButtonLabel(tell.recipients.length)}
                  </Button>
                </div>
              </>
            )}
          </Step>
        )}

        {signal.state === "wont_do" && (
          <Step title="Won't do" hint="The reason is written for reporters.">
            <p className="text-sm text-[var(--color-text-secondary)]">{signal.wont_do_reason}</p>
          </Step>
        )}

        {signal.state !== "told" && signal.state !== "wont_do" && (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setWontDoReason(""); setWontDoOpen(true); }}>Won't do…</Button>
          </div>
        )}
      </div>

      <Modal open={wontDoOpen} onClose={() => setWontDoOpen(false)} title="Won't do" size="sm">
        <ModalBody>
          <Textarea label="Reason, written for reporters" value={wontDoReason} onChange={(event) => setWontDoReason(event.target.value)} placeholder="We've decided not to change this because…" helper="3 to 1,000 characters." />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setWontDoOpen(false)} disabled={busy}>Back</Button>
          <Button variant="danger" loading={busy} disabled={busy || wontDoReason.trim().length < 3} onClick={() => void act("Marked Won't do", async () => {
            await setProductWontDo(signal.id, signal.revision, wontDoReason.trim());
            setWontDoOpen(false);
          })}>Mark Won't do</Button>
        </ModalFooter>
      </Modal>

      <LinkIdeaModal
        open={ideaOpen}
        ideas={ideas}
        linkedIds={linkedIdeaIds}
        onClose={() => setIdeaOpen(false)}
        onLink={(idea) => act(`Idea linked · +${idea.vote_count ?? 0} votes`, async () => {
          await linkSourceToProductSignal({ signalId: signal.id, expectedRevision: signal.revision, sourceKind: "community_idea", sourceId: idea.id });
          setIdeaOpen(false);
        })}
      />
    </aside>
  );
}
