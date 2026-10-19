// #2879 / #2947 — pure helpers for the waiting-room queue-health board.
// Constitutional rule 9: no signal ⇒ grey "No signal yet", never a fake green.

const VERDICT_ORDER = {
  clean: 1,
  insufficient_evidence: 2,
  stalled: 3,
  orphaned: 4,
};

export function normalizeVerdict(raw) {
  const v = typeof raw === "string" ? raw : raw?.verdict;
  if (v === "clean" || v === "stalled" || v === "orphaned" || v === "insufficient_evidence") {
    return v;
  }
  return null;
}

export function verdictLabel(verdict) {
  switch (normalizeVerdict(verdict)) {
    case "clean":
      return "Clean";
    case "stalled":
      return "Stalled";
    case "orphaned":
      return "Orphaned infinity holds";
    case "insufficient_evidence":
      return "Insufficient evidence";
    default:
      return "No signal yet";
  }
}

// Dot class for the headline verdict. No signal → grey. Never green without a
// real clean verdict that also carried a positive event denominator.
export function verdictDotClass(verdictPayload) {
  const verdict = normalizeVerdict(verdictPayload);
  const windows = Number(verdictPayload?.queueWindowsObserved ?? 0);
  if (verdict === "clean" && windows > 0) return "bg-[#22c55e]";
  if (verdict === "stalled") return "bg-[#f59e0b]";
  if (verdict === "orphaned") return "bg-[#ef4444]";
  if (verdict === "insufficient_evidence") return "bg-[var(--gray-400)]";
  return "bg-[var(--gray-400)]";
}

export function verdictBadgeVariant(verdict) {
  switch (normalizeVerdict(verdict)) {
    case "clean":
      return "success";
    case "stalled":
      return "warning";
    case "orphaned":
      return "error";
    case "insufficient_evidence":
      return "default";
    default:
      return "default";
  }
}

export function observeFreshness(latestRunAt, nowMs = Date.now()) {
  if (!latestRunAt) return { state: "none", ageMs: null };
  const ageMs = nowMs - new Date(latestRunAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return { state: "none", ageMs: null };
  // Admission driver ticks frequently; > 5 minutes without a run is stale.
  if (ageMs > 5 * 60 * 1000) return { state: "stale", ageMs };
  return { state: "fresh", ageMs };
}

export function gaugeNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function worstCrossSignal({ orphanInfinityCount, paidWithoutTicketCount } = {}) {
  const orphans = gaugeNumber(orphanInfinityCount) ?? 0;
  const unpaid = gaugeNumber(paidWithoutTicketCount) ?? 0;
  if (orphans > 0) return "orphaned";
  if (unpaid > 0) return "attention";
  return "clear";
}

export function compareVerdictSeverity(a, b) {
  return (VERDICT_ORDER[normalizeVerdict(a)] || 0) - (VERDICT_ORDER[normalizeVerdict(b)] || 0);
}
