import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

const ToastContext = createContext(null);

const AUTO_DISMISS_MS = {
  success: 5000,
  info: 5000,
  warning: 8000,
  error: null, // manual only
};

// How long a toast stays after the pointer or keyboard focus leaves it.
const RELEASE_MS = 4000;

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
    // `action` ({ label, onClick }) and `duration` (ms) are optional (#3802):
    // an action shows as a button in the toast; pressing it runs onClick and
    // dismisses the toast. A duration replaces the variant's own lifetime.
    ({ variant = "info", title, description, action, duration }) => {
      const id = ++toastIdCounter;
      const toast = { id, variant, title, description, action };

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

      const dismissMs =
        typeof duration === "number" && duration > 0 ? duration : AUTO_DISMISS_MS[variant];
      if (dismissMs) {
        timersRef.current[id] = setTimeout(() => removeToast(id), dismissMs);
      }

      return id;
    },
    [removeToast]
  );

  // A toast someone is pointing at, or has moved keyboard focus into, does not
  // disappear under them (#3802): holdToast stops its clock, releaseToast
  // gives it a few more seconds. A toast with no clock (errors) is unaffected.
  const holdToast = useCallback((id) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      timersRef.current[id] = "held";
    }
  }, []);

  const releaseToast = useCallback(
    (id) => {
      if (timersRef.current[id] === "held") {
        timersRef.current[id] = setTimeout(() => removeToast(id), RELEASE_MS);
      }
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, holdToast, releaseToast }}>
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
