// Issue #4255 (W2) — the Work board, version 2. Kanban only.
//
//   * Columns are statuses (ops_work_statuses), each one Not started, Active
//     or Closed underneath. Admins add, rename, recolour, reorder (drag the
//     header, or Move left / Move right) and archive columns; everyone else
//     sees them read-only.
//   * The board fills the window. Column headers stay put; only each
//     column's cards scroll. With more columns than fit, the board scrolls
//     sideways and the headers move with their columns.
//   * Cards drag between columns (dnd-kit, approved by Seth on 10 Nov). The
//     target column lights up and a placeholder shows where the card lands.
//     Keyboard: Space picks a card up, the arrow keys move it to the next
//     column, Space drops it, Esc cancels. Order inside a column stays
//     automatic, so a drop decides the column only.
//   * Phones: one column at a time behind tabs (the tab row is the fixed
//     header); a status pill on each card moves it instead of dragging.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, GripVertical, MessageSquare, MoreHorizontal, Paperclip, Plus } from "lucide-react";
import { Avatars } from "./OpsChip";
import { MenuItem, Popover } from "./Popover";
import { cardReasons, isTagged, personReasonLabel, sortColumn } from "../../lib/opsModel";
import { DUE_TONE, dueLabel, waitingWords } from "../../lib/dueLabel";
import {
  COLUMN_COLORS,
  GROUP_LABELS,
  boardColumns,
  columnNameProblem,
  hoursLabel,
  lastOfGroup,
  liveColumns,
  subtaskProgress,
} from "../../lib/workBoardModel";
import { draftItemTitle } from "../../lib/workViews";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:anywhere] hyphens-none";

/** #4398: the due pill every card shows ("Overdue 4 days", "Due today", "Due Fri 14 Nov"). */
export function DuePill({ card, today, className = "" }) {
  const due = dueLabel(card, today);
  return (
    <span data-due={due.tone} title={due.full || undefined} className={`inline-flex shrink-0 items-center gap-1 self-start rounded-full px-2 py-0.5 text-[11.5px] tabular-nums ${DUE_TONE[due.tone]} ${className}`}>
      <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />{due.text}
    </span>
  );
}

/** #4398: "Waiting on Seth" on a card in review, "Sent back: …" after a send back. */
export function ReviewLine({ card }) {
  if (card?.review) return <span data-review-wait="" className={`text-[12px] font-semibold text-[var(--color-info-700)] ${WORDS}`}>{waitingWords(card)}</span>;
  if (card?.sent_back && card.status !== "done") return <span data-sent-back="" className={`text-[12px] font-semibold text-[var(--color-error-700)] ${WORDS}`}>Sent back: {card.sent_back.reason}</span>;
  return null;
}

/** The small progress ring: done of total. */
function Ring({ done, total }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const p = total ? done / total : 0;
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--gray-200)" strokeWidth="2.2" />
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--color-success-600)" strokeWidth="2.2" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 8 8)" strokeLinecap="round" />
    </svg>
  );
}

