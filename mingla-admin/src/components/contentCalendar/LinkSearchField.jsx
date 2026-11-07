// Issue #4270 (Wave 3) — pick one brand or one creator for a Calendar post
// (searched by name with ops_link_search), or clear it.
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { CONTROL_CLASS } from "../crm/fields";
import * as ops from "../../services/opsService";
import { opsErrorWords } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function LinkSearchField({ id, label, kind, value, helper, disabled, onPick, emptyWords = "None" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [state, setState] = useState({ loading: false, rows: [], error: "" });
  const seq = useRef(0);
  useEffect(() => {
    if (!open) return undefined;
    const text = q.trim();
    if (text.length < 2) return undefined;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true, error: "" }));
      try {
        const answer = await ops.searchLinks(kind, text);
        if (mine === seq.current) setState({ loading: false, rows: answer?.results || [], error: "" });
      } catch (error) {
        if (mine === seq.current) setState({ loading: false, rows: [], error: opsErrorWords(error) });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [open, q, kind]);

  const helperId = helper ? `${id}-help` : undefined;
  const searching = q.trim().length >= 2;
  const rows = searching ? state.rows : [];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{label}</span>
      {!open ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span data-link-value={kind} className="min-w-0 break-words text-sm text-[var(--color-text-primary)]">{value?.name || <span className="text-[var(--color-text-tertiary)]">{emptyWords}</span>}</span>
          <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={disabled} aria-describedby={helperId} onClick={() => { setQ(""); setOpen(true); }}>{value?.id ? "Change" : "Choose"}</Button>
          {value?.id && <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={disabled} onClick={() => onPick(null)}>Clear</Button>}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={id} className="sr-only">Search for a {kind}</label>
          <input id={id} autoFocus className={`${CONTROL_CLASS} min-h-11`} value={q} placeholder={`Type a ${kind} name`} disabled={disabled} onChange={(e) => setQ(e.target.value)} aria-describedby={helperId} />
          {searching && state.loading && <span role="status" className="text-xs text-[var(--color-text-tertiary)]">Searching…</span>}
          {searching && state.error && <span role="alert" className="text-xs text-[var(--color-error-700)]">{state.error}</span>}
          {searching && !state.loading && !state.error && rows.length === 0 && <span className="text-xs text-[var(--color-text-tertiary)]">No match.</span>}
          <ul className="flex min-w-0 flex-col gap-1">
            {rows.map((row) => (
              <li key={row.id}>
                <button type="button" disabled={disabled} onClick={() => { onPick({ id: row.id, name: row.label }); setOpen(false); }}
                  className={`flex min-h-11 w-full min-w-0 flex-col items-start rounded-md px-2 py-1 text-left text-sm hover:bg-[var(--gray-50)] ${FOCUS}`}>
                  <span className="break-words font-semibold text-[var(--color-text-primary)]">{row.label}</span>
                  {row.sub && <span className="text-xs text-[var(--color-text-tertiary)]">{row.sub}</span>}
                </button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 self-start" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      )}
      {helper && <span id={helperId} className="text-xs text-[var(--color-text-tertiary)]">{helper}</span>}
    </div>
  );
}
