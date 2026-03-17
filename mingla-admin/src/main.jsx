import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./context/ToastContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import "./globals.css";

function AppCrashFallback({ error, reset }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-background-secondary, #faf8f6)",
        fontFamily: '"Geist Sans", system-ui, -apple-system, sans-serif',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 400, textAlign: "center" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "#fef2f2",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}
        >
          <span style={{ fontSize: 28 }}>!</span>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111827", margin: "0 0 8px" }}>
          Dashboard Crashed
        </h1>
        <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 24px" }}>
          {error?.message || "An unexpected error crashed the application."}
        </p>
        <button
          onClick={reset}
          style={{
            height: 44,
            padding: "0 24px",
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 10,
            background: "linear-gradient(135deg, #FF7043, #ea580c)",
            color: "#fff",
            border: "none",
            cursor: "pointer",
          }}
        >
          Reload Dashboard
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary fallback={(props) => <AppCrashFallback {...props} />}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
