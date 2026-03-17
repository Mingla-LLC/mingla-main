import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

const ToastContext = createContext(null);

const AUTO_DISMISS_MS = {
  success: 5000,
  info: 5000,
  warning: 8000,
  error: null, // manual only
};

let toastIdCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearTimeout);
    };
  }, []);

  const removeToast = useCallback((id) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    ({ variant = "info", title, description }) => {
      const id = ++toastIdCounter;
      const toast = { id, variant, title, description };

      setToasts((prev) => {
        const next = [toast, ...prev];
        // Keep max 3 visible
        if (next.length > 3) {
          const removed = next.slice(3);
          removed.forEach((t) => {
            if (timersRef.current[t.id]) {
              clearTimeout(timersRef.current[t.id]);
              delete timersRef.current[t.id];
            }
          });
          return next.slice(0, 3);
        }
        return next;
      });

      const dismissMs = AUTO_DISMISS_MS[variant];
      if (dismissMs) {
        timersRef.current[id] = setTimeout(() => removeToast(id), dismissMs);
      }

      return id;
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
