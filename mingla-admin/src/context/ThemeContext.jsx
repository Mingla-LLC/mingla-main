import { createContext, useContext, useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "mingla-admin-theme";
const EXPLICIT_KEY = "mingla-admin-theme-explicit";
const ThemeContext = createContext(null);

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialTheme() {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return getSystemTheme();
}

function applyTheme(newTheme) {
  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem(STORAGE_KEY, newTheme);
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const initial = getInitialTheme();
    applyTheme(initial);
    return initial;
  });

  const setTheme = useCallback((newTheme) => {
    localStorage.setItem(EXPLICIT_KEY, "true");
    setThemeState(newTheme);
    applyTheme(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    localStorage.setItem(EXPLICIT_KEY, "true");
    setThemeState((prev) => {
      const next = prev === "light" ? "dark" : "light";
      applyTheme(next);
      return next;
    });
  }, []);

  // Reset to auto mode (follow system preference)
  const setAutoTheme = useCallback(() => {
    localStorage.removeItem(EXPLICIT_KEY);
    const sys = getSystemTheme();
    setThemeState(sys);
    applyTheme(sys);
  }, []);

  // Follow system theme changes ONLY if user hasn't explicitly toggled
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => {
      const explicit = localStorage.getItem(EXPLICIT_KEY);
      if (explicit) return; // User manually chose — don't override
      const newTheme = e.matches ? "dark" : "light";
      setThemeState(newTheme);
      applyTheme(newTheme);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, setAutoTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
