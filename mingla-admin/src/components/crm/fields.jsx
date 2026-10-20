// Issue #3802 (Wave 1) — small form pieces shared by the Hosts and Creators
// screens. Same look as components/ui/Input.jsx; every control keeps a 44px
// touch target so it remains comfortable on phones and at browser zoom.

export const CONTROL_CLASS = [
  "w-full min-h-11 px-3 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
  "border border-[var(--gray-300)] rounded-xl outline-none transition-[border-color,box-shadow,background-color] duration-150",
  "focus-visible:border-[var(--color-brand-500)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand-100)]",
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
    <select className={`${CONTROL_CLASS} cursor-pointer pr-10 ${className}`} {...props}>
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
export function Segmented({ label, options, value, onChange, disabled = false, variant = "default", fullWidth = false, wrap = false, className = "" }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`${fullWidth ? "flex w-full" : "inline-flex w-fit"} admin-control-scroll max-w-full ${wrap ? "flex-wrap" : "flex-nowrap overflow-x-auto"} gap-1 rounded-xl border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-1 shadow-[var(--shadow-sm)] ${className}`}
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
              "min-h-11 shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium leading-5 transition-[color,background-color,box-shadow] duration-150",
              fullWidth ? "min-w-fit flex-1" : "",
              `focus-visible:outline-none focus-visible:ring-2 ${variant === "highContrast" ? "focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background-primary)]" : "focus-visible:ring-[var(--color-brand-500)]"}`,
              pressed
                ? variant === "highContrast" ? "bg-[var(--color-brand-800)] text-white hover:bg-[var(--color-brand-900)] active:bg-[var(--color-brand-900)]" : "bg-[var(--color-brand-500)] text-white"
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
