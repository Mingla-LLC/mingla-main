// Issue #3980 — the Calendar's event layers for the days on screen (events on
// Mingla, expected events, go-live deadlines, promotions), the runway list,
// and the detail of one selected event. Refreshed while visible; a quiet
// refresh that fails keeps what is on screen.
import { useAuth } from "../context/AuthContext";
import * as ops from "../services/opsService";
import { todayIso } from "../lib/opsModel";
import { useOpsPoll } from "./useOpsWork";

export function useOpsCalendar(from, to) {
  const { access } = useAuth();
  return useOpsPoll(() => ops.fetchCalendar(from, to, todayIso()), {
    key: `${access?.email || ""}|${from}|${to}`,
    intervalMs: 60_000,
    enabled: !!from && !!to,
  });
}

export function useOpsRunway() {
  const { access } = useAuth();
  return useOpsPoll(() => ops.fetchRunwayReport(null, null, todayIso()), { key: `${access?.email || ""}|runway`, intervalMs: 60_000 });
}

export function useOpsAnchor(selection) {
  const { access } = useAuth();
  const kind = selection?.kind || "";
  const id = selection?.id || "";
  return useOpsPoll(() => ops.fetchAnchorDetail(kind, id, todayIso()), {
    key: `${access?.email || ""}|${kind}|${id}`,
    intervalMs: 60_000,
    enabled: !!kind && !!id,
  });
}
