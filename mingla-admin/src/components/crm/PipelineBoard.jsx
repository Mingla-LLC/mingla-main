import { useEffect, useRef, useState } from "react";
import { Skeleton } from "../ui/Skeleton";
import { RecordCard } from "./RecordCard";
import { groupByStage, moveBlocker } from "../../lib/crmModel";

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
 * The board: one column per stage. It scrolls sideways inside its own box, so
 * the page itself never scrolls sideways. Dragging is offered only where there
 * is a mouse or trackpad; the arrow on each card and the stage menu inside the
 * card work everywhere.
 */
export function PipelineBoard({
  def,
  records,
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
  const groups = groupByStage(def, records);
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

  const handleDragStart = (e, record) => {
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
  const handleDrop = (e, stageId) => {
    e.preventDefault();
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
        {def.stages.map((stage) => {
          const cards = groups[stage.id] || [];
          const over = overStage === stage.id && dragId !== null;
          const refused = over ? refusal(stage.id) : null;
          const isOver = over && !refused;
          return (
            <section
              key={stage.id}
              aria-label={`${stage.label}, ${cards.length} ${cards.length === 1 ? "card" : "cards"}`}
              data-stage={stage.id}
              onDragOver={
                canDrag && !disabled
                  ? (e) => {
                      if (overStage !== stage.id) setOverStage(stage.id);
                      // Not calling preventDefault is what tells the browser
                      // "no drop here": the pointer shows the not-allowed sign.
                      if (refusal(stage.id)) {
                        e.dataTransfer.dropEffect = "none";
                        return;
                      }
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }
                  : undefined
              }
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setOverStage((s) => (s === stage.id ? null : s));
              }}
              onDrop={canDrag && !disabled ? (e) => handleDrop(e, stage.id) : undefined}
              className={[
                COLUMN_CLASS,
                isOver ? "outline outline-2 -outline-offset-2 outline-[var(--color-brand-500)]" : "",
                refused ? "cursor-not-allowed opacity-70 outline-dashed outline-1 -outline-offset-1 outline-[var(--gray-400)]" : "",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2 px-0.5">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
                  {stage.label}
                  {stage.auto && (
                    <span className="rounded-full bg-[var(--color-background-primary)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                      auto
                    </span>
                  )}
                </h3>
                <span className="text-xs tabular-nums text-[var(--color-text-tertiary)]">{cards.length}</span>
              </div>
              <p className="px-0.5 text-xs text-[var(--color-text-tertiary)]">{stage.hint}</p>
              {refused && (
                <p role="status" className="rounded-[var(--radius-sm)] bg-[var(--color-background-primary)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)]">
                  Can&apos;t drop here. {refused.message}
                </p>
              )}
              {cards.length === 0 ? (
                <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--gray-300)] px-2 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
                  {stage.auto ? "Fills in by itself" : canDrag ? "Drop a card here" : "Nothing here yet"}
                </p>
              ) : (
                <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 py-0.5">
                  {cards.map((record) => (
                  <RecordCard
                    key={record.id}
                    record={record}
                    def={def}
                    regions={regions}
                    team={team}
                    today={today}
                    pending={pendingIds.has(record.id)}
                    disabled={disabled}
                    canDrag={canDrag}
                    onOpen={onOpen}
                    onMove={onMove}
                    onDragStart={handleDragStart}
                    onDragEnd={endDrag}
                  />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
