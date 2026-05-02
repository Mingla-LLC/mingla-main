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

import { useCurrentBrandStore } from "../store/currentBrandStore";
import {
  useLiveEventStore,
  type LiveEvent,
} from "../store/liveEventStore";
import type { DraftEvent } from "../store/draftEventStore";
import { generateEventSlug, sanitizeSlugForUrl } from "./eventSlug";
import { generateLiveEventId } from "./liveEventId";

/**
 * Convert a DraftEvent into a LiveEvent + push it to liveEventStore.
 * Returns the new LiveEvent on success, or null if the brand is missing
 * (the caller should treat null as a publish failure and preserve the
 * source draft).
 */
export const convertDraftToLiveEvent = (
  draft: DraftEvent,
): LiveEvent | null => {
  // Resolve current brand for slug freezing.
  const brand = useCurrentBrandStore
    .getState()
    .brands.find((b) => b.id === draft.brandId);
  if (brand === undefined) {
    // Brand was deleted between draft creation and publish — fail loud
    // so publishDraft can preserve the draft instead of orphaning it.
    if (typeof console !== "undefined" && typeof console.error === "function") {
      console.error(
        `[liveEventConverter] Cannot publish: brand ${draft.brandId} not found in store.`,
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
  const now = new Date().toISOString();

  const liveEvent: LiveEvent = {
    // Identity
    id: generateLiveEventId(),
    brandId: draft.brandId,
    brandSlug,
    eventSlug,
    // Lifecycle
    status: "live",
    publishedAt: now,
    cancelledAt: null,
    endedAt: null,
    // Content snapshot
    name: draft.name,
    description: draft.description,
    format: draft.format,
    category: draft.category,
    whenMode: draft.whenMode,
    date: draft.date,
    doorsOpen: draft.doorsOpen,
    endsAt: draft.endsAt,
    timezone: draft.timezone,
    recurrenceRule: draft.recurrenceRule,
    multiDates: draft.multiDates,
    venueName: draft.venueName,
    address: draft.address,
    onlineUrl: draft.onlineUrl,
    hideAddressUntilTicket: draft.hideAddressUntilTicket,
    coverHue: draft.coverHue,
    tickets: draft.tickets,
    visibility: draft.visibility,
    requireApproval: draft.requireApproval,
    allowTransfers: draft.allowTransfers,
    hideRemainingCount: draft.hideRemainingCount,
    passwordProtected: draft.passwordProtected,
    privateGuestList: draft.privateGuestList,
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
