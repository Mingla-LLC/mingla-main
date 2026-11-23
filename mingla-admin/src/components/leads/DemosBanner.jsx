// #4571 W4 — the Hosts board banner: "N booked demos are not linked to a host
// card", from crm_demo_inbox_count (the same rule and limit as Demos to link,
// so the two numbers agree). Nothing shows when every demo is linked; a failed
// check says so with Retry, never a silent zero.
import { useCallback, useEffect, useState } from "react";
import { Flag } from "lucide-react";
import { AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { demoInboxCount } from "../../services/crmService";
import { bannerWords } from "./demoLinkModel";

export function DemosBanner() {
  const [state, setState] = useState({ status: "loading", count: 0 });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: "loading" }));
    try {
      const count = await demoInboxCount();
      setState({ status: "ready", count: Number(count) || 0 });
    } catch (error) {
      console.error("[crm] demo inbox count failed:", error?.token || error?.message || error);
      setState({ status: "error", count: 0 });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (state.status === "error") {
    return (
      <AlertCard variant="warning" title="Couldn't check for booked demos that need linking"
        action={<Button variant="secondary" size="sm" className="min-h-11" onClick={load}>Retry</Button>}>
        Demos to link in Leads still lists them.
      </AlertCard>
    );
  }
  const words = state.status === "ready" ? bannerWords(state.count) : "";
  if (!words) return null;
  return (
    <div role="note" data-demos-banner={state.count} className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl bg-[var(--a-sched-bg)] px-4 py-3 text-[var(--a-sched-ink)]">
      <Flag aria-hidden="true" className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <b className="text-[14px]">{words}</b>
        <p className="text-[12.5px]">They came in from the scheduler, and Mingla could not be sure which host they belong to.</p>
      </div>
      <a href="#/inbound" className="inline-flex min-h-11 items-center rounded-lg border border-current px-3 text-[13px] font-semibold hover:opacity-80">Review demo bookings</a>
    </div>
  );
}