/** The card face: title, tags, owners, due, subtasks, thread and files, agent on it. */
export function BoardCardFace({ card, today, columns = [], onMove = null, showPill = false, draftsReady = 0 }) {
  const sub = subtaskProgress(card.subtasks);
  const left = Array.isArray(card.release_items) ? card.release_items.filter((i) => !i.done).length : null;
  const reasons = cardReasons(card).filter((r) => r === "No owner");
  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      {card.parent && <span className={`text-[11px] text-[var(--color-text-tertiary)] ${WORDS}`}>↳ #{card.parent.number} {card.parent.title}</span>}
      <span className={`line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--color-text-primary)] ${WORDS}`}>{card.title}</span>
      <DuePill card={card} today={today} />
      {(isTagged(card) || card.goal || left !== null || card.auto) && (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {isTagged(card) && <span className="rounded-full bg-[var(--color-brand-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-brand-700)]">{personReasonLabel(card)}</span>}
          {isTagged(card) && draftsReady > 0 && <span data-draft-ready="" className="rounded-full bg-[var(--color-info-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-info-700)]">Draft ready</span>}
          {left !== null && <span data-release-left="" className="rounded-full bg-[var(--color-info-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-info-700)]">{left} of {card.release_items.length} left</span>}
          {card.auto && <span className="rounded-full bg-[var(--gray-100)] px-2 py-px text-[11px] font-semibold text-[var(--color-text-secondary)]">Made by Mingla</span>}
          {card.goal && <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-[var(--gray-100)] px-2 py-px text-[11px] text-[var(--color-text-secondary)]"><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-success-600)]" /><span className="truncate">{card.goal.title}</span></span>}
        </span>
      )}
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[var(--color-text-tertiary)]">
        {(card.owners || []).length
          ? <Avatars people={card.owners} />
          : <span aria-label={reasons.length ? "No owner" : "Nobody yet"} className="inline-grid h-6 w-6 place-items-center rounded-full border border-dashed border-[var(--color-error-500)] text-[10px] text-[var(--color-error-700)]">?</span>}
        {sub.total > 0 && <span className="inline-flex items-center gap-1 tabular-nums" aria-label={`${sub.done} of ${sub.total} subtasks done`}><Ring done={sub.done} total={sub.total} />{sub.done}/{sub.total}</span>}
        {Number(card.thread_count) > 0 && <span className="inline-flex items-center gap-0.5 tabular-nums" aria-label={`${card.thread_count} messages`}><MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />{card.thread_count}</span>}
        {Number(card.files_count) > 0 && <span className="inline-flex items-center gap-0.5 tabular-nums" aria-label={`${card.files_count} files`}><Paperclip aria-hidden="true" className="h-3.5 w-3.5" />{card.files_count}</span>}
        {card.estimate_minutes ? <span className="tabular-nums">{hoursLabel(card.estimate_minutes)}</span> : null}
        {card.working && card.status !== "done" && <span className="font-semibold text-[var(--color-brand-700)]"><span aria-hidden="true">● </span>{card.working.name || "An agent"} on it</span>}
      </span>
      {(card.owners?.[0] || card.watchers?.[0]) && (
        <span className={`text-[11.5px] text-[var(--color-text-secondary)] ${WORDS}`}>{card.owners?.[0]?.name || "Nobody"} owns · {card.watchers?.[0]?.name || "nobody"} watches</span>
      )}
      <ReviewLine card={card} />
      {showPill && onMove && (
        <StatusPill card={card} columns={columns} onMove={onMove} />
      )}
    </span>
  );
}

/** The status pill: moves a card without dragging (phones, keyboards, screen readers). */
export function StatusPill({ card, columns, onMove, disabled = false }) {
  const cols = liveColumns(columns);
  const current = cols.find((c) => c.id === card.status_id);
  return (
    <label className="inline-flex min-w-0 items-center gap-1 self-start" onClick={(e) => e.stopPropagation()}>
      <span className="sr-only">Move card {card.number} to</span>
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: current?.color || "var(--gray-400)" }} />
      <select
        data-status-pill={card.id}
        value={card.status_id || ""}
        disabled={disabled}
        onChange={(e) => { const to = cols.find((c) => c.id === e.target.value); if (to) onMove(card, to); }}
        className={`min-h-9 max-w-[12rem] rounded-full border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-2 text-[12px] font-semibold text-[var(--color-text-secondary)] ${FOCUS}`}
      >
        {cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  );
}

function DraggableCard({ card, today, selected, onSelect, canDrag, dimmed, draftsReady = 0 }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `card:${card.id}`, data: { type: "card", card }, disabled: !canDrag });
  return (
    <li className="min-w-0">
      <button
        ref={setNodeRef}
        type="button"
        data-card-id={card.id}
        aria-current={selected ? "true" : undefined}
        aria-roledescription={canDrag ? "Draggable card" : undefined}
        {...attributes}
        {...listeners}
        onClick={() => onSelect(card)}
        className={`flex w-full min-w-0 flex-col rounded-xl border bg-[var(--color-background-primary)] p-2.5 text-left shadow-[var(--shadow-xs,none)] hover:border-[var(--gray-300)] ${selected ? "border-[var(--color-brand-500)] shadow-[inset_0_0_0_1px_var(--color-brand-500)]" : "border-[var(--gray-200)]"} ${isDragging || dimmed ? "opacity-40" : ""} ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${FOCUS}`}
      >
        <BoardCardFace card={card} today={today} draftsReady={draftsReady} />
      </button>
    </li>
  );
}

