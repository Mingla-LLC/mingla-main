// Issue #3980 — the right column of the Work board: one card, live. Changes
// save as they are made; most offer Undo for a few seconds.
import { useEffect, useRef, useState } from "react";
import { Copy, Link2, X } from "lucide-react";
import { AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../../context/ToastContext";
import { useOpsCard } from "../../hooks/useOpsCard";
import * as ops from "../../services/opsService";
import {
  PERSON_ACTIONS,
  PERSON_REASONS,
  WORK_STATUSES,
  addDays,
  agentName,
  agentPromptFor,
  closeKindLabel,
  dayLabel,
  mondayOf,
  opsErrorWords,
  proofBadge,
  requestKey,
  runwayLabel,
  sprintLabel,
  todayIso,
} from "../../lib/opsModel";
import { OpsChip } from "./OpsChip";
import { PeoplePicker } from "./PeoplePicker";
import { RecordPicker } from "./RecordPicker";
import { PlanSteps } from "./PlanSteps";
import { ProofForm } from "./ProofForm";
import { PushBackForm } from "./PushBackForm";
import { CardHistory } from "./CardHistory";
import { NoteBox } from "./NoteBox";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const INPUT = `min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] text-[var(--color-text-primary)] disabled:opacity-60 ${FOCUS}`;
// Done means wraps to show its whole text (it is one line to the server).
const DONE_MEANS_CLASS = "min-h-[56px] w-full resize-y whitespace-pre-wrap break-words rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-2 text-[13px] text-[var(--color-text-primary)] disabled:opacity-60";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";

function Section({ title, children, action }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--gray-200)] pt-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold text-[var(--color-text-primary)]">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function statusTone(card) {
  if (card.status === "done") return "success";
  if (card.status === "person") return "warning";
  if (card.status === "doing") return "brand";
  return "default";
}

