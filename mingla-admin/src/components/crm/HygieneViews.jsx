// Issue #4571 W6a — two views of the Hosts and Creators board for the SOP's
// hygiene steps: Show archived (?view=archived) and the Monday duplicate pairs
// (?view=duplicates). A row opens the card beside (&card=), where Unarchive and
// Merge live. Both lists come from the server (crm_records_archived_list,
// crm_duplicate_pairs).
import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { Badge } from "../ui/Badge";
import { duplicatePairs, listArchived } from "../../services/crmService";
import { loadErrorWords, stageLabel } from "../../lib/crmModel";
import { localWhen } from "../../lib/opsModel";
import { pairReasonWords } from "../../lib/sopTools";

function useLoad(load, deps) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: !s.data }));
    load().then(
      (data) => { if (live) setState({ loading: false, error: null, data }); },
      (error) => { if (live) setState((s) => ({ ...s, loading: false, error })); },
    );
    return () => { live = false; };
  }, [...deps, again]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, retry: () => setAgain((n) => n + 1) };
}

function Loading({ label }) {
  return <div className="flex flex-col gap-2" aria-busy="true" aria-label={label}><Skeleton height={56} /><Skeleton height={56} /></div>;
}

function Failed({ what, error, retry }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-error-700)]">
      <span>Couldn’t load {what}. {loadErrorWords(error)}</span>
      <Button variant="secondary" className="min-h-11" onClick={retry}>Try again</Button>
    </div>
  );
}

function Empty({ children }) {
  return <p className="rounded-xl border border-dashed border-[var(--gray-300)] px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">{children}</p>;
}

const ROW = "flex min-h-11 w-full min-w-0 flex-wrap items-center gap-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 py-2 text-left text-[13px] hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]";

export function ArchivedList({ pipeline, def, tick = 0, onOpen }) {
  const s = useLoad(() => listArchived(pipeline), [pipeline, tick]);
  if (s.loading) return <Loading label="Loading archived cards" />;
  if (s.error && !s.data) return <Failed what="the archived cards" error={s.error} retry={s.retry} />;
  const rows = Array.isArray(s.data?.records) ? s.data.records : [];
  if (!rows.length) return <Empty>Nothing is archived. Archive a card from its panel when it should leave the board.</Empty>;
  return (
    <div className="flex flex-col gap-1" aria-label="Archived cards">
      <p className="text-[12.5px] text-[var(--color-text-tertiary)]">
        {s.data.total} archived{s.data.truncated ? ", the newest 2,000 shown" : ""}. Open one to unarchive it.
      </p>
      {rows.map((r) => (
        <button key={r.id} type="button" className={ROW} onClick={() => onOpen(r.id)}>
          <span className="min-w-0 flex-1 truncate font-semibold text-[var(--color-text-primary)]">{r.name}</span>
          <Badge variant="default">{stageLabel(def, r.stage)}</Badge>
          <span className="w-full text-[12px] text-[var(--color-text-tertiary)]">
            {r.merged_into ? `Merged into ${r.merged_into.name}` : r.archived_reason} · {localWhen(r.archived_at)}
          </span>
        </button>
      ))}
    </div>
  );
}

export function DuplicatePairs({ pipeline, def, tick = 0, onOpen }) {
  const s = useLoad(() => duplicatePairs(pipeline), [pipeline, tick]);
  if (s.loading) return <Loading label="Loading duplicate pairs" />;
  if (s.error && !s.data) return <Failed what="the duplicate pairs" error={s.error} retry={s.retry} />;
  const pairs = Array.isArray(s.data?.pairs) ? s.data.pairs : [];
  if (!pairs.length) return <Empty>No duplicate pairs. Cards that share an email, phone, handle or website, or whose names contain each other, show here.</Empty>;
  return (
    <div className="flex flex-col gap-2" aria-label="Duplicate pairs">
      <p className="text-[12.5px] text-[var(--color-text-tertiary)]">
        {s.data.total} {s.data.total === 1 ? "pair" : "pairs"}{s.data.truncated ? ", the first 200 shown" : ""}. Open the card to keep, then use Merge a duplicate.
      </p>
      {pairs.map((p) => (
        <div key={`${p.a.id}-${p.b.id}`} className="flex min-w-0 flex-col gap-1 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-2">
          <Badge variant="warning">{pairReasonWords(p.reason)}</Badge>
          {[p.a, p.b].map((c) => (
            <button key={c.id} type="button" className={ROW} onClick={() => onOpen(c.id)}>
              <span className="min-w-0 flex-1 truncate font-semibold text-[var(--color-text-primary)]">{c.name}</span>
              <span className="text-[12px] text-[var(--color-text-tertiary)]">{stageLabel(def, c.stage)} · {c.touch_count} {Number(c.touch_count) === 1 ? "touch" : "touches"}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
