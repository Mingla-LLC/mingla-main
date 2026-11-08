/**
 * #4304 — query keys for the First Home gate's "anything made?" probe. A
 * keyless module (no hooks imported) so writers such as Ari's confirm hook can
 * invalidate it without pulling the gate's hook graph in.
 */
export const firstRunKeys = {
  all: ["firstRun"] as const,
  content: (
    userId: string,
    brandIdsKey: string,
  ): readonly ["firstRun", "content", string, string] =>
    [...firstRunKeys.all, "content", userId, brandIdsKey] as const,
};
