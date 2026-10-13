/**
 * toward #3697 Wave 5 — challenge-based LAUNCH (#3704 pattern).
 *
 * Launch starts real spend. The confirm phrase must be typed by a human in the
 * Admin UI and re-checked server-side. A one-click or missing phrase fails closed.
 * Fixed phrase (not model-enum) so Ari/automation cannot complete it from a
 * tool schema — the same property Phase 3 requires for host LAUNCH.
 */

export const LAUNCH_CONFIRM_PHRASE = "LAUNCH";

export function isLaunchConfirmPhrase(value: unknown): boolean {
  return typeof value === "string" && value === LAUNCH_CONFIRM_PHRASE;
}
