import { CheckCircle, AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../../context/ToastContext";

const VARIANT_CONFIG = {
  success: { bg: "bg-[var(--color-success-50)]", border: "border-l-[#22c55e]", text: "text-[var(--color-success-700)]", Icon: CheckCircle },
  error:   { bg: "bg-[var(--color-error-50)]",   border: "border-l-[#ef4444]", text: "text-[var(--color-error-700)]",   Icon: AlertCircle },
  warning: { bg: "bg-[var(--color-warning-50)]", border: "border-l-[#f59e0b]", text: "text-[var(--color-warning-700)]", Icon: AlertTriangle },
  info:    { bg: "bg-[var(--color-info-50)]",    border: "border-l-[#3b82f6]", text: "text-[var(--color-info-700)]",    Icon: Info },
};

function ToastItem({ toast, onDismiss, onHold, onRelease }) {
  const config = VARIANT_CONFIG[toast.variant] || VARIANT_CONFIG.info;
  const ToastIcon = config.Icon;

  return (
    // Two layers on purpose (#3802): the outer one is the theme's solid page
    // surface, the inner one carries the tint. The dark theme's tints are 10%
    // washes, so without the solid layer whatever is behind shows through.
    <div
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
                  onDismiss(toast.id);
                  toast.action.onClick?.();
                }}
                className={`mt-1.5 inline-flex min-h-10 items-center rounded-md text-sm font-semibold underline underline-offset-2 ${config.text} cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2`}
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
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

export function ToastContainer() {
  const { toasts, removeToast, holdToast, releaseToast } = useToast();

  return (
    // The stack never takes a click meant for the page (only a toast itself
    // does), and it is lifted clear of an open drawer's footer: the drawer sets
    // --toast-lift to its footer height (components/ui/Drawer.jsx).
    <div
      data-toast-region=""
      className="pointer-events-none fixed inset-x-4 flex flex-col gap-2 sm:left-auto sm:right-6 sm:items-end"
      style={{ zIndex: "var(--z-toast)", bottom: "calc(1.5rem + var(--toast-lift, 0px))" }}
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, x: 100, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <ToastItem toast={toast} onDismiss={removeToast} onHold={holdToast} onRelease={releaseToast} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
