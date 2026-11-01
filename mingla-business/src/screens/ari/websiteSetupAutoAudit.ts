/**
 * #2830 P0 (D-1 interim) — the automatic Website setup audit starts at most
 * once per brand + setup part per app session.
 *
 * The guard used to live in a component ref. A ref dies with its component,
 * so every remount of the Ari screen (tab switch, pane toggle, route
 * re-entry, fast refresh) re-armed the effect and re-sent the kickoff — one
 * local session sent it 178 times in 41 seconds and hit the daily cap. The
 * claim now lives at module scope, which survives remounts for the life of
 * the JS runtime, and is never released on failure (a failed start is
 * retried by the owner from the message's Retry, never by a loop).
 *
 * [TRANSITIONAL] client-side guard — exit: P3 `flow_resume` control call with
 * a per-conversation server guard (one active run) replaces the kickoff.
 */

const claimedAudits = new Set<string>();

export function websiteSetupAutoAuditKey(
  brandId: string,
  setupPart: string | null | undefined,
): string {
  return `${brandId}:${setupPart ?? "overview"}`;
}

/** True exactly once per key per session; the caller may send only then. */
export function claimWebsiteSetupAutoAudit(key: string): boolean {
  if (claimedAudits.has(key)) return false;
  claimedAudits.add(key);
  return true;
}

/** Test seam only — a real session never releases a claim. */
export function resetWebsiteSetupAutoAuditsForTests(): void {
  claimedAudits.clear();
}