export function WorkDetail({ cardId, config, online, onChanged, headingRef, onBack }) {
  const { addToast } = useToast();
  const read = useOpsCard(cardId);
  const card = read.data?.card || null;
  const team = config?.team || [];
  const me = config?.me || {};
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState("");
  const [linking, setLinking] = useState(false);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [doneMeans, setDoneMeans] = useState("");
  const [result, setResult] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [removeReason, setRemoveReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [saveState, setSaveState] = useState("");
  const idle = useRef(null);

  useEffect(() => {
    setTitle(card?.title || "");
    setInstructions(card?.instructions || "");
    setDoneMeans(card?.done_means || "");
    setResult(card?.result || "");
  }, [card?.id, card?.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setForm(""); setLinking(false); setSaveState(""); }, [cardId]);
  useEffect(() => () => clearTimeout(idle.current), []);

  const locked = !online || !card || card.archived;
  const refresh = async () => { await read.refetch({ quiet: true }); onChanged?.(); };

  const offerUndo = (answer, titleText) => {
    if (!answer?.event_id) { addToast({ variant: "success", title: titleText }); return; }
    addToast({ variant: "success", title: titleText, duration: 8000, action: { label: "Undo", onClick: async () => {
      try { await ops.undoWork(answer.event_id); await refresh(); addToast({ variant: "success", title: "Undone." }); }
      catch (error) { addToast({ variant: "error", title: "Undo didn’t work", description: opsErrorWords(error) }); }
    } } });
  };

  const run = async (label, task, success) => {
    if (!card) return null;
    setBusy(label);
    try {
      const answer = await task();
      await refresh();
      if (success) offerUndo(answer, typeof success === "function" ? success(answer) : success);
      return answer;
    } catch (error) {
      if (error?.token === "stale_write") { addToast({ variant: "warning", title: "This card changed. Showing the latest." }); await refresh(); }
      else addToast({ variant: "error", title: "That didn’t save", description: opsErrorWords(error) });
      return null;
    } finally {
      setBusy("");
    }
  };

  const update = (changes, success) => run("save", () => ops.updateWork(card.id, changes, card.revision), success);

  const saveText = async (field, value, current) => {
    if (!card || (value || "").trim() === (current || "").trim()) return;
    setSaveState("Saving…");
    const answer = await update({ [field]: value });
    setSaveState(answer ? "Saved" : "");
  };

  if (!cardId) return null;
  if (read.loading) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4" aria-busy="true" aria-label="Loading the card">
        <Skeleton height={20} /><Skeleton height={64} /><Skeleton height={120} />
      </div>
    );
  }
  if (read.error) {
    const missing = read.error.token === "not_found";
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4">
        <h2 ref={headingRef} tabIndex={-1} className="text-[15px] font-semibold text-[var(--color-text-primary)]">{missing ? "That card isn’t here." : "Couldn’t load this card"}</h2>
        {!missing && <p className="text-[13px] text-[var(--color-text-secondary)]">{opsErrorWords(read.error)}</p>}
        <div className="flex flex-wrap gap-2">
          {!missing && <Button variant="secondary" className="min-h-11" onClick={() => read.refetch()}>Try again</Button>}
          <Button variant="secondary" className="min-h-11" onClick={onBack}>Back to the board</Button>
        </div>
      </div>
    );
  }
  if (!card) return null;

  const owners = card.owners || [];
  const watchers = card.watchers || [];
  const ownerEmails = owners.map((p) => p.email);
  const watcherEmails = watchers.map((p) => p.email);
  const nameOf = (email) => team.find((p) => p.email === email)?.name || email;
  const systemBlock = card.blocked && card.blocked_kind !== "manual";
  const today = todayIso();
  const thisWeek = mondayOf(today);
  const weeks = Array.from(new Set([card.sprint?.starts_on, ...[0, 7, 14, 21, 28].map((d) => addDays(thisWeek, d))].filter(Boolean))).sort();
  const action = PERSON_ACTIONS[card.person_reason];
  const statusLabel = WORK_STATUSES.find((s) => s.value === card.status)?.label || card.status;

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <button type="button" onClick={onBack} className={`min-h-11 rounded-lg px-2 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] min-[1180px]:hidden ${FOCUS}`}>Back to list</button>
        <OpsChip tone={statusTone(card)}>{card.status === "done" ? closeKindLabel(card.close_kind) : statusLabel}{card.status === "person" ? ` · ${PERSON_REASONS[card.person_reason] || ""}` : ""}</OpsChip>
        {card.blocked && <OpsChip tone="error">Blocked</OpsChip>}
        <span className="text-[12px] text-[var(--color-text-tertiary)]">Card {card.number} · Added by {agentName(card.created_by_name, card.created_via)}</span>
        {saveState && <span role="status" className="ml-auto text-[12px] text-[var(--color-text-tertiary)]">{saveState}</span>}
      </div>
      {card.archived && <AlertCard variant="warning" title="This card was removed.">It is kept for the record and can’t be changed.</AlertCard>}

      <label className="flex min-w-0 flex-col gap-1">
        <span className="sr-only">Title</span>
        <input
          ref={headingRef}
          value={title}
          maxLength={160}
          disabled={locked || card.status === "done"}
          aria-label="Title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => saveText("title", title, card.title)}
          className={`min-h-11 w-full rounded-lg border border-transparent bg-transparent px-1 text-[16px] font-semibold text-[var(--color-text-primary)] hover:border-[var(--gray-200)] disabled:opacity-100 ${FOCUS}`}
        />
      </label>

      {card.claim && (
        <AlertCard variant="info">{agentName(card.claim.holder_name, card.claim.holder_via)} is working on this card. The claim ends at {new Date(card.claim.ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} unless it posts an update.</AlertCard>
      )}
      {card.anchor && (
        <p className="break-words text-[13px] text-[var(--color-text-secondary)]">
          Counted from <span className="font-semibold text-[var(--color-text-primary)]">{card.anchor.title}</span>
          {card.anchor.start_on ? ` · ${dayLabel(card.anchor.start_on)}` : ""} · {runwayLabel(card.anchor.runway)}
        </p>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <PeoplePicker
          label="Owners"
          people={owners}
          team={team}
          exclude={watcherEmails}
          disabled={locked || card.status === "done" || !!busy}
          onAdd={(email) => update({ owners: [...ownerEmails, email] }, `${nameOf(email)} added and told.`)}
          onRemove={(email) => {
            if (ownerEmails.length <= 1) { addToast({ variant: "warning", title: "A card needs at least one owner." }); return; }
            update({ owners: ownerEmails.filter((e) => e !== email) }, `${nameOf(email)} removed.`);
          }}
        />
        <PeoplePicker
          label="Watching"
          people={watchers}
          team={team}
          exclude={ownerEmails}
          disabled={locked || card.status === "done" || !!busy}
          onAdd={(email) => update({ watchers: [...watcherEmails, email] }, `${nameOf(email)} added and told.`)}
          onRemove={(email) => update({ watchers: watcherEmails.filter((e) => e !== email) }, `${nameOf(email)} removed.`)}
        />
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>Due{card.kit_step !== null && card.kit_step !== undefined ? ` · T${card.kit_step > 0 ? "+" : ""}${card.kit_step}` : ""}</span>
          <input type="date" value={card.due_on || ""} disabled={locked || card.status === "done"} onChange={(e) => { if (e.target.value) update({ due_on: e.target.value }, "Due date changed"); }} className={INPUT} />
          {card.overdue && <span className="text-[12px] font-semibold text-[var(--color-error-700)]">Overdue</span>}
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>Sprint</span>
          <select value={card.sprint?.starts_on || ""} disabled={locked || card.status === "done"} onChange={(e) => update({ week: e.target.value }, "Moved to another sprint")} className={INPUT}>
            {weeks.map((w) => <option key={w} value={w}>{sprintLabel(w)}{w === thisWeek ? " (this week)" : ""}</option>)}
          </select>
        </label>
      </div>

      <Section title="Linked records" action={!linking && <button type="button" disabled={locked || card.status === "done"} onClick={() => setLinking(true)} className={`inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] disabled:opacity-50 ${FOCUS}`}><Link2 aria-hidden="true" className="h-3.5 w-3.5" /> Link</button>}>
        {(card.links || []).length === 0 ? <p className="text-[13px] text-[var(--color-text-tertiary)]">Nothing linked.</p> : (
          <ul className="flex min-w-0 flex-wrap gap-1.5">
            {card.links.map((l) => (
              <li key={`${l.kind}:${l.id}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--gray-100)] py-0.5 pl-2.5 pr-0.5 text-[13px]">
                <span className="min-w-0 break-words"><span className="text-[var(--color-text-tertiary)]">{l.kind}: </span>{l.label}{l.exists ? "" : " (removed)"}</span>
                <button type="button" aria-label={`Unlink ${l.label}`} disabled={locked || card.status === "done"} onClick={() => update({ links: card.links.filter((x) => !(x.kind === l.kind && x.id === l.id)).map((x) => ({ kind: x.kind, id: x.id })) }, `${l.label} unlinked`)} className={`inline-grid min-h-8 min-w-8 place-items-center rounded-full hover:bg-[var(--gray-200)] disabled:opacity-50 ${FOCUS}`}><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        {linking && (
          <RecordPicker
            onClose={() => setLinking(false)}
            onPick={async (pick) => {
              const answer = await update({ links: [...(card.links || []).map((x) => ({ kind: x.kind, id: x.id })), { kind: pick.kind, id: pick.id }] }, `${pick.label} linked`);
              if (answer) setLinking(false);
            }}
          />
        )}
      </Section>

      <Section title="Instructions">
        <textarea
          value={instructions}
          maxLength={4000}
          disabled={locked || card.status === "done"}
          aria-label="Instructions"
          onChange={(e) => {
            const value = e.target.value;
            setInstructions(value);
            clearTimeout(idle.current);
            idle.current = setTimeout(() => saveText("instructions", value, card.instructions), 1500);
          }}
          onBlur={() => { clearTimeout(idle.current); saveText("instructions", instructions, card.instructions); }}
          className={`min-h-[96px] w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-2 text-[13px] ${FOCUS}`}
        />
      </Section>

      <Section title="Done means">
        <textarea value={doneMeans} maxLength={300} rows={2} disabled={locked || card.status === "done"} aria-label="Done means" onChange={(e) => setDoneMeans(e.target.value)} onBlur={() => saveText("done_means", doneMeans, card.done_means)} className={`${DONE_MEANS_CLASS} ${FOCUS}`} />
        {card.kind === "gate_live" && <p className="text-[12px] text-[var(--color-text-tertiary)]">Closes itself the moment the event goes public.</p>}
      </Section>

      {card.status !== "done" && (
        <Section title="Blocked">
          {systemBlock ? (
            <div className="flex min-w-0 flex-col gap-2">
              <p className="break-words text-[13px] text-[var(--color-error-700)]">{card.blocked_reason}</p>
              {card.kind === "promo" && me.can_override && (form === "override" ? (
                <div className="flex min-w-0 flex-wrap items-end gap-2">
                  <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                    <span className={LABEL}>Why it can start now</span>
                    <input value={overrideReason} maxLength={300} onChange={(e) => setOverrideReason(e.target.value)} className={INPUT} />
                  </label>
                  <Button className="min-h-11" disabled={locked || overrideReason.trim().length < 10 || !!busy} onClick={async () => {
                    setBusy("override");
                    try {
                      await ops.overrideGate(card.id, overrideReason.trim());
                      await refresh();
                      addToast({ variant: "success", title: "Overridden. The card can start, and the reason is in the agent log." });
                      setForm(""); setOverrideReason("");
                    } catch (error) {
                      addToast({ variant: "error", title: "That didn’t save", description: opsErrorWords(error) });
                    } finally { setBusy(""); }
                  }}>Override</Button>
                  <Button variant="ghost" className="min-h-11" onClick={() => setForm("")}>Cancel</Button>
                </div>
              ) : (
                <Button variant="secondary" className="min-h-11 self-start" disabled={locked || !!busy} onClick={() => setForm("override")}>Override</Button>
              ))}
            </div>
          ) : card.blocked ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 break-words text-[13px] text-[var(--color-error-700)]">{card.blocked_reason}</p>
              <Button variant="secondary" className="min-h-11" disabled={locked || !!busy} onClick={() => update({ blocked: false }, "Unblocked")}>Unblock</Button>
            </div>
          ) : form === "block" ? (
            <div className="flex min-w-0 flex-wrap items-end gap-2">
              <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                <span className={LABEL}>What blocks it</span>
                <input value={blockReason} maxLength={300} onChange={(e) => setBlockReason(e.target.value)} className={INPUT} />
              </label>
              <Button className="min-h-11" disabled={locked || blockReason.trim().length < 5 || !!busy} onClick={async () => { const a = await update({ blocked: true, blocked_reason: blockReason.trim() }, "Marked blocked"); if (a) { setForm(""); setBlockReason(""); } }}>Mark blocked</Button>
              <Button variant="ghost" className="min-h-11" onClick={() => setForm("")}>Cancel</Button>
            </div>
          ) : card.override ? (
            <p className="break-words text-[13px] text-[var(--color-text-secondary)]">Started before go-live: {card.override.by_name} overrode the giveaway and ads rule on {dayLabel(card.override.at)}. {card.override.reason}</p>
          ) : <p className="text-[13px] text-[var(--color-text-tertiary)]">Not blocked.</p>}
        </Section>
      )}

      <Section title="Plan">
        <PlanSteps plan={card.plan} editable={card.status !== "done" && !card.archived} disabled={locked || !!busy} onChange={(plan) => update({ plan }, "Plan saved")} />
      </Section>

      <Section title="Result">
        <textarea value={result} maxLength={2000} disabled={locked || card.status === "done"} aria-label="Result" onChange={(e) => setResult(e.target.value)} onBlur={() => saveText("result", result, card.result)} className={`min-h-[64px] w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-2 text-[13px] ${FOCUS}`} />
      </Section>

      {(card.proof || []).length > 0 && (
        <Section title="Proof">
          <ul className="flex min-w-0 flex-col gap-1.5">
            {card.proof.map((p, i) => (
              <li key={i} className="flex min-w-0 flex-wrap items-start gap-2 text-[13px]">
                <OpsChip tone={p.verified ? "success" : "default"}>{proofBadge(p)}</OpsChip>
                <span className="min-w-0 flex-1 break-words text-[var(--color-text-primary)]">{p.text}</span>
              </li>
            ))}
          </ul>
          {card.close_reason && <p className="break-words text-[13px] text-[var(--color-text-secondary)]">Reason: {card.close_reason}</p>}
        </Section>
      )}

      {!card.archived && (
        <Section title="Actions">
          <div className="flex min-w-0 flex-wrap gap-2">
            {card.status === "todo" && <>
              <Button variant="secondary" className="min-h-11" disabled={locked || !!busy} onClick={() => setForm(form === "push" ? "" : "push")}>Push back</Button>
              <Button className="min-h-11" disabled={locked || !!busy || card.blocked} onClick={() => run("start", () => ops.startWork(card.id, card.revision), "Started")}>Start</Button>
            </>}
            {card.status === "doing" && <>
              <Button variant="secondary" className="min-h-11" disabled={locked || !!busy || card.blocked} onClick={() => setForm(form === "block" ? "" : "block")}>Mark blocked</Button>
              <Button variant="secondary" className="min-h-11" disabled={locked || !!busy} onClick={() => setForm(form === "push" ? "" : "push")}>Push back</Button>
              <Button className="min-h-11" disabled={locked || !!busy} onClick={() => setForm(form === "close" ? "" : "close")}>Close with proof</Button>
            </>}
            {card.status === "person" && <>
              <Button variant="secondary" className="min-h-11" disabled={locked || !!busy} onClick={() => setForm(form === "sendback" ? "" : "sendback")}>Send back</Button>
              {action && <Button className="min-h-11" disabled={locked || !!busy} onClick={() => setForm(action.action)}>{action.label}</Button>}
              {!action && <Button className="min-h-11" disabled={locked || !!busy} onClick={() => setForm(form === "close" ? "" : "close")}>Close with proof</Button>}
            </>}
            {card.status === "done" && <Button variant="secondary" className="min-h-11" disabled={locked || !!busy} onClick={() => run("reopen", () => ops.reopenWork(card.id, null, card.revision), "Reopened")}>Reopen</Button>}
            {me.can_archive && <Button variant="ghost" className="min-h-11" disabled={locked || !!busy} onClick={() => setForm(form === "remove" ? "" : "remove")}>Remove card</Button>}
          </div>
          {form === "close" && <ProofForm busy={busy === "close"} disabled={locked} onCancel={() => setForm("")} onSubmit={async (proof, res) => { const a = await run("close", () => ops.closeWork(card.id, proof, res || null, card.revision), "Card closed"); if (a) setForm(""); }} />}
          {form === "push" && <PushBackForm busy={busy === "push"} disabled={locked} onCancel={() => setForm("")} onSubmit={async (kind, reason, proof) => { const a = await run("push", () => ops.pushBackWork(card.id, kind, reason, proof, card.revision), kind === "declined" ? "Pushed back: not needed" : "Closed: already done"); if (a) setForm(""); }} />}
          {["sendback", "approve_spend", "mark_sent", "mark_published"].includes(form) && (
            <PersonActionForm
              kind={form}
              busy={busy === "person"}
              disabled={locked}
              onCancel={() => setForm("")}
              onSubmit={async (note) => {
                const a = await run("person", () => ops.personAction(card.id, form === "sendback" ? "send_back" : form, note, card.revision),
                  form === "sendback" ? "Sent back to the owner" : form === "approve_spend" ? "Spend approved" : form === "mark_sent" ? "Marked sent" : "Marked published");
                if (a) setForm("");
              }}
            />
          )}
          {form === "remove" && (
            <div className="flex min-w-0 flex-wrap items-end gap-2 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-3">
              <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                <span className={LABEL}>Why remove it</span>
                <input value={removeReason} maxLength={300} onChange={(e) => setRemoveReason(e.target.value)} className={INPUT} />
              </label>
              <Button variant="danger" className="min-h-11" disabled={locked || removeReason.trim().length < 3 || !!busy} onClick={async () => {
                setBusy("remove");
                try { await ops.archiveWork(card.id, removeReason.trim()); addToast({ variant: "success", title: "Card removed." }); setForm(""); setRemoveReason(""); onChanged?.(); onBack?.(); }
                catch (error) { addToast({ variant: "error", title: "That didn’t work", description: opsErrorWords(error) }); }
                finally { setBusy(""); }
              }}>Remove card</Button>
            </div>
          )}
        </Section>
      )}

      <Section title="History"><CardHistory events={read.data?.events || []} /></Section>

      {!card.archived && (
        <Section title="Notes">
          <NoteBox team={team} disabled={locked} busy={busy === "note"} onPost={async (body, emails) => {
            setBusy("note");
            try {
              const answer = await ops.noteWork(card.id, body, emails, requestKey("web_note"));
              await refresh();
              addToast({ variant: "success", title: answer?.told ? `Note posted. ${answer.told} told.` : "Note posted." });
              return true;
            } catch (error) {
              addToast({ variant: "error", title: "Note not posted", description: opsErrorWords(error) });
              return false;
            } finally { setBusy(""); }
          }} />
        </Section>
      )}

      <Section title="Agent prompt" action={<button type="button" onClick={async () => { try { await navigator.clipboard.writeText(agentPromptFor(card)); addToast({ variant: "success", title: "Prompt copied." }); } catch { addToast({ variant: "error", title: "Couldn’t copy", description: "Select the text and copy it yourself." }); } }} className={`inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`}><Copy aria-hidden="true" className="h-3.5 w-3.5" /> Copy</button>}>
        <p className="whitespace-pre-wrap break-words rounded-lg bg-[var(--gray-50)] p-2 font-mono text-[12px] text-[var(--color-text-secondary)]">{agentPromptFor(card)}</p>
      </Section>
    </div>
  );
}

function PersonActionForm({ kind, busy, disabled, onSubmit, onCancel }) {
  const [note, setNote] = useState("");
  const needsNote = kind === "approve_spend" || kind === "sendback";
  const label = kind === "approve_spend" ? "What was approved" : kind === "sendback" ? "What should the owner change" : "Note (optional)";
  const submit = kind === "approve_spend" ? "Approve spend" : kind === "sendback" ? "Send back" : kind === "mark_sent" ? "Mark sent" : "Mark published";
  const ok = !needsNote || note.trim().length >= 5;
  return (
    <form className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-3" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(note.trim() || null); }}>
      {kind === "mark_published" && <p className="text-[13px] text-[var(--color-text-secondary)]">Mingla checks that the event is public before this card closes.</p>}
      {kind === "mark_sent" && <p className="text-[13px] text-[var(--color-text-secondary)]">Send the message yourself first. Mingla records that you sent it.</p>}
      {(needsNote || kind === "mark_sent") && (
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>{label}</span>
          <input value={note} maxLength={300} disabled={disabled || busy} onChange={(e) => setNote(e.target.value)} className={INPUT} />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={disabled || busy || !ok} className={`min-h-11 rounded-lg bg-[var(--color-brand-800)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--color-brand-900)] disabled:opacity-50 ${FOCUS}`}>{busy ? "Saving…" : submit}</button>
        <button type="button" onClick={onCancel} className={`min-h-11 rounded-lg px-3 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Cancel</button>
      </div>
    </form>
  );
}

export { PersonActionForm };
