// Issue #4255 (W2) — the board's columns and the sprint plan, read through the
// one ops loader (useOpsPoll: refresh on a timer while visible, on focus and
// when the connection returns; a quiet refresh that fails keeps what is shown).
import { useAuth } from "../context/AuthContext";
import * as ops from "../services/opsService";
import { todayIso } from "../lib/opsModel";
import { useOpsPoll } from "./useOpsWork";

/** The board's live columns and whether this viewer may change them. */
export function useWorkStatuses({ enabled = true } = {}) {
  const { access } = useAuth();
  return useOpsPoll(() => ops.listStatuses(false), { key: `${access?.email || ""}|work-statuses`, intervalMs: 60_000, enabled });
}

/** One sprint's plan: review, goals, capacity, the cards in it and the backlog. */
export function useSprintPlan(sprintId, { enabled = true, intervalMs = 60_000 } = {}) {
  const { access } = useAuth();
  return useOpsPoll(() => ops.fetchSprintPlan(sprintId || null, todayIso()), { key: `${access?.email || ""}|sprint-plan|${sprintId || "current"}`, intervalMs, enabled });
}

/** A card's thread, refreshed every 20 seconds while it is open. */
export function useCardThread(cardId, { enabled = true } = {}) {
  const { access } = useAuth();
  return useOpsPoll(() => ops.listMessages(cardId, 200), { key: `${access?.email || ""}|thread|${cardId || ""}`, intervalMs: 20_000, enabled: enabled && !!cardId });
}
