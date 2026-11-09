// Issue #3980 — the Calendar's event layers for the days on screen (events on
// Mingla, expected events, go-live deadlines, promotions), the runway list,
// and the detail of one selected event. Refreshed while visible; a quiet
// refresh that fails keeps what is on screen.
import { useAuth } from "../context/AuthContext";
import * as ops from "../services/opsService";
import { todayIso } from "../lib/opsModel";
import { useOpsPoll } from "./useOpsWork";
import { onSignOut } from "../lib/signOutCleanup";

export function useOpsCalendar(from, to) {
  const { access } = useAuth();
  return useOpsPoll(() => ops.fetchCalendar(from, to, todayIso()), {
    key: `${access?.email || ""}|${from}|${to}`,
    intervalMs: 60_000,
    enabled: !!from && !!to,
  });
}

// #4339 Creators and Locals calls: the booked calls for the days on screen
// (instants; the page draws each on the viewer's own day and time).
export function useCalendarCalls(fromIso, toIso, showTest) {
  const { access } = useAuth();
  return useOpsPoll(() => ops.fetchCalendarCalls(fromIso, toIso, showTest), {
    key: `${access?.email || ""}|calls|${fromIso}|${toIso}|${showTest ? 1 : 0}`,
    intervalMs: 60_000,
    enabled: !!fromIso && !!toIso,
  });
}

// The runway list's last answer per signed-in person, kept across remounts so
// Back to runway shows the rows (and can focus the one that opened the panel)
// at once instead of a loading state.
const RUNWAY_CACHE = new Map();
// Signing out forgets it, so the next person never sees these rows.
onSignOut(() => RUNWAY_CACHE.clear());

export function useOpsRunway() {
  const { access } = useAuth();
  return useOpsPoll(() => ops.fetchRunwayReport(null, null, todayIso()), { key: `${access?.email || ""}|runway`, intervalMs: 60_000, cache: RUNWAY_CACHE });
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
