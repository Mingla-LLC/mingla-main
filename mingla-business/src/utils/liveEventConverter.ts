/**
 * DraftEvent → LiveEvent converter. Single ownership transfer point.
 *
 * [I-16 GUARD] Used ONLY by `draftEventStore.publishDraft`. The converter
 * is the single point at which a LiveEvent is born; it pushes to
 * `liveEventStore` and returns it. The caller (publishDraft) then
 * deletes the source draft. Together this implements I-16 (live-event
 * ownership separation — Constitution #2 enforcement at structural level).
 *
 * Frozen brandSlug at publish time: if the brand is renamed later, the
 * URL stays valid because the LiveEvent carries its own snapshot of
 * brandSlug. This is by design.
 *
 * Per Cycle 6 spec §3.1.4.
 */

import {
  useLiveEventStore,
  type LiveEvent,
} from "../store/liveEventStore";
import type { DraftEvent } from "../store/draftEventStore";
import { getBrandFromCache } from "../hooks/useBrands";
import { generateEventSlug, sanitizeSlugForUrl } from "./eventSlug";
import { generateLiveEventId } from "./liveEventId";

/**
 * Side-effect-free preflight for the local publish conversion.
 *
 * Server-backed drafts must not be promoted out of `events.status='draft'`
 * until the local conversion can succeed. Today the only expected local
 * conversion blocker is a missing brand snapshot in the React Query cache.
 */
export const canConvertDraftToLiveEvent = (draft: DraftEvent): boolean =>
  getBrandFromCache(draft.brandId) !== null;

/**
 * Convert a DraftEvent into a LiveEvent + push it to liveEventStore.
 * Returns the new LiveEvent on success, or null if the brand is missing
 * (the caller should treat null as a publish failure and preserve the
 * source draft).
 */
export const convertDraftToLiveEvent = (
  draft: DraftEvent,
): LiveEvent | null => {
  // Resolve brand for slug freezing. Cycle 2 / ORCH-0742: outside-component
  // context reads the live Brand record from the React Query cache by ID.
  // Returns null if the cache hasn't seen this brand (deleted between draft
  // creation and publish, or fresh app + cold-start before list fetch) —
  // publishDraft preserves the source draft on null return.
  const brand = getBrandFromCache(draft.brandId);
  if (brand === null) {
    // Brand was deleted between draft creation and publish — fail loud
    // so publishDraft can preserve the draft instead of orphaning it.
    if (typeof console !== "undefined" && typeof console.error === "function") {
      console.error(
        `[liveEventConverter] Cannot publish: brand ${draft.brandId} not found in cache.`,
      );
    }
    return null;
  }
  const brandSlug = sanitizeSlugForUrl(brand.slug);

  // Resolve uniqueness against this brand's existing live events.
  const existingSlugs = new Set(
    useLiveEventStore
      .getState()
      .getLiveEventsForBrand(draft.brandId)
      .map((e) => e.eventSlug),
  );
  const eventSlug = generateEventSlug(draft.name, existingSlugs);
  const serverEventSlug =
    draft.serverSlug !== null && draft.serverSlug.trim().length > 0
      ? sanitizeSlugForUrl(draft.serverSlug)
      : eventSlug;
  const now = new Date().toISOString();

  const liveEvent: LiveEvent = {
    // Identity
    id: generateLiveEventId(),
    serverEventId: draft.id,
    brandId: draft.brandId,
    brandSlug,
    eventSlug: serverEventSlug,
    // Lifecycle
    status: "live",
    publishedAt: now,
    cancelledAt: null,
    endedAt: null,
    // Content snapshot
    name: draft.name,
    description: draft.description,
    format: draft.format,
    // ORCH-0824: legacy `category` field is null going forward; replaced by
    // partyTypes/vibeTags/musicGenres arrays. Kept on LiveEvent type for
    // backward compat with persisted Zustand state (cleanup: ORCH-0824-D).
    category: null,
    partyTypes: draft.partyTypes,
    vibeTags: draft.vibeTags,
    musicGenres: draft.musicGenres,
    city: draft.city,
    locationGeo: draft.locationGeo,
    whenMode: draft.whenMode,
    date: draft.date,
    doorsOpen: draft.doorsOpen,
    endsAt: draft.endsAt,
    // ORCH-0877 — carry the smart-inferred UTC end-instant from draft into
    // live. After publish the server-projection mappers overwrite both
    // master*Utc fields with the canonical event_dates values; this is the
    // bridge value for the brief moment between publish and refetch.
    masterStartAtUtc: null,
    masterEndAtUtc: draft.endsAtUtc,
    timezone: draft.timezone,
    recurrenceRule: draft.recurrenceRule,
    multiDates: draft.multiDates,
    venueName: draft.venueName,
    address: draft.address,
    onlineUrl: draft.onlineUrl,
    hideAddressUntilTicket: draft.hideAddressUntilTicket,
    coverHue: draft.coverHue,
    coverMediaUrl: draft.coverMediaUrl,
    coverMediaType: draft.coverMediaType,
    coverMediaProvider: draft.coverMediaProvider,
    coverMediaSourceUrl: draft.coverMediaSourceUrl,
    coverMediaCredit: draft.coverMediaCredit,
    coverMediaCreditUrl: draft.coverMediaCreditUrl,
    coverMediaAlt: draft.coverMediaAlt,
    currency: draft.currency ?? brand.defaultCurrency ?? "GBP",
    tickets: draft.tickets,
    visibility: draft.visibility,
    requireApproval: draft.requireApproval,
    allowTransfers: draft.allowTransfers,
    hideRemainingCount: draft.hideRemainingCount,
    passwordProtected: draft.passwordProtected,
    privateGuestList: draft.privateGuestList,
    inPersonPaymentsEnabled: draft.inPersonPaymentsEnabled,
    // Forward-compat for Cycle 9
    orders: [],
    // Meta
    createdAt: draft.createdAt,
    updatedAt: now,
  };

  // [I-16 GUARD] addLiveEvent is called from EXACTLY this line (and no
  // other code path). publishDraft delegates to this converter; the
  // converter delegates to addLiveEvent. Atomic ownership transfer.
  useLiveEventStore.getState().addLiveEvent(liveEvent);
  return liveEvent;
};
