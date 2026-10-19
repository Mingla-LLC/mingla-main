// Issue #3980 — the team, statuses, kit and limits for the ops screens.
import { useAuth } from "../context/AuthContext";
import * as ops from "../services/opsService";
import { todayIso } from "../lib/opsModel";
import { useOpsPoll } from "./useOpsWork";

export function useOpsConfig() {
  const { access } = useAuth();
  return useOpsPoll(() => ops.fetchOpsConfig(todayIso()), { key: access?.email || "", intervalMs: 0 });
}
