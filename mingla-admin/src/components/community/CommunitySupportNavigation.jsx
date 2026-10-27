import { Tabs } from "../ui/Tabs";

// #4130 Wave 6 — one flat row of tabs for the Support page or the Community
// page (lib/supportCommunityTabs.js holds both lists). On a phone it is a
// select, so no tab hides off screen. Only tabs the person may open are passed in.
export function CommunitySupportNavigation({ label, tabs, activeTab, counts, onChange }) {
  const countFor = (id) => Number(counts?.[id] || 0);
  return (
    <div className="space-y-2">
      <div className="md:hidden">
        <label className="sr-only" htmlFor="support-community-tab">{label} section</label>
        <select
          id="support-community-tab"
          value={activeTab}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm font-medium text-[var(--color-text-primary)]"
        >
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}{countFor(tab.id) > 0 ? ` (${countFor(tab.id)})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="hidden md:block">
        <Tabs
          tabs={tabs.map((tab) => ({
            id: tab.id,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {tab.label}
                {countFor(tab.id) > 0 ? (
                  <span className="rounded-full bg-[var(--color-brand-100)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-brand-700)]">
                    {countFor(tab.id)}
                  </span>
                ) : null}
              </span>
            ),
          }))}
          activeTab={activeTab}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
