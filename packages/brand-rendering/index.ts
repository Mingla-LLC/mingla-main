export { PublicBrandPage } from "./PublicBrandPage";
// META-ORCH-1255(C) — the shared menu section renderer (the venue public page
// §6.6 reuses the brand page's Menu composition verbatim, currency-aware).
// META-ORCH-1255(R2): lives in its own module for the ORCH-1083 bundle budget;
// bundle-sensitive consumers (the venue page) use the DEEP specifier
// "@mingla/brand-rendering/PublicMenuSections" instead of this barrel.
export { PublicMenuSections } from "./PublicMenuSections";
export type {
  PublicBrand,
  PublicBrandCallbacks,
  PublicBrandContact,
  PublicBrandEvent,
  PublicBrandExperience,
  PublicBrandLinks,
  PublicBrandPageProps,
  PublicBrandTicket,
  PublicBrandTrip,
  PublicBrandUpcoming,
  PublicBrandVenueSummary,
  PublicMediaType,
  PublicMenuGroup,
  PublicMenuItem,
  PublicVenueDetail,
} from "./types";
