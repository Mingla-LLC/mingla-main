// ORCH-1008 Phase 4 — additive arrow-key nav. Existing props/behavior unchanged.
//   Left/Right cycles tabs and focuses the new active tab. Home/End jump to
//   first/last. Disabled tabs are skipped. Backward-compatible: no caller
//   needs to change.

import { useRef } from "react";

export function Tabs({ tabs, activeTab, onChange, className = "", variant = "default", mobileGrid = false }) {
  const buttonRefs = useRef({});

  function handleKeyDown(event, currentId) {
    const key = event.key;
    if (
      key !== "ArrowLeft" &&
      key !== "ArrowRight" &&
      key !== "Home" &&
      key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const enabled = tabs.filter((t) => !t.disabled);
    if (enabled.length === 0) return;
    const idx = enabled.findIndex((t) => t.id === currentId);
    let nextIdx;
    if (key === "Home") nextIdx = 0;
    else if (key === "End") nextIdx = enabled.length - 1;
    else if (key === "ArrowRight") nextIdx = (idx + 1) % enabled.length;
    else nextIdx = (idx - 1 + enabled.length) % enabled.length;
    const nextId = enabled[nextIdx].id;
    onChange(nextId);
    requestAnimationFrame(() => buttonRefs.current[nextId]?.focus());
  }

  return (
    <div className={`admin-control-scroll min-w-0 overflow-x-auto border-b border-[var(--gray-200)] ${className}`}>
      <nav className={mobileGrid ? "grid min-w-full grid-cols-2 gap-0 sm:flex sm:w-max" : "flex w-max min-w-full gap-0"} role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              ref={(el) => { buttonRefs.current[tab.id] = el; }}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, tab.id)}
              className={[
                "-mb-px min-h-11 shrink-0 cursor-pointer whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors duration-150",
                variant === "highContrast"
                  ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2"
                  : "",
                isActive
                  ? variant === "highContrast"
                    ? "text-[var(--color-brand-700)] border-b-2 border-[var(--color-brand-700)]"
                    : "text-[var(--color-brand-500)] border-b-2 border-[var(--color-brand-500)]"
                  : variant === "highContrast"
                    ? "text-[var(--color-text-secondary)] border-b-2 border-transparent hover:text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-tertiary)] border-b-2 border-transparent hover:text-[var(--color-text-secondary)]",
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
