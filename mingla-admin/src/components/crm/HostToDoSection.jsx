// #4571 W3: the Work section of a host or creator card, fed by
// crm_record_work (every open or recently closed card and subtask that points
// at the record; for hosts also what To do read). Before: Issue #4270 (Wave 2) — the first block of a host card: To do. The open
// Work cards for this host (any host record of its brand), oldest due first,
// each with its due date (red when late), owners, Send/Spend/Publish tag and
// "Host sees" when the host can see it on their plan. "+ Add work item"
// opens a short form: what, assignees, watchers, due, Files link and "Host
// can see this task on their plan" (off by default, D4). Mingla writes the
// card's instructions and done means (C-6); staff can edit them on the card.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link2, Plus, Search } from "lucide-react";
import { Button } from "../ui/Button";
import { SideLink } from "../ui/PanelStack";
import { Avatars } from "../ops/OpsChip";
import { FixesList } from "../ops/FixesList";
import { PeopleField } from "../people/PeopleField";
import { OWNERS_HINT, WATCHERS_HINT, lastOwnerWords, lastWatcherWords } from "../../lib/peopleField";
import { useToast } from "../../context/ToastContext";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import { dueChoices } from "../../lib/crmModel";
import * as ops from "../../services/opsService";
import { linkWorkToRecord, unlinkWorkFromRecord, workPickerRows, workStatusWords } from "../../lib/recordWorkLinks";
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
  // #4571: every owner of the host card to start with (up to 10); the watchers are picked.
  return { title: "", owners: (owners || []).slice(0, 10), watchers: [], due: "", filesUrl: "", hostSees: false };
}

/**
 * One open card: title, due chip, owners, tag, Host sees. Opens the card over
 * the record panel (PanelStack, "Back to <record>"). #4571 design v5: Unlink
 * sits beside the row (never inside the link), refused for a closed card.
 */
export function HostToDoRow({ card, today = todayIso(), onUnlink = null, unlinking = false, disabled = false }) {
  const done = card.status === "done";
  const late = !done && card.due_on && String(card.due_on).slice(0, 10) < today;
  const row = (
    <SideLink
      side={{ kind: "card", id: card.id }}
      href={`#/work-board?card=${card.id}`}
      data-host-todo={card.id}
      className={`flex min-h-11 w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-[var(--gray-200)] px-3 py-2 hover:bg-[var(--gray-50)] ${FOCUS}`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-[13px] font-semibold text-[var(--color-text-primary)] ${WORDS} ${done ? "line-through opacity-70" : ""}`}>
          {card.parent_number ? <span className="mr-1 text-[var(--color-text-tertiary)]">↳ #{card.parent_number}</span> : card.number ? <span className="mr-1 text-[var(--color-text-tertiary)]">#{card.number}</span> : null}
          {card.title}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--color-text-tertiary)]">
          {(card.owners || []).length
            ? <Avatars people={card.owners} />
            : <span className="rounded-full bg-[var(--color-error-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-error-700)]">No owner</span>}
          {isTagged(card) && <span className="rounded-full bg-[var(--color-brand-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-brand-700)]">{personReasonLabel(card)}</span>}
          {card.on_brand_plan && <span data-host-sees="" className="rounded-full bg-[var(--color-success-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-success-700)]">Host sees</span>}
          {card.brand_plan_source === "host_app" && <span data-from-host-app="" className="rounded-full bg-[var(--color-info-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-info-700)]">From Host app</span>}
          {done && <span className="rounded-full bg-[var(--color-success-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-success-700)]">Done</span>}
          {card.status === "doing" && <span className="rounded-full bg-[var(--gray-100)] px-2 py-px text-[11px] font-semibold text-[var(--color-text-secondary)]">In progress</span>}
        </span>
      </span>
      {card.due_on && !done && (
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums ${late ? "bg-[var(--color-error-50)] text-[var(--color-error-700)]" : "bg-[var(--gray-100)] text-[var(--color-text-secondary)]"}`}>
          {late ? "Late · " : ""}{dayLabel(card.due_on)}
        </span>
      )}
    </SideLink>
  );
  if (!onUnlink) return row;
  return (
    <span className="flex min-w-0 items-stretch gap-1">
      <span className="min-w-0 flex-1">{row}</span>
      <Button variant="ghost" size="sm" className="min-h-11 shrink-0" data-unlink-work={card.id} loading={unlinking}
        disabled={disabled || unlinking || done} title={done ? "A closed card's links can't change" : `Unlink card ${card.number ?? ""}`}
        aria-label={`Unlink card ${card.number ?? ""}, ${card.title}`} onClick={() => onUnlink(card)}>
        Unlink
      </Button>
    </span>
  );
}

