import { useEffect, useRef, useState } from "react";
import { CheckCircle, AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../../context/ToastContext";

const VARIANT_CONFIG = {
  success: { bg: "bg-[var(--color-success-50)]", border: "border-l-[#22c55e]", text: "text-[var(--color-success-700)]", Icon: CheckCircle },
  error:   { bg: "bg-[var(--color-error-50)]",   border: "border-l-[#ef4444]", text: "text-[var(--color-error-700)]",   Icon: AlertCircle },
  warning: { bg: "bg-[var(--color-warning-50)]", border: "border-l-[#f59e0b]", text: "text-[var(--color-warning-700)]", Icon: AlertTriangle },
  info:    { bg: "bg-[var(--color-info-50)]",    border: "border-l-[#3b82f6]", text: "text-[var(--color-info-700)]",    Icon: Info },
};

// The panel an open drawer or dialog puts keyboard focus on when it opens
// (components/ui/Drawer.jsx, components/ui/Modal.jsx).
const DIALOG_PANEL = '[role="dialog"][aria-modal="true"]';
// A drawer is a side panel; a dialog in the middle of the screen is not.
const SIDE_PANEL = `aside${DIALOG_PANEL}`;
// Room a toast needs beside a side panel: its 320px minimum plus the margins.
const ROOM_BESIDE_PANEL = 368;

/**
 * Call BEFORE a toast is dismissed from one of its own buttons; call what it
 * returns afterwards. If keyboard focus was inside the toast, the button that
 * held it is about to leave the page and focus would fall to nothing: it is
 * put on the open drawer or dialog instead, so the next Tab stays inside the
 * card. With nothing open, or focus elsewhere, nothing is touched.
 */
function focusReturn(toastEl) {
  const inside = !!toastEl && toastEl.contains(document.activeElement);
  return () => {
    if (!inside) return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      // Something took focus on purpose (the action opened a card, say).
      if (active && active !== document.body && document.body.contains(active) && !toastEl.contains(active)) return;
      const panels = document.querySelectorAll(DIALOG_PANEL);
      const panel = panels.length > 0 ? panels[panels.length - 1] : null;
      if (panel && typeof panel.focus === "function") panel.focus();
    });
  };
}

function ToastItem({ toast, onDismiss, onHold, onRelease }) {
  const config = VARIANT_CONFIG[toast.variant] || VARIANT_CONFIG.info;
  const ToastIcon = config.Icon;
  const rootRef = useRef(null);

  return (
    // Two layers on purpose (#3802): the outer one is the theme's solid page
    // surface, the inner one carries the tint. The dark theme's tints are 10%
    // washes, so without the solid layer whatever is behind shows through.
    <div
      ref={rootRef}
      role="alert"
      onMouseEnter={() => onHold?.(toast.id)}
      onMouseLeave={() => onRelease?.(toast.id)}
      onFocus={() => onHold?.(toast.id)}
      onBlur={() => onRelease?.(toast.id)}
      className="pointer-events-auto w-full sm:w-auto sm:min-w-[320px] max-w-[480px] overflow-hidden rounded-lg bg-[var(--color-background-primary)] shadow-[var(--shadow-lg)]"
    >
      <div className={["p-3 px-4 border-l-4", config.bg, config.border].join(" ")}>
        <div className="flex items-start gap-3">
          <ToastIcon className={`w-5 h-5 ${config.text} shrink-0 mt-0.5`} aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium break-words ${config.text}`}>{toast.title}</p>
            {toast.description && (
              <p className={`text-sm break-words ${config.text} opacity-80 mt-0.5`}>{toast.description}</p>
            )}
            {toast.action?.label && (
              <button
                type="button"
                onClick={() => {
                  const restoreFocus = focusReturn(rootRef.current);
                  onDismiss(toast.id);
                  toast.action.onClick?.();
                  restoreFocus();
                }}
                className={`mt-1.5 inline-flex min-h-10 items-center rounded-md text-sm font-semibold underline underline-offset-2 ${config.text} cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2`}
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              const restoreFocus = focusReturn(rootRef.current);
              onDismiss(toast.id);
              restoreFocus();
            }}
            className={`-mr-2 -mt-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${config.text} opacity-70 hover:opacity-100 cursor-pointer transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]`}
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * How far from the right edge the stack must sit to be clear of an open side
 * panel, in pixels; 0 when there is none, on a phone (the panel is the whole
 * screen there), or when there is no room beside it.
 *
 * A toast drawn over an open card covers the card's lower fields until it
 * clears. Beside the card it covers nothing the person is working on.
 */
function usePanelWidth(active) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const measure = () => {
      const panel = document.querySelector(SIDE_PANEL);
      const wide = typeof window.matchMedia === "function" && window.matchMedia("(min-width: 640px)").matches;
      // offsetWidth, not the on-screen box: the panel slides in, and its
      // width is the same from the first frame.
      const w = panel && wide ? panel.offsetWidth : 0;
      setWidth(w > 0 && window.innerWidth - w >= ROOM_BESIDE_PANEL ? w : 0);
    };
    measure();
    const observer = typeof MutationObserver === "function" ? new MutationObserver(measure) : null;
    if (observer) observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active]);
  return active ? width : 0;
}

export function ToastContainer() {
  const { toasts, removeToast, holdToast, releaseToast } = useToast();
  const besidePanel = usePanelWidth(toasts.length > 0);
  const more = toasts.length - 1;

  return (
    // The stack never takes a click meant for the page (only a toast itself
    // does). With a card open beside it, it sits to the LEFT of the card, so
    // no field or button of the card is ever under a toast. Where there is no
    // room beside the card (a phone, a narrow window) it stays at the bottom,
    // lifted clear of the card's footer: the drawer sets --toast-lift to its
    // footer height (components/ui/Drawer.jsx).
    <div
      data-toast-region=""
      className="pointer-events-none fixed inset-x-4 flex flex-col gap-2 sm:left-auto sm:right-6 sm:items-end"
      style={
        besidePanel > 0
          ? { zIndex: "var(--z-toast)", bottom: "1.5rem", right: `calc(${besidePanel}px + 1.5rem)` }
          : { zIndex: "var(--z-toast)", bottom: "calc(1.5rem + var(--toast-lift, 0px))" }
      }
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast, index) => (
          <motion.div
            key={toast.id}
            layout
            // On a phone only the newest toast is shown in full; the rest are
            // counted in the row below it, so three messages never cover the
            // form someone is filling in.
            className={index > 0 ? "max-sm:hidden" : undefined}
            initial={{ opacity: 0, x: 100, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <ToastItem toast={toast} onDismiss={removeToast} onHold={holdToast} onRelease={releaseToast} />
          </motion.div>
        ))}
      </AnimatePresence>
      {more > 0 && (
        <div className="pointer-events-auto flex h-10 items-center justify-between gap-3 rounded-lg bg-[var(--color-background-primary)] px-4 text-sm text-[var(--color-text-secondary)] shadow-[var(--shadow-lg)] sm:hidden">
          <span role="status">{more} more</span>
          <button
            type="button"
            onClick={() => {
              const restoreFocus = focusReturn(document.querySelector("[data-toast-region]"));
              toasts.forEach((t) => removeToast(t.id));
              restoreFocus();
            }}
            className="inline-flex h-10 cursor-pointer items-center rounded-md font-semibold text-[var(--color-text-primary)] underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
          >
            Dismiss all
          </button>
        </div>
      )}
    </div>
  );
}
