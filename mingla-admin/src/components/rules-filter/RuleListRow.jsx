import { useState } from "react";
import { Play, MoreVertical, Hash } from "lucide-react";
import { RuleKindChip } from "./RuleKindChip";

const RELATIVE_THRESHOLDS = [
  [60, "just now"],
  [3600, (s) => `${Math.floor(s / 60)}m ago`],
  [86400, (s) => `${Math.floor(s / 3600)}h ago`],
  [604800, (s) => `${Math.floor(s / 86400)}d ago`],
  [2592000, (s) => `${Math.floor(s / 604800)}w ago`],
  [Infinity, (s) => `${Math.floor(s / 2592000)}mo ago`],
];

function relativeTime(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  for (const [limit, fmt] of RELATIVE_THRESHOLDS) {
    if (diffSec < limit) return typeof fmt === "function" ? fmt(diffSec) : fmt;
  }
  return "—";
}

export function RuleListRow({ rule, selected, onClick, onRunClick, cityIsSelected }) {
  const [hovered, setHovered] = useState(false);
  const fires7d = Number.isFinite(rule?.fires_7d) ? rule.fires_7d : 0;
  const entryCount = Number.isFinite(rule?.entry_count) ? rule.entry_count : 0;
  const lastEdited = relativeTime(rule?.last_edited_at);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={[
        "group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer",
        "transition-colors duration-150",
        selected
          ? "bg-[var(--color-brand-50)] border border-[var(--color-brand-200)]"
          : "hover:bg-[var(--gray-100)] border border-transparent",
      ].join(" ")}
      aria-pressed={selected}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-medium text-[var(--color-text-primary)] truncate font-mono">
            {rule.name}
          </span>
          {rule.is_active === false && (
            <span className="text-[10px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">
              inactive
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
          <RuleKindChip kind={rule.kind} size="sm" />
          <span className="inline-flex items-center gap-0.5">
            <Hash className="w-3 h-3" />
            {entryCount} {entryCount === 1 ? "entry" : "entries"}
          </span>
          <span>·</span>
          <span>
            {fires7d.toLocaleString()} fires/7d
          </span>
          <span>·</span>
          <span>edited {lastEdited}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {hovered && cityIsSelected && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRunClick?.(rule);
            }}
            className={[
              "inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
              "bg-[var(--color-brand-500)] text-white hover:bg-[var(--color-brand-600)]",
              "transition-colors",
            ].join(" ")}
            title={`Run this rule on the selected city`}
          >
            <Play className="w-3 h-3" />
            Run
          </button>
        )}
        {hovered && !cityIsSelected && (
          <span
            className="text-[10px] text-[var(--color-text-tertiary)] italic"
            title="Pick a city to run this rule"
          >
            Pick a city
          </span>
        )}
        <MoreVertical className="w-4 h-4 text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-50 transition-opacity" />
      </div>
    </div>
  );
}
