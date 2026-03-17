import { useState, useRef, useEffect, useCallback } from "react";

export function Dropdown({ trigger, children, align = "right", className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const triggerRef = useRef(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

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
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(!open); }
          if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); }
        }}
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {trigger}
      </div>
      {open && (
        <div
          className={[
            "absolute mt-1 min-w-[180px] py-1",
            "bg-[var(--color-background-primary)] border border-[var(--gray-200)]",
            "rounded-lg shadow-[var(--shadow-lg)]",
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
        "w-full text-left px-3 py-2 text-sm cursor-pointer transition-colors duration-150",
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
