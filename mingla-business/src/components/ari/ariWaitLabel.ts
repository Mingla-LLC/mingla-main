/**
 * #3355 P3 — the wait label under an Ari turn.
 *
 * "Reconnecting to Ari…" is true only when this device cannot tell whether
 * the server has the turn. When the last status check reached the server and
 * it said the turn is still running, the connection is fine and the model is
 * simply slow, so the label says so.
 */

export const ARI_RECONNECTING_LABEL = "Reconnecting to Ari…";
export const ARI_STILL_THINKING_LABEL = "Ari is still thinking…";

export function ariWaitLabel(
  turn: { reconciling: boolean; serverWorking?: boolean },
  phaseLabel: string,
): string {
  if (!turn.reconciling) return phaseLabel;
  return turn.serverWorking ? ARI_STILL_THINKING_LABEL : ARI_RECONNECTING_LABEL;
}
