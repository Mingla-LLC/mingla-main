const KIND_CONFIG = {
  blacklist:       { code: "BL", label: "Blacklist",   bg: "bg-[var(--color-error-50)]",   text: "text-[var(--color-error-700)]" },
  whitelist:       { code: "WL", label: "Whitelist",   bg: "bg-[var(--color-success-50)]", text: "text-[var(--color-success-700)]" },
  promotion:       { code: "PR", label: "Promotion",   bg: "bg-[var(--color-brand-50)]",   text: "text-[var(--color-brand-700)]" },
  demotion:        { code: "DM", label: "Demotion",    bg: "bg-[var(--color-warning-50)]", text: "text-[var(--color-warning-700)]" },
  strip:           { code: "ST", label: "Strip",       bg: "bg-[var(--gray-200)]",         text: "text-[var(--color-text-secondary)]" },
  keyword_set:     { code: "KS", label: "Keyword Set", bg: "bg-[var(--color-info-50)]",    text: "text-[var(--color-info-700)]" },
  time_window:     { code: "TW", label: "Time Window", bg: "bg-[var(--color-brand-50)]",   text: "text-[var(--color-brand-700)]" },
  numeric_range:   { code: "NR", label: "Numeric",     bg: "bg-[var(--color-brand-50)]",   text: "text-[var(--color-brand-700)]" },
  min_data_guard:  { code: "MD", label: "Data Guard",  bg: "bg-[var(--gray-200)]",         text: "text-[var(--color-text-secondary)]" },
};

export function RuleKindChip({ kind, size = "md" }) {
  const config = KIND_CONFIG[kind] || { code: "??", label: kind || "Unknown", bg: "bg-[var(--gray-200)]", text: "text-[var(--color-text-secondary)]" };
  const sizeClass = size === "sm"
    ? "text-[10px] px-1.5 py-0.5 gap-1"
    : "text-[11px] px-2 py-0.5 gap-1.5";

  return (
    <span
      className={[
        "inline-flex items-center rounded font-semibold uppercase tracking-wide",
        config.bg, config.text, sizeClass,
      ].join(" ")}
      title={config.label}
    >
      <span className="font-mono">{config.code}</span>
      {size !== "sm" && <span className="font-normal normal-case tracking-normal">{config.label}</span>}
    </span>
  );
}
