/**
 * brandPatch — diff helper for Brand updates (Cycle 17e-A).
 *
 * Per IMPL dispatch §6 D-CYCLE17E-A-SPEC-1 Option (a): produces a minimal
 * `Partial<Brand>` containing only the fields that differ between draft and
 * original. Used by BrandEditView's handleSave to feed `useUpdateBrand`
 * mutation a tight patch (vs sending the full draft and letting
 * mapUiToBrandUpdatePatch sort it out).
 *
 * Comparison strategy:
 *   - Primitives (string/number/boolean): strict equality
 *   - Nested objects (contact, links): JSON.stringify equality (acceptable for
 *     the small flat shapes used; deep equality would be over-engineering)
 *   - Skip immutable fields: `id`, `slug`, `role`, `account_id` analogue
 *   - Skip server-derived fields: `stats`, `currentLiveEvent`, `payouts`,
 *     `refunds`, `events` (these come from joins/subqueries, not from
 *     the brand row itself)
 */

import type { Brand } from "../store/currentBrandStore";

/**
 * Compute the minimal patch between draft and original Brand objects.
 * Returns only the fields that have changed.
 *
 * Returns empty object when no fields differ — useUpdateBrand short-circuits
 * to refetch in that case (per brandsService.ts §3.2.6).
 */
export function computeDirtyFieldsPatch(
  draft: Brand,
  original: Brand,
): Partial<Brand> {
  const patch: Partial<Brand> = {};

  if (draft.displayName !== original.displayName) {
    patch.displayName = draft.displayName;
  }
  if (draft.kind !== original.kind) {
    patch.kind = draft.kind;
  }
  if (draft.address !== original.address) {
    patch.address = draft.address;
  }
  if (draft.coverHue !== original.coverHue) {
    patch.coverHue = draft.coverHue;
  }
  if (draft.bio !== original.bio) {
    patch.bio = draft.bio;
  }
  if (draft.tagline !== original.tagline) {
    patch.tagline = draft.tagline;
  }
  if (draft.photo !== original.photo) {
    patch.photo = draft.photo;
  }
  if (draft.displayAttendeeCount !== original.displayAttendeeCount) {
    patch.displayAttendeeCount = draft.displayAttendeeCount;
  }
  if (draft.coverMediaUrl !== original.coverMediaUrl) {
    patch.coverMediaUrl = draft.coverMediaUrl;
  }
  if (draft.coverMediaType !== original.coverMediaType) {
    patch.coverMediaType = draft.coverMediaType;
  }
  if (draft.profilePhotoType !== original.profilePhotoType) {
    patch.profilePhotoType = draft.profilePhotoType;
  }
  // Nested-object compare via JSON stringify (small flat shapes — fine)
  if (JSON.stringify(draft.contact) !== JSON.stringify(original.contact)) {
    patch.contact = draft.contact;
  }
  if (JSON.stringify(draft.links) !== JSON.stringify(original.links)) {
    patch.links = draft.links;
  }

  // SKIPPED (immutable or server-derived):
  //   - id (immutable)
  //   - slug (immutable per I-17 + trg_brands_immutable_slug)
  //   - role (per-brand membership; managed via brand_team_members, not brand row)
  //   - stats (server-derived from joined events/orders)
  //   - currentLiveEvent (server-derived from event status query)
  //   - stripeStatus / availableBalanceGbp / pendingBalanceGbp / lastPayoutAt
  //     (server-derived from Stripe Connect; B-cycle wires these)
  //   - payouts / refunds / events (server-derived stub arrays)

  return patch;
}
