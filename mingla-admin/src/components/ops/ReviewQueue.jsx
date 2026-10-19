// Issue #3980 — To review, Spend or publish: work cards that wait for a
// person to approve money or confirm an event is published. Two columns.
import { useRef, useState } from "react";
import { AlertCard, SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import * as ops from "../../services/opsService";
import { opsErrorWords, proofBadge, runwayLabel, dayLabel, todayIso } from "../../lib/opsModel";
import { useOpsPoll } from "../../hooks/useOpsWork";
import { TwoColumn, revealDetail } from "./TwoColumn";
import { OpsChip } from "./OpsChip";
import { PlanSteps } from "./PlanSteps";
import { PersonActionForm } from "./WorkDetail";

const GROUPS = [
  { reason: "spend", title: "Spend money" },
  { reason: "publish", title: "Publish an event" },
  { reason: "other", title: "Other" },
];
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function ReviewQueue({ selectedId, onSelect, online, onChanged }) {
  const { access } = useAuth();
  const { addToast } = useToast();
  const queue = useOpsPoll(() => ops.listReview(todayIso()), { key: access?.email || "", intervalMs: 30_000 });
  const detailRef = useRef(null);
  const headingRef = useRef(null);
  const [form, setForm] = useState("");
  const [busy, setBusy] = useState(false);
  const cards = queue.data?.cards || [];
  const card = cards.find((c) => c.id === selectedId) || null;

  const act = async (action, note) => {
    if (!card) return;
    setBusy(true);
    try {
      const answer = await ops.personAction(card.id, action, note, card.revision);
      setForm("");
      await queue.refetch({ quiet: true });
      onChanged?.();
      const title = action === "approve_spend" ? "Spend approved" : action === "mark_published" ? "Marked published" : "Sent back to the owner";
      addToast({ variant: "success", title, duration: 8000, action: answer?.event_id ? { label: "Undo", onClick: async () => {
        try { await ops.undoWork(answer.event_id); await queue.refetch({ quiet: true }); onChanged?.(); }
        catch (error) { addToast({ variant: "error", title: "Undo didn’t work", description: opsErrorWords(error) }); }
      } } : undefined });
    } catch (error) {
      if (error?.token === "stale_write") { addToast({ variant: "warning", title: "This card changed. Showing the latest." }); await queue.refetch({ quiet: true }); }
      else addToast({ variant: "error", title: "That didn’t save", description: opsErrorWords(error) });
    } finally {
      setBusy(false);
    }
  };

  if (queue.loading) return <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading what waits for a person"><Skeleton height={64} /><Skeleton height={64} /></div>;
  if (queue.error) return <AlertCard variant="error" title="Couldn’t load what waits for a person" action={<Button variant="secondary" className="min-h-11" onClick={() => queue.refetch()}>Try again</Button>}>{opsErrorWords(queue.error)}</AlertCard>;
  if (cards.length === 0) return <SectionCard><p className="text-[13px] text-[var(--color-text-secondary)]">Nothing waiting for a person.</p></SectionCard>;

  return (
    <TwoColumn
      ref={detailRef}
      detailLabel="Card waiting for a person"
      list={
        <div className="flex min-w-0 flex-col gap-4">
          {GROUPS.map((g) => {
            const rows = cards.filter((c) => c.person_reason === g.reason);
            if (rows.length === 0) return null;
            return (
              <section key={g.reason} aria-labelledby={`review-${g.reason}`} className="min-w-0">
                <h2 id={`review-${g.reason}`} className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{g.title} · {rows.length}</h2>
                <ul className="grid min-w-0 gap-2">
                  {rows.map((c) => (
                    <li key={c.id}>
                      <button type="button" data-review-id={c.id} aria-current={c.id === selectedId ? "true" : undefined} onClick={() => { setForm(""); onSelect(c.id); revealDetail(detailRef, headingRef); }}
                        className={`flex w-full min-w-0 flex-col gap-1 rounded-xl border p-3 text-left ${c.id === selectedId ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--gray-200)] bg-[var(--color-background-primary)] hover:bg-[var(--gray-50)]"} ${FOCUS}`}>
                        <span className="break-words text-[13.5px] font-semibold text-[var(--color-text-primary)]">{c.title}</span>
                        <span className="text-[12px] text-[var(--color-text-tertiary)]">Card {c.number} · due {dayLabel(c.due_on)} · {(c.owners || []).map((o) => o.name).join(", ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      }
      detail={card ? (
        <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)]">
          <button type="button" onClick={() => { onSelect(null); requestAnimationFrame(() => document.querySelector(`[data-review-id="${card.id}"]`)?.focus?.()); }} className={`min-h-11 self-start rounded-lg px-2 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] min-[1180px]:hidden ${FOCUS}`}>Back to list</button>
          <h2 ref={headingRef} tabIndex={-1} className="break-words text-[16px] font-semibold text-[var(--color-text-primary)]">{card.title}</h2>
          {card.anchor && <p className="break-words text-[13px] text-[var(--color-text-secondary)]">{card.anchor.title} · {runwayLabel(card.anchor.runway)}</p>}
          <p className="whitespace-pre-wrap break-words text-[13px] text-[var(--color-text-secondary)]">{card.instructions}</p>
          {card.result && <div><h3 className="text-[12.5px] font-semibold">Result</h3><p className="whitespace-pre-wrap break-words text-[13px] text-[var(--color-text-secondary)]">{card.result}</p></div>}
          <div><h3 className="mb-1 text-[12.5px] font-semibold">Plan</h3><PlanSteps plan={card.plan} editable={false} /></div>
          {(card.proof || []).length > 0 && (
            <ul className="flex flex-col gap-1">{card.proof.map((p, i) => <li key={i} className="flex flex-wrap items-start gap-2 text-[13px]"><OpsChip tone={p.verified ? "success" : "default"}>{proofBadge(p)}</OpsChip><span className="min-w-0 flex-1 break-words">{p.text}</span></li>)}</ul>
          )}
          <div className="flex flex-wrap gap-2">
            {card.person_reason === "spend" && <Button className="min-h-11" disabled={!online || busy} onClick={() => setForm("approve_spend")}>Approve spend</Button>}
            {card.person_reason === "publish" && <Button className="min-h-11" disabled={!online || busy} onClick={() => setForm("mark_published")}>Mark published</Button>}
            <Button variant="secondary" className="min-h-11" disabled={!online || busy} onClick={() => setForm("sendback")}>Send back</Button>
            <a href={`#/work-board?card=${card.id}`} className={`inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`}>Open on the Work board</a>
          </div>
          {form && <PersonActionForm kind={form} busy={busy} disabled={!online} onCancel={() => setForm("")} onSubmit={(note) => act(form === "sendback" ? "send_back" : form, note)} />}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--gray-300)] p-4 text-[13px] text-[var(--color-text-tertiary)]">Pick a card to see what it needs.</div>
      )}
    />
  );
}
