import { useEffect, useRef, useCallback } from "react";
import { X } from "lucide-react";

const SIZE_CLASSES = {
  sm: "max-w-[480px]",
  md: "max-w-[640px]",
  lg: "max-w-[800px]",
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, size = "md", destructive = false, children }) {
  const overlayRef = useRef(null);
  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);

  const handleEscape = useCallback(
    (e) => {
      if (e.key === "Escape") {
        // Don't close if user is typing in an input/textarea/select
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
          document.activeElement.blur();
          return;
        }
        onClose();
      }
    },
    [onClose]
  );

  const handleTabKey = useCallback((e) => {
    if (e.key !== "Tab" || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll(FOCUSABLE_SELECTOR);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, []);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement;
      document.addEventListener("keydown", handleEscape);
      document.addEventListener("keydown", handleTabKey);
      document.body.style.overflow = "hidden";
      requestAnimationFrame(() => {
        // Focus the modal container, not the first button (which is the X close button)
        modalRef.current?.focus();
      });
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("keydown", handleTabKey);
      document.body.style.overflow = "";
      if (previousFocusRef.current?.focus) previousFocusRef.current.focus();
    };
  }, [open, handleEscape, handleTabKey]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}
      className="fixed inset-0 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[4px] animate-[fade-in_200ms_ease-out]"
      style={{ zIndex: "var(--z-modal)" }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className={[
          "w-full bg-[var(--color-background-primary)] rounded-xl shadow-[var(--shadow-xl)]",
          "animate-[scale-in_200ms_ease-out]",
          SIZE_CLASSES[size] || SIZE_CLASSES.md,
          "max-h-[calc(100vh-32px)] flex flex-col",
        ].join(" ")}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--gray-200)] shrink-0">
          <h2 className={`text-lg font-semibold ${destructive ? "text-[#b91c1c]" : "text-[var(--color-text-primary)]"}`}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] transition-colors duration-150 cursor-pointer"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalBody({ children, className = "" }) {
  return (
    <div className={`p-6 overflow-y-auto flex-1 max-h-[70vh] ${className}`}>
      {children}
    </div>
  );
}

export function ModalFooter({ children, className = "" }) {
  return (
    <div className={`flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--gray-200)] shrink-0 ${className}`}>
      {children}
    </div>
  );
}
