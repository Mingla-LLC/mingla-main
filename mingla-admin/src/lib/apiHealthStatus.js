// ORCH-1199 — pure status-derivation helpers for the API-health board.
// Extracted from ApiHealthPage so they are node-testable without the React
// render path (I-PROPOSED-1199-NO-FABRICATED-HEALTH UI unit test).

// Worst-of-layers, where `down` worst → red; `degraded` → amber; `healthy` →
// green; everything else (no signal / unknown) → null. NEVER green for a
// service with no real signal (constitutional rule 9).
export function worstOfLayers(layers) {
  const order = { healthy: 1, degraded: 2, down: 3 };
  let worst = null;
  for (const v of Object.values(layers || {})) {
    const s = v?.status;
    if (s === "unknown" || s == null) continue;
    if (worst === null || order[s] > order[worst]) worst = s;
  }
  return worst; // null when there is NO real signal
}

// Status → dot Tailwind class. `alerting` forces red regardless. No signal →
// grey. NEVER returns the green class for a service with no signal.
export function statusDotClass(layers, alertState) {
  if (alertState === "alerting") return "bg-[#ef4444]"; // red
  const worst = worstOfLayers(layers);
  switch (worst) {
    case "healthy":
      return "bg-[#22c55e]"; // green
    case "degraded":
      return "bg-[#f59e0b]"; // amber
    case "down":
      return "bg-[#ef4444]"; // red
    default:
      return "bg-[var(--gray-400)]"; // grey — unknown / no signal
  }
}