// A waiting message draft no open card carries (#4130), at the top of the first column.
function DraftItem({ draft, selected, onOpen }) {
  return (
    <li className="min-w-0">
      <button type="button" data-draft-item={draft.id} aria-current={selected ? "true" : undefined} onClick={() => onOpen(draft)}
        className={`flex w-full min-w-0 flex-col gap-1.5 rounded-xl border bg-[var(--color-background-primary)] p-2.5 text-left hover:border-[var(--gray-300)] ${selected ? "border-[var(--color-brand-500)]" : "border-[var(--gray-200)]"} ${FOCUS}`}>
        <span className={`text-[13px] font-semibold leading-snug text-[var(--color-text-primary)] ${WORDS}`}>{draftItemTitle(draft)}</span>
        <span className="flex min-w-0 flex-wrap gap-1">
          <span className="rounded-full bg-[var(--color-brand-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-brand-700)]">You send</span>
          <span className="rounded-full bg-[var(--color-info-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-info-700)]">Draft ready</span>
        </span>
      </button>
    </li>
  );
}

function Placeholder() {
  return <li aria-hidden="true" data-drop-placeholder="" className="h-14 rounded-xl border-2 border-dashed border-[var(--color-brand-400,var(--color-brand-500))] bg-[var(--color-brand-50)]" />;
}

