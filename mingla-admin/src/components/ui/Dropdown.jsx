import { useState, useRef, useEffect, useCallback, useId } from "react";

export function Dropdown({ trigger, children, align = "right", className = "", ariaLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const triggerId = useId();

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => document.getElementById(triggerId)?.focus());
  }, [triggerId]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const handleEscape = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, close]);

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <div
        id={triggerId}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(!open); }
          if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); }
        }}
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {trigger}
      </div>
      {open && (
        <div
          className={[
            "absolute mt-2 min-w-[200px] max-w-[min(22rem,calc(100vw-2rem))] max-h-[min(28rem,calc(100dvh-5rem))] overflow-y-auto p-1.5",
            "bg-[var(--color-background-primary)] border border-[var(--gray-200)]",
            "rounded-xl shadow-[var(--shadow-lg)]",
            "animate-[dropdown-in_150ms_ease-out]",
            align === "right" ? "right-0" : "left-0",
          ].join(" ")}
          style={{ zIndex: "var(--z-dropdown)" }}
          role="menu"
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({ onClick, destructive = false, children, className = "", onClose }) {
  return (
    <button
      onClick={(e) => { onClick?.(e); onClose?.(); }}
      role="menuitem"
      className={[
        "flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-left text-sm cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-500)]",
        destructive
          ? "text-[#ef4444] hover:bg-[var(--color-error-50)]"
          : "text-[var(--color-text-primary)] hover:bg-[var(--gray-50)]",
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function DropdownSeparator() {
  return <div className="border-t border-[var(--gray-100)] my-1" />;
}

export function DropdownLabel({ children }) {
  return (
    <div className="px-3 py-1 text-xs uppercase tracking-wider text-[var(--color-text-tertiary)]">
      {children}
    </div>
  );
}
