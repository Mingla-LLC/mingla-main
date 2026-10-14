// Issue #3802 (Wave 1) — small form pieces shared by the Hosts and Creators
// screens. Same look as components/ui/Input.jsx; every control is 40px high so
// it is easy to hit on a phone.

export const CONTROL_CLASS = [
  "w-full h-10 max-sm:h-11 px-3 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
  "border border-[var(--gray-300)] rounded-lg outline-none transition-all duration-150",
  "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
  "disabled:opacity-60 disabled:cursor-not-allowed",
].join(" ");

export const TEXTAREA_CLASS = [
  "w-full min-h-[72px] p-3 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
  "border border-[var(--gray-300)] rounded-lg outline-none resize-y transition-all duration-150",
  "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
  "disabled:opacity-60 disabled:cursor-not-allowed",
].join(" ");

export const LABEL_CLASS = "block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)] mb-1.5";

export function Field({ label, htmlFor, helper, error, full = false, children }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      {label && (
        <label htmlFor={htmlFor} className={LABEL_CLASS}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">
          {error}
        </p>
      ) : helper ? (
        <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{helper}</p>
      ) : null}
    </div>
  );
}

/** The last row of every region menu: it opens "City missing?", and is never a value. */
export const MISSING_CITY = "__city_missing__";
export const MISSING_CITY_LABEL = "City missing?";

/** options: [{ value, label, disabled }]. `placeholder` is the empty choice. */
export function Select({ options, placeholder, className = "", ...props }) {
  return (
    <select className={`${CONTROL_CLASS} cursor-pointer ${className}`} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={!!o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A row of choices where exactly one is pressed. */
export function Segmented({ label, options, value, onChange, disabled = false, className = "" }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex max-w-full flex-wrap rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-0.5 ${className}`}
    >
      {options.map((o) => {
        const pressed = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            onClick={() => {
              if (!pressed) onChange(o.value);
            }}
            className={[
              "h-10 max-sm:h-11 px-3 text-sm font-medium rounded-md whitespace-nowrap transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
              pressed
                ? "bg-[var(--color-brand-500)] text-white"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]",
              disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
