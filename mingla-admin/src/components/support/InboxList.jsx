// Issue #4420 (step 5) — the left side of the Support chat inbox: search, the
// label chips, "Open · N" on top and a "Resolved · N" section pinned at the
// bottom that is closed until it is clicked. Each row: name · brand, the last
// message snippet, the time and its labels. Reported enquiries sit in the same
// list. The words and the order come from lib/supportInboxModel.js.
import { ChevronDown, ChevronRight, LifeBuoy } from "lucide-react";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { SearchInput } from "../ui/SearchInput";
import { LabelChips } from "./InboxLabels";
import { INBOX_CHIPS, rowLabels, rowPreview, rowTitle } from "../../lib/supportInboxModel";
import { waitLabel } from "../../lib/supportTicketMetrics";
import { formatReportedAt } from "../../lib/reportedEnquiries";
import { isWebsiteRequestTicket, websiteRequestClock } from "../../lib/websiteRequestModel";

function Row({ row, selected, onSelect, linkedByConversation, previews, lookups }) {
  const linked = row.kind === "conversation" ? linkedByConversation[row.id] || [] : [];
  const labels = rowLabels(row, linked);
  const title = rowTitle(row, lookups);
  const snippet = rowPreview(row, row.kind === "conversation" ? previews[row.ticket.conversation_id] : null);
  const when = row.kind === "reported" ? formatReportedAt(row.at) : waitLabel(row.ticket);
  // #4453: a website change request shows its 24-hour clock.
  const clock = row.kind === "conversation" && isWebsiteRequestTicket(row.ticket) ? websiteRequestClock(row.ticket) : null;
  return (
    <li>
      <button
        type="button"
        data-row={row.key}
        onClick={() => onSelect(row)}
        aria-current={selected ? "true" : undefined}
        aria-label={`Open ${row.kind === "reported" ? "reported enquiry" : "conversation"} with ${title}`}
        className={`flex w-full min-w-0 flex-col gap-1 px-4 py-3 text-left hover:bg-[var(--gray-50)] ${selected ? "bg-[var(--color-brand-50)]" : ""}`}
      >
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{title}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-text-tertiary)]">{when}</span>
        </span>
        <span className="truncate text-xs text-[var(--color-text-secondary)]">{snippet}</span>
        <span className="flex flex-wrap gap-1"><LabelChips labels={labels} />{clock && clock.state !== "done" ? <span className="inline-flex items-center rounded-full bg-[var(--gray-100)] px-2 py-0.5 text-[11px] font-medium text-[var(--gray-700)]">{clock.label}</span> : null}</span>
      </button>
    </li>
  );
}

/**
 * Props: loading, error, onRetry, open (rows), resolved (rows), chip, onChip,
 * search, onSearch, resolvedOpen, onToggleResolved, selectedKey, onSelect(row),
 * linkedByConversation, previews, lookups, coverageNote, canLoadOlder,
 * loadingOlder, onLoadOlder, filtersActive, notice (a non-blocking line).
 */
export function InboxList({
  loading, error, onRetry, open, resolved, chip, onChip, search, onSearch,
  resolvedOpen, onToggleResolved, selectedKey, onSelect, linkedByConversation, previews, lookups,
  coverageNote, canLoadOlder, loadingOlder, onLoadOlder, filtersActive, notice,
}) {
  const rowProps = { onSelect, linkedByConversation, previews, lookups };
  return (
    <section aria-label="Conversations" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] lg:h-[calc(100vh-180px)]">
      <div className="space-y-2 border-b border-[var(--gray-200)] p-3">
        <SearchInput
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          onClear={() => onSearch("")}
          placeholder="Search name, brand, topic or number"
          aria-label="Search conversations"
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {INBOX_CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={chip === c.id}
              onClick={() => onChip(chip === c.id ? "" : c.id)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${chip === c.id ? "bg-[var(--color-brand-500)] text-white" : "bg-[var(--gray-100)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-200)]"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {notice ? <p role="status" className="text-xs text-[var(--color-text-tertiary)]">{notice}</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">Couldn't load the conversations</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">{error}</p>
            <Button variant="link" onClick={onRetry}>Try again</Button>
          </div>
        ) : (
          <>
            <h2 className="sticky top-0 z-10 border-b border-[var(--gray-100)] bg-[var(--color-background-primary)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Open · {open.length}</h2>
            {open.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <LifeBuoy className="h-9 w-9 text-[var(--gray-300)]" aria-hidden="true" />
                <p className="px-4 text-sm text-[var(--color-text-tertiary)]">{filtersActive ? "Nothing here for this search or filter." : "Nobody is waiting on us."}</p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--gray-100)]">
                {open.map((row) => <Row key={row.key} row={row} selected={row.key === selectedKey} {...rowProps} />)}
              </ul>
            )}
          </>
        )}
      </div>

      {!loading && !error ? (
        <div className="border-t border-[var(--gray-200)]">
          <button
            type="button"
            aria-expanded={resolvedOpen}
            aria-controls="inbox-resolved"
            onClick={onToggleResolved}
            className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]"
          >
            {resolvedOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            Resolved · {resolved.length}
          </button>
          {resolvedOpen ? (
            <div id="inbox-resolved" className="max-h-[40vh] overflow-y-auto border-t border-[var(--gray-100)]">
              {resolved.length === 0 ? (
                <p className="px-4 py-4 text-sm text-[var(--color-text-tertiary)]">{filtersActive ? "No resolved conversation matches." : "Nothing resolved yet."}</p>
              ) : (
                <ul className="divide-y divide-[var(--gray-100)]">
                  {resolved.map((row) => <Row key={row.key} row={row} selected={row.key === selectedKey} {...rowProps} />)}
                </ul>
              )}
              {coverageNote ? (
                <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--gray-100)] px-4 py-2 text-xs text-[var(--color-text-secondary)]">
                  <span>{coverageNote}</span>
                  {canLoadOlder ? <Button size="sm" variant="secondary" loading={loadingOlder} disabled={loadingOlder} onClick={onLoadOlder}>Load older</Button> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
