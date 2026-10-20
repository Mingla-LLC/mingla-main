// Issue #3980 (R8, D-11) — the Agent log is now the Agent activity tab on
// Work. The page id stays so old links keep working: #/agent-log lands on
// #/work-board?tab=activity, replacing the address (Back does not bounce).
import { useEffect } from "react";

export const AGENT_LOG_REDIRECT = "#/work-board?tab=activity";

export function AgentLogPage() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.location.replace(`${window.location.pathname}${window.location.search}${AGENT_LOG_REDIRECT}`);
  }, []);
  return <p role="status" className="text-[13px] text-[var(--color-text-secondary)]">The Agent log is now Agent activity on Work. Opening it…</p>;
}
