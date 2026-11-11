// Issue #3980 — one work card, live. Changes save as they are made; most offer
// Undo for a few seconds.
//
// Issue #4255 (Work board v2, W3) — the card panel, rebuilt (720px, with a
// focus mode that fills the page; the thread opens beside it as panel two):
//   (1) one header line: the card number and, for a subtask, the breadcrumb
//       to its parent; Thread (with its message count), focus mode, the ⋯
//       menu (Copy agent prompt, Copy link, Show changes in thread, Move to,
//       Archive card) and close;
//   (2) the title, shown once and edited in place; "Done when" one line under
//       it;
//   (3) status in two lines at most: the status pill (the board's columns),
//       the next action as one button, More (Send back, Push back, Block),
//       and a red second line only when something is wrong;
//   (4) people and dates in two lines at most: Owners, Watching, Assign to
//       me; then Start, Due, Sprint, Goal and Estimate as chips;
//   (5) the description, a composer (bold, lists, checklists, links, code,
//       @mentions, / menu) that autosaves 800 ms after typing stops and on
//       blur; Instructions, Done means and Result merge into it (D4);
//   (6) subtasks, two levels deep; (7) files and links; (8) linked records
//       and GitHub; (9) the host plan switch where it applies.
// Gone (D5-D7): the second Title field, Instructions, Result, the Proof box
// (proof shows at the foot of the thread), the four folds at the bottom (in
// the ⋯ menu and the thread now), and "Message to send" (a draft for a person
// is a subtask they own).
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Link2, Maximize2, MessageSquare, Minimize2, MoreHorizontal, X } from "lucide-react";
import { AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../../context/ToastContext";
import { useOpsCard } from "../../hooks/useOpsCard";
import { useCardUploads } from "../../hooks/useCardFiles";
import * as ops from "../../services/opsService";
import {
  personActionFor,
  personReasonLabel,
  isTagged,
  roadmapDraftHref,
  addDays,
  agentName,
  agentPromptFor,
  dayLabel,
  githubChipClass,
  githubChipWords,
  githubWaitOffered,
  githubWaitWords,
  mondayOf,
  opsErrorWords,
  parseGithubInput,
  cardAnchorWords,
  sprintLabel,
  todayIso,
  workingWords,
  showsHostSees,
} from "../../lib/opsModel";
import { GROUP_LABELS, hoursLabel, liveColumns, parseEstimate, writeShowChanges } from "../../lib/workBoardModel";
import { OpsChip } from "./OpsChip";
import { PeopleField, PersonAvatar } from "../people/PeopleField";
import { suggestedPeople } from "../../lib/peopleField";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import { RecordPicker } from "./RecordPicker";
import { ProofForm } from "./ProofForm";
import { PushBackForm } from "./PushBackForm";
import { CardWording } from "./CardPersonPanels";
import { RichComposer } from "./RichComposer";
import { CardSubtasks } from "./CardSubtasks";
import { CardFiles } from "./CardFiles";
import { MenuItem, Popover } from "./Popover";
import { DraftKeptNote, SideLink, usePanelLinks } from "../ui/PanelStack";
import { usePanelDraft } from "../../hooks/usePanelDraft";
import { AUTO_GROW_CLASS, useAutoGrow } from "./useAutoGrow";
import { linkSide, sideHref } from "../../lib/panelStack";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const INPUT = `min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] text-[var(--color-text-primary)] disabled:opacity-60 ${FOCUS}`;
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";
const CHIP = `inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg px-2 text-[12.5px] hover:bg-[var(--gray-100)] disabled:opacity-60 ${FOCUS}`;
// "Done when": one quiet line under the title that grows to show its whole text.
const DONE_MEANS_CLASS = "min-h-8 min-w-0 flex-1 resize-none whitespace-pre-wrap break-words rounded-md border border-transparent bg-transparent px-1 py-1 text-[12.5px] text-[var(--color-text-secondary)] hover:border-[var(--gray-200)] focus:border-[var(--gray-300)]";
const ICON_BTN = `inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`;

function Section({ title, children, action }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className={LABEL}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The verb a card's owner does next: "publishes", "sends", "approves the spend", "finishes it". */
function nextVerb(card) {
  const tag = card.tag || card.person_reason;
  return { publish: "publishes", send: "sends", spend: "approves the spend", other: "gives the OK" }[tag] || (card.status === "doing" ? "finishes it" : "starts it");
}

/** The red second line: only when something is wrong. */
function troubleWords(card, today) {
  const parts = [];
  if (card.due_on && card.status !== "done") {
    const days = Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${String(card.due_on).slice(0, 10)}T00:00:00Z`)) / 86_400_000);
    if (days > 0) parts.push(`Overdue by ${days} ${days === 1 ? "day" : "days"}`);
  }
  if (card.blocked) parts.push(`Blocked${card.blocked_reason ? `: ${card.blocked_reason}` : ""}`);
  if (card.status !== "done" && !(card.owners || []).length) parts.push("No owner");
  if (!parts.length) return "";
  const owner = (card.owners || [])[0];
  return `${parts.join(" · ")}${owner && card.status !== "done" ? ` · next: ${owner.name} ${nextVerb(card)}` : ""}`;
}

/** A property chip: its value, or a faint "+ Due" when empty; it opens a small picker. */
function PropChip({ label, value, empty, children, disabled, danger = false, width = "w-64" }) {
  return (
    <Popover label={label} width={width} disabled={disabled} dataAttr={`prop:${label}`}
      button={value
        ? <span className="inline-flex min-w-0 items-center gap-1"><span className="text-[var(--color-text-tertiary)]">{label}</span><span className={`truncate font-semibold ${danger ? "text-[var(--color-error-700)]" : "text-[var(--color-text-primary)]"}`}>{value}</span></span>
        : <span className="text-[var(--color-text-tertiary)]">+ {empty || label}</span>}
      buttonClassName={`${CHIP} ${danger ? "bg-[var(--color-error-50)]" : value ? "bg-[var(--gray-50)]" : ""}`}>
      {(close) => <div className="flex flex-col gap-2 p-1">{typeof children === "function" ? children(close) : children}</div>}
    </Popover>
  );
}

/** Owners or Watching: avatars, + to change, in a popover with the people field. */
function PeopleChip({ id, label, people, field }) {
  return (
    <Popover label={label} width="w-80" dataAttr={`people:${label}`}
      button={<span className="inline-flex items-center gap-1.5"><span className="text-[var(--color-text-tertiary)]">{label}</span>
        {people.length ? <span className="inline-flex">{people.slice(0, 4).map((p, i) => <span key={p.email} className={i ? "-ml-1.5" : ""}><PersonAvatar person={p} size="sm" /></span>)}</span> : <span className="text-[var(--color-text-tertiary)]">nobody</span>}
        <span aria-hidden="true" className="text-[var(--color-text-tertiary)]">+</span><span className="sr-only">{people.map((p) => p.name).join(", ")}</span></span>}
      buttonClassName={`${CHIP} bg-[var(--gray-50)]`}>
      <div id={id} className="p-1">{field}</div>
    </Popover>
  );
}

// #4270 W7 rework (D-1): `onOpenSide` is set inside the Brand group panel, so
// the wording card's link to another page is not shown there.
export function WorkDetail({ cardId, config, online, onChanged, headingRef, onBack, onClose, onOpenSide = null, focus = false, onFocus = null, onOpenCard = null, columns: givenColumns = null }) {
  const { addToast } = useToast();
  const read = useOpsCard(cardId);
  const card = read.data?.card || null;
  const directory = usePeopleDirectory();
  const links = usePanelLinks();
  const team = directory.people.length ? directory.people : (config?.team || []);
  const me = config?.me || {};
  const columns = liveColumns(givenColumns && givenColumns.length ? givenColumns : config?.columns || []);
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState("");
  const [closeTo, setCloseTo] = useState(null);
  const [closeChildren, setCloseChildren] = useState(false);
  const [linking, setLinking] = useState(false);
  // #4255: what is typed is kept per card (lib/panelDrafts.js) until it is
  // saved, so it survives a linked item or the thread opening beside it.
  const [title, setTitle, titleDraft] = usePanelDraft(`work:${cardId}:title`, card?.title || "");
  const [doneMeans, setDoneMeans, doneMeansDraft] = usePanelDraft(`work:${cardId}:done_means`, card?.done_means || "");
  const savedDescription = card ? (card.description ?? card.instructions ?? "") : "";
  const [description, setDescription, descriptionDraft] = usePanelDraft(`work:${cardId}:description`, savedDescription);
  const [blockReason, setBlockReason] = useState("");
  // The title and Done when grow with their text and never clip it.
  const titleGrow = useAutoGrow(title);
  const doneMeansGrow = useAutoGrow(doneMeans);
  const titleRef = useCallback((el) => {
    titleGrow(el);
    if (headingRef && typeof headingRef === "object") headingRef.current = el;
    else if (typeof headingRef === "function") headingRef(el);
  }, [titleGrow, headingRef]);
  const [removeReason, setRemoveReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [saveState, setSaveState] = useState("");
  const idle = useRef(null);
  const close = onClose || onBack;

  useEffect(() => () => clearTimeout(idle.current), []);

  const locked = !online || !card || card.archived;
  const refresh = async () => { await read.refetch({ quiet: true }); onChanged?.(); };
  const uploads = useCardUploads(cardId, () => refresh());

  const offerUndo = (answer, titleText) => {
    if (!answer?.event_id) { addToast({ variant: "success", title: titleText }); return; }
    addToast({ variant: "success", title: titleText, duration: 8000, action: { label: "Undo", onClick: async () => {
      try { await ops.undoWork(answer.event_id); await refresh(); addToast({ variant: "success", title: "Undone." }); }
      catch (error) { addToast({ variant: "error", title: "Undo didn’t work", description: opsErrorWords(error) }); }
    } } });
  };
  const failed = async (error) => {
    if (error?.token === "stale_write") { addToast({ variant: "warning", title: "This card changed. Showing the latest." }); await refresh(); }
    else addToast({ variant: "error", title: "That didn’t save", description: opsErrorWords(error) });
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
      await failed(error);
      return null;
    } finally {
      setBusy("");
    }
  };

  const update = (changes, success) => run("save", () => ops.updateWork(card.id, changes, card.revision), success);

  const drafts = { title: titleDraft, done_means: doneMeansDraft, description: descriptionDraft };
  const saveText = async (field, value, current) => {
    if (!card) return;
    if ((value || "").trim() === (current || "").trim()) { drafts[field]?.clear(); return; }
    setSaveState("Saving…");
    const answer = await update({ [field]: value });
    if (answer) drafts[field]?.clear();
    setSaveState(answer ? "Saved" : "Not saved");
  };
  const saveDescription = (md) => {
    clearTimeout(idle.current);
    saveText("description", md, savedDescription);
  };

  const openThread = () => {
    if (!card) return;
    if (links?.openSide) links.openSide({ kind: "thread", id: card.id });
    else window.location.assign(sideHref({ kind: "thread", id: card.id }));
  };
  const openCard = (id) => {
    if (onOpenCard) onOpenCard(id);
    else if (links?.openSide) links.openSide({ kind: "card", id });
    else window.location.assign(`#/work-board?card=${id}`);
  };

  if (!cardId) return null;
  const headerBar = (inner) => (
    <div data-card-header="" className="flex h-12 shrink-0 items-center gap-1 border-b border-[var(--gray-200)] px-3">
      {inner}
      {close && <button type="button" aria-label="Close" onClick={close} className={ICON_BTN}><X aria-hidden="true" className="h-4 w-4" /></button>}
    </div>
  );
  if (read.loading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {headerBar(<span className="flex-1" />)}
        <div className="flex flex-col gap-3 p-5" aria-busy="true" aria-label="Loading the card"><Skeleton height={24} /><Skeleton height={64} /><Skeleton height={200} /></div>
      </div>
    );
  }
  if (read.error) {
    const missing = read.error.token === "not_found";
    return (
      <div className="flex h-full min-h-0 flex-col">
        {headerBar(<span className="flex-1" />)}
        <div className="flex flex-col gap-3 p-5">
          <h2 ref={headingRef} tabIndex={-1} className="text-[15px] font-semibold text-[var(--color-text-primary)]">{missing ? "That card isn’t here." : "Couldn’t load this card"}</h2>
          {!missing && <p className="text-[13px] text-[var(--color-text-secondary)]">{opsErrorWords(read.error)}</p>}
          <div className="flex flex-wrap gap-2">
            {!missing && <Button variant="secondary" className="min-h-11" onClick={() => read.refetch()}>Try again</Button>}
            {close && <Button variant="secondary" className="min-h-11" onClick={close}>Back to the board</Button>}
          </div>
        </div>
      </div>
    );
  }
  if (!card) return null;

  const owners = card.owners || [];
  const watchers = card.watchers || [];
  const ownerEmails = owners.map((p) => p.email);
  const watcherEmails = watchers.map((p) => p.email);
  const anchorWords = cardAnchorWords(card.anchor);
  const nameOf = (email) => team.find((p) => p.email === email)?.name || email;
  const githubBlock = card.blocked && card.blocked_kind === "github";
  const systemBlock = card.blocked && card.blocked_kind !== "manual" && !githubBlock;
  const today = todayIso();
  const thisWeek = mondayOf(today);
  const weeks = Array.from(new Set([card.sprint?.starts_on, ...[0, 7, 14, 21, 28].map((d) => addDays(thisWeek, d))].filter(Boolean))).sort();
  const action = personActionFor(card);
  const draftHref = roadmapDraftHref(card);
  const tagged = isTagged(card);
  const closed = card.status === "done";
  const column = columns.find((c) => c.id === card.status_id) || card.column || null;
  const trouble = troubleWords(card, today);
  const doneColumn = columns.find((c) => c.grp === "done");
  const ancestors = Array.isArray(read.data?.ancestors) ? read.data.ancestors : [];
  const subtasks = Array.isArray(read.data?.subtasks) ? read.data.subtasks : [];
  const files = Array.isArray(read.data?.files) ? read.data.files : [];
  const sprintGoals = [config?.sprint?.current, config?.sprint?.next].find((s) => s?.id && s.id === card.sprint?.id)?.goals || [];
  const openSubs = subtasks.filter((s) => s.status !== "done").length;
  const myName = directory.people.find((p) => p.me)?.name || me.name || "";
  const canEdit = !locked && !closed;

  // The status pill and the ⋯ menu's Move to: a Closed column asks for proof first.
  const moveTo = (to) => {
    if (!to || to.id === card.status_id) return;
    if (to.grp === "done" && !closed) { setCloseTo(to); setForm("close"); return; }
    run("move", () => ops.moveWork(card.id, to.id, card.revision), `Moved to ${to.name}`);
  };
  const startClose = () => { setCloseTo(doneColumn || null); setForm(form === "close" ? "" : "close"); };
  const submitClose = async (proof, res) => {
    const to = closeTo || doneColumn;
    const a = to
      ? await run("close", () => ops.moveWork(card.id, to.id, card.revision, { proof, result: res || null, closeChildren }), "Card closed")
      : await run("close", () => ops.closeWork(card.id, proof, res || null, card.revision), "Card closed");
    if (a) { setForm(""); setCloseTo(null); setCloseChildren(false); }
  };

  let primary = null;
  if (!card.archived) {
    if (closed) primary = <Button className="h-9" disabled={locked || !!busy} onClick={() => run("reopen", () => ops.reopenWork(card.id, null, card.revision), "Reopened")}>Reopen</Button>;
    else if (tagged && action) primary = <Button className="h-9" disabled={locked || !!busy} onClick={() => setForm(form === action.action ? "" : action.action)}>{action.label}</Button>;
    else if (card.status === "todo" && !tagged) primary = <Button className="h-9" disabled={locked || !!busy || card.blocked} onClick={() => run("start", () => ops.startWork(card.id, card.revision), "Started")}>Start</Button>;
    else primary = <Button className="h-9" disabled={locked || !!busy} onClick={startClose}>Done with proof</Button>;
  }
  const more = [];
  if (!card.archived && !closed) {
    if (tagged) more.push({ id: "sendback", label: "Send back", run: () => setForm("sendback") });
    if (tagged && card.status === "todo") more.push({ id: "start", label: "Start", run: () => run("start", () => ops.startWork(card.id, card.revision), "Started"), disabled: card.blocked });
    if (tagged && action) more.push({ id: "close", label: "Done with proof", run: startClose });
    more.push({ id: "push", label: "Push back", run: () => setForm("push") });
    if (card.blocked && card.blocked_kind === "manual") more.push({ id: "unblock", label: "Unblock", run: () => update({ blocked: false }, "Unblocked") });
    else if (!card.blocked && card.status === "doing") more.push({ id: "block", label: "Mark blocked", run: () => setForm("block") });
    if (systemBlock && card.kind === "promo" && me.can_override) more.push({ id: "override", label: "Override the rule", run: () => setForm("override") });
  }

  return (
    <div data-work-card={card.id} data-focus={focus ? "true" : "false"} className="flex h-full min-h-0 flex-col">
      {/* (1) One header line */}
      {headerBar(
        <>
          <nav aria-label="Card" className="flex min-w-0 flex-1 items-center gap-1 text-[12.5px] text-[var(--color-text-tertiary)]">
            {ancestors.map((a) => (
              <span key={a.id} className="inline-flex min-w-0 items-center gap-1">
                <button type="button" data-breadcrumb={a.id} onClick={() => openCard(a.id)} className={`min-w-0 max-w-[12rem] truncate rounded px-1 font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`} title={a.title}>#{a.number} {a.title}</button>
                <span aria-hidden="true">›</span>
              </span>
            ))}
            <span className="shrink-0 font-semibold text-[var(--color-text-secondary)]">#{card.number}</span>
            {column && <span className="truncate">· {GROUP_LABELS[column.grp] || ""}</span>}
            {saveState && <span role="status" className="ml-2 shrink-0 text-[12px]">{saveState}</span>}
          </nav>
          <button type="button" data-open-thread="" onClick={openThread} className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--gray-200)] px-2.5 text-[12.5px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>
            <MessageSquare aria-hidden="true" className="h-4 w-4" /> Thread
            {Number(card.thread_count) > 0 && <span className="rounded-full bg-[var(--color-brand-500)] px-1.5 text-[11px] tabular-nums text-white">{card.thread_count}</span>}
          </button>
          {onFocus && (
            <button type="button" data-focus-mode="" aria-pressed={focus ? "true" : "false"} aria-label={focus ? "Leave focus mode" : "Focus mode: fill the page"} title={focus ? "Leave focus mode" : "Focus mode"} onClick={() => onFocus(!focus)} className={ICON_BTN}>
              {focus ? <Minimize2 aria-hidden="true" className="h-4 w-4" /> : <Maximize2 aria-hidden="true" className="h-4 w-4" />}
            </button>
          )}
          <Popover label="Card options" role="menu" align="right" width="w-64" dataAttr="card-menu"
            button={<MoreHorizontal aria-hidden="true" className="h-4 w-4" />} buttonClassName={ICON_BTN}>
            {(closeMenu) => (
              <div className="flex flex-col">
                <MenuItem hint="for Claude or Codex" onClick={async () => { closeMenu(); try { await navigator.clipboard.writeText(agentPromptFor(card)); addToast({ variant: "success", title: "Prompt copied." }); } catch { addToast({ variant: "error", title: "Couldn’t copy", description: "Your browser blocked copying." }); } }}>Copy agent prompt</MenuItem>
                <MenuItem onClick={async () => { closeMenu(); try { await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#/work-board?card=${card.id}`); addToast({ variant: "success", title: "Link copied" }); } catch { addToast({ variant: "error", title: "Couldn’t copy", description: "Your browser blocked copying." }); } }}>Copy link</MenuItem>
                <MenuItem onClick={() => { closeMenu(); writeShowChanges(typeof window !== "undefined" ? window.localStorage : null, true); openThread(); }}>Show changes in thread</MenuItem>
                {!card.archived && columns.length > 0 && (
                  <div role="group" aria-label="Move to" className="border-t border-[var(--gray-200)] pt-1">
                    <p className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Move to</p>
                    {columns.map((c) => <MenuItem key={c.id} disabled={locked || c.id === card.status_id} onClick={() => { closeMenu(); moveTo(c); }} hint={c.id === card.status_id ? "here now" : GROUP_LABELS[c.grp]}><span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.name}</span></MenuItem>)}
                  </div>
                )}
                {me.can_archive && !card.archived && <div className="border-t border-[var(--gray-200)] pt-1"><MenuItem danger onClick={() => { closeMenu(); setForm("remove"); }}>Archive card…</MenuItem></div>}
              </div>
            )}
          </Popover>
        </>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className={`mx-auto flex min-w-0 flex-col gap-4 px-5 py-4 ${focus ? "max-w-[960px]" : ""}`}>
          <DraftKeptNote className="w-full" kept={Object.values(drafts).some((d) => d.kept)} onDiscard={() => Object.values(drafts).forEach((d) => d.clear())} />
          {card.archived && <AlertCard variant="warning" title="This card was removed.">It is kept for the record and can’t be changed.</AlertCard>}

          {/* (2) The title, once, and Done when */}
          <div className="flex min-w-0 flex-col gap-1">
            <label className="sr-only" htmlFor={`card-${card.id}-title`}>Title</label>
            <textarea
              ref={titleRef}
              value={title}
              id={`card-${card.id}-title`}
              data-card-title=""
              rows={1}
              maxLength={160}
              disabled={!canEdit}
              onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
              onBlur={() => saveText("title", title, card.title)}
              className={`w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[19px] font-semibold leading-snug text-[var(--color-text-primary)] hover:border-[var(--gray-200)] focus:border-[var(--gray-300)] disabled:opacity-100 ${AUTO_GROW_CLASS} ${FOCUS}`}
            />
            <div className="flex min-w-0 items-start gap-2 px-1 text-[12.5px]">
              <label htmlFor={`card-${card.id}-done`} className="shrink-0 pt-1.5 text-[var(--color-text-tertiary)]">Done when</label>
              <textarea value={doneMeans} ref={doneMeansGrow} id={`card-${card.id}-done`} rows={1} maxLength={300} disabled={!canEdit} placeholder="What finished looks like"
                onChange={(e) => setDoneMeans(e.target.value.replace(/[\r\n]+/g, " "))} onBlur={() => saveText("done_means", doneMeans, card.done_means)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                className={`${DONE_MEANS_CLASS} ${AUTO_GROW_CLASS} ${FOCUS}`} />
            </div>
            <p className="px-1 text-[11.5px] text-[var(--color-text-tertiary)]">
              {card.auto ? "Made from the timeline" : card.brand_plan_source === "host_app" ? "Added by the host in the Host app" : `Added by ${agentName(card.created_by_name, card.created_via)}`}
              {card.on_brand_plan ? " · On host plan" : ""}
            </p>
          </div>

          {/* (3) Status, two lines at most */}
          <section data-next-step="" aria-label="Status" className="flex min-w-0 flex-col gap-1.5">
            <div data-status-line="" className="flex min-w-0 flex-wrap items-center gap-2">
              <Popover label="Status" role="menu" width="w-60" disabled={locked} dataAttr="status-pill"
                button={<span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: column?.color || "var(--gray-400)" }} />{column?.name || "Status"}<span aria-hidden="true">▾</span></span>}
                buttonClassName={`inline-flex h-9 items-center rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-2.5 text-[13px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] disabled:opacity-60`}>
                {(closeMenu) => columns.map((c) => (
                  <MenuItem key={c.id} disabled={c.id === card.status_id || (c.grp === "doing" && card.status === "todo" && card.blocked)} onClick={() => { closeMenu(); moveTo(c); }} hint={GROUP_LABELS[c.grp]}>
                    <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.name}</span>
                  </MenuItem>
                ))}
              </Popover>
              {primary}
              {more.length > 0 && (
                <Popover label="More actions" role="menu" width="w-52" disabled={locked || !!busy} dataAttr="more"
                  button={<span className="inline-flex items-center gap-1">More <span aria-hidden="true">▾</span></span>}
                  buttonClassName="inline-flex h-9 items-center rounded-lg px-2.5 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]">
                  {(closeMenu) => more.map((m) => <MenuItem key={m.id} disabled={m.disabled} onClick={() => { closeMenu(); m.run(); }}>{m.label}</MenuItem>)}
                </Popover>
              )}
              {tagged && <OpsChip tone="warning">{personReasonLabel(card)}</OpsChip>}
              {draftHref && <a href={draftHref} target="_blank" rel="noopener" title="Opens in a new tab, so this card stays as it is" className={`inline-flex h-9 items-center rounded-lg px-2 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`}>Open the draft in Roadmap</a>}
              {(busy === "save" || busy === "start" || busy === "move") && <span role="status" className="text-[12px] text-[var(--color-text-tertiary)]">Saving…</span>}
            </div>
            {trouble && !card.archived && (
              <p data-trouble-line="" className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px] text-[var(--color-error-700)]">
                <span className="rounded bg-[var(--color-error-50)] px-1.5 text-[11px] font-semibold">{card.blocked ? "Blocked" : card.overdue ? "Late" : "Check"}</span>
                <span className="min-w-0 break-words">{trouble}</span>
              </p>
            )}
            {form === "close" && (
              <div className="flex min-w-0 flex-col gap-2">
                {closeTo && <p className="text-[12.5px] text-[var(--color-text-secondary)]">Moving to {closeTo.name} closes this card.</p>}
                {openSubs > 0 && (
                  <label className="flex min-h-10 items-start gap-2 text-[13px] text-[var(--color-text-primary)]">
                    <input type="checkbox" checked={closeChildren} onChange={(e) => setCloseChildren(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--color-brand-700)]" />
                    <span>Close the {openSubs} open {openSubs === 1 ? "subtask" : "subtasks"} too</span>
                  </label>
                )}
                <ProofForm busy={busy === "close"} disabled={locked} onCancel={() => { setForm(""); setCloseTo(null); }} onSubmit={submitClose} />
              </div>
            )}
            {form === "push" && <PushBackForm busy={busy === "push"} disabled={locked} onCancel={() => setForm("")} onSubmit={async (kind, reason, proof) => { const a = await run("push", () => ops.pushBackWork(card.id, kind, reason, proof, card.revision), kind === "declined" ? "Pushed back: not needed" : "Closed: already done"); if (a) setForm(""); }} />}
            {form === "block" && (
              <div className="flex min-w-0 flex-wrap items-end gap-2">
                <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                  <span className={LABEL}>What blocks it</span>
                  <input value={blockReason} maxLength={300} onChange={(e) => setBlockReason(e.target.value)} className={INPUT} />
                </label>
                <Button className="min-h-11" disabled={locked || blockReason.trim().length < 5 || !!busy} onClick={async () => { const a = await update({ blocked: true, blocked_reason: blockReason.trim() }, "Marked blocked"); if (a) { setForm(""); setBlockReason(""); } }}>Mark blocked</Button>
                <Button variant="ghost" className="min-h-11" onClick={() => setForm("")}>Cancel</Button>
              </div>
            )}
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
            ) : null)}
            {form === "remove" && (
              <div className="flex min-w-0 flex-wrap items-end gap-2 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-3">
                <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                  <span className={LABEL}>Why archive it</span>
                  <input value={removeReason} maxLength={300} onChange={(e) => setRemoveReason(e.target.value)} className={INPUT} />
                </label>
                <Button variant="danger" className="min-h-11" disabled={locked || removeReason.trim().length < 3 || !!busy} onClick={async () => {
                  setBusy("remove");
                  try { await ops.archiveWork(card.id, removeReason.trim()); addToast({ variant: "success", title: "Card archived." }); setForm(""); setRemoveReason(""); onChanged?.(); close?.(); }
                  catch (error) { addToast({ variant: "error", title: "That didn’t work", description: opsErrorWords(error) }); }
                  finally { setBusy(""); }
                }}>Archive card</Button>
                <Button variant="ghost" className="min-h-11" onClick={() => setForm("")}>Cancel</Button>
              </div>
            )}
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
            {githubBlock && <GithubWait card={card} disabled={locked || !!busy} onChange={(on, words) => update({ blocked_on_github: on }, words)} />}
            {!closed && card.override && <p className="break-words text-[12.5px] text-[var(--color-text-secondary)]">Started before go-live: {card.override.by_name} overrode the giveaway and ads rule on {dayLabel(card.override.at)}. {card.override.reason}</p>}
            <CardWording card={card} onChanged={refresh} onOpenSide={onOpenSide} />
          </section>
          {card.working && <WorkingMark card={card} canClear={!!me.can_archive && !locked} onCleared={refresh} />}

          {/* (4) People and dates, two lines at most */}
          <section aria-label="People and dates" className="flex min-w-0 flex-col gap-1">
            <div data-people-line="" className="flex min-w-0 flex-wrap items-center gap-1">
              <PeopleChip id={`card-${card.id}-owners-pop`} label="Owners" people={owners} field={
                <PeopleField id={`card-${card.id}-owners`} label="Owners" value={ownerEmails} team={team} me={directory.me}
                  suggested={suggestedPeople(directory.me, ownerEmails)} exclude={watcherEmails} min={ownerEmails.length ? 1 : 0}
                  minWords={card.auto ? "This card keeps one owner once it has one. Add someone else first, then remove this one." : undefined}
                  disabled={!canEdit} busy={!!busy}
                  onChange={(next, change) => update({ owners: next }, change.added ? `${nameOf(change.added)} added and told.` : `${nameOf(change.removed)} removed.`)} />
              } />
              <PeopleChip id={`card-${card.id}-watchers-pop`} label="Watching" people={watchers} field={
                <PeopleField id={`card-${card.id}-watchers`} label="Watching" value={watcherEmails} team={team} me={directory.me}
                  suggested={[directory.me].filter(Boolean)} exclude={ownerEmails} disabled={!canEdit} busy={!!busy}
                  onChange={(next, change) => update({ watchers: next }, change.added ? `${nameOf(change.added)} added and told.` : `${nameOf(change.removed)} removed.`)} />
              } />
              {directory.me && !ownerEmails.includes(directory.me) && canEdit && (
                <button type="button" data-assign-me="" disabled={!!busy} onClick={() => update({ owners: [...ownerEmails, directory.me] }, "Assigned to you.")} className={`${CHIP} font-semibold text-[var(--color-text-secondary)]`}>Assign to me</button>
              )}
            </div>
            <div data-dates-line="" className="flex min-w-0 flex-wrap items-center gap-1">
              <PropChip label="Start" value={card.start_on ? dayLabel(card.start_on) : ""} disabled={!canEdit} width="w-56">
                {(closeIt) => (
                  <>
                    <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">Start date
                      <input type="date" defaultValue={card.start_on || ""} max={card.due_on || undefined} onChange={(e) => { update({ start_on: e.target.value || null }, e.target.value ? "Start date set" : "Start date cleared"); closeIt(); }} className={INPUT} />
                    </label>
                    {card.start_on && <button type="button" onClick={() => { update({ start_on: null }, "Start date cleared"); closeIt(); }} className={`self-start text-[12.5px] text-[var(--color-text-secondary)] underline ${FOCUS}`}>Clear</button>}
                  </>
                )}
              </PropChip>
              <PropChip label={`Due${card.kit_step !== null && card.kit_step !== undefined ? ` · T${card.kit_step > 0 ? "+" : ""}${card.kit_step}` : ""}`} empty="Due" value={card.due_on ? dayLabel(card.due_on) : ""} danger={!!card.overdue} disabled={!canEdit} width="w-56">
                {(closeIt) => (
                  <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">Due date
                    <input type="date" defaultValue={card.due_on || ""} onChange={(e) => { if (e.target.value) { update({ due_on: e.target.value }, "Due date changed"); closeIt(); } }} className={INPUT} />
                  </label>
                )}
              </PropChip>
              <PropChip label="Sprint" value={card.in_backlog ? "Backlog" : card.sprint?.starts_on ? sprintLabel(card.sprint.starts_on).replace(/^Sprint /, "") : ""} disabled={!canEdit} width="w-60">
                {(closeIt) => (
                  <>
                    {weeks.map((w) => <MenuItem key={w} disabled={w === card.sprint?.starts_on && !card.in_backlog} onClick={() => { update({ week: w, in_backlog: false }, "Moved to another sprint"); closeIt(); }}>{sprintLabel(w)}{w === thisWeek ? " (this week)" : ""}</MenuItem>)}
                    <MenuItem disabled={card.in_backlog} onClick={() => { update({ in_backlog: true }, "Moved to the backlog"); closeIt(); }}>Backlog</MenuItem>
                  </>
                )}
              </PropChip>
              <PropChip label="Goal" value={card.goal?.title || ""} disabled={!canEdit} width="w-64">
                {(closeIt) => (
                  sprintGoals.length === 0 ? <p className="p-1 text-[12.5px] text-[var(--color-text-tertiary)]">This card’s sprint has no goals yet. Add them in Plan sprint.</p> : (
                    <>
                      {sprintGoals.map((g) => <MenuItem key={g.id} disabled={g.id === card.goal?.id} onClick={() => { update({ goal: g.id }, "Goal set"); closeIt(); }}>{g.title}</MenuItem>)}
                      {card.goal && <MenuItem onClick={() => { update({ goal: null }, "Goal taken off"); closeIt(); }}>No goal</MenuItem>}
                    </>
                  )
                )}
              </PropChip>
              <PropChip label="Estimate" value={hoursLabel(card.estimate_minutes)} disabled={!canEdit} width="w-56">
                {(closeIt) => (
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const { minutes, problem } = parseEstimate(new FormData(e.currentTarget).get("est"));
                    if (problem) { addToast({ variant: "error", title: problem }); return; }
                    update({ estimate_minutes: minutes }, minutes ? `Estimate ${hoursLabel(minutes)}` : "Estimate cleared");
                    closeIt();
                  }} className="flex flex-col gap-1">
                    <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">Hours
                      <input name="est" inputMode="decimal" autoFocus defaultValue={card.estimate_minutes ? String(Math.round((card.estimate_minutes / 60) * 10) / 10) : ""} placeholder="e.g. 1.5" className={INPUT} />
                    </label>
                    <Button type="submit" size="sm">Save</Button>
                  </form>
                )}
              </PropChip>
            </div>
            {anchorWords && (
              <p className="break-words px-2 text-[12.5px] text-[var(--color-text-secondary)]">
                {anchorWords.lead} <span className="font-semibold text-[var(--color-text-primary)]">{anchorWords.title}</span>{anchorWords.rest}
              </p>
            )}
          </section>

          {/* (5) Description */}
          <section aria-labelledby={`desc-${card.id}`} data-card-description="" className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <h3 id={`desc-${card.id}`} className={LABEL}>Description</h3>
              <span className="text-[11.5px] text-[var(--color-text-tertiary)]">{canEdit ? "Type @ to tag · / for blocks" : ""}{descriptionDraft.kept ? " · not saved yet" : ""}</span>
            </div>
            <RichComposer key={card.id} id={`card-${card.id}-description`} label="Description" value={description} disabled={!canEdit} people={team}
              placeholder="What needs doing, links, checklists. Type @ to tag a teammate."
              onChange={(md) => { setDescription(md); clearTimeout(idle.current); idle.current = setTimeout(() => saveText("description", md, savedDescription), 800); }}
              onBlur={saveDescription}
              onPasteFiles={canEdit ? (list) => { uploads.add(list); addToast({ variant: "info", title: "Adding the picture to Files." }); } : undefined} />
            {card.kind === "gate_live" && <p className="text-[12px] text-[var(--color-text-tertiary)]">Closes itself the moment the event goes public.</p>}
          </section>

          {/* (6) Subtasks */}
          <CardSubtasks card={card} subtasks={subtasks} columns={columns} disabled={locked} myName={myName}
            onOpenCard={openCard} onChanged={refresh} offerUndo={offerUndo} onError={failed} />

          {/* (7) Files and links */}
          <CardFiles card={card} files={files} disabled={locked} onChanged={refresh} uploads={uploads} />

          {/* (8) Linked records and GitHub, one compact row each */}
          <Section title="Linked" action={!linking && canEdit && <button type="button" aria-label="Link a record" onClick={() => setLinking(true)} className={`inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}><Link2 aria-hidden="true" className="h-3.5 w-3.5" /> Link a record</button>}>
            {(card.links || []).length === 0 ? <p className="text-[12.5px] text-[var(--color-text-tertiary)]">Nothing linked.</p> : (
              <ul className="flex min-w-0 flex-wrap gap-1.5">
                {card.links.map((l) => (
                  <li key={`${l.kind}:${l.id}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--gray-100)] py-0.5 pl-2.5 pr-0.5 text-[12.5px]">
                    {l.exists && linkSide(l) ? (
                      <SideLink side={linkSide(l)} aria-label={`Open ${l.label}`} className={`inline-flex min-h-7 min-w-0 items-center break-words rounded-full font-medium text-[var(--color-text-primary)] hover:underline ${FOCUS}`}>
                        <span><span className="text-[var(--color-text-tertiary)]">{l.kind.replace("_", " ")}: </span>{l.label}</span>
                      </SideLink>
                    ) : (
                      <span className="min-w-0 break-words"><span className="text-[var(--color-text-tertiary)]">{l.kind.replace("_", " ")}: </span>{l.label}{l.exists ? "" : " (removed)"}</span>
                    )}
                    <button type="button" aria-label={`Unlink ${l.label}`} disabled={!canEdit} onClick={() => update({ links: card.links.filter((x) => !(x.kind === l.kind && x.id === l.id)).map((x) => ({ kind: x.kind, id: x.id })) }, `${l.label} unlinked`)} className={`inline-grid h-8 w-8 place-items-center rounded-full hover:bg-[var(--gray-200)] disabled:opacity-50 ${FOCUS}`}><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
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
            <GithubLinks card={card} disabled={!canEdit || !!busy} onSave={(github, words) => update({ github }, words)} />
            {!closed && !githubBlock && !card.blocked && (card.github || []).length > 0 && (
              <GithubWait card={card} disabled={locked || !!busy} onChange={(on, words) => update({ blocked_on_github: on }, words)} />
            )}
          </Section>

          {/* (9) The host plan switch */}
          {showsHostSees(card) && (
            <HostSeesToggle card={card} disabled={locked || !!busy} onChange={(on) => update({ on_brand_plan: on }, on ? "The host can see this on their plan" : "The host no longer sees this")} />
          )}
        </div>
      </div>
    </div>
  );
}

