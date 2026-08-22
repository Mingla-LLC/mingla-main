import type {
  PublicBrandProps,
  PublicEventProps,
  PublicTicketProps,
} from "@mingla/offering-rendering";

import type { PublicEventOccurrence } from "../services/publicEventOccurrencesService";
import type { DraftEvent, TicketStub } from "../store/draftEventStore";
import type { Brand } from "../types/brand";
import { eventCoverProviderCreditLabel } from "../types/eventCoverProvider";
import {
  computeEndsAtUtcWithSmartInfer,
  localWallClockToUtcInstant,
} from "./eventDateMath";
import {
  formatDraftDateLine,
  formatDraftDateSubline,
  formatDraftDatesList,
} from "./eventDateDisplay";
import { isLegacyUnsafeEventCoverVideoUrl } from "./eventCoverMediaRules";

export interface DraftEventBuyerPreview {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  occurrences: readonly PublicEventOccurrence[];
}

const mapTicket = (ticket: TicketStub): PublicTicketProps => ({
  id: ticket.id,
  name: ticket.name,
  description: ticket.description ?? null,
  priceGbp: ticket.priceGbp,
  priceAllInGbp: ticket.priceAllInGbp ?? null,
  currency: ticket.currency ?? null,
  isFree: ticket.isFree,
  isUnlimited: ticket.isUnlimited,
  capacity: ticket.capacity,
  visibility:
    ticket.visibility === "hidden"
      ? "hidden"
      : ticket.visibility === "disabled"
        ? "disabled"
        : "visible",
  passwordProtected: ticket.passwordProtected,
  password: ticket.password,
  saleStartAt: ticket.saleStartAt,
  saleEndAt: ticket.saleEndAt,
  approvalRequired: ticket.approvalRequired,
  waitlistEnabled: ticket.waitlistEnabled,
  availableAt: ticket.availableAt,
  displayOrder: ticket.displayOrder,
});

/**
 * Pure adapter for authenticated Business preview. It shapes draft truth for
 * the same Foundation renderer as buyer web without publishing or mutating the
 * live-event store.
 */
export const draftEventBuyerPreview = (
  draft: DraftEvent,
  brand: Brand | null,
): DraftEventBuyerPreview => {
  const occurrences = (draft.multiDates ?? []).flatMap((entry) => {
    const startAt = localWallClockToUtcInstant(
      `${entry.date}T${entry.startTime}`,
      draft.timezone,
    );
    const endAt = computeEndsAtUtcWithSmartInfer(
      entry.date,
      entry.startTime,
      entry.endTime,
      draft.timezone,
    );
    if (startAt === null || endAt === null) return [];
    return [{
      id: entry.id,
      startAt,
      endAt,
      timezone: draft.timezone,
      isMaster: false,
      ticketsRemaining: null,
    } satisfies PublicEventOccurrence];
  }).sort((left, right) => left.startAt.localeCompare(right.startAt))
    .map((occurrence, index) => ({ ...occurrence, isMaster: index === 0 }));

  const coverVideoUnsafe = isLegacyUnsafeEventCoverVideoUrl(
    draft.coverMediaUrl,
    draft.coverMediaType,
  );
  const safeCoverMediaType = coverVideoUnsafe ? null : draft.coverMediaType;

  return {
    event: {
      id: draft.id,
      name: draft.name,
      brandId: draft.brandId,
      brandSlug: brand?.slug ?? "",
      eventSlug: draft.serverSlug ?? draft.id,
      description: draft.description,
      dateLine: formatDraftDateLine(draft),
      dateSubline: formatDraftDateSubline(draft),
      datesList: formatDraftDatesList(draft),
      status: "published",
      endedAt: null,
      acquisitionState: { kind: "current" },
      format: draft.format === "in_person" ? "in-person" : draft.format,
      venueName: draft.venueName,
      address: draft.address,
      hideAddressUntilTicket: draft.hideAddressUntilTicket,
      locationGeo: draft.locationGeo,
      coverHue: draft.coverHue,
      coverMediaUrl: coverVideoUnsafe ? null : draft.coverMediaUrl,
      coverMediaType:
        safeCoverMediaType === "image" ||
        safeCoverMediaType === "video" ||
        safeCoverMediaType === "gif"
          ? safeCoverMediaType
          : null,
      coverCredit: eventCoverProviderCreditLabel({
        provider: coverVideoUnsafe ? null : draft.coverMediaProvider,
        credit: coverVideoUnsafe ? null : draft.coverMediaCredit,
      }),
      coverGallery: [],
      tickets: draft.tickets.map(mapTicket),
      currency: draft.currency ?? brand?.defaultCurrency ?? null,
      partyTypes: draft.partyTypes,
      vibeTags: draft.vibeTags,
      musicGenres: draft.musicGenres,
      themeOverrides: draft.themeOverrides ?? null,
    },
    brand: brand === null ? null : {
      id: brand.id,
      slug: brand.slug,
      displayName: brand.displayName ?? "Brand",
      photo: brand.photo,
      theme: brand.theme ?? null,
    },
    occurrences,
  };
};
