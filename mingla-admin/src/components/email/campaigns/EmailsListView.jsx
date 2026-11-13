// Issue #4419 — the Emails tab: every email, scheduled to sent, in one list.
//
// Filter chips with counts, a debounced search, one row per email (thumbnail,
// subject and preview line, audience and who, status with the one time that
// matters, the count that matters). A failed load is never "No emails yet":
// it says it couldn't load and offers Try again.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Mail, Pencil, RotateCcw, Search } from "lucide-react";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { listCampaigns } from "../../../services/adminSendEmailService";
import { emailErrorWords } from "../../../lib/emailFailureWords";
import {
  campaignAudienceLabel,
  listCount,
  listFiltersFor,
  listWhen,
  pageRange,
  sampleText,
  statePill,
} from "./campaignModel";

const EMPTY_COUNTS = { all: 0, scheduled: 0, sending: 0, sent: 0, attention: 0, cancelled: 0 };

function Thumb({ url }) {
  if (url) {
    return (
      <span className="block h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-[var(--gray-200)] bg-white max-[720px]:h-10 max-[720px]:w-12" aria-hidden="true">
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] text-[var(--color-text-tertiary)] max-[720px]:h-10 max-[720px]:w-12" aria-hidden="true">
      <Mail className="h-4 w-4" />
    </span>
  );
}

function TechnicalDetail({ text }) {
  if (!text) return null;
  return (
    <details className="w-full max-w-[44ch] text-left">
      <summary className="cursor-pointer text-xs text-[var(--color-text-tertiary)]">Technical detail for engineering</summary>
      <div className="mt-2 break-words rounded-lg bg-[var(--gray-50)] px-2.5 py-2 font-mono text-[11px] text-[var(--color-text-tertiary)]">{text}</div>
    </details>
  );
}

function SkeletonRows() {
  return Array.from({ length: 5 }).map((_, i) => (
    <div key={i} data-skeleton-row="" className="flex items-center gap-4 border-b border-[var(--gray-100)] px-5 py-3.5 last:border-b-0">
      <span className="h-12 w-16 shrink-0 animate-pulse rounded-lg bg-[var(--gray-100)] motion-reduce:animate-none" />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="h-3.5 w-2/3 animate-pulse rounded bg-[var(--gray-100)] motion-reduce:animate-none" />
        <span className="h-3 w-1/2 animate-pulse rounded bg-[var(--gray-100)] motion-reduce:animate-none" />
      </span>
      <span className="hidden h-5 w-24 animate-pulse rounded bg-[var(--gray-100)] motion-reduce:animate-none sm:block" />
    </div>
  ));
}

function StateBox({ icon, tone = "neutral", title, text, children }) {
  const Icon = icon;
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone === "error" ? "bg-[var(--color-error-50)] text-[var(--color-error-700)]" : "bg-[var(--gray-100)] text-[var(--color-text-tertiary)]"}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</h3>
      <p className="max-w-[44ch] text-sm text-[var(--color-text-secondary)]">{text}</p>
      {children}
    </div>
  );
}

/**
 * What the list shows for a given load state. Presentational: the container
 * below owns loading; tests render this directly for every state.
 */
