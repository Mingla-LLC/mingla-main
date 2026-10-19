// Issue #3980 — "Plan this launch" in the Calendar's event panel. It asks the
// server for the launch kit cards of this event (nothing is written), shows
// them inline with the steps it skipped and why, and adds them through the
// same checked add as every other card. Inline, no overlay.
import { useState } from "react";
import { Button } from "../ui/Button";
import { useToast } from "../../context/ToastContext";
import { useOpsConfig } from "../../hooks/useOpsConfig";
import * as ops from "../../services/opsService";
import { addResultSummary, dayLabel, kitPlanSummary, kitSkipWords, opsErrorWords, requestKey, todayIso } from "../../lib/opsModel";
import { OpsChip } from "./OpsChip";
import { FixesList } from "./FixesList";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function LaunchPlanner({ anchor, online, onAdded }) {
  const { addToast } = useToast();
  const config = useOpsConfig();
  const [preview, setPreview] = useState(null);
  const [state, setState] = useState("idle");
  const [error, setError] = useState(null);
  const [problems, setProblems] = useState([]);
  const team = Array.isArray(config.data?.team) ? config.data.team : [];
  const nameOf = (email) => team.find((p) => p.email === email)?.name || String(email || "").split("@")[0];

  const plan = async () => {
    setState("loading"); setError(null); setProblems([]);
    try {
      const answer = await ops.previewLaunchKit(anchor.kind, anchor.id, {}, todayIso());
      setPreview(answer);
      setState("preview");
    } catch (e) {
      setError(e); setState("idle");
    }
  };

  const add = async () => {
    const cards = Array.isArray(preview?.cards) ? preview.cards : [];
    if (cards.length === 0) return;
    setState("adding"); setError(null);
    try {
      const answer = await ops.addWork(cards, requestKey("kit"));
      const summary = addResultSummary(answer);
      setProblems(summary.problems);
      if (summary.added > 0) {
        addToast({ variant: "success", title: summary.toast, duration: 8000, action: { label: "Open Work board", onClick: () => { window.location.hash = "#/work-board"; } } });
      }
      setState(summary.problems.length ? "preview" : "done");
      onAdded?.();
    } catch (e) {
      setError(e); setState("preview");
    }
  };

  if (state === "done") return null;
  if (state === "idle" || state === "loading") {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-[13px] text-[var(--color-text-secondary)]">No launch kit cards yet. Plan it and each step lands on the Work board with its owner and due date.</p>
        {error && <p role="alert" className="break-words text-[13px] text-[var(--color-error-700)]">{opsErrorWords(error)}</p>}
        <Button className="min-h-11 self-start" disabled={!online || state === "loading"} onClick={plan}>{state === "loading" ? "Planning…" : "Plan this launch"}</Button>
      </div>
    );
  }

  const cards = Array.isArray(preview?.cards) ? preview.cards : [];
  const skipped = Array.isArray(preview?.skipped) ? preview.skipped : [];
  const summary = kitPlanSummary(preview);
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-3">
      <h4 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{summary.count === 0 ? "Nothing left to add" : `${summary.count} cards to add`}</h4>
      {cards.length > 0 && (
        <ul className="flex min-w-0 flex-col divide-y divide-[var(--gray-200)]">
          {cards.map((c) => (
            <li key={c.kit_step} className="flex min-w-0 items-start gap-2 py-1.5">
              <span className="w-14 shrink-0 text-[12px] tabular-nums text-[var(--color-text-tertiary)]">{dayLabel(c.due_on)}</span>
              <span className="min-w-0 flex-1">
                <span className={`block break-words text-[13px] text-[var(--color-text-primary)] ${c.kind === "gate_live" ? "font-semibold" : ""}`}>{c.title}</span>
                <span className="block break-words text-[12px] text-[var(--color-text-tertiary)]">{(c.owners || []).map(nameOf).join(", ")}</span>
              </span>
              {c.kind === "promo" && summary.promoHeld && <OpsChip tone="warning">Blocked until go-live</OpsChip>}
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Skipped</span>
          <ul className="flex min-w-0 flex-col gap-1">
            {skipped.map((s) => (
              <li key={s.kit_step} className="flex min-w-0 flex-wrap items-start justify-between gap-2 text-[13px]">
                <span className="min-w-0 flex-1 break-words text-[var(--color-text-secondary)]">{s.title}</span>
                <OpsChip>{kitSkipWords(s.reason)}{s.card?.number ? ` (Card ${s.card.number})` : ""}</OpsChip>
              </li>
            ))}
          </ul>
        </div>
      )}
      {problems.length > 0 && (
        <FixesList
          title={`Not added: ${problems.length} ${problems.length === 1 ? "card" : "cards"}`}
          fixes={problems.flatMap((p) => p.messages.map((message) => ({ field: p.title || "card", message })))}
        />
      )}
      {error && <p role="alert" className="break-words text-[13px] text-[var(--color-error-700)]">{opsErrorWords(error)}</p>}
      <p className="text-[12px] text-[var(--color-text-tertiary)]">Host steps go to the host card’s owner, the other steps to you. Owners can be changed on each card.</p>
      <div className="flex flex-wrap gap-2">
        {cards.length > 0 && (
          <Button className="min-h-11" disabled={!online || state === "adding"} onClick={add}>{state === "adding" ? "Adding…" : summary.addLabel}</Button>
        )}
        <button type="button" onClick={() => { setState("idle"); setPreview(null); setProblems([]); }} className={`min-h-11 rounded-lg px-3 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Cancel</button>
      </div>
    </div>
  );
}
