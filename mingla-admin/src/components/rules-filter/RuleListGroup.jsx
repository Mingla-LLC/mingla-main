import { ChevronDown, ChevronRight } from "lucide-react";
import { RuleListRow } from "./RuleListRow";

export function RuleListGroup({
  groupName,
  groupCount,
  rules,
  collapsed,
  onToggle,
  selectedRuleId,
  onRuleClick,
  onRunClick,
  cityIsSelected,
}) {
  const Icon = collapsed ? ChevronRight : ChevronDown;

  return (
    <div className="border-b border-[var(--gray-200)] last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className={[
          "w-full flex items-center gap-2 px-3 py-2",
          "text-left hover:bg-[var(--gray-100)] transition-colors cursor-pointer",
        ].join(" ")}
      >
        <Icon className="w-4 h-4 text-[var(--color-text-tertiary)] shrink-0" />
        <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          {groupName}
        </span>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">
          ({groupCount})
        </span>
      </button>
      {!collapsed && (
        <div className="px-2 pb-2 space-y-1">
          {rules.map((r) => (
            <RuleListRow
              key={r.id}
              rule={r}
              selected={selectedRuleId === r.id}
              onClick={() => onRuleClick(r.id)}
              onRunClick={onRunClick}
              cityIsSelected={cityIsSelected}
            />
          ))}
        </div>
      )}
    </div>
  );
}
