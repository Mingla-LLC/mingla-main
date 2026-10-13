/**
 * Issue #3801 — the two facts about a trip's packages that every read must
 * agree on: the ORDER the host authored them in, and the trip's total spots.
 *
 * Pure (no Supabase, no React Native) so the host read (`tripsService`), the
 * buyer read (`publicEventsService`) and the wizard preview share one owner.
 *
 * ORDER. `trip_pricing_tiers` has no order column; the authored order lives on
 * the joined `ticket_types.display_order`. Neither read ordered the tiers, so
 * Postgres returned them in heap order and "the first package" changed between
 * reloads. Order is `display_order`, then `created_at`, then id — total, so two
 * reads of the same rows can never disagree.
 *
 * SPOTS. A trip has no capacity of its own: each package carries its spots in
 * `ticket_types.quantity_total`. The trip total is their sum, independent of
 * row order. A package with no limit makes the total unknowable, so the total
 * is `null` ("no cap") rather than a number that leaves it out (Constitution
 * rule 9 — never fabricate).
 */

export interface TripPackageOrderRow {
  id: string;
  display_order?: number | null;
  created_at?: string | null;
}

export interface TripPackageSpotsRow {
  quantity_total: number | null;
  is_unlimited?: boolean | null;
}

function orderRank(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.POSITIVE_INFINITY;
}

/** Authored order: display_order, then created_at, then id. Missing sorts last. */
export function compareTripPackageOrder(
  a: TripPackageOrderRow | undefined,
  b: TripPackageOrderRow | undefined,
): number {
  if (a === undefined || b === undefined) {
    if (a === b) return 0;
    return a === undefined ? 1 : -1;
  }
  const aOrder = orderRank(a.display_order);
  const bOrder = orderRank(b.display_order);
  if (aOrder !== bOrder) return aOrder < bOrder ? -1 : 1;
  const aCreated = a.created_at ?? "";
  const bCreated = b.created_at ?? "";
  if (aCreated !== bCreated) {
    if (aCreated === "") return 1;
    if (bCreated === "") return -1;
    return aCreated < bCreated ? -1 : 1;
  }
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Returns the tier rows in authored order. Does not mutate the input. A tier
 * whose ticket type is not in the map (soft-deleted package) sorts last, by its
 * own id, so the result is still total.
 */
export function orderTripPricingTierRows<
  T extends { id: string; ticket_type_id: string },
>(tiers: readonly T[], ticketTypesById: ReadonlyMap<string, TripPackageOrderRow>): T[] {
  return [...tiers].sort((a, b) => {
    const byPackage = compareTripPackageOrder(
      ticketTypesById.get(a.ticket_type_id),
      ticketTypesById.get(b.ticket_type_id),
    );
    if (byPackage !== 0) return byPackage;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
}

/**
 * The trip's total spots: the sum of every package's spots. `null` when there
 * are no packages, or when any package has no limit.
 */
export function sumTripPackageSpots(
  packages: readonly TripPackageSpotsRow[],
): number | null {
  if (packages.length === 0) return null;
  let total = 0;
  for (const pkg of packages) {
    if (pkg.is_unlimited === true) return null;
    if (typeof pkg.quantity_total !== "number" || !Number.isFinite(pkg.quantity_total)) {
      return null;
    }
    total += Math.max(0, pkg.quantity_total);
  }
  return total;
}