/** One column: fixed header, its own scrolling list, + Add card at the foot. */
function BoardColumn({ col, columns, today, selectedId, onSelect, canChange, canDrag, onAddCard, columnActions, dragCard, overColumnId, drafts, selectedDraftId, onOpenDraft, draftsByCard, allDraftsHref }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `col:${col.id}`, data: { type: "column", column: col }, disabled: !canChange });
  const lit = dragCard && overColumnId === col.id && dragCard.status_id !== col.id;
  // Where the dragged card would land: the column's automatic order with it in.
  const list = lit ? sortColumn([...col.cards, { ...dragCard, status_id: col.id, status: col.grp, __ghost: true }], col.grp === "done" ? "done" : "todo") : col.cards;
  const empty = list.length + (drafts?.length || 0) === 0;
  return (
    <section
      ref={setNodeRef}
      data-column={col.id}
      data-column-group={col.grp}
      aria-labelledby={`work-col-${col.id}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex h-full w-[280px] shrink-0 flex-col rounded-xl border bg-[var(--gray-50)] ${lit ? "border-[var(--color-brand-500)] ring-2 ring-[var(--color-brand-100)]" : "border-[var(--gray-200)]"} ${isDragging ? "opacity-60" : ""}`}
    >
      <header data-column-header="" className="flex shrink-0 items-center gap-1.5 border-b border-[var(--gray-200)] px-2.5 py-2">
        {canChange && (
          <button type="button" aria-label={`Drag to move the ${col.name} column`} {...attributes} {...listeners} className={`-ml-1 inline-grid h-7 w-5 cursor-grab place-items-center rounded text-[var(--color-text-tertiary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>
            <GripVertical aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: col.color }} />
        <h2 id={`work-col-${col.id}`} className={`min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--color-text-primary)]`} title={`${col.name} · ${GROUP_LABELS[col.grp]}`}>{col.name}</h2>
        <span className="shrink-0 rounded-full bg-[var(--color-background-primary)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--color-text-secondary)]" aria-label={`${col.count} ${col.count === 1 ? "card" : "cards"}`}>{col.count}</span>
        {drafts?.length > 0 && <span className="shrink-0 rounded-full bg-[var(--color-info-50)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--color-info-700)]">+{drafts.length} {drafts.length === 1 ? "draft" : "drafts"}</span>}
        {canChange && <ColumnMenu col={col} columns={columns} actions={columnActions} />}
      </header>
      {col.cut && (
        <p data-column-cut={col.id} role="status" className="mx-2 mt-2 rounded-lg bg-[var(--color-info-50)] px-2 py-1.5 text-[12px] text-[var(--color-info-700)]">
          Showing the first {col.shown} of {col.count}. Filter by owner or search to see the rest.
        </p>
      )}
      <div data-column-scroll="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {empty ? (
          <p className="px-1 py-2 text-[12.5px] text-[var(--color-text-tertiary)]">Nothing here.{canDrag ? " Drop a card." : ""}</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-1.5">
            {(drafts || []).map((d) => <DraftItem key={`draft-${d.id}`} draft={d} selected={d.id === selectedDraftId} onOpen={onOpenDraft} />)}
            {list.map((card) => card.__ghost
              ? <Placeholder key="ghost" />
              : <DraggableCard key={card.id} card={card} today={today} selected={card.id === selectedId} onSelect={onSelect} canDrag={canDrag} dimmed={dragCard?.id === card.id && lit} draftsReady={draftsByCard?.get?.(card.id) || 0} />)}
          </ul>
        )}
        {drafts && allDraftsHref && <a href={allDraftsHref} className={`mt-2 block rounded-lg px-1.5 py-1 text-[12px] font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>All my message drafts, sent and discarded</a>}
      </div>
      {onAddCard && (
        <button type="button" onClick={() => onAddCard(col)} className={`flex min-h-10 shrink-0 items-center gap-1 rounded-b-xl border-t border-[var(--gray-200)] px-3 text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>
          <Plus aria-hidden="true" className="h-3.5 w-3.5" /> Add card
        </button>
      )}
    </section>
  );
}

/** The column's ⋯ menu (admins): rename, colour, move, archive. */
function ColumnMenu({ col, columns, actions }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(col.name);
  const [error, setError] = useState("");
  const cols = liveColumns(columns);
  const i = cols.findIndex((c) => c.id === col.id);
  return (
    <Popover label={`${col.name} column options`} role="menu" align="right" width="w-64" dataAttr={`column:${col.id}`}
      button={<MoreHorizontal aria-hidden="true" className="h-4 w-4" />}
      buttonClassName="inline-grid h-7 w-7 place-items-center rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--gray-100)]">
      {(close) => (
        <div className="flex flex-col gap-1">
          {renaming ? (
            <form className="flex flex-col gap-1 p-1" onSubmit={async (e) => {
              e.preventDefault();
              const problem = columnNameProblem(name, columns, col.id);
              if (problem) { setError(problem); return; }
              const ok = await actions.rename(col, name.replace(/\s+/g, " ").trim());
              if (ok) { setRenaming(false); close(); }
            }}>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]" htmlFor={`rename-${col.id}`}>Column name</label>
              <input id={`rename-${col.id}`} autoFocus maxLength={30} value={name} onChange={(e) => { setName(e.target.value); setError(""); }} className={`min-h-9 rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-[13px] ${FOCUS}`} />
              {error && <span role="alert" className="text-[12px] text-[var(--color-error-700)]">{error}</span>}
              <div className="flex gap-1"><button type="submit" className={`min-h-9 rounded-md bg-[var(--color-brand-700)] px-3 text-[12.5px] font-semibold text-white ${FOCUS}`}>Save</button><button type="button" onClick={() => setRenaming(false)} className={`min-h-9 rounded-md px-2 text-[12.5px] ${FOCUS}`}>Cancel</button></div>
            </form>
          ) : <MenuItem onClick={() => { setName(col.name); setRenaming(true); }}>Rename</MenuItem>}
          <div className="flex flex-wrap gap-1 px-2 py-1" role="group" aria-label="Colour">
            {COLUMN_COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={col.color === c ? "true" : "false"} onClick={async () => { if (await actions.recolour(col, c)) close(); }}
                className={`h-6 w-6 rounded-full ${col.color === c ? "ring-2 ring-[var(--color-text-primary)] ring-offset-2 ring-offset-[var(--color-background-primary)]" : ""} ${FOCUS}`} style={{ background: c }} />
            ))}
          </div>
          <MenuItem disabled={i <= 0} onClick={async () => { if (await actions.move(col, i - 1)) close(); }}>Move left</MenuItem>
          <MenuItem disabled={i < 0 || i >= cols.length - 1} onClick={async () => { if (await actions.move(col, i + 1)) close(); }}>Move right</MenuItem>
          <p className="px-2.5 py-1 text-[12px] text-[var(--color-text-tertiary)]">Counts as {GROUP_LABELS[col.grp]}</p>
          <MenuItem danger disabled={lastOfGroup(col, columns)} hint={lastOfGroup(col, columns) ? `Only ${GROUP_LABELS[col.grp]} column` : undefined} onClick={() => { close(); actions.archive(col); }}>Archive column…</MenuItem>
        </div>
      )}
    </Popover>
  );
}

/** + Add column (admins): name, what it counts as, colour. */
function AddColumn({ columns, onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [grp, setGrp] = useState("doing");
  const [color, setColor] = useState(COLUMN_COLORS[3]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <div className="flex w-[220px] shrink-0 flex-col gap-1 pt-1">
        <button type="button" data-add-column="" onClick={() => setOpen(true)} className={`flex min-h-10 items-center gap-1 rounded-xl border border-dashed border-[var(--gray-300)] px-3 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)] ${FOCUS}`}><Plus aria-hidden="true" className="h-4 w-4" /> Add column</button>
        <span className="px-3 text-[11.5px] text-[var(--color-text-tertiary)]">Admins only</span>
      </div>
    );
  }
  return (
    <form data-new-column="" className="flex w-[260px] shrink-0 flex-col gap-2 self-start rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-3" onSubmit={async (e) => {
      e.preventDefault();
      const problem = columnNameProblem(name, columns);
      if (problem) { setError(problem); return; }
      setBusy(true);
      const ok = await onAdd({ name: name.replace(/\s+/g, " ").trim(), grp, color });
      setBusy(false);
      if (ok) { setOpen(false); setName(""); }
    }}>
      <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">New column</p>
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--color-text-secondary)]">Name
        <input autoFocus maxLength={30} value={name} onChange={(e) => { setName(e.target.value); setError(""); }} className={`min-h-9 rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-[13px] font-normal text-[var(--color-text-primary)] ${FOCUS}`} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--color-text-secondary)]">Counts as
        <select value={grp} onChange={(e) => setGrp(e.target.value)} className={`min-h-9 rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-[13px] font-normal text-[var(--color-text-primary)] ${FOCUS}`}>
          <option value="todo">Not started</option>
          <option value="doing">Active</option>
          <option value="done">Closed (asks for proof)</option>
        </select>
      </label>
      <div role="group" aria-label="Colour" className="flex flex-wrap gap-1">
        {COLUMN_COLORS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={color === c ? "true" : "false"} onClick={() => setColor(c)} className={`h-6 w-6 rounded-full ${color === c ? "ring-2 ring-[var(--color-text-primary)] ring-offset-2 ring-offset-[var(--color-background-primary)]" : ""} ${FOCUS}`} style={{ background: c }} />)}
      </div>
      {error && <span role="alert" className="text-[12px] text-[var(--color-error-700)]">{error}</span>}
      <div className="flex gap-1.5">
        <button type="button" onClick={() => { setOpen(false); setError(""); }} className={`min-h-9 rounded-md px-3 text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Cancel</button>
        <button type="submit" disabled={busy} className={`min-h-9 rounded-md bg-[var(--color-brand-700)] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50 ${FOCUS}`}>{busy ? "Adding…" : "Add column"}</button>
      </div>
    </form>
  );
}

