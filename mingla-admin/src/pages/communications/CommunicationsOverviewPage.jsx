// #4383 — Communications › Overview: everything scheduled to go out to hosts
// and explorers, soonest first, and anything that failed or ran late. It
// opens for whoever can open any Communications screen (lib/access.js
// PAGE_ACCESS_UNION.communications) and only links the screens that person
// may open.
import { useMemo } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { SectionCard } from "../../components/ui/Card";
import { useAuth } from "../../context/AuthContext";
import { canOpenPage } from "../../lib/access";
import { COMMUNICATIONS_SCREENS } from "../../lib/communications";

export function CommunicationsOverviewPage() {
  const { access } = useAuth();
  const screens = useMemo(
    () => COMMUNICATIONS_SCREENS.filter((screen) => canOpenPage(access, screen.id)),
    [access],
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Everything scheduled to go out to hosts and explorers, soonest first."
      />
      <SectionCard title="Screens" subtitle="Each one is its own page in Communications.">
        <ul className="divide-y divide-[var(--gray-100)]">
          {screens.map((screen) => (
            <li key={screen.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">{screen.label}</p>
                <p className="text-[13px] text-[var(--color-text-secondary)]">{screen.description}</p>
              </div>
              <a
                href={`#/${screen.id}`}
                className="inline-flex min-h-9 items-center rounded-lg border border-[var(--gray-300)] px-3 text-[13px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)]"
              >
                Open {screen.label}
              </a>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
