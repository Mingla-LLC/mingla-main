// Issue #3980 — link a card to a real host, creator, brand, event, content
// card or expected event, searched in live Mingla data. Inline, no layer.
import { useEffect, useId, useRef, useState } from "react";
import * as ops from "../../services/opsService";
import { LINK_KINDS, opsErrorWords } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function RecordPicker({ onPick, onClose, kinds = LINK_KINDS }) {
  const id = useId();
  const [kind, setKind] = useState(kinds[0]?.value || "host");
  const [q, setQ] = useState("");
  const [state, setState] = useState({ loading: false, results: [], error: null });
  const seq = useRef(0);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setState({ loading: false, results: [], error: null }); return undefined; }
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(async () => {
      try {
        const answer = await ops.searchLinks(kind, query);
        if (mine === seq.current) setState({ loading: false, results: answer?.results || [], error: null });
      } catch (error) {
        if (mine === seq.current) setState({ loading: false, results: [], error });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [kind, q]);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-2">
      <div role="group" aria-label="Kind of record" className="flex min-w-0 flex-wrap gap-1">
        {kinds.map((k) => (
          <button
            key={k.value}
            type="button"
            aria-pressed={k.value === kind}
            onClick={() => { setKind(k.value); setState({ loading: false, results: [], error: null }); }}
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
              <li key={r.id}>
                <button type="button" onClick={() => onPick({ kind, id: r.id, label: r.label })} className={`flex min-h-11 w-full min-w-0 flex-col justify-center rounded-lg px-2 py-1 text-left hover:bg-[var(--gray-100)] ${FOCUS}`}>
                  <span className="break-words text-[13px] font-medium text-[var(--color-text-primary)]">{r.label}</span>
                  {r.sub && <span className="break-words text-[12px] text-[var(--color-text-tertiary)]">{r.sub}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {onClose && <button type="button" onClick={onClose} className={`min-h-11 self-start rounded-lg px-2 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Done linking</button>}
    </div>
  );
}