// #4270 W2 rework (P3-5): "Host can see this" on a card that is on a host
// card. A person switches it on or off here; Undo puts it back. An agent
// can never switch it on (the server refuses, D15).
function HostSeesToggle({ card, disabled, onChange }) {
  const id = `host-sees-${card.id}`;
  return (
    <Section title="Host plan">
      <label htmlFor={id} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-2 text-[13px] text-[var(--color-text-primary)]">
        <input id={id} type="checkbox" data-host-sees-toggle="" checked={!!card.on_brand_plan} disabled={disabled}
          onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand-700)]" />
        <span className="min-w-0 break-words">
          <span className="block font-semibold">Host can see this</span>
          <span className="block text-[12px] text-[var(--color-text-tertiary)]">On: the host sees its title, due date, status and Files link on their plan.</span>
        </span>
      </label>
    </Section>
  );
}

// "● Seth's Claude (Hosts sweep) is on it · last update 2 h ago". The owner or
// an admin can clear the mark, with a reason (inline confirm).
function WorkingMark({ card, canClear, onCleared }) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const words = workingWords(card.working);
  return (
    <div className={`flex min-w-0 flex-col gap-2 rounded-xl border p-3 text-[13px] ${card.working.quiet ? "border-[var(--gray-200)] bg-[var(--color-warning-50)]" : "border-[var(--gray-200)] bg-[var(--color-brand-50)]"}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${card.working.quiet ? "bg-[var(--color-warning-600)]" : "bg-[var(--color-brand-700)]"}`} />
        <span className="min-w-0 flex-1 break-normal [overflow-wrap:anywhere] text-[var(--color-text-primary)]">{words}</span>
        {canClear && !open && (
          <button type="button" onClick={() => setOpen(true)} className={`min-h-11 rounded-lg px-2 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Clear working mark</button>
        )}
      </div>
      {!card.working.quiet && <p className="text-[12px] text-[var(--color-text-secondary)]">Another agent cannot change this card until it has had no update for 24 hours. You can always change it.</p>}
      {open && (
        <form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={async (e) => {
          e.preventDefault();
          if (reason.trim().length < 5) return;
          setBusy(true);
          try {
            await ops.clearWorkingMark(card.id, reason.trim());
            addToast({ variant: "success", title: "Working mark cleared. Its person was told." });
            setOpen(false); setReason("");
            await onCleared?.();
          } catch (error) {
            addToast({ variant: "error", title: "That didn’t work", description: opsErrorWords(error) });
          } finally { setBusy(false); }
        }}>
          <label className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className={LABEL}>Why clear it</span>
            <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className={INPUT} />
          </label>
          <Button type="submit" variant="danger" className="min-h-11" disabled={busy || reason.trim().length < 5}>{busy ? "Clearing…" : "Clear it"}</Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => { setOpen(false); setReason(""); }}>Cancel</Button>
        </form>
      )}
    </div>
  );
}

// GitHub issues and pull requests of Mingla-LLC/mingla-main linked to the
// card: chips that open GitHub in a new tab, a link field and remove.
function GithubLinks({ card, disabled, onSave }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const links = card.github || [];
  const current = links.map((g) => (g.kind === "pull" ? `https://github.com/Mingla-LLC/mingla-main/pull/${g.number}` : `#${g.number}`));
  const add = async () => {
    const parsed = parseGithubInput(value);
    if (parsed.error) { setError(parsed.error); return; }
    if (links.some((g) => g.number === parsed.number)) { setError(`#${parsed.number} is already linked.`); return; }
    if (links.length >= 10) { setError("A card can link at most 10 GitHub issues or pull requests."); return; }
    const answer = await onSave([...current, value.trim()], `#${parsed.number} linked`);
    if (answer) { setValue(""); setError(""); setAdding(false); }
  };
  return (
    <Section title="GitHub" action={!adding && <button type="button" aria-label="Link GitHub" disabled={disabled} onClick={() => setAdding(true)} className={`inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] disabled:opacity-50 ${FOCUS}`}><Link2 aria-hidden="true" className="h-3.5 w-3.5" /> Link</button>}>
      {links.length === 0 ? <p className="text-[13px] text-[var(--color-text-tertiary)]">No issue or pull request linked.</p> : (
        <ul className="flex min-w-0 flex-wrap gap-1.5">
          {links.map((g, i) => (
            <li key={g.number} className={`inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-2.5 pr-0.5 text-[13px] ${githubChipClass(g.label)}`}>
              <a href={g.url} target="_blank" rel="noopener noreferrer" title={g.title || undefined} className={`inline-flex min-h-8 items-center gap-1 rounded-full font-medium hover:underline ${FOCUS}`}>
                <span className="break-normal [overflow-wrap:normal]">{githubChipWords(g)}</span>
                <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0 text-[var(--color-text-tertiary)]" />
                <span className="sr-only">(opens GitHub in a new tab)</span>
              </a>
              <button type="button" aria-label={`Remove #${g.number}`} disabled={disabled} onClick={() => onSave(current.filter((_, j) => j !== i), `#${g.number} removed`)} className={`-my-1.5 -mr-1 inline-grid h-11 w-11 place-items-center rounded-full hover:bg-[var(--gray-200)] disabled:opacity-50 ${FOCUS}`}><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form className="flex min-w-0 flex-wrap items-start gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <label className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="sr-only">GitHub issue or pull request</span>
            <input value={value} autoFocus maxLength={120} placeholder="#123 or a GitHub link" aria-invalid={error ? "true" : undefined} aria-describedby={error ? `gh-err-${card.id}` : undefined} onChange={(e) => { setValue(e.target.value); setError(""); }} className={INPUT} />
            {error && <span id={`gh-err-${card.id}`} role="alert" className="text-[12px] text-[var(--color-error-700)]">{error}</span>}
          </label>
          <Button type="submit" className="min-h-11" disabled={disabled || !value.trim()}>Link</Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => { setAdding(false); setValue(""); setError(""); }}>Cancel</Button>
        </form>
      )}
    </Section>
  );
}

// "Blocked until #3980 is Live": a person sets the card to wait for its GitHub
// links; Mingla unblocks it by itself once every one is Live and tells its
// owners. A person can switch it off; an agent cannot (the server refuses).
function GithubWait({ card, disabled, onChange }) {
  const on = card.blocked && card.blocked_kind === "github";
  const words = githubWaitWords(card.github);
  if (!words || !githubWaitOffered(card)) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on ? "true" : "false"}
        disabled={disabled}
        onClick={() => onChange(!on, on ? "No longer waiting for GitHub" : "Waiting for GitHub. Mingla unblocks it when it is Live.")}
        className={`inline-flex min-h-11 max-w-full items-center gap-2 self-start rounded-lg px-1 text-left text-[13px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--gray-100)] disabled:opacity-50 ${FOCUS}`}
      >
        <span aria-hidden="true" className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? "bg-[var(--color-brand-600)]" : "bg-[var(--gray-300)]"}`}>
          <span className={`inline-block h-4 w-4 rounded-full bg-[var(--color-background-primary)] shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
        </span>
        <span className="break-normal [overflow-wrap:normal]">{words}</span>
      </button>
      {on && <p className="break-words text-[13px] text-[var(--color-error-700)]">{card.blocked_reason} It unblocks by itself and its owners are told.</p>}
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
