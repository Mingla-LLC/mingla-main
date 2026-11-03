import { useEffect, useRef, useState } from "react";
import { Skeleton } from "../ui/Skeleton";
import { RecordCard } from "./RecordCard";
import { moveBlocker, stageLabel } from "../../lib/crmModel";
import { columnShown } from "../../lib/outreachView";

// A column never grows past the screen: its cards scroll inside it, so a
// column of 200 cards is as tall as a column of 5.
const COLUMN_CLASS =
  "flex min-h-[180px] max-h-[min(72vh,760px)] flex-col gap-2 rounded-[var(--radius-md)] bg-[var(--gray-100)] p-2.5";
const BOARD_CLASS = "grid grid-flow-col auto-cols-[minmax(200px,1fr)] gap-3";
// While a card is dragged within this many pixels of the board's left or right
// edge, the board scrolls that way so an off-screen column can be reached.
const EDGE_PX = 72;
const EDGE_SPEED = 14;

/** Seven columns of two placeholder cards while the pipeline loads. */
export function PipelineBoardSkeleton() {
  return (
    <div className="max-w-full overflow-x-auto pb-2" aria-busy="true" aria-label="Loading the board">
      <div className={BOARD_CLASS}>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className={COLUMN_CLASS}>
            <Skeleton width="60%" height={16} />
            <Skeleton width="80%" height={12} />
            <Skeleton height={76} style={{ borderRadius: 8 }} />
            <Skeleton height={76} style={{ borderRadius: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The board: a Stale column, then one column per stage (lib/outreachView.js
 * boardColumns). It scrolls sideways inside its own box, so the page itself
 * never scrolls sideways. Dragging is offered only where there is a mouse or
 * trackpad; the arrow on each card and the stage menu inside the card work
 * everywhere. Stale is not a stage: a card cannot be dropped there (a future
 * next-step date takes it out). #4255: a column shows 8 cards, then
 * "Show all N"; its count is always every card in it.
 */
export function PipelineBoard({
  def,
  columns,
  staleAction = null,
  regions,
  team,
  today,
  pendingIds,
  disabled = false,
  canDrag = false,
  onOpen,
  onMove,
}) {
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [expanded, setExpanded] = useState({});
  const records = columns.flatMap((c) => c.cards);
  const dragged = dragId ? records.find((r) => r.id === dragId) || null : null;

  // Sideways auto-scroll while dragging near an edge.
  const scrollerRef = useRef(null);
  const speedRef = useRef(0);
  const frameRef = useRef(0);
  const stopScrolling = () => {
    speedRef.current = 0;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
  };
  const stepScroll = () => {
    const el = scrollerRef.current;
    if (el && speedRef.current !== 0) el.scrollLeft += speedRef.current;
    frameRef.current = speedRef.current !== 0 ? requestAnimationFrame(stepScroll) : 0;
  };
  const steerScroll = (e) => {
    const el = scrollerRef.current;
    if (!el || dragId === null) return;
    const box = el.getBoundingClientRect();
    let speed = 0;
    if (e.clientX < box.left + EDGE_PX) speed = -EDGE_SPEED;
    else if (e.clientX > box.right - EDGE_PX) speed = EDGE_SPEED;
    speedRef.current = speed;
    if (speed !== 0 && !frameRef.current) frameRef.current = requestAnimationFrame(stepScroll);
  };
  useEffect(() => stopScrolling, []);

  // The column the pointer was last over, and whether this drag ended in a
  // drop. Both are read when the drag ends.
  const lastOver = useRef({ stage: null, at: 0 });
  const dropped = useRef(false);

  const handleDragStart = (e, record) => {
    dropped.current = false;
    lastOver.current = { stage: null, at: 0 };
    setDragId(record.id);
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", record.id);
    } catch (err) {
      console.error("[crm] drag could not start:", err?.message || err);
    }
  };
  const endDrag = () => {
    stopScrolling();
    setDragId(null);
    setOverStage(null);
  };
  // The drag is over. A card let go over a column that will never take it
  // (Live sets itself; a Live host only leaves for Lost) gets no drop from the
  // browser, because that column is not a drop target. Letting go there must
  // not be silent: the move is asked for anyway, and the page answers it in
  // plain words without moving anything. The column still never LOOKS like a
  // place to drop.
  const handleDragEnd = (e) => {
    const record = dragged;
    const wasDropped = dropped.current;
    endDrag();
    if (!record || wasDropped || disabled) return;
    let stageId = null;
    if (e && (e.clientX || e.clientY)) {
      const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.closest?.("[data-stage]"));
      stageId = under ? under.closest("[data-stage]").getAttribute("data-stage") : null;
    } else if (e && e.timeStamp - lastOver.current.at < 700) {
      // A browser that gives no position for the end of a drag.
      stageId = lastOver.current.stage;
    }
    if (!stageId || stageId === record.stage) return;
    const block = moveBlocker(def, record, stageId);
    if (block && (block.token === "stage_sets_itself" || block.token === "stage_is_live")) onMove(record, stageId);
  };
  const handleDrop = (e, stageId) => {
    e.preventDefault();
    dropped.current = true;
    const id = dragId || e.dataTransfer.getData("text/plain");
    endDrag();
    const record = records.find((r) => r.id === id);
    if (record && record.stage !== stageId) onMove(record, stageId);
  };
  // A column that will never take this card (Live sets itself; a Live host
  // only leaves for Lost) must not LOOK like a place to drop it.
  const refusal = (stageId) => {
    if (!dragged || dragged.stage === stageId) return null;
    const block = moveBlocker(def, dragged, stageId);
    return block && (block.token === "stage_sets_itself" || block.token === "stage_is_live") ? block : null;
  };

  return (
    <div
      role="region"
      aria-label={`${def.label} board`}
      tabIndex={0}
      ref={scrollerRef}
      onDragOver={canDrag && !disabled ? steerScroll : undefined}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) stopScrolling();
      }}
      className="max-w-full overflow-x-auto rounded-[var(--radius-md)] pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
    >
      <div className={BOARD_CLASS}>
        {columns.map((column) => {
          const stageId = column.stageId;
          const cards = column.cards;
          const droppable = !!stageId && canDrag && !disabled;
          const over = !!stageId && overStage === stageId && dragId !== null;
          const refused = over ? refusal(stageId) : null;
          const isOver = over && !refused;
          const { shown, hidden } = columnShown(column, !!expanded[column.id]);
          return (
            <section
              key={column.id}
              aria-label={`${column.label}, ${cards.length} ${cards.length === 1 ? "card" : "cards"}`}
              data-stage={stageId || undefined}
              data-column={column.id}
              onDragOver={
                droppable
                  ? (e) => {
                      if (overStage !== stageId) setOverStage(stageId);
                      lastOver.current = { stage: stageId, at: e.timeStamp };
                      // Not calling preventDefault is what tells the browser
                      // "no drop here": the pointer shows the not-allowed sign.
                      if (refusal(stageId)) {
                        e.dataTransfer.dropEffect = "none";
                        return;
                      }
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }
                  : undefined
              }
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setOverStage((s) => (s === stageId ? null : s));
              }}
              onDrop={droppable ? (e) => handleDrop(e, stageId) : undefined}
              className={[
                COLUMN_CLASS,
                column.kind === "stale" ? "bg-[var(--color-warning-50)]" : "",
                column.terminal && !expanded[column.id] ? "min-h-0" : "",
                isOver ? "outline outline-2 -outline-offset-2 outline-[var(--color-brand-500)]" : "",
                refused ? "cursor-not-allowed opacity-70 outline-dashed outline-1 -outline-offset-1 outline-[var(--gray-400)]" : "",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2 px-0.5">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
                  {column.label}
                  {column.auto && (
                    <span className="rounded-full bg-[var(--color-background-primary)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                      auto
                    </span>
                  )}
                </h3>
                <span data-column-count={column.id} className="text-xs tabular-nums text-[var(--color-text-tertiary)]">{cards.length}</span>
              </div>
              {column.hint && <p className="px-0.5 text-xs text-[var(--color-text-tertiary)]">{column.hint}</p>}
              {column.kind === "stale" && staleAction}
              {refused && (
                <p role="status" className="rounded-[var(--radius-sm)] bg-[var(--color-background-primary)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)]">
                  Can&apos;t drop here. {refused.message}
                </p>
              )}
              {cards.length === 0 ? (
                <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--gray-300)] px-2 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
                  {column.kind === "stale" ? "Nothing is past its date" : column.auto ? "Fills in by itself" : canDrag && stageId ? "Drop a card here" : "Nothing here yet"}
                </p>
              ) : (
                <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 py-0.5">
                  {shown.map((record) => (
                  <RecordCard
                    key={record.id}
                    record={record}
                    def={def}
                    regions={regions}
                    team={team}
                    today={today}
                    stageTag={column.kind === "stale" ? stageLabel(def, record.stage) : ""}
                    pending={pendingIds.has(record.id)}
                    disabled={disabled}
                    canDrag={canDrag}
                    onOpen={onOpen}
                    onMove={onMove}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  />
                  ))}
                  {hidden > 0 && (
                    <button
                      type="button"
                      data-show-all={column.id}
                      onClick={() => setExpanded((x) => ({ ...x, [column.id]: true }))}
                      className="min-h-11 rounded-[var(--radius-sm)] border border-dashed border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-xs font-semibold text-[var(--color-brand-700)] hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
                    >
                      {shown.length === 0 ? `Show ${cards.length}` : `Show all ${cards.length}`}
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
