// Issue #3980 — owners or watchers picked from the active team. The list
// opens inline under the field, never as a floating layer. Names never break
// letter by letter: a name keeps at least six characters of width and only
// wraps between words, and a long role label drops under the name.
import { useId, useState } from "react";
import { Plus, X } from "lucide-react";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function PeoplePicker({ label, people = [], team = [], onAdd, onRemove, disabled = false, exclude = [] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const taken = new Set([...people.map((p) => p.email), ...exclude]);
  const query = q.trim().toLowerCase();
  const options = team.filter((p) => !taken.has(p.email) && (!query || p.name.toLowerCase().includes(query) || p.email.includes(query)));
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span id={`${id}-label`} className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{label}</span>
      <ul aria-labelledby={`${id}-label`} className="flex min-w-0 flex-wrap items-center gap-1.5">
        {people.length === 0 && <li className="text-[13px] text-[var(--color-text-tertiary)]">Nobody yet</li>}
        {people.map((p) => (
          <li key={p.email} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--gray-100)] py-0.5 pl-2.5 pr-0.5 text-[13px] text-[var(--color-text-primary)]">
            <span className="min-w-[6ch] break-normal [overflow-wrap:normal]">{p.name}</span>
            <button type="button" aria-label={`Remove ${p.name}`} disabled={disabled} onClick={() => onRemove(p.email)} className={`inline-grid min-h-8 min-w-8 place-items-center rounded-full text-[var(--color-text-tertiary)] hover:bg-[var(--gray-200)] disabled:opacity-50 ${FOCUS}`}>
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
        <li>
          <button type="button" aria-expanded={open} aria-controls={`${id}-list`} disabled={disabled} onClick={() => setOpen((v) => !v)} className={`inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] disabled:opacity-50 ${FOCUS}`}>
            <Plus aria-hidden="true" className="h-3.5 w-3.5" /> Add
          </button>
        </li>
      </ul>
      {open && (
        <div id={`${id}-list`} className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-2">
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the team"
            aria-label={`Search the team for ${label.toLowerCase()}`}
            className={`min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] text-[var(--color-text-primary)] ${FOCUS}`}
          />
          {options.length === 0 ? (
            <p className="px-1 text-[13px] text-[var(--color-text-tertiary)]">No one else to add.</p>
          ) : (
            <ul className="flex min-w-0 flex-col">
              {options.map((p) => (
                <li key={p.email}>
                  <button type="button" onClick={() => { onAdd(p.email); setQ(""); setOpen(false); }} className={`flex min-h-11 w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 rounded-lg px-2 py-1 text-left text-[13px] hover:bg-[var(--gray-100)] ${FOCUS}`}>
                    <span className="min-w-[6ch] break-normal [overflow-wrap:normal] font-medium text-[var(--color-text-primary)]">{p.name}</span>
                    <span className="text-[12px] text-[var(--color-text-tertiary)]">{p.role_label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
