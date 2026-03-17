// ── Session Duration Tracker ────────────────────────────────────────────────
// Simple module-level tracker. Initialized when the module first loads
// (app start). Reset on sign-out if needed.

let sessionStartTime: number = Date.now();

export function getSessionDurationMs(): number {
  return Date.now() - sessionStartTime;
}

export function resetSession(): void {
  sessionStartTime = Date.now();
}
