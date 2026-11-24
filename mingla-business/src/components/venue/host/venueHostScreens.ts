/**
 * #4490 — THE HOST venue owner: every Host venue screen #4490 added (the
 * feature modules, the Till, Close the day, Kitchen and bar, Selling in person,
 * the offer editors, stock, the live floor, the ordering-mode card) in ONE
 * chunk, loaded on intent through `loadVenueHostScreens` (venueHostOwner.ts).
 *
 * Why one owner: web export puts any module that two lazy chunks share into the
 * eager `__common` chunk every visitor downloads. The venue screens share their
 * models, services, sheets and copy almost entirely, so loading each through
 * its own `import()` (or from several routes) hoisted about a megabyte of host
 * code into the boot payload. Importing them statically HERE, and reaching
 * this file only through the one loader, keeps all of it in this chunk.
 *
 * Rules (pinned by venueOwners.issue4490.implementor.test.ts):
 *  - Never import this file statically, and never `import()` any module it
 *    exports from anywhere else: go through `loadVenueHostScreens`.
 *  - No nested `React.lazy` / `import()` between modules of this owner.
 *  - Guest code never imports this owner (the guest owner is
 *    `../guest/venueGuestScreens.ts`).
 */
// The two workspaces themselves (LazyVenueSuites.tsx), so the classic modules
// they import statically share this chunk with the feature modules.
export { VenueSuiteShell } from "../VenueSuiteShell";
export { StaySuiteShell } from "../../stay/StaySuiteShell";
export { VenueSpacesModule } from "../features/VenueSpacesModule";
export { VenueAvailabilityPricingModule } from "../features/VenueAvailabilityPricingModule";
export { VenueOffersModule } from "../features/offers/VenueOffersModule";
export { BookingTermsSection } from "../features/offers/BookingTermsSection";
export { VenueTodayModule } from "../features/today/VenueTodayModule";
export { VenueTodayOverview } from "../features/today/VenueTodayOverview";
export { EventsHereCard } from "../features/today/EventsHereCard";
export { VenueCheckInModule } from "../features/checkin/VenueCheckInModule";
export { VenueGuestListModule } from "../features/guestlist/VenueGuestListModule";
export { VenueRequestsModule } from "../features/requests/VenueRequestsModule";
export { VenueCalendarModule } from "../features/calendar/VenueCalendarModule";
export { VenueMembersModule } from "../features/members/VenueMembersModule";
export { VenueTypeAndFeaturesPanel } from "../features/VenueTypeAndFeaturesPanel";
export { VenueFloorLive } from "../features/floor/VenueFloorLive";
export { VenueAvailabilityModule } from "../VenueAvailabilityModule";
export { VenueOrdersModule } from "../VenueOrdersModule";
export { OrderingModeCard } from "../OrderingModeCard";
export { MenuStockLoader } from "../stock/MenuStockLoader";
export { MenuItemStockSection } from "../stock/MenuItemStockSection";
export {
  VenueDayCloseRouteScreen,
  VenueOfferEditorRouteScreen,
  VenueStationRouteScreen,
  VenueTillRouteScreen,
  VenueTillSettingsRouteScreen,
} from "./venueHostRoutes";
// The Team sheet's Till PIN section (team/LazyTillPinSection.tsx).
export { TillPinSection } from "../../team/TillPinSection";
// The Stay venue header reads the same inventory the Stay suite shows.
export { getStayInventory } from "../../../services/stayInventoryService";
