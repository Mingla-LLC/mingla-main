// Issue #4420 (step 4) — "Send to GitHub" on a ticket (spec section 8). The
// same review, search, link or create, refresh steps the Product board had,
// keyed by the ticket's backing Product signal (made the first time it is
// sent), through the unchanged product-avengers-sync function. Only the public
// wording written here crosses into the public repository. The linked issue is
// also written to the card's own GitHub list (issue_4420_ticket_github_mirror).
//
//   task ticket      uses the card's own GitHub field (no section)
//   not an operator  the section shows, the button is off, with the reason
//   operator         can send
import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input, Textarea } from "../ui/Input";
import { useToast } from "../../context/ToastContext";
import * as ops from "../../services/opsService";
import {
  getProductSignalWorkspace,
  recordCandidateDecision,
  runProductAvengersCommand,
  saveNoFitReason,
  savePublicProductReview,
} from "../../services/productAvengersService";
import { opsErrorWords } from "../../lib/opsModel";
import { githubSectionState } from "../../lib/ticketModel";

const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";
const PRODUCTS = ["Business", "Explorer", "Both", "Platform"];
const THEMES = ["Discovery & Deck", "Social Graph", "Payments", "Business Tooling", "Growth & Activation", "Trust & Safety", "Platform Health", "Place Intelligence"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];
const ESTIMATES = ["1", "2", "3", "5", "8", "13"];
const HORIZONS = ["Now", "Next", "Later"];
const QUARTERS = ["Q4 2026", "Q1 2027", "Q2 2027", "Q3 2027", "Q4 2027"];

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block text-[13px] font-medium text-[var(--color-text-primary)]">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function initialReview(card, review) {
  const text = card.description ?? card.instructions ?? "";
  return {
    publicTitle: review?.public_title || card.title || "",
    publicProblem: review?.public_problem_statement || text,
    publicOutcome: review?.public_outcome || "",
    acceptanceCriteria: (review?.public_acceptance_criteria || [""]).join("\n"),
    product: review?.board_product || "Both",
    theme: review?.board_theme || "Business Tooling",
    priority: review?.board_priority || "P2",
    estimate: review?.board_estimate || "3",
    horizon: review?.board_horizon || "Next",
    quarter: review?.board_quarter || "Q4 2026",
  };
}

