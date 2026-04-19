import { useMemo, useState } from "react";
import { Filter, X } from "lucide-react";
import { SectionCard } from "../ui/Card";
import { SearchInput } from "../ui/SearchInput";
import { Button } from "../ui/Button";
import { RuleListGroup } from "./RuleListGroup";

const KIND_FILTER_OPTIONS = [
  { value: "", label: "All kinds" },
  { value: "blacklist", label: "Blacklist" },
  { value: "whitelist", label: "Whitelist" },
  { value: "promotion", label: "Promotion" },
  { value: "demotion", label: "Demotion" },
  { value: "strip", label: "Strip" },
  { value: "keyword_set", label: "Keyword Set" },
  { value: "min_data_guard", label: "Data Guard" },
];

const GROUP_OPTIONS = [
  { value: "category", label: "Group by category" },
  { value: "kind", label: "Group by kind" },
  { value: "scope", label: "Group by scope (global/category)" },
];

const HUMAN_CATEGORY = (slug) => {
  if (!slug) return "Other";
  return slug
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
};

const HUMAN_KIND = (kind) => {
  const map = {
    blacklist: "Blacklist", whitelist: "Whitelist",
    promotion: "Promotion", demotion: "Demotion",
    strip: "Strip", keyword_set: "Keyword Set",
    min_data_guard: "Data Guard", time_window: "Time Window",
    numeric_range: "Numeric Range",
  };
  return map[kind] || kind;
};

function groupRules(rules, groupBy) {
  const groups = new Map();
  for (const r of rules) {
    let key, label;
    if (groupBy === "kind") {
      key = r.kind || "unknown";
      label = HUMAN_KIND(key);
    } else if (groupBy === "scope") {
      key = r.scope_kind || "global";
      label = key === "global" ? "Global Rules" : "Category-Scoped Rules";
    } else {
      // category
      if (r.scope_kind === "global") {
        key = "__global__";
        label = "Global";
      } else {
        key = r.scope_value || "uncategorized";
        label = HUMAN_CATEGORY(key);
      }
    }
    if (!groups.has(key)) groups.set(key, { key, label, rules: [] });
    groups.get(key).rules.push(r);
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === "__global__") return -1;
    if (b.key === "__global__") return 1;
    return a.label.localeCompare(b.label);
  });
}

export function RuleSetGrid({
  rules,
  selectedRuleId,
  onRuleClick,
  onRunClick,
  loading,
  cityIsSelected,
  search,
  onSearchChange,
  kindFilter,
  onKindFilterChange,
  groupBy,
  onGroupByChange,
  neverFiredOnly,
  onNeverFiredToggle,
}) {
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());

  const filtered = useMemo(() => {
    let r = rules || [];
    if (neverFiredOnly) r = r.filter((x) => !x.fires_total || x.fires_total === 0);
    return r;
  }, [rules, neverFiredOnly]);

  const grouped = useMemo(() => groupRules(filtered, groupBy), [filtered, groupBy]);

  const filterIsActive = !!search || !!kindFilter || !!neverFiredOnly;

  const toggleGroup = (key) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearFilters = () => {
    onSearchChange("");
    onKindFilterChange("");
    onNeverFiredToggle(false);
  };

  return (
    <SectionCard
      title="Rules"
      subtitle={`${filtered.length} of ${(rules || []).length}`}
      noPadding
    >
      {/* Filter bar */}
      <div className="px-4 py-3 border-b border-[var(--gray-200)] flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px]">
          <SearchInput
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onClear={() => onSearchChange("")}
            placeholder="Search by rule name..."
          />
        </div>
        <select
          value={kindFilter}
          onChange={(e) => onKindFilterChange(e.target.value)}
          className={[
            "h-10 px-3 text-sm rounded-lg outline-none cursor-pointer",
            "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
            "border border-[var(--gray-300)]",
            "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
          ].join(" ")}
        >
          {KIND_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={groupBy}
          onChange={(e) => onGroupByChange(e.target.value)}
          className={[
            "h-10 px-3 text-sm rounded-lg outline-none cursor-pointer",
            "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
            "border border-[var(--gray-300)]",
            "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
          ].join(" ")}
        >
          {GROUP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <label
          className={[
            "h-10 inline-flex items-center gap-2 px-3 rounded-lg cursor-pointer",
            "border text-sm transition-colors",
            neverFiredOnly
              ? "bg-[var(--color-warning-50)] border-[#f59e0b] text-[var(--color-warning-700)]"
              : "bg-[var(--color-background-primary)] border-[var(--gray-300)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]",
          ].join(" ")}
        >
          <input
            type="checkbox"
            checked={neverFiredOnly}
            onChange={(e) => onNeverFiredToggle(e.target.checked)}
            className="cursor-pointer"
          />
          Never fired only
        </label>
        {filterIsActive && (
          <Button size="sm" variant="ghost" icon={X} onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div className="p-6 space-y-2">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="h-14 rounded-lg bg-[var(--gray-100)] animate-pulse"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center">
          <Filter className="w-10 h-10 text-[var(--color-text-tertiary)] mx-auto mb-3 opacity-50" />
          {filterIsActive ? (
            <>
              <p className="text-[14px] text-[var(--color-text-secondary)] mb-2">
                No rules match the current filters.
              </p>
              <Button size="sm" variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            </>
          ) : (
            <p className="text-[14px] text-[var(--color-text-secondary)]">
              No rules found. The rules engine appears empty.
            </p>
          )}
        </div>
      ) : (
        <div>
          {grouped.map((g) => (
            <RuleListGroup
              key={g.key}
              groupName={g.label}
              groupCount={g.rules.length}
              rules={g.rules}
              collapsed={collapsedGroups.has(g.key)}
              onToggle={() => toggleGroup(g.key)}
              selectedRuleId={selectedRuleId}
              onRuleClick={onRuleClick}
              onRunClick={onRunClick}
              cityIsSelected={cityIsSelected}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
