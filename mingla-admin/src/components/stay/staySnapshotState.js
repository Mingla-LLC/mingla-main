export const STAY_SNAPSHOT_STALE_AFTER_MS = 2 * 60 * 1000;

export function staySnapshotState(snapshotAt, now = Date.now()) {
  const capturedAt = Date.parse(snapshotAt || "");
  if (!Number.isFinite(capturedAt)) return "missing";
  return now - capturedAt >= STAY_SNAPSHOT_STALE_AFTER_MS ? "stale" : "fresh";
}
