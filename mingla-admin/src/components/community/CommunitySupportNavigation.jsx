import { Tabs } from "../ui/Tabs";

export const COMMUNITY_SUPPORT_SECTIONS = [
  { id: "overview", label: "Overview", tabs: [{ id: "overview", label: "Overview" }] },
  {
    id: "community",
    label: "Community",
    tabs: [
      { id: "announcements", label: "Announcements" },
      { id: "roadmap", label: "Roadmap" },
      { id: "ideas", label: "Ideas" },
      { id: "questions", label: "Questions" },
      { id: "moderation", label: "Moderation" },
    ],
  },
  {
    id: "support",
    label: "Support",
    tabs: [
      { id: "support", label: "Tickets" },
      { id: "brand-groups", label: "Brand groups" },
    ],
  },
  {
    id: "product",
    label: "Product",
    tabs: [
      { id: "product", label: "Product Inbox" },
      { id: "feature-guide", label: "Feature Guide" },
    ],
  },
  {
    id: "email",
    label: "Email",
    tabs: [{ id: "email", label: "Email" }],
  },
  {
    id: "team",
    label: "Team",
    tabs: [{ id: "team", label: "People and roles" }],
  },
];

export function sectionForTab(tabId) {
  return COMMUNITY_SUPPORT_SECTIONS.find((section) =>
    section.tabs.some((tab) => tab.id === tabId),
  )?.id || "overview";
}

export function CommunitySupportNavigation({ activeTab, visibleTabIds, counts, onChange }) {
  const sections = COMMUNITY_SUPPORT_SECTIONS
    .map((section) => ({
      ...section,
      tabs: section.tabs.filter((tab) => visibleTabIds.has(tab.id)),
    }))
    .filter((section) => section.tabs.length > 0);
  const activeSection = sections.some((section) => section.id === sectionForTab(activeTab))
    ? sectionForTab(activeTab)
    : sections[0]?.id;
  const current = sections.find((section) => section.id === activeSection);
  const selectOptions = sections.flatMap((section) =>
    section.tabs.map((tab) => ({
      id: tab.id,
      label: section.id === "overview" ? tab.label : `${section.label} · ${tab.label}`,
    })),
  );

  const topTabs = sections.map((section) => ({
    id: section.id,
    label: (
      <span className="inline-flex items-center gap-1.5">
        {section.label}
        {Number(counts?.[section.id] || 0) > 0 ? (
          <span className="rounded-full bg-[var(--color-brand-100)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-brand-700)]">
            {counts[section.id]}
          </span>
        ) : null}
      </span>
    ),
  }));

  return (
    <div className="space-y-2">
      <div className="md:hidden">
        <label className="sr-only" htmlFor="community-support-section">Community and Support section</label>
        <select
          id="community-support-section"
          value={activeTab}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm font-medium text-[var(--color-text-primary)]"
        >
          {selectOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>
      <div className="hidden md:block">
        <Tabs
          tabs={topTabs}
          activeTab={activeSection}
          onChange={(sectionId) => {
            const next = sections.find((section) => section.id === sectionId);
            if (next?.tabs[0]) onChange(next.tabs[0].id);
          }}
        />
        {current?.tabs.length > 1 ? (
          <div className="mt-2 flex flex-wrap gap-2" role="tablist" aria-label={`${current.label} sections`}>
            {current.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeTab}
                onClick={() => onChange(tab.id)}
                className={`min-h-9 rounded-full px-3 py-1.5 text-sm font-medium ${
                  tab.id === activeTab
                    ? "bg-[var(--color-brand-500)] text-white"
                    : "border border-[var(--gray-200)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]"
                }`}
              >
                {tab.label}
                {Number(counts?.[tab.id] || 0) > 0 ? ` (${counts[tab.id]})` : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

