import { ArrowRight } from "lucide-react";
import { Button } from "../ui/Button";
import { DueBadge } from "./DueBadge";
import { displayOwners, icpLabel, nextStage, regionName } from "../../lib/crmModel";

/**
 * One card on the board. The card opens through a full-size button that sits
 * beside (not around) the arrow button, so each is its own control for a
 * keyboard and a screen reader.
 */
export function RecordCard({
  record,
  def,
  regions,
  team,
  today,
  pending = false,
  disabled = false,
  canDrag = false,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
}) {
  const next = nextStage(def, record);
  const icp = icpLabel(def, record.icp);
  const region = regionName(regions, record.region_id);
  const where = [icp, region].filter(Boolean).join(" · ") || "No ICP or region yet";
  const owners = displayOwners(record, team);
  const draggable = canDrag && !disabled && !pending;

  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart?.(e, record) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      data-record-id={record.id}
      aria-busy={pending || undefined}
      className={[
        "group relative rounded-[var(--radius-sm)] border border-[var(--gray-200)]",
        "bg-[var(--color-background-primary)] p-3 shadow-[var(--shadow-sm)] transition-opacity duration-150",
        pending ? "opacity-60" : "",
        draggable ? "cursor-grab active:cursor-grabbing" : "",
      ].join(" ")}
    >
      <button
        type="button"
        aria-label={`Open ${record.name}`}
        onClick={() => onOpen(record)}
        className="absolute inset-0 h-full w-full cursor-pointer rounded-[var(--radius-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
      />
      <div className="pointer-events-none relative">
        <p className="break-words text-sm font-semibold text-[var(--color-text-primary)]">{record.name}</p>
        <p className="mt-0.5 break-words text-xs text-[var(--color-text-secondary)]">{where}</p>
        <p className="mt-0.5 break-words text-xs text-[var(--color-text-tertiary)]">
          {owners}
          {record.next_action ? ` · ${record.next_action}` : ""}
        </p>
      </div>
      {(record.due_on || next) && (
        <div className="relative mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="pointer-events-none">
            <DueBadge dueOn={record.due_on} today={today} />
          </span>
          {next && (
            <Button
              variant="secondary"
              size="sm"
              className="max-sm:h-10"
              iconRight={ArrowRight}
              disabled={disabled || pending}
              title={`Move to ${next.label}`}
              aria-label={`Move ${record.name} to ${next.label}`}
              onClick={(e) => {
                e.stopPropagation();
                onMove(record, next.id);
              }}
            >
              {next.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