/** The board fills the window below where it starts. */
function useFillHeight(ref, enabled) {
  const [height, setHeight] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setHeight(Math.max(320, Math.floor(window.innerHeight - top - 16)));
    };
    measure();
    window.addEventListener("resize", measure);
    const t = setTimeout(measure, 50);
    return () => { window.removeEventListener("resize", measure); clearTimeout(t); };
  }, [ref, enabled]);
  return height;
}

/** Phones (under 768px) see one column at a time. */
function useIsPhone() {
  const query = "(max-width: 767.98px)";
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const m = window.matchMedia(query);
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return phone;
}

/**
 * Keyboard: the arrow keys take a picked-up card to the next or previous
 * column (by their place on screen), rather than 25 pixels at a time.
 */
function columnKeyboardCoordinates(event, { context }) {
  const { active, collisionRect, droppableRects, droppableContainers } = context;
  if (!active || !collisionRect) return undefined;
  const dir = event.code === "ArrowRight" ? 1 : event.code === "ArrowLeft" ? -1 : 0;
  if (!dir) return undefined;
  event.preventDefault();
  const cols = droppableContainers.getEnabled()
    .filter((c) => c.data.current?.type === "column")
    .map((c) => droppableRects.get(c.id))
    .filter(Boolean)
    .sort((a, b) => a.left - b.left);
  const x = collisionRect.left + collisionRect.width / 2;
  const target = dir > 0 ? cols.find((r) => r.left > x) : [...cols].reverse().find((r) => r.left + r.width < x);
  if (!target) return undefined;
  return { x: target.left + target.width / 2 - collisionRect.width / 2, y: target.top + 60 };
}

