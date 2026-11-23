// Issue #3980 — link a card to a real host, creator, brand, event, content
// card or expected event, searched in live Mingla data. Inline, no layer.
import { useEffect, useId, useRef, useState } from "react";
import * as ops from "../../services/opsService";
import { LINK_KINDS, linkLabelWords, linkSubWords, opsErrorWords } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

/** #4571 final gate: one search result. A booking's status shows as its word (linkSubWords), never the raw id. */
export function PickerResult({ kind, r, onPick }) {
  return (
    <li>
      <button type="button" onClick={() => onPick({ kind, id: r.id, label: r.label })} className={`flex min-h-11 w-full min-w-0 flex-col justify-center rounded-lg px-2 py-1 text-left hover:bg-[var(--gray-100)] ${FOCUS}`}>
        <span className="break-words text-[13px] font-medium text-[var(--color-text-primary)]">{linkLabelWords(r.label)}</span>
        {r.sub && <span data-picker-sub="" className="break-words text-[12px] text-[var(--color-text-tertiary)]">{linkSubWords(kind, r.sub)}</span>}
      </button>
    </li>
  );
}

export function RecordPicker({ onPick, onClose, kinds = LINK_KINDS }) {
  const id = useId();
  const [kind, setKind] = useState(kinds[0]?.value || "host");
  const [q, setQ] = useState("");
  // Results belong to the kind and words they were searched for; anything
  // else on screen is still searching.
  const [found, setFound] = useState({ kind: null, query: null, results: [], error: null });
  const seq = useRef(0);
  const query = q.trim();
  useEffect(() => {
    if (query.length < 2) return undefined;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        // #4420: a support conversation is found by customer name or number (Support staff only).
        const answer = kind === "support_conversation"
          ? { results: (await ops.searchConversations(query) || []).map((r) => ({ id: r.id, label: r.label, sub: [r.customer_name, r.segment === "business" ? "Host" : r.segment === "explorer" ? "Explorer" : ""].filter(Boolean).join(" · ") })) }
          : await ops.searchLinks(kind, query);
        if (mine === seq.current) setFound({ kind, query, results: answer?.results || [], error: null });
      } catch (error) {
        if (mine === seq.current) setFound({ kind, query, results: [], error });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [kind, query]);
  const current = found.kind === kind && found.query === query;
  const state = { loading: !current, results: current ? found.results : [], error: current ? found.error : null };
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-2">
      <div role="group" aria-label="Kind of record" className="flex min-w-0 flex-wrap gap-1">
        {kinds.map((k) => (
          <button
            key={k.value}
            type="button"
            aria-pressed={k.value === kind}
            onClick={() => setKind(k.value)}
            className={`min-h-11 rounded-lg px-3 text-[13px] font-semibold ${k.value === kind ? "bg-[var(--color-brand-800)] text-white" : "bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]"} ${FOCUS}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <input
        id={`${id}-q`}
        type="search"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search live Mingla data"
        aria-label="Search live Mingla data"
        className={`min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] text-[var(--color-text-primary)] ${FOCUS}`}
      />
      <div aria-live="polite" className="min-w-0">
        {q.trim().length < 2 ? (
          <p className="px-1 text-[13px] text-[var(--color-text-tertiary)]">Type at least 2 letters.</p>
        ) : state.loading ? (
          <p className="px-1 text-[13px] text-[var(--color-text-tertiary)]">Searching…</p>
        ) : state.error ? (
          <p role="alert" className="px-1 text-[13px] text-[var(--color-error-700)]">{opsErrorWords(state.error)}</p>
        ) : state.results.length === 0 ? (
          <p className="px-1 text-[13px] text-[var(--color-text-tertiary)]">Nothing found.</p>
        ) : (
          <ul className="flex min-w-0 flex-col">
            {state.results.map((r) => (
              <PickerResult key={r.id} kind={kind} r={r} onPick={onPick} />
            ))}
          </ul>
        )}
      </div>
      {onClose && <button type="button" onClick={onClose} className={`min-h-11 self-start rounded-lg px-2 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Done linking</button>}
    </div>
  );
}
