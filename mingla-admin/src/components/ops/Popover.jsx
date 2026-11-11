// Issue #4255 (W2, W3) — a small anchored popover for the board's column
// menu, the card's ⋯ menu, the filter chips and the property chips. It closes
// on a click outside and on Esc (which then does not close the panel too), and
// gives focus back to the button that opened it.
import { useEffect, useId, useRef, useState } from "react";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function Popover({ label, button, buttonClassName = "", align = "left", width = "w-60", role = "dialog", children, disabled = false, open: givenOpen, onOpenChange, dataAttr }) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = givenOpen ?? ownOpen;
  const setOpen = (v) => { if (onOpenChange) onOpenChange(v); else setOwnOpen(v); };
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) (onOpenChange || setOwnOpen)(false); };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      (onOpenChange || setOwnOpen)(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [open, onOpenChange]);
  // Closing from inside (a picked item) gives focus back to the button.
  const [refocus, setRefocus] = useState(false);
  useEffect(() => {
    if (!refocus || open) return;
    buttonRef.current?.focus();
    setRefocus(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [refocus, open]);
  const close = () => { setOpen(false); setRefocus(true); };
  return (
    <span ref={rootRef} className="relative inline-flex min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup={role === "menu" ? "menu" : "dialog"}
        aria-expanded={open ? "true" : "false"}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        data-popover-button={dataAttr || ""}
        onClick={() => setOpen(!open)}
        className={`${buttonClassName} ${FOCUS}`}
      >
        {button}
      </button>
      {open && (
        <div
          id={id}
          role={role}
          aria-label={label}
          className={`absolute top-full z-30 mt-1 ${align === "right" ? "right-0" : "left-0"} ${width} max-w-[90vw] rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1.5 text-[13px] shadow-[var(--shadow-lg)]`}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </span>
  );
}

/** One item in a popover menu. */
export function MenuItem({ children, onClick, danger = false, disabled = false, hint }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] disabled:opacity-50 ${danger ? "text-[var(--color-error-700)] hover:bg-[var(--color-error-50)]" : "text-[var(--color-text-primary)] hover:bg-[var(--gray-100)]"} ${FOCUS}`}
    >
      <span className="min-w-0 break-words">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{hint}</span>}
    </button>
  );
}
