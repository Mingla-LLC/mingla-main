/**
 * #4238 — small pure rules the Host ads builder shares across its load paths.
 */

/**
 * The platforms a draft starts with. One rule for a fresh ad, a restored
 * draft and a draft that was not found: when nothing was saved, tick every
 * available platform; otherwise keep exactly the saved ones that are still
 * available.
 */
export function initialHostAdConnections<C extends { id: string }>(
  available: readonly C[],
  savedIds: unknown,
): C[] {
  const ids = Array.isArray(savedIds)
    ? savedIds.filter((id): id is string => typeof id === "string")
    : [];
  if (ids.length === 0) return [...available];
  const wanted = new Set(ids);
  const kept = available.filter((item) => wanted.has(item.id));
  return kept.length > 0 ? kept : [...available];
}

/** "Matched on all platforms" only when at least one platform is ticked. */
export function hostAdMatchSubtitle(
  missingNames: string,
  missingCount: number,
  selectedCount: number,
): string {
  if (selectedCount === 0) return "Turn on at least one app to check this";
  return missingCount === 0
    ? "Matched on all platforms"
    : `Not found on ${missingNames}: remove it or turn those platforms off`;
}
