/**
 * hueFromId — deterministic 0–359 hue from a stable string id.
 *
 * ORCH-1016 (orchestrator resolution #1): the Discover > Trips feed RPC does NOT
 * return a `cover_hue` column (keeps the RPC lean). The shared EventCoverMedia
 * needs a `hue` for its null-cover band, so derive it CLIENT-SIDE by hashing the
 * tripId. Deterministic + stable so the same trip always gets the same band.
 *
 * djb2-style hash → mod 360. Pure, no deps.
 */
export function hueFromId(id: string): number {
  let hash = 5381;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 33) ^ id.charCodeAt(i);
  }
  // >>> 0 coerces to unsigned 32-bit before mod so the result is always 0–359.
  return (hash >>> 0) % 360;
}
