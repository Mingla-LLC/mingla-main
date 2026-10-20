// Issue #3980 — one card with its history, log and claims. Only the answer
// for the card on screen is ever shown (latest-only).
import { useAuth } from "../context/AuthContext";
import * as ops from "../services/opsService";
import { todayIso } from "../lib/opsModel";
import { useOpsPoll } from "./useOpsWork";

export function useOpsCard(id) {
  const { access } = useAuth();
  return useOpsPoll(() => ops.getWork(id, todayIso()), { key: `${access?.email || ""}|${id || ""}`, intervalMs: 30_000, enabled: !!id });
}
