import { forwardRef } from "react";
import { Search, X } from "lucide-react";

export const SearchInput = forwardRef(function SearchInput(
  { value, onChange, onClear, placeholder = "Search...", className = "", ...props },
  ref
) {
  return (
    <div className={`relative ${className}`}>
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[var(--color-text-muted)] pointer-events-none"
        aria-hidden="true"
      />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={[
          "w-full h-10 pl-10 pr-10 text-sm",
          "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
          "border border-[var(--gray-300)] rounded-lg outline-none",
          "transition-all duration-150",
          "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
        ].join(" ")}
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-pointer"
          aria-label="Clear search"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
});
