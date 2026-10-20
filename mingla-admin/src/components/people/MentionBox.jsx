// Issue #3980 (R9) — a note box with @ mentions: a textarea, and the same
// people list as the people field, anchored above the box while a name is
// being typed after @. Up and down move, Enter or Tab picks, Esc closes.
// The line under it says who will be told. The note's picks (each teammate's
// email and unique mention text) belong to the caller (NoteBox), which drops
// a pick the moment its text leaves the note.
import { useId, useState } from "react";
import { PersonAvatar } from "./PeopleField";
import { shownName } from "../../lib/peopleField";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";

export function MentionBox({ value, onChange, options = [], team = [], tokenFor, onPick, told, disabled, placeholder, label = "Note", maxLength = 2000 }) {
  const id = useId().replace(/:/g, "");
  const [hiState, setHi] = useState(0);
  // Esc closes the list until the note changes again.
  const [closedAt, setClosedAt] = useState(null);
  const open = options.length > 0 && closedAt !== value && !disabled;
  const hi = Math.min(hiState, Math.max(0, options.length - 1));
  const pick = (person) => { onPick(person); setHi(0); };
  const onKeyDown = (event) => {
    if (!open) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setHi((h) => Math.min(options.length - 1, h + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if ((event.key === "Enter" || event.key === "Tab") && options[hi]) { event.preventDefault(); pick(options[hi]); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setClosedAt(value); }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="relative min-w-0">
        {open && (
          <div id={`${id}-list`} role="listbox" aria-label="Teammates to mention" className="absolute bottom-full left-0 right-0 z-30 mb-1.5 max-h-[260px] overflow-auto rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1.5 shadow-[var(--shadow-lg)]">
            <div role="presentation" className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Mention</div>
            {options.map((p, i) => (
              <div
                key={p.email}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === hi}
                aria-label={`Mention ${shownName(p, team)}, ${p.email}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(p)}
                className={`grid min-h-11 cursor-pointer grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] ${i === hi ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--gray-50)]"}`}
              >
                <PersonAvatar person={p} />
                <span className="min-w-0">
                  <span className={`block font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{tokenFor ? tokenFor(p) : `@${p.name}`}</span>
                  <span className={`block text-[12px] text-[var(--color-text-tertiary)] ${WORDS}`}>{p.role}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(event) => { setHi(0); onChange(event); }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          aria-activedescendant={open && options[hi] ? `${id}-opt-${hi}` : undefined}
          aria-label={label}
          placeholder={placeholder || "Write a note. Type @ to mention someone."}
          className={`min-h-[84px] w-full resize-y rounded-xl border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-2.5 text-[13px] leading-normal text-[var(--color-text-primary)] ${FOCUS}`}
        />
      </div>
      <p className={`text-[12px] text-[var(--color-text-tertiary)] ${WORDS}`} aria-live="polite">{told}</p>
    </div>
  );
}
