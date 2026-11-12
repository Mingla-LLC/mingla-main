// Issue #4255 (W3) — a card's subtasks, GitHub sub-issue style: a progress bar
// and "3 of 5 done", then one row per subtask with a tick box, its title, its
// own subtask count, thread count, status, due date and owner. Rows drag to
// a new order (or Move up / Move down from the keyboard), expand one more
// level to show their own subtasks, and open in the same panel with a
// breadcrumb back. "+ Add subtask" adds a row in place and Enter adds the
// next. Two levels deep at most (card, subtask, sub-subtask): a sub-subtask
// takes no subtasks of its own. A tick closes the subtask (its proof says it
// was ticked here) and offers Undo for 8 seconds.
import { useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, GripVertical, MessageSquare, Plus } from "lucide-react";
import { PersonAvatar } from "../people/PeopleField";
import * as ops from "../../services/opsService";
import { opsErrorWords, requestKey, todayIso } from "../../lib/opsModel";
import { DUE_TONE, dueLabel } from "../../lib/dueLabel";
import { canHaveSubtasks, liveColumns, makeSubtaskAdder, reorderIds, subtaskProgress, tickProof } from "../../lib/workBoardModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

function SubtaskRow({ sub, columns, depth, disabled, onTick, onOpen, canReorder, onMove, index, count, expandable }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sub.id, disabled: !canReorder });
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState(null);
  const [kidsError, setKidsError] = useState("");
  const col = liveColumns(columns).find((c) => c.id === sub.status_id);
  const done = sub.status === "done";
  const n = subtaskProgress(sub.subtasks);
  const owner = (sub.owners || [])[0];
  const due = dueLabel(sub, todayIso());  // #4398
  const expand = async () => {
    const next = !open;
    setOpen(next);
    if (next && !kids) {
      try { const r = await ops.getWork(sub.id, todayIso()); setKids(Array.isArray(r?.subtasks) ? r.subtasks : []); setKidsError(""); }
      catch (error) { setKidsError(opsErrorWords(error)); }
    }
  };
  return (
    <li ref={setNodeRef} data-subtask={sub.id} data-depth={depth} style={{ transform: CSS.Transform.toString(transform), transition }} className={`min-w-0 ${isDragging ? "opacity-60" : ""}`}>
      <div className="flex min-h-10 min-w-0 items-center gap-1.5 rounded-lg px-1 hover:bg-[var(--gray-50)]">
        {canReorder ? (
          <button type="button" aria-label={`Drag to reorder ${sub.title}`} {...attributes} {...listeners} className={`inline-grid h-7 w-4 shrink-0 cursor-grab place-items-center text-[var(--color-text-tertiary)] ${FOCUS}`}><GripVertical aria-hidden="true" className="h-3.5 w-3.5" /></button>
        ) : <span className="w-4 shrink-0" />}
        {expandable && n.total > 0 ? (
          <button type="button" aria-expanded={open ? "true" : "false"} aria-label={`${open ? "Hide" : "Show"} the subtasks of ${sub.title}`} onClick={expand} className={`inline-grid h-7 w-5 shrink-0 place-items-center rounded text-[var(--color-text-tertiary)] ${FOCUS}`}><ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} /></button>
        ) : <span className="w-5 shrink-0" />}
        <input type="checkbox" data-subtask-tick={sub.id} checked={done} disabled={disabled} onChange={() => onTick(sub)} aria-label={done ? `Reopen ${sub.title}` : `Tick ${sub.title} done`} className="h-4 w-4 shrink-0 accent-[var(--color-success-600)]" />
        <button type="button" onClick={() => onOpen(sub.id)} className={`min-w-0 flex-1 truncate rounded text-left text-[13px] ${done ? "text-[var(--color-text-tertiary)] line-through" : "text-[var(--color-text-primary)]"} hover:underline ${FOCUS}`}>{sub.title}</button>
        {n.total > 0 && <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--color-text-tertiary)]">{n.done}/{n.total}</span>}
        {Number(sub.thread_count) > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[11.5px] text-[var(--color-text-tertiary)]" aria-label={`${sub.thread_count} messages`}><MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />{sub.thread_count}</span>}
        {col && <span className="hidden shrink-0 items-center gap-1 rounded-full bg-[var(--gray-100)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] sm:inline-flex"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: col.color }} />{col.name}</span>}
        {due.tone !== "none" && <span data-due={due.tone} title={due.full || undefined} className={`shrink-0 rounded-full px-1.5 py-px text-[11px] tabular-nums ${DUE_TONE[due.tone]}`}>{due.text}</span>}
        {sub.review && <span data-review-wait="" className="hidden shrink-0 text-[11px] font-semibold text-[var(--color-info-700)] sm:inline">In review</span>}
        {owner ? <span title={owner.name}><PersonAvatar person={owner} size="sm" /></span> : <span className="w-5 shrink-0" />}
        {canReorder && (
          <span className="sr-only">
            <button type="button" disabled={index === 0} onClick={() => onMove(sub, -1)}>Move {sub.title} up</button>
            <button type="button" disabled={index === count - 1} onClick={() => onMove(sub, 1)}>Move {sub.title} down</button>
          </span>
        )}
      </div>
      {open && (
        <ul className="ml-9 flex min-w-0 flex-col border-l border-[var(--gray-200)] pl-2">
          {kidsError ? <li role="alert" className="text-[12px] text-[var(--color-error-700)]">{kidsError}</li>
            : !kids ? <li aria-busy="true" className="text-[12px] text-[var(--color-text-tertiary)]">Loading…</li>
            : kids.map((k) => (
              <li key={k.id} data-subtask={k.id} data-depth={depth + 1} className="flex min-h-9 min-w-0 items-center gap-1.5 px-1">
                <input type="checkbox" checked={k.status === "done"} disabled={disabled} onChange={async () => { await onTick(k); try { const r = await ops.getWork(sub.id, todayIso()); setKids(r?.subtasks || []); } catch { setKids(null); } }} aria-label={k.status === "done" ? `Reopen ${k.title}` : `Tick ${k.title} done`} className="h-4 w-4 shrink-0 accent-[var(--color-success-600)]" />
                <button type="button" onClick={() => onOpen(k.id)} className={`min-w-0 flex-1 truncate text-left text-[12.5px] ${k.status === "done" ? "text-[var(--color-text-tertiary)] line-through" : "text-[var(--color-text-primary)]"} hover:underline ${FOCUS}`}>{k.title}</button>
                {(() => { const d = dueLabel(k, todayIso()); return d.tone !== "none" ? <span data-due={d.tone} className={`shrink-0 rounded-full px-1.5 py-px text-[11px] tabular-nums ${DUE_TONE[d.tone]}`}>{d.text}</span> : null; })()}
                {(k.owners || [])[0] && <PersonAvatar person={k.owners[0]} size="sm" />}
              </li>
            ))}
        </ul>
      )}
    </li>
  );
}

