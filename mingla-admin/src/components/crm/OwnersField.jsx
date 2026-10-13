import { displayName } from "../../lib/crmModel";
import { LABEL_CLASS } from "./fields";

/**
 * Who owns a card: one toggle per teammate, any number pressed. The full
 * address shows on hover (people are stored by address; the name is derived).
 */
export function OwnersField({ team, value, onChange, disabled = false, labelId }) {
  const owners = Array.isArray(value) ? value : [];
  const people = Array.isArray(team) ? team : [];
  // Someone who left the team can still be on an old card: show them so they
  // can be taken off.
  const strangers = owners.filter((e) => !people.some((p) => p.email === e));
  const all = [
    ...people.map((p) => ({ email: p.email, name: p.display_name || displayName(p.email), note: p.status === "invited" ? "invited" : "" })),
    ...strangers.map((e) => ({ email: e, name: displayName(e), note: "no longer on the team" })),
  ];
  const names = all.map((p) => p.name);

  const toggle = (email) => {
    const next = owners.includes(email) ? owners.filter((e) => e !== email) : [...owners, email];
    onChange([...next].sort());
  };

  return (
    <div className="sm:col-span-2">
      <span id={labelId} className={LABEL_CLASS}>
        Owners
      </span>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {all.map((p) => {
          const pressed = owners.includes(p.email);
          // Two teammates with the same first name are told apart by address.
          const clash = names.filter((n) => n === p.name).length > 1;
          return (
            <button
              key={p.email}
              type="button"
              aria-pressed={pressed}
              title={p.email}
              disabled={disabled || (p.note === "no longer on the team" && !pressed)}
              onClick={() => toggle(p.email)}
              className={[
                "inline-flex h-10 items-center gap-1 rounded-full border px-3 text-sm font-medium transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-1",
                pressed
                  ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                  : "border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]",
                disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              ].join(" ")}
            >
              {clash ? p.email : p.name}
              {p.note && <span className="text-xs font-normal opacity-80">({p.note})</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
        {owners.length === 0 ? "Nobody yet. Pick one or more." : "Tap a name to add or remove them."}
      </p>
    </div>
  );
}