/** The review, search and link steps for a ticket that already has its backing signal. */
function Workflow({ card, signalId, disabled, onChanged }) {
  const { addToast } = useToast();
  const [ws, setWs] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [noFit, setNoFit] = useState("");
  const [reasons, setReasons] = useState({});
  const load = useCallback(async () => {
    try {
      const data = await getProductSignalWorkspace(signalId);
      setWs(data);
      setError(null);
      setReview((prev) => prev || initialReview(card, data.review));
      setNoFit((prev) => prev || data.review?.no_fit_reason || "");
    } catch (e) {
      setError(e);
    }
  }, [signalId, card]);
  useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect

  const act = async (title, action, { mirror = false } = {}) => {
    setBusy(true);
    try {
      await action();
      if (mirror) await ops.mirrorTicketGithub(card.id);
      addToast({ variant: "success", title });
      await load();
      if (mirror) await onChanged?.();
    } catch (e) {
      addToast({ variant: "error", title: "That didn’t finish", description: e?.token ? opsErrorWords(e) : e?.message });
    } finally {
      setBusy(false);
    }
  };

  if (error && !ws) return <p role="alert" className="text-[13px] text-[var(--color-error-700)]">{error.message || "Couldn’t load the GitHub state."} <button type="button" onClick={load} className="font-semibold underline">Try again</button></p>;
  if (!ws || !review) return <p className="text-[13px] text-[var(--color-text-tertiary)]">Loading…</p>;
  const item = ws.item;
  const revision = ws.review?.revision || 0;
  const off = disabled || busy;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {item ? (
        <div className="flex min-w-0 flex-col gap-2 rounded-lg bg-[var(--gray-50)] p-3">
          <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">Linked to GitHub issue #{item.issue_number}</p>
          <div className="flex flex-wrap items-center gap-2">
            {item.issue_url && <a href={item.issue_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-brand-700)] hover:underline">Open issue <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></a>}
            <Button size="sm" variant="secondary" disabled={off} onClick={() => act("Refreshed from GitHub", () => runProductAvengersCommand(signalId, "refresh"), { mirror: true })}>Refresh from GitHub</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[12.5px] text-[var(--color-text-tertiary)]">Only the public wording below can reach the public GitHub repository. Names and private details stay on the ticket.</p>
          <Input label="Public issue title" value={review.publicTitle} onChange={(e) => setReview({ ...review, publicTitle: e.target.value })} />
          <Textarea label="Public problem" value={review.publicProblem} onChange={(e) => setReview({ ...review, publicProblem: e.target.value })} />
          <Textarea label="Public intended outcome" value={review.publicOutcome} onChange={(e) => setReview({ ...review, publicOutcome: e.target.value })} />
          <Textarea label="Acceptance criteria · one per line" value={review.acceptanceCriteria} onChange={(e) => setReview({ ...review, acceptanceCriteria: e.target.value })} />
          <details className="rounded-lg bg-[var(--gray-50)] p-3">
            <summary className="cursor-pointer text-[13px] font-medium text-[var(--color-text-primary)]">Board fields</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SelectField label="Product" value={review.product} onChange={(v) => setReview({ ...review, product: v })} options={PRODUCTS} />
              <SelectField label="Theme" value={review.theme} onChange={(v) => setReview({ ...review, theme: v })} options={THEMES} />
              <SelectField label="Priority" value={review.priority} onChange={(v) => setReview({ ...review, priority: v })} options={PRIORITIES} />
              <SelectField label="Estimate" value={review.estimate} onChange={(v) => setReview({ ...review, estimate: v })} options={ESTIMATES} />
              <SelectField label="Horizon" value={review.horizon} onChange={(v) => setReview({ ...review, horizon: v })} options={HORIZONS} />
              <SelectField label="Quarter" value={review.quarter} onChange={(v) => setReview({ ...review, quarter: v })} options={QUARTERS} />
            </div>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} disabled={disabled} onClick={() => act("Public wording saved", () => savePublicProductReview(signalId, review, revision))}>Save public wording</Button>
            <Button size="sm" variant="secondary" disabled={off || !ws.review} onClick={() => act("Searched the Avengers board", () => runProductAvengersCommand(signalId, "search"))}>Search existing issues</Button>
          </div>
          {!ws.review && <p className="text-[12px] text-[var(--color-text-tertiary)]">Save the public wording first; the search uses only that wording.</p>}
          {ws.review && (
            <div className="flex min-w-0 flex-col gap-3">
              <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">Existing issues on the Avengers board</p>
              {ws.candidates.length === 0 ? <p className="text-[13px] text-[var(--color-text-secondary)]">Run the search. If nothing fits, say why before creating a new issue.</p> : ws.candidates.map((c) => (
                <div key={c.issue_number} className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--gray-200)] p-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <a href={c.issue_url} target="_blank" rel="noreferrer" className="break-words text-[13px] font-semibold text-[var(--color-brand-700)] hover:underline">#{c.issue_number} · {c.issue_title}</a>
                      <span className="mt-1 flex gap-2"><Badge>{c.issue_state}</Badge><Badge variant={c.decision === "selected" ? "success" : "default"}>{c.decision === "selected" ? "chosen" : c.decision}</Badge></span>
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" disabled={off} onClick={() => act("Issue chosen", () => recordCandidateDecision(signalId, c.issue_number, "selected"))}>Choose</Button>
                      <Button size="sm" disabled={off || c.decision !== "selected"} onClick={() => act(`Linked to #${c.issue_number}`, () => runProductAvengersCommand(signalId, "link_existing", { issue_number: c.issue_number }), { mirror: true })}>Link to #{c.issue_number}</Button>
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <Input label="Why this issue doesn’t fit" value={reasons[c.issue_number] ?? c.decision_reason ?? ""} onChange={(e) => setReasons({ ...reasons, [c.issue_number]: e.target.value })} />
                    <Button size="sm" variant="secondary" disabled={off || (reasons[c.issue_number] ?? c.decision_reason ?? "").trim().length < 10} onClick={() => act("Marked not a fit", () => recordCandidateDecision(signalId, c.issue_number, "not_fit", reasons[c.issue_number] ?? c.decision_reason))}>Not a fit</Button>
                  </div>
                </div>
              ))}
              <Textarea label="Why none of these fits" value={noFit} onChange={(e) => setNoFit(e.target.value)} helper="Needed before creating a new issue; at least 20 characters." />
              <Button size="sm" disabled={off || !ws.review?.candidates_checked_at || noFit.trim().length < 20 || ws.candidates.some((c) => c.decision !== "not_fit")}
                onClick={() => act("New Avengers issue created", async () => { await saveNoFitReason(signalId, noFit); await runProductAvengersCommand(signalId, "create_issue"); }, { mirror: true })}>Confirm no fit and create the issue</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The GitHub section of a ticket. `isOperator` is whether this person is a
 * product operator (owner, admin or partner; the server checks it again).
 */
export function TicketGithubSection({ card, isOperator, disabled = false, onChanged }) {
  const { addToast } = useToast();
  const state = githubSectionState(card, { isOperator });
  const [busy, setBusy] = useState(false);
  if (state.mode === "none") return null;
  const signalId = card.ticket?.source_signal_id || null;
  const send = async () => {
    setBusy(true);
    try {
      await ops.ensureTicketSignal(card.id);
      await onChanged?.();
    } catch (error) {
      addToast({ variant: "error", title: "Couldn’t start Send to GitHub", description: opsErrorWords(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="GitHub" data-ticket-github="" className="flex min-w-0 flex-col gap-2">
      <h3 className={LABEL}>GitHub</h3>
      {state.mode === "task" ? (
        <p className="text-[12.5px] text-[var(--color-text-tertiary)]">{state.words}</p>
      ) : state.mode === "locked" ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Button variant="secondary" className="min-h-11 self-start" disabled aria-describedby={`gh-locked-${card.id}`}>Send to GitHub</Button>
          <p id={`gh-locked-${card.id}`} className="text-[12.5px] text-[var(--color-text-tertiary)]">{state.words}</p>
        </div>
      ) : signalId ? (
        <Workflow card={card} signalId={signalId} disabled={disabled || card.status === "done"} onChanged={onChanged} />
      ) : (
        <Button className="min-h-11 self-start" loading={busy} disabled={disabled || busy || card.status === "done"} onClick={send}>Send to GitHub</Button>
      )}
    </section>
  );
}
