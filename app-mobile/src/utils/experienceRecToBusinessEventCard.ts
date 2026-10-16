/**
 * Map a brand-experience Recommendation / saved card onto BusinessEventCard.
 * Extracted from SwipeableCards so Likes and Calendar can open the same Book path (#1672 / #3281 1d).
 * SwipeableCards keeps a local wrapper of the same name so ORCH-1065 source pins stay green.
 */
import type { BusinessEventCard } from "../types/mergedDiscover";
import { hueFromId } from "./hueFromId";
import { extractHideAddressUntilTicket } from "./venueExperienceMapping";

export function experienceRecToBusinessEventCard(rec: any): BusinessEventCard {
  const firstStop = Array.isArray(rec?.stops) && rec.stops.length > 0 ? rec.stops[0] : null;
  const eventId = String(rec?.eventId ?? rec?.id ?? '');
  const brandSlug = typeof rec?.brandSlug === 'string' ? rec.brandSlug : '';
  const eventSlug = typeof rec?.eventSlug === 'string' ? rec.eventSlug : '';
  return {
    eventId,
    brandId: typeof rec?.brandId === 'string' ? rec.brandId : '',
    brandSlug,
    brandName: typeof rec?.brandName === 'string' ? rec.brandName : '',
    brandProfilePhotoUrl: typeof rec?.brandLogoUrl === 'string' ? rec.brandLogoUrl : null,
    eventSlug,
    title: typeof rec?.title === 'string' ? rec.title : '',
    // ORCH-1072: use the experience's REAL description (events.description),
    // NOT the one-line tagline. Empty → null → the sheet shows its empty-state.
    description:
      typeof rec?.description === 'string' && rec.description.trim().length > 0
        ? rec.description
        : null,
    // ORCH-1072: use the experience's REAL cover (image OR video), NOT the
    // fabricated first-stop image + hardcoded 'image'. EventCoverMedia in the
    // shared render layer plays video/gif/image. Falls back to the first stop
    // image only when the experience has no cover at all (honest fallback).
    coverMediaUrl:
      typeof rec?.coverMediaUrl === 'string' && rec.coverMediaUrl.length > 0
        ? rec.coverMediaUrl
        : (firstStop?.imageUrl ?? null),
    coverMediaType:
      rec?.coverMediaType === 'image' ||
      rec?.coverMediaType === 'video' ||
      rec?.coverMediaType === 'gif'
        ? rec.coverMediaType
        : (typeof rec?.coverMediaUrl === 'string' && rec.coverMediaUrl.length > 0
            ? 'image'
            : (firstStop?.imageUrl ? 'image' : null)),
    coverHue: hueFromId(eventId),
    masterDateUtc: rec?.masterDateUtc ?? null,
    masterEndAtUtc: rec?.masterEndAtUtc ?? null,
    doorsOpenLocal: null,
    endsAtLocal: null,
    timezone: typeof rec?.timezone === 'string' ? rec.timezone : 'UTC',
    venueName: firstStop?.placeName ?? null,
    // ORCH-1138 rework (§4.C.3) — carry the resolved city (rec.city) or fall back
    // to the first stop's city → the consumer City,Country meta chip (was hard null).
    city:
      typeof rec?.city === 'string' && rec.city.length > 0
        ? rec.city
        : (typeof firstStop?.city === 'string' && firstStop.city.length > 0
            ? firstStop.city
            : null),
    address: null,
    // ORCH-1157 Round-3 [consumer-hide-address] — carry the REAL flag instead of
    // a hardcoded `false`. The deck experience envelope carries no top-level
    // street (address is null) and may not carry the theme; honor a direct
    // boolean if present, else fail CLOSED to true (street hidden). Never
    // fabricate a reveal-by-default privacy flag (Constitution rule 9).
    hideAddressUntilTicket:
      typeof rec?.hideAddressUntilTicket === 'boolean'
        ? rec.hideAddressUntilTicket
        : extractHideAddressUntilTicket(rec?.theme),
    format: 'in-person',
    locationGeo:
      firstStop && typeof firstStop.lat === 'number' && typeof firstStop.lng === 'number'
        ? { lat: firstStop.lat, lng: firstStop.lng }
        : null,
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    priceMin: typeof rec?.totalPriceMin === 'number' ? rec.totalPriceMin : null,
    priceMax: typeof rec?.totalPriceMax === 'number' ? rec.totalPriceMax : null,
    displayPriceCents: null,
    displayCurrency: null,
    currency: typeof rec?.currency === 'string' ? rec.currency : 'USD',
    publicBuyerUrl: `https://host.usemingla.com/e/${brandSlug}/${eventSlug}`,
    // ORCH-1072: carry the multi-stop itinerary + upcoming occurrences so the
    // detail sheet renders the route + the date picker. Experience-only (an
    // event/trip card never sets these → undefined → no itinerary/picker).
    experienceStops: Array.isArray(rec?.stops)
      ? rec.stops.map((s: any, idx: number) => {
          // ORCH-1138 rework (§4.C.3) — carry the FULL per-stop gallery + coords +
          // start time + label so the consumer detail renders count-aware
          // galleries, the "Where you'll start" map, time pills, and START
          // HERE/THEN/END WITH (these were silently dropped — the mockup gap).
          const imageUrls: string[] = Array.isArray(s?.imageUrls)
            ? s.imageUrls.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
            : [];
          const single =
            typeof s?.imageUrl === 'string' && s.imageUrl.length > 0 ? s.imageUrl : null;
          const total = rec.stops.length;
          const stopLabel: 'Start Here' | 'Then' | 'End With' =
            typeof s?.stopLabel === 'string' &&
            (s.stopLabel === 'Start Here' || s.stopLabel === 'Then' || s.stopLabel === 'End With')
              ? s.stopLabel
              : (idx === 0 ? 'Start Here' : idx === total - 1 ? 'End With' : 'Then');
          return {
            stopNumber: typeof s?.stopNumber === 'number' ? s.stopNumber : 0,
            placeName: typeof s?.placeName === 'string' && s.placeName.length > 0 ? s.placeName : null,
            address: typeof s?.address === 'string' && s.address.length > 0 ? s.address : null,
            imageUrl: single ?? (imageUrls.length > 0 ? imageUrls[0] : null),
            aiDescription:
              typeof s?.aiDescription === 'string' && s.aiDescription.length > 0 ? s.aiDescription : null,
            imageUrls: imageUrls.length > 0 ? imageUrls : (single !== null ? [single] : []),
            lat: typeof s?.lat === 'number' && s.lat !== 0 ? s.lat : null,
            lng: typeof s?.lng === 'number' && s.lng !== 0 ? s.lng : null,
            startTime:
              typeof s?.startTime === 'string' && s.startTime.length > 0 ? s.startTime : null,
            stopLabel,
          };
        })
      : undefined,
    experienceIntents: Array.isArray(rec?.experienceIntents)
      ? rec.experienceIntents.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
      : undefined,
    brandTheme:
      rec?.brandTheme !== null && typeof rec?.brandTheme === 'object' ? rec.brandTheme : null,
    upcomingOccurrences: Array.isArray(rec?.upcomingOccurrences)
      ? rec.upcomingOccurrences.map((o: any) => ({
          eventDateId: typeof o?.eventDateId === 'string' ? o.eventDateId : '',
          startAt: typeof o?.startAt === 'string' ? o.startAt : '',
          endAt: typeof o?.endAt === 'string' ? o.endAt : '',
          capacity: typeof o?.capacity === 'number' ? o.capacity : null,
          sold: typeof o?.sold === 'number' ? o.sold : 0,
          remaining: typeof o?.remaining === 'number' ? o.remaining : null,
        }))
      : undefined,
    // ORCH-1153 WS2: recurrence fields → the consumer rule-based open-daily
    // detector (the final seed the ConsumerExperienceDetailScreen reads).
    isRecurring: rec?.isRecurring === true,
    recurrenceRule:
      rec?.recurrenceRule !== null && typeof rec?.recurrenceRule === 'object'
        ? rec.recurrenceRule
        : null,
  } as unknown as BusinessEventCard;
}
