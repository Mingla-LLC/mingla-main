/**
 * #2830 P0 (D-1 interim) — the automatic Website setup audit starts at most
 * once per brand per app session. Not per setup part: the setup screen moves
 * between parts (`?step=`) while the panel stays open, and a per-part key
 * re-sent "Set up my Website" on every move, racing the run's own lease
 * ("I'm already working on this in another window"). A brand that already has
 * a live run of this person's never kicks off again: the panel opens that
 * run's chat and resumes it, with no new message.
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

export function websiteSetupAutoAuditKey(brandId: string): string {
  return `${brandId}:website_setup`;
}

/**
 * The kickoff decision for the setup panel. Null: send nothing. It waits until
 * the run is known, and a live run of this person's resumes instead.
 */
export function websiteSetupKickoffKey(input: {
  brandId: string;
  /** The part on screen. Deliberately not part of the key: a move is not a start. */
  part: string | null;
  /** The run's state has answered (or failed). Until then, nothing is sent. */
  runKnown: boolean;
  /** This person's live Website setup run's chat, when there is one. */
  liveRunConversationId: string | null;
}): string | null {
  if (!input.runKnown || input.liveRunConversationId) return null;
  return websiteSetupAutoAuditKey(input.brandId);
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
