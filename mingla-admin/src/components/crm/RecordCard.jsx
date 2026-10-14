import { ArrowRight } from "lucide-react";
import { Button } from "../ui/Button";
import { DueBadge } from "./DueBadge";
import { Badge } from "../ui/Badge";
import { contactRuleView, displayOwners, icpLabel, nextStage, recordOpenLabel, regionName } from "../../lib/crmModel";

/**
 * One card on the board. The whole card is a button (Enter or Space opens
 * it); the arrow is a real button inside it that keeps its own click. The card
 * itself is the draggable element, so a drag can start anywhere on it in every
 * browser.
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
  const rule = contactRuleView(record, team);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={recordOpenLabel(record, team)}
      aria-busy={pending || undefined}
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart?.(e, record) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={() => onOpen(record)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(record);
        }
      }}
      data-record-id={record.id}
      className={[
        "group rounded-[var(--radius-sm)] border border-[var(--gray-200)]",
        "bg-[var(--color-background-primary)] p-3 shadow-[var(--shadow-sm)] transition-opacity duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
        pending ? "opacity-60" : "",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      ].join(" ")}
    >
      <p className="break-words text-sm font-semibold text-[var(--color-text-primary)]">{record.name}</p>
      {rule && (
        <p className="mt-1" title={rule.reason || undefined}>
          <Badge variant={rule.variant}>{rule.label}</Badge>
        </p>
      )}
      <p className="mt-0.5 break-words text-xs text-[var(--color-text-secondary)]">{where}</p>
      <p className="mt-0.5 break-words text-xs text-[var(--color-text-tertiary)]">
        {owners}
        {record.next_action ? ` \u00b7 ${record.next_action}` : ""}
      </p>
      {(record.due_on || next) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span>
            <DueBadge dueOn={record.due_on} today={today} />
          </span>
          {next && (
            <Button
              variant="secondary"
              size="sm"
              className="max-sm:h-11"
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
