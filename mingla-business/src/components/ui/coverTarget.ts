/**
 * CoverTarget — ORCH-0989 [Unified cover picker sheet] discriminated union.
 *
 * Replaces CoverPicker's ad-hoc brandId + eventRowId + coverMediaApplyMode
 * props with one target object that drives BOTH persistence routing and
 * per-target video availability:
 *
 *   - event / trip → events-table row (events.cover_media_url) via
 *     uploadEventCoverMedia + the event-scoped video pipeline.
 *   - brand        → brands.cover_media_url via useBrandCoverUpload
 *     (device + provider) + the generalized brand-target video pipeline.
 *
 * Per SPEC_ORCH-0989 §4.2 (LOCKED).
 */

export type CoverTarget =
  | {
      // META-ORCH-1059 Sub-B: "experience" joins event/trip — experiences are
      // events-table rows that use the SAME events.cover_media_* columns, so
      // the experience variant mirrors event/trip exactly (uploadEventCoverMedia
      // + the event-scoped video pipeline keyed on the experience's events-row
      // id). No new persistence path or server-side video-target is needed.
      kind: "event" | "trip" | "experience";
      brandId: string;
      /** events-table row id (event id, trip's events-row id, or experience id). */
      eventRowId: string;
      coverMediaApplyMode: "draft_auto" | "published_manual";
    }
  | {
      kind: "brand";
      brandId: string;
      /** Needed by useBrandCoverUpload's updateBrand mutation. */
      accountId: string;
      /** Needed by useUpdateBrand's optimistic patch. */
      existingDescription: string | null;
    };
