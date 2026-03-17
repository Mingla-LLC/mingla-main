export function Tabs({ tabs, activeTab, onChange, className = "" }) {
  return (
    <div className={`border-b border-[var(--gray-200)] ${className}`}>
      <nav className="flex gap-0" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={[
                "px-4 py-2 text-sm font-medium cursor-pointer transition-colors duration-150 -mb-px",
                isActive
                  ? "text-[var(--color-brand-500)] border-b-2 border-[var(--color-brand-500)]"
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
