// Issue #3980 — add a card. The server checks everything; a refused card
// keeps the form filled and lists what to fix.
import { useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { useToast } from "../../context/ToastContext";
import * as ops from "../../services/opsService";
import { KIT_STEPS, dayLabel, opsErrorWords, requestKey } from "../../lib/opsModel";
import { FixesList } from "./FixesList";
import { PeoplePicker } from "./PeoplePicker";
import { RecordPicker } from "./RecordPicker";
import { AUTO_GROW_CLASS, useAutoGrow } from "./useAutoGrow";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const INPUT = `min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] text-[var(--color-text-primary)] ${FOCUS}`;
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";

export function WorkAddForm({ config, online, headingRef, onAdded, onCancel, onOpenCard }) {
  const { addToast } = useToast();
  const team = config?.team || [];
  const me = config?.me?.email;
  const [title, setTitle] = useState("");
  // Title grows with its text like the card's own Title, never clipped.
  const titleGrow = useAutoGrow(title);
  const [instructions, setInstructions] = useState("");
  const [doneMeans, setDoneMeans] = useState("");
  const doneMeansGrow = useAutoGrow(doneMeans);
  const [owners, setOwners] = useState(me ? [me] : []);
  const [watchers, setWatchers] = useState([]);
  const [due, setDue] = useState("");
  const [links, setLinks] = useState([]);
  const [kit, setKit] = useState("");
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(null);
  const keyRef = useRef({ key: null, value: null });

  const people = (emails) => emails.map((email) => ({ email, name: team.find((p) => p.email === email)?.name || email }));
  const eventLink = links.find((l) => l.kind === "event" || l.kind === "expected");
  const item = useMemo(() => {
    const out = { title, instructions, done_means: doneMeans, owners, watchers, links: links.map((l) => ({ kind: l.kind, id: l.id })) };
    if (due) out.due_on = due;
    if (kit && eventLink) { out.kit_step = Number(kit); out.anchor = { kind: eventLink.kind, id: eventLink.id }; }
    return out;
  }, [title, instructions, doneMeans, owners, watchers, links, due, kit, eventLink]);

  const submit = async (e) => {
    e.preventDefault();
    const value = JSON.stringify(item);
    if (keyRef.current.value !== value) keyRef.current = { key: requestKey("web_add"), value };
    setBusy(true);
    try {
      const answer = await ops.addWork([item], keyRef.current.key);
      const row = answer?.results?.[0];
      if (row?.status === "added") {
        setRefused(null);
        keyRef.current = { key: null, value: null };
        const told = [...owners, ...watchers].filter((x) => x !== me).length;
        addToast({ variant: "success", title: "Card added", description: told ? `${told} ${told === 1 ? "person was" : "people were"} told.` : undefined });
        onAdded?.(row.card);
      } else {
        setRefused(row || { status: "refused", fixes: [] });
      }
    } catch (error) {
      addToast({ variant: "error", title: "Card not added", description: opsErrorWords(error) });
    } finally {
      setBusy(false);
    }
  };

  const fixes = refused?.status === "refused" ? refused.fixes || [] : [];
  const failed = new Set(fixes.map((f) => f.field));
  const passed = refused?.status === "refused" ? [
    !failed.has("title") && "Title",
    links.length > 0 && !failed.has("links") && "Linked records exist",
    !failed.has("item") && "No duplicate open card",
  ].filter(Boolean) : [];

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)]">
      <h2 ref={headingRef} tabIndex={-1} className="text-[15px] font-semibold text-[var(--color-text-primary)]">Add card</h2>
      {refused?.status === "refused" && <FixesList title={`Card not added: ${fixes.length} ${fixes.length === 1 ? "thing" : "things"} to fix`} fixes={fixes} passed={passed} />}
      {refused?.status === "duplicate" && (
        <div role="alert" className="flex min-w-0 flex-col gap-2 rounded-xl bg-[var(--color-warning-50)] p-3 text-[13px] text-[var(--color-warning-700)]">
          <p className="break-words">{refused.message}</p>
          <Button variant="secondary" className="min-h-11 self-start" onClick={() => onOpenCard?.(refused.existing?.id)}>Open existing card</Button>
        </div>
      )}
      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>Title</span>
        <textarea
          value={title}
          ref={titleGrow}
          rows={1}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (online && !busy) e.currentTarget.form?.requestSubmit?.(); } }}
          className={`min-h-11 w-full whitespace-pre-wrap break-words rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-text-primary)] ${AUTO_GROW_CLASS} ${FOCUS}`}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>Instructions</span>
        <textarea value={instructions} maxLength={4000} onChange={(e) => setInstructions(e.target.value)} placeholder="What should the person or their agent do?" className={`min-h-[88px] w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-2 text-[13px] ${FOCUS}`} />
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>Done means</span>
        <textarea value={doneMeans} ref={doneMeansGrow} maxLength={300} rows={2} onChange={(e) => setDoneMeans(e.target.value)} placeholder="What shows the work is done" className={`min-h-[56px] w-full ${AUTO_GROW_CLASS} whitespace-pre-wrap break-words rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-2 text-[13px] ${FOCUS}`} />
      </label>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <PeoplePicker label="Owners" people={people(owners)} team={team} exclude={watchers} onAdd={(email) => setOwners([...owners, email])} onRemove={(email) => setOwners(owners.filter((x) => x !== email))} />
        <PeoplePicker label="Watching" people={people(watchers)} team={team} exclude={owners} onAdd={(email) => setWatchers([...watchers, email])} onRemove={(email) => setWatchers(watchers.filter((x) => x !== email))} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className={LABEL}>Linked records</span>
        {links.length > 0 && (
          <ul className="flex min-w-0 flex-wrap gap-1.5">
            {links.map((l) => (
              <li key={`${l.kind}:${l.id}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--gray-100)] py-0.5 pl-2.5 pr-0.5 text-[13px]">
                <span className="min-w-0 break-words"><span className="text-[var(--color-text-tertiary)]">{l.kind}: </span>{l.label}</span>
                <button type="button" aria-label={`Unlink ${l.label}`} onClick={() => setLinks(links.filter((x) => x !== l))} className={`inline-grid min-h-8 min-w-8 place-items-center rounded-full hover:bg-[var(--gray-200)] ${FOCUS}`}>×</button>
              </li>
            ))}
          </ul>
        )}
        {linking ? (
          <RecordPicker onClose={() => setLinking(false)} onPick={(pick) => { if (!links.some((l) => l.kind === pick.kind && l.id === pick.id)) setLinks([...links, pick]); setLinking(false); }} />
        ) : (
          <button type="button" onClick={() => setLinking(true)} className={`min-h-11 self-start rounded-lg px-2 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`}>+ Link</button>
        )}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>Due date</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={INPUT} />
          {!due && eventLink && <span className="break-words text-[12px] text-[var(--color-text-tertiary)]">Due date counted back from {eventLink.label}{kit ? ` (T${Number(kit) > 0 ? "+" : ""}${kit})` : ", the day before it starts"}.</span>}
          {due && <span className="text-[12px] text-[var(--color-text-tertiary)]">Due {dayLabel(due)}</span>}
        </label>
        {eventLink && (
          <label className="flex min-w-0 flex-col gap-1">
            <span className={LABEL}>Kit step</span>
            <select value={kit} onChange={(e) => setKit(e.target.value)} className={INPUT}>
              <option value="">None</option>
              {KIT_STEPS.filter((k) => k.value !== -28 && k.value !== -21).map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" loading={busy} disabled={!online || busy}>Add card</Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
