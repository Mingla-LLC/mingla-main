import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export const Input = forwardRef(function Input(
  { label, error, helper, className = "", type = "text", onFocus, onBlur, ...props },
  ref
) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && showPassword ? "text" : type;

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={ref}
          type={inputType}
          className={[
            "w-full h-10 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
            "border rounded-lg outline-none transition-all duration-150",
            isPassword ? "pl-3 pr-10" : "px-3",
            error
              ? "border-[#ef4444] focus:border-[#ef4444] focus:ring-2 focus:ring-[#fee2e2]"
              : "border-[var(--gray-300)] focus:border-[#f97316] focus:ring-2 focus:ring-[#ffedd5]",
            className,
          ].join(" ")}
          onFocus={onFocus}
          onBlur={onBlur}
          {...props}
        />
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
  { label, error, helper, className = "", onFocus, onBlur, ...props },
  ref
) {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        className={[
          "w-full min-h-[100px] p-3 text-sm font-mono",
          "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
          "border rounded-lg outline-none resize-y transition-all duration-150",
          error
            ? "border-[#ef4444] focus:border-[#ef4444] focus:ring-2 focus:ring-[#fee2e2]"
            : "border-[var(--gray-300)] focus:border-[#f97316] focus:ring-2 focus:ring-[#ffedd5]",
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
          checked ? "bg-[#f97316]" : "bg-[var(--gray-300)]",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        <span
          className={[
            "pointer-events-none inline-block w-5 h-5 rounded-full bg-white shadow-sm",
            "transition-transform duration-150 mt-0.5",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
      {label && <span className="text-sm text-[var(--color-text-primary)]">{label}</span>}
    </label>
  );
}