function collisions(args) {
  const within = pointerWithin(args).filter((c) => c.data?.droppableContainer?.data?.current?.type === "column");
  return within.length ? within : closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => c.data.current?.type === "column") });
}

const ANNOUNCE = {
  onDragStart: ({ active }) => (active.data.current?.type === "card" ? `Picked up card ${active.data.current.card.number}. Use the left and right arrow keys to choose a column, Space to drop, Escape to cancel.` : `Picked up the ${active.data.current?.column?.name} column.`),
  onDragOver: ({ active, over }) => (over ? `${active.data.current?.type === "card" ? `Card ${active.data.current.card.number}` : "The column"} is over ${over.data.current?.column?.name}.` : "Not over a column."),
  onDragEnd: ({ active, over }) => (over ? `Dropped in ${over.data.current?.column?.name}.` : `Card ${active.data.current?.card?.number || ""} put back.`),
  onDragCancel: () => "Cancelled. Nothing moved.",
};

export function WorkBoard({
  columns,
  cards,
  info = null,
  today,
  selectedId,
  onSelect,
  canChange = false,
  online = true,
  onMoveCard,
  onAddCard = null,
  columnActions,
  drafts = [],
  selectedDraftId = null,
  onOpenDraft = null,
  draftsByCard = null,
  allDraftsHref = null,
  layout = null,
}) {
  const phoneNow = useIsPhone();
  const phone = layout ? layout === "phone" : phoneNow;
  const cols = useMemo(() => boardColumns(columns, cards, info), [columns, cards, info]);
  const boardRef = useRef(null);
  const height = useFillHeight(boardRef, !layout);
  const [dragCard, setDragCard] = useState(null);
  const [overColumnId, setOverColumnId] = useState(null);
  const [active, setActive] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space picks up and drops; Enter still opens the card.
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );
  const firstTodo = cols.find((c) => c.grp === "todo")?.id;
  const draftsFor = (col) => (onOpenDraft && col.id === firstTodo ? drafts : []);

  if (phone) {
    const current = cols.find((c) => c.id === active) || cols[0];
    return (
      <div data-work-board="phone" className="flex min-w-0 flex-col">
        <div role="tablist" aria-label="Column" data-column-tabs="" className="sticky top-0 z-10 flex min-w-0 gap-1 overflow-x-auto border-b border-[var(--gray-200)] bg-[var(--color-background-secondary)] pb-1">
          {cols.map((col) => (
            <button key={col.id} type="button" role="tab" id={`work-col-tab-${col.id}`} aria-selected={current?.id === col.id} aria-controls={`work-col-panel-${col.id}`}
              ref={(el) => { if (el && current?.id === col.id) el.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }}
              onClick={() => setActive(col.id)}
              className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold ${current?.id === col.id ? "bg-[var(--color-background-primary)] text-[var(--color-brand-700)] shadow-sm" : "text-[var(--color-text-secondary)]"} ${FOCUS}`}>
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: col.color }} />
              <span className="whitespace-nowrap">{col.name}</span> <span className="tabular-nums">{col.count}</span>
            </button>
          ))}
        </div>
        {current && (
          <section id={`work-col-panel-${current.id}`} role="tabpanel" aria-labelledby={`work-col-tab-${current.id}`} data-column={current.id} className="flex min-w-0 flex-col gap-1.5 pt-2">
            {current.cut && <p role="status" className="rounded-lg bg-[var(--color-info-50)] px-2 py-1.5 text-[12px] text-[var(--color-info-700)]">Showing the first {current.shown} of {current.count}. Filter by owner or search to see the rest.</p>}
            {current.cards.length + draftsFor(current).length === 0 ? <p className="px-1 py-2 text-[12.5px] text-[var(--color-text-tertiary)]">Nothing here.</p> : (
              <ul className="flex min-w-0 flex-col gap-1.5">
                {draftsFor(current).map((d) => <DraftItem key={`draft-${d.id}`} draft={d} selected={d.id === selectedDraftId} onOpen={onOpenDraft} />)}
                {current.cards.map((card) => (
                  <li key={card.id} className="min-w-0 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-2.5">
                    <button type="button" data-card-id={card.id} aria-current={card.id === selectedId ? "true" : undefined} onClick={() => onSelect(card)} className={`block w-full min-w-0 text-left ${FOCUS}`}>
                      <BoardCardFace card={card} today={today} draftsReady={draftsByCard?.get?.(card.id) || 0} />
                    </button>
                    <div className="pt-2"><StatusPill card={card} columns={columns} onMove={onMoveCard} disabled={!online} /></div>
                  </li>
                ))}
              </ul>
            )}
            {current.id === firstTodo && allDraftsHref && <a href={allDraftsHref} className={`rounded-lg px-1.5 py-1 text-[12px] font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>All my message drafts, sent and discarded</a>}
            {onAddCard && <button type="button" onClick={() => onAddCard(current)} className={`flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-[var(--color-text-secondary)] ${FOCUS}`}><Plus aria-hidden="true" className="h-4 w-4" /> Add card</button>}
          </section>
        )}
      </div>
    );
  }

  const onDragStart = ({ active: a }) => {
    if (a.data.current?.type === "card") setDragCard(a.data.current.card);
  };
  const onDragOver = ({ over }) => setOverColumnId(over?.data.current?.type === "column" ? over.data.current.column.id : null);
  const reset = () => { setDragCard(null); setOverColumnId(null); };
  const onDragEnd = ({ active: a, over }) => {
    const type = a.data.current?.type;
    reset();
    if (!over || over.data.current?.type !== "column") return;
    const to = over.data.current.column;
    if (type === "card") { onMoveCard(a.data.current.card, to); return; }
    if (type === "column" && canChange) {
      const from = a.data.current.column;
      const index = cols.findIndex((c) => c.id === to.id);
      if (from.id !== to.id && index >= 0) columnActions.move(from, index);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collisions} accessibility={{ announcements: ANNOUNCE, screenReaderInstructions: { draggable: "To move a card, press Space, then the left and right arrow keys to choose a column, and Space again to drop it. Escape cancels." } }}
      onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={reset}>
      <div ref={boardRef} data-work-board="columns" style={height ? { height } : undefined} className={`flex min-w-0 gap-2.5 overflow-x-auto overflow-y-hidden pb-1 ${height ? "" : "h-[70vh]"}`}>
        <SortableContext items={cols.map((c) => `col:${c.id}`)} strategy={horizontalListSortingStrategy}>
          {cols.map((col) => (
            <BoardColumn key={col.id} col={col} columns={columns} today={today} selectedId={selectedId} onSelect={onSelect}
              canChange={canChange && online} canDrag={online} onAddCard={online ? onAddCard : null} columnActions={columnActions}
              dragCard={dragCard} overColumnId={overColumnId}
              drafts={draftsFor(col)} selectedDraftId={selectedDraftId} onOpenDraft={onOpenDraft}
              draftsByCard={draftsByCard} allDraftsHref={col.id === firstTodo ? allDraftsHref : null} />
          ))}
        </SortableContext>
        {canChange && online && <AddColumn columns={columns} onAdd={columnActions.add} />}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragCard ? (
          <div className="w-[264px] rotate-[1.5deg] rounded-xl border border-[var(--color-brand-500)] bg-[var(--color-background-primary)] p-2.5 shadow-[var(--shadow-lg)]">
            <BoardCardFace card={dragCard} today={today} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