export function CardSubtasks({ card, subtasks = [], columns = [], disabled, myName, onOpenCard, onChanged, offerUndo, onError }) {
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState(null);
  const inputRef = useRef(null);
  const titleRef = useRef("");
  const live = useRef({});
  live.current = { cardId: card.id, onChanged, onError };
  const adderRef = useRef(null);
  if (!adderRef.current) {
    adderRef.current = makeSubtaskAdder({
      send: async (t, cardId) => {
        const out = await ops.addSubtask(cardId, { title: t }, requestKey("web_sub"));
        if (out?.status === "duplicate") throw Object.assign(new Error("A subtask with that title is already open on this card."), { token: "duplicate" });
        if (out?.status !== "added") throw Object.assign(new Error(""), { token: "invalid_card", fixes: Array.isArray(out?.fixes) ? out.fixes : [] });
      },
      onAdded: async () => { await live.current.onChanged?.(); },
      // A failed title comes back into the box when nothing new was typed.
      onFailed: (t, error, cardId) => {
        if (!titleRef.current && cardId === live.current.cardId) { titleRef.current = t; setTitle(t); }
        live.current.onError(error);
      },
      onIdle: () => { setBusy(false); requestAnimationFrame(() => inputRef.current?.focus()); },
    });
  }
  const canAdd = canHaveSubtasks(card) && !disabled && card.status !== "done";
  const list = order ? order.map((id) => subtasks.find((s) => s.id === id)).filter(Boolean) : subtasks;
  const prog = subtaskProgress({ total: subtasks.length, done: subtasks.filter((s) => s.status === "done").length });
  const doneColumn = liveColumns(columns).find((c) => c.grp === "done");
  const canReorder = !disabled && subtasks.length > 1;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  if (!canHaveSubtasks(card) && subtasks.length === 0) return null;

  const tick = async (sub) => {
    try {
      const answer = sub.status === "done"
        ? await ops.reopenWork(sub.id, null, sub.revision)
        : await ops.moveWork(sub.id, doneColumn?.id, sub.revision, { proof: tickProof(myName), closeChildren: true });
      await onChanged?.();
      // #4398: a tick by anyone but the subtask's watcher asks the watcher to confirm.
      offerUndo(answer, sub.status === "done" ? `Reopened “${sub.title}”`
        : answer?.review ? `“${sub.title}” sent to ${answer.review.watcher_name} to confirm` : `Ticked “${sub.title}” done`);
    } catch (error) { onError(error); }
  };
  const reorder = async (ids) => {
    setOrder(ids);
    try { await ops.reorderSubtasks(card.id, ids, card.revision); await onChanged?.(); }
    catch (error) { onError(error); }
    finally { setOrder(null); }
  };
  // #4255 rework (P2): Enter takes the typed title and clears the box before
  // anything is awaited, so a second Enter on the same words sends nothing;
  // titles typed in a row are queued and added in order, one at a time.
  const add = (e) => {
    e.preventDefault();
    const typed = titleRef.current;
    if (!adderRef.current.submit(typed, card.id)) return;
    titleRef.current = "";
    setTitle("");
    setBusy(true);
  };
  return (
    <section aria-labelledby={`subtasks-${card.id}`} data-card-subtasks="" className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 id={`subtasks-${card.id}`} className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Subtasks</h3>
        {canAdd && <button type="button" data-add-subtask="" onClick={() => { setAdding(true); requestAnimationFrame(() => inputRef.current?.focus()); }} className={`inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}><Plus aria-hidden="true" className="h-3.5 w-3.5" />Add subtask</button>}
      </div>
      {subtasks.length > 0 && (
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--gray-100)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prog.pct} aria-label={prog.words}>
            <span className="block h-full rounded-full bg-[var(--color-success-600)]" style={{ width: `${prog.pct}%` }} />
          </span>
          <span className="shrink-0 text-[12px] tabular-nums text-[var(--color-text-secondary)]">{prog.words}</span>
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (over && active.id !== over.id) reorder(reorderIds(list.map((s) => s.id), active.id, over.id)); }}>
        <SortableContext items={list.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex min-w-0 flex-col rounded-lg border border-[var(--gray-200)] empty:hidden">
            {list.map((s, i) => (
              <SubtaskRow key={s.id} sub={s} columns={columns} depth={Number(card.depth || 0) + 1} disabled={disabled} onTick={tick} onOpen={onOpenCard}
                canReorder={canReorder} index={i} count={list.length} expandable={canHaveSubtasks({ depth: Number(card.depth || 0) + 1 })}
                onMove={(sub, d) => { const ids = list.map((x) => x.id); const j = ids.indexOf(sub.id) + d; if (j >= 0 && j < ids.length) reorder(reorderIds(ids, sub.id, ids[j])); }} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {canAdd && (adding || subtasks.length > 0) && (
        <form onSubmit={add} className="flex min-w-0 items-center gap-2 rounded-lg border border-dashed border-[var(--gray-300)] px-2">
          <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border border-[var(--gray-300)]" />
          <label className="sr-only" htmlFor={`new-sub-${card.id}`}>New subtask</label>
          <input id={`new-sub-${card.id}`} ref={inputRef} value={title} maxLength={160} aria-busy={busy ? "true" : "false"} placeholder="Add a subtask and press Enter"
            onChange={(e) => { titleRef.current = e.target.value; setTitle(e.target.value); }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAdding(false); titleRef.current = ""; setTitle(""); e.currentTarget.blur(); } }}
            className="min-h-10 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--color-text-primary)] outline-none" />
        </form>
      )}
      {!canHaveSubtasks(card) && <p className="text-[12px] text-[var(--color-text-tertiary)]">Subtasks go two levels deep, so this one takes no subtasks of its own.</p>}
    </section>
  );
}
