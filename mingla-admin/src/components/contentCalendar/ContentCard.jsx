import { ArrowRight, CalendarClock, MessageSquare } from "lucide-react";
import { Badge } from "../ui/Badge";

export function ContentCard({ item, compact = false, onOpen, onMove, onStage, stages = [], draggable = false }) {
  const date = item.publish_at ? new Date(item.publish_at) : null;
  const validDate = date && !Number.isNaN(date.getTime());
  return (
    <article
      draggable={draggable}
      onDragStart={(event) => { event.dataTransfer.setData("text/x-mingla-content-id", item.id); event.dataTransfer.effectAllowed = "move"; }}
      className="rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-3 shadow-[var(--shadow-sm)]"
    >
      <button type="button" onClick={() => onOpen(item.id)} className="min-h-11 w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2">
        <span className="block break-words text-sm font-semibold text-[var(--color-text-primary)]">{item.title}</span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
          <Badge>{item.stage}</Badge>
          {validDate && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />{date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}
          {Number(item.comment_count || 0) > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />{item.comment_count}</span>}
        </span>
        {!compact && <span className="mt-2 block truncate text-xs text-[var(--color-text-secondary)]">{item.owners?.join(", ") || "Unassigned"}</span>}
      </button>
      {onMove && item.stage !== "published" && (
        <button type="button" onClick={() => onMove(item)} aria-label={`Move ${item.title} forward`} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-md border border-[var(--gray-300)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]">
          Next stage <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {onStage && <label className="mt-2 block"><span className="sr-only">Move {item.title} to stage</span><select value={item.stage} onChange={(event) => onStage(item, event.target.value)} className="min-h-11 w-full rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-xs text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]">{stages.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}</select></label>}
    </article>
  );
}
