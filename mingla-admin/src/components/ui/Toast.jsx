import { useEffect, useRef, useState } from "react";
import { CheckCircle, AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../../context/ToastContext";
import { EDGE_GAP, PANEL_GAP, stackPlace } from "../../lib/toastPlace";

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
// The air left between the last field of an open card and a toast over it.
const CLEAR_GAP = 32;

/**
 * Call BEFORE a toast is dismissed from one of its own buttons; call what it
 * returns afterwards. If keyboard focus was inside the toast, the button that
 * held it is about to leave the page and focus would fall to nothing: it is
 * put on the open drawer or dialog instead, so the next Tab stays inside the
 * card. With nothing open, or focus elsewhere, nothing is touched.
 */
function focusReturn(toastEl, elsewhere) {
  const inside = !!toastEl && toastEl.contains(document.activeElement);
  return () => {
    if (!inside) return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      // Something took focus on purpose (the action opened a card, say).
      if (active && active !== document.body && document.body.contains(active) && !toastEl.contains(active)) return;
      const panels = document.querySelectorAll(DIALOG_PANEL);
      const panel = panels.length > 0 ? panels[panels.length - 1] : null;
      if (panel && typeof panel.focus === "function") {
        panel.focus();
        return;
      }
      // Nothing is open: go where the toast's owner said the work continues
      // (action.focusAfter returns that element), so focus is never dropped.
      const next = typeof elsewhere === "function" ? elsewhere() : null;
      if (next && typeof next.focus === "function" && document.body.contains(next)) next.focus();
    });
  };
}

function ToastItem({ toast, onDismiss, onHold, onRelease, fill = false }) {
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
      // Beside a card there may be less than 320px: the toast then takes the
      // room there is instead of spilling under the card or off the screen.
      style={fill ? { minWidth: 0, width: "100%" } : undefined}
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
                  const restoreFocus = focusReturn(rootRef.current, toast.action.focusAfter);
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
              const restoreFocus = focusReturn(rootRef.current, toast.action?.focusAfter);
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

function useStackPlace(active) {
  const [place, setPlace] = useState({ beside: 0, fill: false });
  useEffect(() => {
    if (!active) return undefined;
    const measure = () => {
      const panel = document.querySelector(SIDE_PANEL);
      const wide = typeof window.matchMedia === "function" && window.matchMedia("(min-width: 640px)").matches;
      // offsetWidth, not the on-screen box: the panel slides in, and its
      // width is the same from the first frame.
      const next = stackPlace(window.innerWidth, panel ? panel.offsetWidth : 0, wide);
      setPlace((prev) => (prev.beside === next.beside && prev.fill === next.fill ? prev : next));
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
  return active ? place : { beside: 0, fill: false };
}

/**
 * While the stack is at the bottom of the screen (a phone), tell an open card
 * how much space the stack takes, as --toast-clear on the page. The card adds
 * that much room after its last field, so every field can be scrolled clear
 * of a toast. Removed when there are no toasts or the stack is beside the card.
 */
function useClearSpace(regionRef, on) {
  useEffect(() => {
    const root = document.documentElement;
    const region = regionRef.current;
    if (!on || !region) return undefined;
    const set = () => root.style.setProperty("--toast-clear", `${region.offsetHeight + CLEAR_GAP}px`);
    set();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(set) : null;
    if (observer) observer.observe(region);
    return () => {
      if (observer) observer.disconnect();
      root.style.removeProperty("--toast-clear");
    };
  }, [regionRef, on]);
}

export function ToastContainer() {
  const { toasts, removeToast, holdToast, releaseToast } = useToast();
  const { beside: besidePanel, fill } = useStackPlace(toasts.length > 0);
  const regionRef = useRef(null);
  useClearSpace(regionRef, toasts.length > 0 && besidePanel === 0);
  const more = toasts.length - 1;

  return (
    // The stack never takes a click meant for the page (only a toast itself
    // does). With a card open beside it, it sits to the LEFT of the card at
    // every width from 640px up, so no field or button of the card is ever
    // under a toast. On a phone the card is the whole screen: the stack stays
    // at the bottom, lifted clear of the card's footer (the drawer sets
    // --toast-lift to its footer height, components/ui/Drawer.jsx), and the
    // card leaves room after its last field so everything can be scrolled
    // clear of it (--toast-clear, set above).
    <div
      ref={regionRef}
      data-toast-region=""
      className="pointer-events-none fixed inset-x-4 flex flex-col gap-2 sm:left-auto sm:right-6 sm:items-end"
      style={
        besidePanel > 0
          ? { zIndex: "var(--z-toast)", bottom: "1.5rem", left: `${EDGE_GAP}px`, right: `${besidePanel + PANEL_GAP}px` }
          : { zIndex: "var(--z-toast)", bottom: "calc(1.5rem + var(--toast-lift, 0px))" }
      }
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast, index) => (
          <motion.div
            key={toast.id}
            layout
            style={fill ? { width: "100%" } : undefined}
            // On a phone only the newest toast is shown in full; the rest are
            // counted in the row below it, so three messages never cover the
            // form someone is filling in.
            className={index > 0 ? "max-sm:hidden" : undefined}
            initial={{ opacity: 0, x: 100, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <ToastItem toast={toast} onDismiss={removeToast} onHold={holdToast} onRelease={releaseToast} fill={fill} />
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
