import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Right-side panel (issue #3802). Same focus technique as Modal.jsx: focus is
 * kept inside while open and returns to where it was on close; Esc and a click
 * on the scrim close it. Full width under 640px.
 *
 * `suspended` hands the keyboard to a dialog opened on top of the drawer (its
 * own Esc and Tab handling), so one Esc closes one thing.
 * `header` replaces the plain title (the title is still the accessible name).
 */
export function Drawer({ open, onClose, title, header, footer, suspended = false, children }) {
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);
  const titleId = useId();

  // Latest onClose in a ref so the effects depend only on `open` (see Modal.jsx).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Remember where focus was, and put it back on close.
  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) panel.focus();
    });
    return () => {
      if (previousFocusRef.current?.focus) previousFocusRef.current.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || suspended) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (e.key === "Escape") {
        const active = document.activeElement;
        const tag = active?.tagName;
        // First Esc leaves the field (which saves it); the next one closes.
        if (panel.contains(active) && (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")) {
          active.blur();
          panel.focus();
          return;
        }
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = panel.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, suspended]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex justify-end" style={{ zIndex: "var(--z-modal)" }}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40 motion-safe:animate-[fade-in_200ms_ease-out]"
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={[
          "relative flex h-full w-full flex-col sm:w-[min(440px,100%)]",
          "bg-[var(--color-background-primary)] shadow-[var(--shadow-xl)] outline-none",
          "border-l border-[var(--gray-200)]",
          "motion-safe:animate-[slide-in-right_200ms_ease-out]",
        ].join(" ")}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--gray-200)] px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            {header ? (
              <>
                <h2 id={titleId} className="sr-only">
                  {title}
                </h2>
                {header}
              </>
            ) : (
              <h2 id={titleId} className="break-words text-lg font-semibold text-[var(--color-text-primary)]">
                {title}
              </h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors duration-150 hover:bg-[var(--gray-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-[var(--gray-200)] px-4 py-3 sm:px-5">{footer}</div>
        )}
      </aside>
    </div>
  );
}
