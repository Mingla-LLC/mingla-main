// Issue #4270 (Wave 2) — the first block of a host card: To do. The open
// Work cards for this host (any host record of its brand), oldest due first,
// each with its due date (red when late), owners, Send/Spend/Publish tag and
// "Host sees" when the host can see it on their plan. "+ Add work item"
// opens a short form: what, assignees, watchers, due, Files link and "Host
// can see this task on their plan" (off by default, D4). Mingla writes the
// card's instructions and done means (C-6); staff can edit them on the card.
import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { SideLink } from "../ui/PanelStack";
import { Avatars } from "../ops/OpsChip";
import { FixesList } from "../ops/FixesList";
import { PeopleField } from "../people/PeopleField";
import { useToast } from "../../context/ToastContext";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import * as ops from "../../services/opsService";
import {
  dayLabel,
  isTagged,
  opsErrorWords,
  personReasonLabel,
  quickAddItem,
  quickAddProblems,
  requestKey,
  sortColumn,
  todayIso,
} from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";
const INPUT = `min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] text-[var(--color-text-primary)] disabled:opacity-60 ${FOCUS}`;

function emptyForm(owners) {
  return { title: "", owners, watchers: [], due: "", filesUrl: "", hostSees: false };
}

/** One open card: title, due chip, owners, tag, Host sees. Opens the card beside. */
export function HostToDoRow({ card, today = todayIso() }) {
  const late = card.due_on && String(card.due_on).slice(0, 10) < today;
  return (
    <SideLink
      side={{ kind: "card", id: card.id }}
      href={`#/work-board?card=${card.id}`}
      data-host-todo={card.id}
      className={`flex min-h-11 w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-[var(--gray-200)] px-3 py-2 hover:bg-[var(--gray-50)] ${FOCUS}`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-[13px] font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{card.title}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--color-text-tertiary)]">
          {(card.owners || []).length
            ? <Avatars people={card.owners} />
            : <span className="rounded-full bg-[var(--color-error-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-error-700)]">No owner</span>}
          {isTagged(card) && <span className="rounded-full bg-[var(--color-brand-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-brand-700)]">{personReasonLabel(card)}</span>}
          {card.on_brand_plan && <span data-host-sees="" className="rounded-full bg-[var(--color-success-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-success-700)]">Host sees</span>}
          {card.status === "doing" && <span className="rounded-full bg-[var(--gray-100)] px-2 py-px text-[11px] font-semibold text-[var(--color-text-secondary)]">In progress</span>}
        </span>
      </span>
      {card.due_on && (
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums ${late ? "bg-[var(--color-error-50)] text-[var(--color-error-700)]" : "bg-[var(--gray-100)] text-[var(--color-text-secondary)]"}`}>
          {late ? "Late · " : ""}{dayLabel(card.due_on)}
        </span>
      )}
    </SideLink>
  );
}

export function HostToDoSection({ record, read, online, onAdded }) {
  const { addToast } = useToast();
  const directory = usePeopleDirectory();
  const team = directory.people;
  const me = directory.me || "";
  const id = record?.id;
  const defaultOwners = useMemo(() => (record?.owners || []).slice(), [record?.owners]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(() => emptyForm(defaultOwners));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(null);
  const keyRef = useRef({ key: null, value: null });
  const today = todayIso();

  const data = read?.data;
  const cards = sortColumn((Array.isArray(data?.todo) ? data.todo : []).filter((c) => c && c.status !== "done"), "todo");
  const doneCount = Number(data?.done_count) || 0;
  const problems = quickAddProblems(form, today);
  const problemFor = (field) => (tried ? problems.find((p) => p.field === field)?.message || "" : "");
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const fid = (key) => `host-todo-${id}-${key}`;

  const open = () => { setForm(emptyForm(defaultOwners)); setTried(false); setRefused(null); setAdding(true); };
  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    if (!online || busy || problems.length) return;
    const item = quickAddItem({ ...form, recordId: id });
    const value = JSON.stringify(item);
    if (keyRef.current.value !== value) keyRef.current = { key: requestKey("web_host_todo"), value };
    setBusy(true);
    try {
      const answer = await ops.addWork([item], keyRef.current.key);
      const row = answer?.results?.[0];
      if (row?.status === "added") {
        keyRef.current = { key: null, value: null };
        const names = (row.card?.owners || []).map((o) => o.name).filter(Boolean);
        addToast({ variant: "success", title: `Added. Card ${row.card?.number ?? ""} is in To do for ${names.length ? names.join(", ") : "its owners"}.` });
        setAdding(false);
        setRefused(null);
        setForm(emptyForm(defaultOwners));
        onAdded?.(row.card);
      } else {
        // What was typed stays; the list says what to fix.
        setRefused(row || { status: "refused", fixes: [] });
      }
    } catch (error) {
      addToast({ variant: "error", title: "Work item not added", description: opsErrorWords(error) });
    } finally {
      setBusy(false);
    }
  };

  const fixes = refused?.status === "refused" ? refused.fixes || [] : [];
  return (
    <section aria-labelledby={`host-todo-${id}`} data-host-section="todo" className="flex min-w-0 flex-col gap-2">
      <h3 id={`host-todo-${id}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
        <span>To do</span>
        {!read?.loading && data && <span className="text-[12.5px] font-medium text-[var(--color-text-tertiary)]">{cards.length} open · {doneCount} done this week</span>}
      </h3>
      {read?.loading ? (
        <div role="status" className="flex flex-col gap-2"><span className="sr-only">Loading this host’s work…</span><div className="h-11 animate-pulse rounded-lg bg-[var(--gray-100)]" /><div className="h-11 animate-pulse rounded-lg bg-[var(--gray-100)]" /></div>
      ) : read?.error && !data ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] text-[var(--color-error-700)]">
          <span className={`min-w-0 ${WORDS}`}>Couldn’t load this host’s work. {opsErrorWords(read.error)}</span>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={read.retry}>Try again</Button>
        </div>
      ) : cards.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-tertiary)]">Nothing open.</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {cards.map((c) => <li key={c.id} className="min-w-0"><HostToDoRow card={c} today={today} /></li>)}
        </ul>
      )}

      {adding ? (
        <form data-host-add-form="" onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-3">
          {!online && <p role="status" className="text-[12.5px] font-semibold text-[var(--color-warning-700)]">You’re offline</p>}
          {fixes.length > 0 && <FixesList title={`Not added: ${fixes.length} ${fixes.length === 1 ? "thing" : "things"} to fix`} fixes={fixes} />}
          {refused?.status === "duplicate" && <p role="alert" className="rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-[13px] text-[var(--color-warning-700)]">{refused.message}</p>}
          <label className="flex min-w-0 flex-col gap-1" htmlFor={fid("title")}>
            <span className={LABEL}>What</span>
            <input id={fid("title")} autoFocus maxLength={160} value={form.title} disabled={busy} placeholder="e.g. Chase the venue contract"
              aria-invalid={!!problemFor("title") || undefined} aria-describedby={problemFor("title") ? fid("title-err") : undefined}
              onChange={(e) => set({ title: e.target.value })} className={INPUT} />
            {problemFor("title") && <span id={fid("title-err")} className="text-[12px] text-[var(--color-error-700)]">{problemFor("title")}</span>}
          </label>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <PeopleField id={fid("owners")} label="Assignees" value={form.owners} team={team} me={me} suggested={defaultOwners} exclude={form.watchers} onChange={(owners) => set({ owners })} />
              {problemFor("owners") && <span role="alert" className="text-[12px] text-[var(--color-error-700)]">{problemFor("owners")}</span>}
            </div>
            <PeopleField id={fid("watchers")} label="Watchers" value={form.watchers} team={team} me={me} suggested={[me].filter(Boolean)} exclude={form.owners} onChange={(watchers) => set({ watchers })} />
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1" htmlFor={fid("due")}>
              <span className={LABEL}>Due</span>
              <input id={fid("due")} type="date" min={today} value={form.due} disabled={busy}
                aria-invalid={!!problemFor("due_on") || undefined} onChange={(e) => set({ due: e.target.value })} className={INPUT} />
              {problemFor("due_on") && <span className="text-[12px] text-[var(--color-error-700)]">{problemFor("due_on")}</span>}
            </label>
            <label className="flex min-w-0 flex-col gap-1" htmlFor={fid("files")}>
              <span className={LABEL}>Files link (optional)</span>
              <input id={fid("files")} type="url" inputMode="url" maxLength={2000} value={form.filesUrl} disabled={busy} placeholder="https://"
                aria-invalid={!!problemFor("files_url") || undefined} onChange={(e) => set({ filesUrl: e.target.value })} className={INPUT} />
              {problemFor("files_url") && <span className="text-[12px] text-[var(--color-error-700)]">{problemFor("files_url")}</span>}
            </label>
          </div>
          <label className="flex min-h-11 min-w-0 items-center gap-2 text-[13px] text-[var(--color-text-primary)]" htmlFor={fid("host-sees")}>
            <input id={fid("host-sees")} type="checkbox" checked={form.hostSees} disabled={busy} onChange={(e) => set({ hostSees: e.target.checked })} className="h-4 w-4" />
            Host can see this task on their plan
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" className="min-h-11" loading={busy} disabled={!online || busy}>{busy ? "Adding…" : "Add work item"}</Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" className="min-h-11 self-start" icon={Plus} disabled={!online} onClick={open}>Add work item</Button>
      )}
    </section>
  );
}
