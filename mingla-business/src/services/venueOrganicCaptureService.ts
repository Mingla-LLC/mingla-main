export type VenueOrganicCaptureEvent =
  | "page_view"
  | "menu_open"
  | "reservation_start"
  | "availability_shown";

export interface VenueOrganicCaptureScope {
  brandId: string;
  venueId: string;
}

export async function startVenueOrganicJourney(
  _scope: VenueOrganicCaptureScope,
): Promise<void> {
  // Buyer capture is web-only. Business native preview must remain excluded.
}

export async function captureVenueOrganicEvent(
  _scope: VenueOrganicCaptureScope,
  _eventType: VenueOrganicCaptureEvent,
): Promise<void> {
  // Buyer capture is web-only. Business native preview must remain excluded.
}

export function getVenueOrganicJourneyToken(
  _scope: VenueOrganicCaptureScope,
): string | null {
  return null;
}
