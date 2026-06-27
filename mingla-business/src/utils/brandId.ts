/**
 * META-ORCH-1232 (C1) — single source of truth for "is this brand id safely
 * persistable / queryable against the `brands.id` (uuid) column?"
 *
 * Root cause this guards: `useCreateBrand.onMutate` mints an optimistic
 * `_temp_${Date.now().toString(36)}` brand id into the React Query list cache.
 * `useCurrentBrandRecovery` reads that same list and, for a zero-brand account,
 * resolves `brands[0]` ("newest-brand") — i.e. the `_temp_…` id — then writes it
 * to the global `currentBrandId` pointer AND to `creator_accounts.default_brand_id`
 * (a uuid column) AND it flows into `getBrand(.eq("id", …))` against the uuid
 * `brands.id`. Both DB-bound paths throw Postgres `22P02 invalid input syntax for
 * type uuid` (observed live), corrupting brand selection.
 *
 * Constitution #4 (one source of truth): the resolver, the recovery write
 * boundary, `setCreatorDefaultBrand`, and `getBrand` ALL import this predicate.
 * A brand id is "persisted" iff it is a syntactically valid RFC-4122 UUID. This
 * by construction rejects every `_temp_…` optimistic id (which is base-36, never
 * a uuid) and any other non-uuid value before it can reach a uuid column or the
 * authoritative current-brand pointer.
 */

// RFC-4122 UUID (any version/variant). `brands.id` is a Postgres `uuid` column,
// which accepts any well-formed UUID — so we validate shape, not version.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The optimistic-create temp-id prefix minted by useCreateBrand.onMutate. Kept
// as an explicit, named guard so the intent is unmistakable even though the
// UUID check already excludes it (a `_temp_…` value can never match UUID_RE).
export const TEMP_BRAND_ID_PREFIX = "_temp_";

/**
 * True iff `id` is a real, server-persisted brand id (a valid UUID) — and thus
 * safe to (a) write to `currentBrandId`, (b) pass as `default_brand_id`, or
 * (c) query against the uuid `brands.id` column. A `_temp_…` optimistic id, an
 * empty string, null/undefined, or any non-uuid string returns false.
 */
export const isPersistedBrandId = (id: string | null | undefined): id is string => {
  if (id === null || id === undefined) return false;
  if (id.startsWith(TEMP_BRAND_ID_PREFIX)) return false;
  return UUID_RE.test(id);
};

/**
 * Typed app-level error thrown when a non-persisted brand id reaches a DB write
 * sink that targets a uuid column (e.g. `setCreatorDefaultBrand`). Surfaces as a
 * caught failure rather than letting Postgres `22P02` escape the service layer.
 */
export class InvalidBrandIdError extends Error {
  constructor(brandId: string) {
    super(`InvalidBrandIdError: "${brandId}" is not a persisted brand id (uuid)`);
    this.name = "InvalidBrandIdError";
  }
}
