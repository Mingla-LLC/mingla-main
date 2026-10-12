import { useState } from "react";
import { Skeleton } from "../ui/Skeleton";
import { RecordCard } from "./RecordCard";
import { groupByStage } from "../../lib/crmModel";

const COLUMN_CLASS =
  "flex min-h-[180px] flex-col gap-2 rounded-[var(--radius-md)] bg-[var(--gray-100)] p-2.5";
const BOARD_CLASS = "grid grid-flow-col auto-cols-[minmax(200px,1fr)] gap-3";

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

  return (
    <div
      role="region"
      aria-label={`${def.label} board`}
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-[var(--radius-md)] pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
    >
      <div className={BOARD_CLASS}>
        {def.stages.map((stage) => {
          const cards = groups[stage.id] || [];
          const isOver = overStage === stage.id && dragId !== null;
          return (
            <section
              key={stage.id}
              aria-label={`${stage.label}, ${cards.length} ${cards.length === 1 ? "card" : "cards"}`}
              data-stage={stage.id}
              onDragOver={
                canDrag && !disabled
                  ? (e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (overStage !== stage.id) setOverStage(stage.id);
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
              {cards.length === 0 ? (
                <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--gray-300)] px-2 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
                  {stage.auto ? "Fills in by itself" : canDrag ? "Drop a card here" : "Nothing here yet"}
                </p>
              ) : (
                cards.map((record) => (
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
                ))
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