export function EmailsListBody({
  status, rows = [], counts = EMPTY_COUNTS, total = 0, page = 0, pageSize = 20,
  filter = "all", query = "", isAdmin = false, error = null, now = null,
  onFilter, onQuery, onRetry, onOpen, onWrite, onPage,
}) {
  const chips = listFiltersFor(isAdmin);
  let body;
  if (status === "loading") {
    body = <SkeletonRows />;
  } else if (status === "error") {
    const said = emailErrorWords(error);
    body = (
      <StateBox icon={AlertTriangle} tone="error" title="Couldn't load your emails" text={said.words}>
        <Button icon={RotateCcw} onClick={onRetry}>Try again</Button>
        <TechnicalDetail text={said.technical} />
      </StateBox>
    );
  } else if (!rows.length) {
    body = Number(counts.all) === 0 && !query
      ? (
        <StateBox icon={Mail} title="No emails yet" text="Everything you send or schedule shows up here, with the exact copy people got.">
          <Button icon={Pencil} onClick={onWrite}>Write an email</Button>
        </StateBox>
      )
      : (
        <StateBox icon={Search} title="Nothing matches" text={`No emails in this filter${query ? ` for “${query}”` : ""}.`}>
          <Button variant="secondary" onClick={() => { onQuery?.(""); onFilter?.("all"); }}>Show all emails</Button>
        </StateBox>
      );
  } else {
    body = rows.map((row) => {
      const pill = statePill(row.state, row.state_label);
      const count = listCount(row);
      return (
        <button
          key={row.id}
          type="button"
          data-email-row={row.id}
          onClick={() => onOpen?.(row.id)}
          aria-label={`Open ${sampleText(row.subject)}`}
          className="grid w-full grid-cols-[64px_minmax(0,1fr)_150px_200px_120px] items-center gap-4 border-b border-[var(--gray-100)] px-5 py-3.5 text-left last:border-b-0 hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-500)] max-[1080px]:grid-cols-[56px_minmax(0,1fr)_180px_110px] max-[720px]:grid-cols-[48px_minmax(0,1fr)] max-[720px]:gap-3 max-[720px]:px-4"
        >
          <Thumb url={row.thumb_url} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{sampleText(row.subject)}</span>
            <span className="truncate text-[13px] text-[var(--color-text-tertiary)]">{sampleText(row.preheader) || " "}</span>
          </span>
          <span className="min-w-0 text-[13px] text-[var(--color-text-secondary)] max-[1080px]:hidden">
            <span className="block truncate">{campaignAudienceLabel(row)}</span>
            {row.by_name ? <span className="block truncate text-xs text-[var(--color-text-tertiary)]">by {row.by_name}</span> : null}
          </span>
          <span className="flex min-w-0 flex-col items-start gap-1 text-xs text-[var(--color-text-tertiary)] max-[720px]:col-start-2 max-[720px]:flex-row max-[720px]:flex-wrap max-[720px]:items-center">
            <Badge variant={pill.variant} dot>{pill.label}</Badge>
            <span>{listWhen(row, now ?? undefined)}</span>
          </span>
          <span className="text-right text-[13px] tabular-nums text-[var(--color-text-secondary)] max-[720px]:col-start-2 max-[720px]:text-left">
            <b className="font-semibold text-[var(--color-text-primary)]">{count.big}</b> {count.words}
            <span className="block text-xs text-[var(--color-text-tertiary)]">{count.small}</span>
          </span>
        </button>
      );
    });
  }

  const lastPage = Math.max(Math.ceil(Number(total || 0) / pageSize) - 1, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter emails">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={filter === chip.id}
              onClick={() => onFilter?.(chip.id)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium ${filter === chip.id ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:border-[var(--gray-300)]"}`}
            >
              {chip.label}
              <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${chip.id === "attention" && Number(counts.attention) > 0 ? "bg-[var(--color-error-50)] text-[var(--color-error-700)]" : "bg-[var(--gray-100)] text-[var(--color-text-tertiary)]"}`}>
                {status === "ready" ? Number(counts[chip.id] || 0).toLocaleString("en-US") : "–"}
              </span>
            </button>
          ))}
        </div>
        <label className="flex min-h-9 min-w-0 flex-[0_1_260px] items-center gap-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 text-[var(--color-text-tertiary)] max-[720px]:flex-[1_1_100%]">
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <input
            type="search"
            value={query}
            maxLength={100}
            onChange={(event) => onQuery?.(event.target.value)}
            placeholder="Search subject"
            aria-label="Search emails"
            className="w-full min-w-0 bg-transparent text-sm text-[var(--color-text-primary)] outline-none"
          />
        </label>
      </div>
      {!isAdmin ? <p className="text-xs text-[var(--color-text-tertiary)]">You see scheduled emails. Only admins see sent emails.</p> : null}
      <div className="overflow-hidden rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)]">
        <div aria-busy={status === "loading"}>{body}</div>
        {status === "ready" && rows.length ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--gray-100)] px-5 py-3 text-xs text-[var(--color-text-tertiary)]">
            <span>Newest first · scheduled emails pinned on top</span>
            <span className="flex items-center gap-2 tabular-nums">
              {pageRange(page, pageSize, total)}
              {lastPage > 0 ? (
                <>
                  <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label="Previous page" disabled={page <= 0} onClick={() => onPage?.(page - 1)} />
                  <Button size="sm" variant="ghost" icon={ChevronRight} aria-label="Next page" disabled={page >= lastPage} onClick={() => onPage?.(page + 1)} />
                </>
              ) : null}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The container: loads a page for the filter, search and page number. */
export function EmailsListView({ isAdmin, initialFilter = "all", onOpen, onWrite, onFilterChange, onSessionExpired }) {
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [state, setState] = useState({ status: "loading", rows: [], counts: EMPTY_COUNTS, total: 0, error: null });
  const seq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, status: "loading", error: null }));
    try {
      const result = await listCampaigns({ filter, query: debounced, page });
      if (mine !== seq.current) return;
      setState({ status: "ready", rows: result.rows || [], counts: result.counts || EMPTY_COUNTS, total: result.total || 0, error: null });
    } catch (error) {
      if (mine !== seq.current) return;
      if (error?.name === "SessionExpiredError") onSessionExpired?.();
      setState({ status: "error", rows: [], counts: EMPTY_COUNTS, total: 0, error });
    }
  }, [filter, debounced, page, onSessionExpired]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  return (
    <EmailsListBody
      {...state}
      page={page}
      filter={filter}
      query={query}
      isAdmin={isAdmin}
      onFilter={(next) => { setFilter(next); setPage(0); onFilterChange?.(next); }}
      onQuery={(next) => { setQuery(next); setPage(0); }}
      onRetry={() => void load()}
      onOpen={onOpen}
      onWrite={onWrite}
      onPage={setPage}
    />
  );
}
