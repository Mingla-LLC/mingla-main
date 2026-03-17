import { CheckCircle, AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../../context/ToastContext";

const VARIANT_CONFIG = {
  success: { bg: "bg-[var(--color-success-50)]", border: "border-l-[#22c55e]", text: "text-[var(--color-success-700)]", Icon: CheckCircle },
  error:   { bg: "bg-[var(--color-error-50)]",   border: "border-l-[#ef4444]", text: "text-[var(--color-error-700)]",   Icon: AlertCircle },
  warning: { bg: "bg-[var(--color-warning-50)]", border: "border-l-[#f59e0b]", text: "text-[var(--color-warning-700)]", Icon: AlertTriangle },
  info:    { bg: "bg-[var(--color-info-50)]",    border: "border-l-[#3b82f6]", text: "text-[var(--color-info-700)]",    Icon: Info },
};

function ToastItem({ toast, onDismiss }) {
  const config = VARIANT_CONFIG[toast.variant] || VARIANT_CONFIG.info;
  const ToastIcon = config.Icon;

  return (
    <div
      role="alert"
      className={[
        "min-w-[320px] max-w-[480px] p-3 px-4 rounded-lg border-l-4",
        "shadow-[var(--shadow-lg)]",
        config.bg,
        config.border,
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <ToastIcon className={`w-5 h-5 ${config.text} shrink-0 mt-0.5`} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${config.text}`}>{toast.title}</p>
          {toast.description && (
            <p className={`text-sm ${config.text} opacity-80 mt-0.5`}>{toast.description}</p>
          )}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className={`shrink-0 ${config.text} opacity-60 hover:opacity-100 cursor-pointer transition-opacity duration-150`}
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div
      className="fixed bottom-6 right-6 flex flex-col gap-2"
      style={{ zIndex: "var(--z-toast)" }}
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
            <ToastItem toast={toast} onDismiss={removeToast} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
