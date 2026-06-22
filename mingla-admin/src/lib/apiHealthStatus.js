// ORCH-1201 — pure status-derivation helpers for the API-health board.
// Extracted from ApiHealthPage so they are node-testable without the React
// render path (I-PROPOSED-1201-NO-FABRICATED-HEALTH UI unit test).

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

// ORCH-1201-R2 — per-class signal descriptor for the admin board. The class
// decides WHICH signal is authoritative, so the UI labels the metric correctly
// (a processor's "balance" is settled funds, NOT an alertable credit). Pure +
// node-testable.
export function signalLabel(svc) {
  switch (svc?.monitoring_class) {
    case "A":
      return "Balance / usage";
    case "B":
      return "Reactive — last error";
    case "C":
      return "Processor health";
    case "D":
      return "Status feed";
    case "E":
      return "Platform";
    case "F":
      return "Synthetic";
    default:
      return "Status";
  }
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
