// ===========================================================================
// Issue #1793 — the #1767 Phase 4 ordering renderers.
//
// SPEC #1788 P-61 SET-B names this folder by path: everything under
// `packages/brand-rendering/venueOrdering/**` may sell and may never touch
// money. The strict-grep gate scans it RECURSIVELY, so a file added here is
// covered the moment it exists — no allowlist to remember to update.
//
// Hosts import DEEP specifiers
// (`@mingla/brand-rendering/venueOrdering/VenueOrderingMenuList`) inside their
// OWN `React.lazy` boundary. This barrel exists for types and for tests; a host
// that value-imports it at module scope drags every renderer into its entry
// chunk, which is the exact bundle-budget regression #1550/#1791 already paid
// for twice.
// ===========================================================================

export type {
  VenueOrderBuyerDraft,
  VenueOrderCartLine,
  VenueOrderFulfillmentStatus,
  VenueOrderHandover,
  VenueOrderingConfig,
  VenueOrderingSpot,
  VenueOrderingSpotState,
  VenueOrderingState,
  VenueOrderingView,
  VenueOrderLiveStatus,
  VenueOrderModifier,
  VenueOrderModifierGroup,
  VenueOrderPreview,
  VenueOrderPricedLine,
  VenueOrderTipChoice,
} from "./venueOrderingTypes";

export {
  isoDayFromMondayZero,
  VENUE_ORDER_DEFAULT_TIP_PRESETS_BPS,
  VENUE_ORDER_MAX_LINE_QUANTITY,
  VENUE_ORDER_PARTY_SIZE_HELP,
  VENUE_ORDER_PARTY_SIZE_MAX,
  VENUE_ORDER_PARTY_SIZE_PROMPT,
  venueOrderBuyerFailure,
  venueOrderCartCount,
  venueOrderCartLineKey,
  venueOrderCartReducer,
  venueOrderCartWireLines,
  venueOrderHandover,
  venueOrderHandoverChip,
  venueOrderingCanOrder,
  venueOrderingIsCounterPickup,
  venueOrderingItemOrderable,
  venueOrderingMenuGroups,
  venueOrderingModifierFailure,
  venueOrderingModifierMessage,
  venueOrderingNotice,
  venueOrderingWindowContains,
  venueOrderInitialTip,
  venueOrderPartySizeValid,
  venueOrderProgressCopy,
  venueOrderTipIsRemembered,
  venueOrderTipPresets,
} from "./venueOrderingRules";

export type {
  VenueOrderCartAction,
  VenueOrderingLocalClock,
  VenueOrderingMenuGroupView,
  VenueOrderingNotice as VenueOrderingNoticeView,
  VenueOrderingServiceWindow,
  VenueOrderProgressCopy,
} from "./venueOrderingRules";

export {
  useVenueOrderingCart,
  type VenueOrderingCartApi,
  type VenueOrderingCartState,
} from "./useVenueOrderingCart";

export {
  parseVenueOrderSitting,
  serialiseVenueOrderSitting,
  VENUE_ORDER_SITTING_TTL_MS,
  type VenueOrderSitting,
  venueOrderNameAfterHydration,
  venueOrderShouldAskPartySize,
  venueOrderSittingKey,
  venueOrderTipAfterHydration,
} from "./venueOrderingSitting";
