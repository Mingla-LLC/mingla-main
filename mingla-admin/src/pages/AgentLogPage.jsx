// Issue #3980 (R8, D-11) — the Agent log is now the Agent activity tab on
// Work. The page id stays so old links keep working: #/agent-log lands on
// #/work-board?tab=activity, replacing the address (Back does not bounce).
import { useEffect } from "react";
import { PageHeader } from "../components/ui/PageHeader";

export const AGENT_LOG_REDIRECT = "#/work-board?tab=activity";

export function AgentLogPage() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.location.replace(`${window.location.pathname}${window.location.search}${AGENT_LOG_REDIRECT}`);
  }, []);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="Agent activity" description="The Agent log is now the Agent activity tab on Work. Opening it…" />
      <a href={AGENT_LOG_REDIRECT} className="self-start rounded-lg px-1 text-[13px] font-semibold text-[var(--color-brand-700)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]">Open Agent activity</a>
    </div>
  );
}
