// Issue #4255 — one dropdown filter with its label in front ("Owner  Everyone ▾"),
// the shape every filter bar on Work, the Calendar and Hosts and creators uses.
import { useId } from "react";
import { Select } from "../crm/fields";

export function FilterSelect({ label, value, options, onChange, disabled = false, name }) {
  const id = useId();
  return (
    <label htmlFor={id} className="inline-flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-[var(--color-text-secondary)]">
      <span className="whitespace-nowrap">{label}</span>
      <Select
        id={id}
        name={name}
        data-filter={name}
        className="!w-auto min-h-11 max-w-[220px] text-[13px]"
        value={value}
        disabled={disabled}
        options={options}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
