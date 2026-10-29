import type { ListingInsightsIdentity } from "../../services/listingInsightsService";

const COPY: Record<ListingInsightsIdentity["listingType"], string> = {
  event: "See how people discover and book this event.",
  experience: "See how people discover and book this experience.",
  trip: "See how people discover and book this trip.",
  rsvp: "See how people discover and RSVP to this event.",
  venue: "See how people discover and reserve this venue.",
};

export const listingInsightsIntro = (
  listingType: ListingInsightsIdentity["listingType"],
): string => COPY[listingType];
