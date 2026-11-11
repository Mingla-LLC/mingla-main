import { useContext, useEffect, useId, useRef } from "react";
import { ArrowLeft, X } from "lucide-react";
import { PanelSlotContext } from "./PanelStack";

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
 *
 * Issue #4255: inside a PanelStack panel (PanelSlotContext) the same drawer is
 * drawn as a docked, NON-modal panel: no scrim, no focus trap, the page keeps
 * scrolling, and Esc is handled once by the PanelStack (top panel first). A
 * second panel that covers the first on a narrow screen shows Back.
 */
export function Drawer({ open, onClose, title, header, footer, suspended = false, bare = false, children }) {
  const slot = useContext(PanelSlotContext);
  const panelRef = useRef(null);
  const footerRef = useRef(null);
  const previousFocusRef = useRef(null);
  const titleId = useId();

  // Latest onClose in a ref so the effects depend only on `open` (see Modal.jsx).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // #4255: tell the panel stack what this panel is called and how it closes.
  const register = slot?.register;
  useEffect(() => {
    if (!register || !open) return undefined;
    register({ title: typeof title === "string" ? title : "", onClose: () => onCloseRef.current?.() });
    return () => register(null);
  }, [register, open, title]);

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

  // Lift the toast stack clear of this drawer's footer, so a toast never sits
  // on the footer's buttons (Delete, Mark as lost) or takes their taps.
  const hasFooter = !!footer;
  useEffect(() => {
    if (!open || !hasFooter) return undefined;
    const root = document.documentElement;
    const lift = () => {
      const h = footerRef.current ? footerRef.current.offsetHeight : 0;
      root.style.setProperty("--toast-lift", `${h}px`);
    };
    lift();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(lift) : null;
    if (observer && footerRef.current) observer.observe(footerRef.current);
    return () => {
      if (observer) observer.disconnect();
      root.style.removeProperty("--toast-lift");
    };
  }, [open, hasFooter]);

  useEffect(() => {
    if (!open || suspended || slot) return undefined;
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
      // Tab stays inside the drawer AND the toasts: a toast's Undo or Open is
      // part of what the person can do right now, so it is reachable too.
      const toasts = document.querySelector("[data-toast-region]");
      const focusable = [
        ...panel.querySelectorAll(FOCUSABLE_SELECTOR),
        ...(toasts ? toasts.querySelectorAll(FOCUSABLE_SELECTOR) : []),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = panel.contains(active) || (!!toasts && toasts.contains(active));
      if (!inside) {
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
  }, [open, suspended, slot]);

  if (!open) return null;

  if (slot) {
    return (
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        data-panel-focus=""
        data-panel={slot.slot}
        className={[
          "relative flex h-full w-full flex-col",
          "bg-[var(--color-background-primary)] shadow-[var(--shadow-xl)] outline-none",
          "border-l border-[var(--gray-200)]",
          "motion-safe:animate-[slide-in-right_200ms_ease-out]",
        ].join(" ")}
      >
        {/* #4255 W3: a bare panel (the work card, its thread) draws its own
            one-line header with its own close button; Back still shows. */}
        {bare ? (
          <>
            <h2 id={titleId} className="sr-only">{title}</h2>
            {slot.back && (
              <div className="shrink-0 border-b border-[var(--gray-200)] px-3">
                <button type="button" data-panel-back="" onClick={slot.back.onClick} className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-lg px-1 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]">
                  <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{slot.back.label}</span>
                </button>
              </div>
            )}
          </>
        ) : (
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--gray-200)] px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            {slot.back && (
              <button
                type="button"
                data-panel-back=""
                onClick={slot.back.onClick}
                className="-ml-1 mb-1 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-lg px-1 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{slot.back.label}</span>
              </button>
            )}
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
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors duration-150 hover:bg-[var(--gray-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        )}
        {/* A drawer opened from inside a panel is an ordinary drawer again. */}
        <PanelSlotContext.Provider value={null}>
          <div className={bare ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5"}>{children}</div>
          {footer && (
            <div ref={footerRef} className="shrink-0 border-t border-[var(--gray-200)] px-4 py-3 sm:px-5">
              {footer}
            </div>
          )}
        </PanelSlotContext.Provider>
      </aside>
    );
  }

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
          bare ? "relative flex h-full w-full flex-col sm:w-[min(720px,100%)]" : "relative flex h-full w-full flex-col sm:w-[min(440px,100%)]",
          "bg-[var(--color-background-primary)] shadow-[var(--shadow-xl)] outline-none",
          "border-l border-[var(--gray-200)]",
          "motion-safe:animate-[slide-in-right_200ms_ease-out]",
        ].join(" ")}
      >
        {bare ? <h2 id={titleId} className="sr-only">{title}</h2> : (
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
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors duration-150 hover:bg-[var(--gray-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        )}
        <div className={bare ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5"}>{children}</div>
        {footer && (
          <div ref={footerRef} className="shrink-0 border-t border-[var(--gray-200)] px-4 py-3 sm:px-5">
            {footer}
          </div>
        )}
      </aside>
    </div>
  );
}