/**
 * #4571 design v5: "Link existing work". Searches Work cards with
 * ops_link_search('card', q) (by #number or title) and shows the open ones
 * with their number, title, status and owners (from the Work list for the
 * same words). Picking one links it to this record (lib/recordWorkLinks.js).
 */
export function WorkLinkPicker({ record, linkedIds, online, busyId, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState({ query: null, rows: [], error: null });
  const seq = useRef(0);
  const query = q.trim().replace(/^#/, "");
  useEffect(() => {
    if (query.length < 2 && !/^\d+$/.test(query)) return undefined;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const [search, open] = await Promise.all([
          ops.searchLinks("card", query),
          ops.listBoardWork({ q: query, status: ["todo", "doing", "person"], limit: 20 }),
        ]);
        if (mine === seq.current) setFound({ query, rows: workPickerRows(search?.results, open?.cards, linkedIds), error: null });
      } catch (error) {
        if (mine === seq.current) setFound({ query, rows: [], error });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = found.query === query;
  const short = query.length < 2 && !/^\d+$/.test(query);
  return (
    <div data-work-link-picker="" className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--gray-300)] bg-[var(--color-background-primary)] shadow-[var(--shadow-md)]">
      <label className="flex min-w-0 items-center gap-2 border-b border-[var(--gray-200)] px-3" htmlFor={`work-link-${record.id}`}>
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--color-text-tertiary)]" />
        <span className="sr-only">Find a Work card by number or title</span>
        <input id={`work-link-${record.id}`} type="search" autoFocus autoComplete="off" value={q} disabled={!online}
          placeholder="Find a Work card by #number or title" onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
          className="min-h-11 w-full min-w-0 bg-transparent text-[13.5px] text-[var(--color-text-primary)] outline-none" />
      </label>
      <div aria-live="polite" className="max-h-64 min-w-0 overflow-y-auto">
        {short ? (
          <p className="px-3 py-3 text-[13px] text-[var(--color-text-tertiary)]">Type a card number or at least 2 letters of its title.</p>
        ) : !current ? (
          <p className="px-3 py-3 text-[13px] text-[var(--color-text-tertiary)]">Searching…</p>
        ) : found.error ? (
          <p role="alert" className="px-3 py-3 text-[13px] text-[var(--color-error-700)]">Couldn’t search Work. {opsErrorWords(found.error)}</p>
        ) : found.rows.length === 0 ? (
          <p className="px-3 py-3 text-[13px] text-[var(--color-text-tertiary)]">No open Work card matches that isn’t already linked here.</p>
        ) : (
          <ul className="min-w-0">
            {found.rows.map((r) => (
              <li key={r.id} className="border-t border-[var(--gray-200)] first:border-t-0">
                <button type="button" data-work-pick={r.id} disabled={!online || !!busyId} onClick={() => onPick(r)}
                  className={`flex min-h-11 w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--gray-50)] disabled:opacity-60 ${FOCUS}`}>
                  <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--color-text-tertiary)]">#{r.number}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={`text-[13px] font-medium text-[var(--color-text-primary)] ${WORDS}`}>{r.title}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--color-text-tertiary)]">
                      {workStatusWords(r.status) && <span className="rounded bg-[var(--gray-100)] px-1.5 py-px text-[11px] font-semibold text-[var(--color-text-secondary)]">{workStatusWords(r.status)}</span>}
                      {r.due_on ? <span>Due {dayLabel(r.due_on)}</span> : <span>No due date</span>}
                    </span>
                  </span>
                  {r.owners.length > 0 ? <Avatars people={r.owners} /> : <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">No owner</span>}
                  {busyId === r.id && <span className="sr-only">Linking…</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-end border-t border-[var(--gray-200)] px-2 py-1">
        <Button variant="ghost" size="sm" className="min-h-11" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

/**
 * `prefill` (#4270 W7, Brand groups): { key, title }; a new key opens the
 * Add work item form with that title (Host can see stays off).
 */
export function HostToDoSection({ record, read, online, onAdded, onLinksChanged = null, prefill = null }) {
  const isCreator = record?.pipeline === "creators";
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
  // #4571 design v5: link an existing Work card, and unlink one, from here.
  const [picking, setPicking] = useState(false);
  const [linkBusy, setLinkBusy] = useState("");
  const name = record?.name || "this card";
  const linkPicked = async (pick) => {
    if (!online || linkBusy) return;
    setLinkBusy(pick.id);
    try {
      const res = await linkWorkToRecord(ops, pick.id, record);
      addToast({ variant: res.already ? "info" : "success", title: res.already ? `Card ${pick.number} is already linked to ${name}` : `Linked card ${pick.number} to ${name}` });
      setPicking(false);
      onLinksChanged?.();
    } catch (error) {
      addToast({ variant: "error", title: `Card ${pick.number ?? ""} not linked`, description: opsErrorWords(error) });
    } finally {
      setLinkBusy("");
    }
  };
  const unlink = async (card) => {
    if (!online || linkBusy) return;
    setLinkBusy(card.id);
    try {
      await unlinkWorkFromRecord(ops, card.id, record);
      addToast({ variant: "success", title: `Unlinked card ${card.number ?? ""} from ${name}` });
      onLinksChanged?.();
    } catch (error) {
      addToast({ variant: "error", title: `Card ${card.number ?? ""} not unlinked`, description: opsErrorWords(error) });
    } finally {
      setLinkBusy("");
    }
  };

  const data = read?.data;
  // #4571 W3: crm_record_work's rows, open first (the server's order), then those closed in the last 14 days.
  const all = Array.isArray(data?.cards) ? data.cards.filter(Boolean) : [];
  const cards = sortColumn(all.filter((c) => c.status !== "done"), "todo");
  const closed = all.filter((c) => c.status === "done");
  const doneCount = closed.length;
  const problems = quickAddProblems(form, today, (email) => (team || []).find((p) => p.email === email)?.name || email);
  const problemFor = (field) => (tried ? problems.find((p) => p.field === field)?.message || "" : "");
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const fid = (key) => `host-todo-${id}-${key}`;

  const open = () => { setForm(emptyForm(defaultOwners)); setTried(false); setRefused(null); setAdding(true); };
  const prefillKey = prefill?.key || "";
  useEffect(() => {
    if (!prefillKey || !prefill) return;
    setForm({ ...emptyForm(defaultOwners), title: String(prefill.title || "").slice(0, 160) });
    setTried(false); setRefused(null); setAdding(true);
  }, [prefillKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    if (!online || busy || problems.length) return;
    const item = quickAddItem({ ...form, recordId: id, linkKind: isCreator ? "creator" : "host" });
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
        <span className="min-w-0">Work{!read?.loading && data && <span className="text-[12.5px] font-medium text-[var(--color-text-tertiary)]"> · {cards.length} open · {doneCount} done in the last 14 days</span>}</span>
        <span className="flex flex-wrap gap-1">
          {!adding && <Button variant="ghost" size="sm" className="min-h-11" icon={Plus} disabled={!online} onClick={open}>Add work item</Button>}
          <Button variant="secondary" size="sm" className="min-h-11" icon={Link2} data-link-work="" aria-expanded={picking} disabled={!online} onClick={() => setPicking((x) => !x)}>Link existing work</Button>
        </span>
      </h3>
      {picking && (
        <WorkLinkPicker record={record} linkedIds={all.map((c) => c.id)} online={online} busyId={linkBusy}
          onPick={linkPicked} onClose={() => setPicking(false)} />
      )}
      {read?.loading ? (
        <div role="status" className="flex flex-col gap-2"><span className="sr-only">Loading this card’s work…</span><div className="h-11 animate-pulse rounded-lg bg-[var(--gray-100)]" /><div className="h-11 animate-pulse rounded-lg bg-[var(--gray-100)]" /></div>
      ) : read?.error && !data ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] text-[var(--color-error-700)]">
          <span className={`min-w-0 ${WORDS}`}>Couldn’t load the work for {record?.name || "this card"}. {opsErrorWords(read.error)}</span>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={read.retry}>Try again</Button>
        </div>
      ) : all.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--gray-300)] px-3 py-3 text-[13px] text-[var(--color-text-tertiary)]">No Work points at this {isCreator ? "creator" : "host"} yet. Add a work item, or link an existing one.</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {[...cards, ...closed].map((c) => <li key={c.id} className="min-w-0"><HostToDoRow card={c} today={today} onUnlink={unlink} unlinking={linkBusy === c.id} disabled={!online || (!!linkBusy && linkBusy !== c.id)} /></li>)}
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
              {/* #4571: 1 to 10 owners and 1 to 10 watchers, nobody in both. */}
              <PeopleField id={fid("owners")} label="Owners" max={10} min={1} minWords={lastOwnerWords} hint={OWNERS_HINT} value={form.owners} team={team} me={me} suggested={defaultOwners} exclude={form.watchers} onChange={(owners) => set({ owners })} />
              {problemFor("owners") && <span role="alert" className="text-[12px] text-[var(--color-error-700)]">{problemFor("owners")}</span>}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <PeopleField id={fid("watchers")} label="Watching" max={10} hint={WATCHERS_HINT} minWords={lastWatcherWords} value={form.watchers} team={team} me={me} suggested={[me].filter(Boolean)} exclude={form.owners} onChange={(watchers) => set({ watchers })} />
              {problemFor("watchers") && <span role="alert" className="text-[12px] text-[var(--color-error-700)]">{problemFor("watchers")}</span>}
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            {/* #4571 W3: quick due choices, not a typed date. */}
            <div className="flex min-w-0 flex-col gap-1" role="group" aria-labelledby={fid("due")}>
              <span id={fid("due")} className={LABEL}>Due</span>
              <span className="flex min-w-0 flex-wrap gap-1">
                {dueChoices(today).map((c) => (
                  <button key={c.value} type="button" aria-pressed={form.due === c.value} disabled={busy} onClick={() => set({ due: c.value })}
                    className={`min-h-9 rounded-full border px-2.5 text-[12px] font-semibold ${form.due === c.value ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)] text-[var(--color-text-secondary)]"}`}>{c.label}</button>
                ))}
              </span>
              {problemFor("due_on") && <span className="text-[12px] text-[var(--color-error-700)]">{problemFor("due_on")}</span>}
            </div>
            <label className="flex min-w-0 flex-col gap-1" htmlFor={fid("files")}>
              <span className={LABEL}>Files link (optional)</span>
              <input id={fid("files")} type="url" inputMode="url" maxLength={2000} value={form.filesUrl} disabled={busy} placeholder="https://"
                aria-invalid={!!problemFor("files_url") || undefined} onChange={(e) => set({ filesUrl: e.target.value })} className={INPUT} />
              {problemFor("files_url") && <span className="text-[12px] text-[var(--color-error-700)]">{problemFor("files_url")}</span>}
            </label>
          </div>
          {!isCreator && <label className="flex min-h-11 min-w-0 items-center gap-2 text-[13px] text-[var(--color-text-primary)]" htmlFor={fid("host-sees")}>
            <input id={fid("host-sees")} type="checkbox" checked={form.hostSees} disabled={busy} onChange={(e) => set({ hostSees: e.target.checked })} className="h-4 w-4" />
            Host can see this task on their plan
          </label>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" className="min-h-11" loading={busy} disabled={!online || busy}>{busy ? "Adding…" : "Add work item"}</Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
