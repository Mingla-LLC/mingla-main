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
  useCurrentBrandStore,
  type Brand,
} from "../store/currentBrandStore";
import {
  useLiveEventStore,
  type LiveEvent,
} from "../store/liveEventStore";
import type { DraftEvent } from "../store/draftEventStore";
import { queryClient } from "../config/queryClient";
import { brandKeys } from "../hooks/useBrands";
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
  // Resolve brand for slug freezing. Cycle 17e-A: brand list moved to React
  // Query; outside-component context uses singleton queryClient cache.
  // Falls back to currentBrand selection (most operators publish drafts for
  // their currently-selected brand). If neither matches, returns null —
  // publishDraft preserves the source draft.
  const brand = (() => {
    const current = useCurrentBrandStore.getState().currentBrand;
    if (current !== null && current.id === draft.brandId) {
      return current;
    }
    // Cache lookup via queryClient (without accountId we can't pinpoint the
    // list key, so iterate over cached lists and merge).
    const queries = queryClient.getQueriesData<Brand[]>({
      queryKey: brandKeys.lists(),
    });
    for (const [, brands] of queries) {
      if (brands === undefined) continue;
      const found = brands.find((b) => b.id === draft.brandId);
      if (found !== undefined) return found;
    }
    return undefined;
  })();
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
