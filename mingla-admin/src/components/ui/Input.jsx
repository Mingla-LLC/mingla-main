import { forwardRef, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { CalendarInput } from "@mingla/calendar-web";

// #4452 §7.1: fields are 44 px, radius 12, a 1.5 px --a-line border, 14 px
// text; focus is an ink border with a 4 px orange ring (rgba(235,120,37,.16)).
const FIELD_OK = "border-[1.5px] border-[var(--a-line)] focus:border-[var(--a-text)] focus:shadow-[0_0_0_4px_rgba(235,120,37,.16)]";
const FIELD_ERR = "border-[1.5px] border-[#ef4444] focus:border-[#ef4444] focus:shadow-[0_0_0_4px_rgba(239,68,68,.16)]";
const LABEL = "block text-[12.5px] font-semibold text-[var(--a-text2)] mb-1.5";


export const Input = forwardRef(function Input(
  { label, error, helper, className = "", type = "text", onFocus, onBlur, id, ...props },
  ref
) {
  const [showPassword, setShowPassword] = useState(false);
  // #4130: the label names its input (htmlFor/id), so a click on "Reason"
  // focuses the box and screen readers read the label with it.
  const autoId = useId();
  const inputId = id || autoId;
  const isPassword = type === "password";
  const inputType = isPassword && showPassword ? "text" : type;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className={LABEL}>
          {label}
        </label>
      )}
      <div className="relative">
        {type === "date" || type === "datetime-local" ? (
          // #4523: dates are picked on the Mingla calendar, never the browser's date box. The handler
          // still receives an input-like event ({ target: { value } }).
          <CalendarInput
            ref={ref}
            id={inputId}
            mode={type === "date" ? "date" : "datetime"}
            value={props.value}
            defaultValue={props.defaultValue}
            onChange={props.onChange}
            min={props.min}
            max={props.max}
            disabled={props.disabled}
            name={props.name}
            placeholder={props.placeholder}
            aria-label={props["aria-label"]}
            aria-invalid={error ? true : props["aria-invalid"]}
            aria-describedby={props["aria-describedby"]}
            required={props.required}
            onFocus={onFocus}
            onBlur={onBlur}
            className={["h-11 text-sm rounded-xl", error ? FIELD_ERR : FIELD_OK, className].join(" ")}
          />
        ) : (
        <input
          ref={ref}
          id={inputId}
          type={inputType}
          className={[
            "w-full h-11 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
            "rounded-xl outline-none transition-all duration-150",
            isPassword ? "pl-3 pr-10" : "px-3",
            error ? FIELD_ERR : FIELD_OK,
            className,
          ].join(" ")}
          onFocus={onFocus}
          onBlur={onBlur}
          {...props}
        />
        )}
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-pointer"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-[#ef4444] mt-1">{error}</p>}
      {helper && !error && <p className="text-xs text-[var(--color-text-tertiary)] mt-1">{helper}</p>}
    </div>
  );
});

export const Textarea = forwardRef(function Textarea(
  { label, error, helper, className = "", onFocus, onBlur, id, ...props },
  ref
) {
  const autoId = useId();
  const textareaId = id || autoId;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={textareaId} className={LABEL}>
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        className={[
          "w-full min-h-[100px] px-3 py-2.5 text-sm font-mono",
          "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
          "rounded-xl outline-none resize-y transition-all duration-150",
          error ? FIELD_ERR : FIELD_OK,
          className,
        ].join(" ")}
        onFocus={onFocus}
        onBlur={onBlur}
        {...props}
      />
      {error && <p className="text-xs text-[#ef4444] mt-1">{error}</p>}
      {helper && !error && <p className="text-xs text-[var(--color-text-tertiary)] mt-1">{helper}</p>}
    </div>
  );
});

export function Toggle({ label, checked, onChange, disabled = false }) {
  return (
    <label className={`inline-flex items-center gap-3 ${disabled ? "opacity-70 cursor-not-allowed" : "cursor-pointer"}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={[
          "relative inline-flex w-11 h-6 shrink-0 rounded-full transition-colors duration-150",
          checked ? "bg-[var(--a-text)]" : "bg-[var(--gray-300)]", /* #4452 §7.1: the checked track is ink */
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        <span
          className={[
            "pointer-events-none inline-block w-5 h-5 rounded-full bg-[var(--a-panel)] shadow-sm",
            "transition-transform duration-150 mt-0.5",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
      {label && <span className="text-sm text-[var(--color-text-primary)]">{label}</span>}
    </label>
  );
}

/** #4452 §7.1: a native select with the field look (44 px, radius 12). */
export const Select = forwardRef(function Select(
  { label, error, helper, className = "", id, options = [], placeholder, children, ...props },
  ref
) {
  const autoId = useId();
  const selectId = id || autoId;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className={LABEL}>
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        className={[
          "w-full h-11 px-3 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
          "rounded-xl outline-none transition-all duration-150 cursor-pointer",
          error ? FIELD_ERR : FIELD_OK,
          className,
        ].join(" ")}
        aria-invalid={error ? true : undefined}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      {error && <p className="text-xs text-[#ef4444] mt-1">{error}</p>}
      {helper && !error && <p className="text-xs text-[var(--color-text-tertiary)] mt-1">{helper}</p>}
    </div>
  );
});
