import { useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { Skeleton } from "../ui/Skeleton";
import { RecordCard } from "./RecordCard";
import { moveBlocker, stageLabel } from "../../lib/crmModel";
import { columnShown } from "../../lib/outreachView";
import { collisions, columnKeyboardCoordinates } from "../ops/WorkBoard";

// A column never grows past the screen: its cards scroll inside it, so a
// column of 200 cards is as tall as a column of 5.
const COLUMN_CLASS =
  "flex min-h-[180px] max-h-[min(72vh,760px)] flex-col gap-2 rounded-[var(--radius-md)] bg-[var(--gray-100)] p-2.5";
// #4571 design v5: 264px columns so a card's five lines read without clipping.
const BOARD_CLASS = "grid grid-flow-col auto-cols-[minmax(264px,1fr)] gap-3.5";

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
 * never scrolls sideways. #4571 W3: dragging is dnd-kit, the same as the Work
 * board (WorkBoard.jsx): a mouse or trackpad drags after 6px, and the keyboard
 * picks a focused card up with Space, moves it a column at a time with the
 * arrow keys and drops it with Space (Escape cancels). dnd-kit scrolls the
 * board sideways near its edges. Every drop goes through onMove, the page's one
 * stage move (the hook's moveStage); a move the server refuses (Live sets
 * itself, a Live host only leaves for Lost, Demo booked needs a linked demo)
 * is answered by the page in the server's words and nothing moves. The arrow
 * on each card and the stage menu inside the card work everywhere. Stale is
 * not a stage: nothing drops there. #4255: a column shows 8 cards, then "Show
 * all N"; its count is always every card in it.
 */
const ANNOUNCE = {
  onDragStart: ({ active }) => `Picked up ${active.data.current?.record?.name || "the card"}. Use the left and right arrow keys to choose a stage, Space to drop, Escape to cancel.`,
  onDragOver: ({ active, over }) => (over ? `${active.data.current?.record?.name || "The card"} is over ${over.data.current?.column?.name}.` : "Not over a stage."),
  onDragEnd: ({ active, over }) => (over ? `Dropped in ${over.data.current?.column?.name}.` : `${active.data.current?.record?.name || "The card"} put back.`),
  onDragCancel: () => "Cancelled. Nothing moved.",
};

function DraggableRecord({ record, draggable, ...rest }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `record:${record.id}`, data: { type: "card", record }, disabled: !draggable });
  return <RecordCard record={record} canDrag={draggable} drag={{ ref: setNodeRef, attributes, listeners, isDragging }} {...rest} />;
}

function StageColumn({ column, droppable, dragged, refusal, children, className }) {
  const stageId = column.stageId;
  const { setNodeRef, isOver } = useDroppable({
    id: `stage:${column.id}`,
    data: { type: "column", column: { id: column.id, name: column.label, stageId } },
    disabled: !droppable,
  });
  const over = isOver && !!dragged && dragged.stage !== stageId;
  const refused = over ? refusal(stageId) : null;
  return children({ setNodeRef, isOver: over && !refused, refused, className });
}

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
  const [dragged, setDragged] = useState(null);
  const [expanded, setExpanded] = useState({});
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space picks up and drops; Enter still opens the card.
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );
  // A column that will never take this card (Live sets itself; a Live host
  // only leaves for Lost) must not LOOK like a place to drop it.
  const refusal = (stageId) => {
    if (!dragged || dragged.stage === stageId) return null;
    const block = moveBlocker(def, dragged, stageId);
    return block && (block.token === "stage_sets_itself" || block.token === "stage_is_live") ? block : null;
  };
  const onDragStart = ({ active }) => setDragged(active.data.current?.record || null);
  const onDragEnd = ({ active, over }) => {
    const record = active.data.current?.record;
    setDragged(null);
    if (!record || disabled || !over || over.data.current?.type !== "column") return;
    const stageId = over.data.current.column.stageId;
    // A drop is never silent: even onto a column that will not take it, the
    // move is asked for and the page answers it in plain words.
    if (stageId && stageId !== record.stage) onMove(record, stageId);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collisions}
      accessibility={{ announcements: ANNOUNCE, screenReaderInstructions: { draggable: "To move a card, press Space, then the left and right arrow keys to choose a stage, and Space again to drop it. Escape cancels. Enter opens the card." } }}
      onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragged(null)}>
    <div
      role="region"
      aria-label={`${def.label} board`}
      tabIndex={0}
      data-pipeline-board="dnd"
      className="relative max-w-full overflow-x-auto rounded-[var(--radius-md)] pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
    >
      <div className={BOARD_CLASS}>
        {columns.map((column) => {
          const stageId = column.stageId;
          const cards = column.cards;
          const droppable = !!stageId && canDrag && !disabled;
          const { shown, hidden } = columnShown(column, !!expanded[column.id]);
          return (
            <StageColumn key={column.id} column={column} droppable={droppable} dragged={dragged} refusal={refusal}>
              {({ setNodeRef, isOver, refused }) => (
            <section
              ref={setNodeRef}
              aria-label={`${column.label}, ${cards.length} ${cards.length === 1 ? "card" : "cards"}`}
              data-stage={stageId || undefined}
              data-column={column.id}
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
                  <DraggableRecord
                    key={record.id}
                    record={record}
                    def={def}
                    regions={regions}
                    team={team}
                    today={today}
                    stageTag={column.kind === "stale" ? stageLabel(def, record.stage) : ""}
                    pending={pendingIds.has(record.id)}
                    disabled={disabled}
                    draggable={canDrag && !disabled && !pendingIds.has(record.id)}
                    onOpen={onOpen}
                    onMove={onMove}
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
              )}
            </StageColumn>
          );
        })}
      </div>
    </div>
      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <div className="w-[220px] rotate-[1.5deg] rounded-[var(--radius-sm)] border border-[var(--color-brand-500)] bg-[var(--color-background-primary)] p-3 text-sm font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-lg)]">
            {dragged.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
