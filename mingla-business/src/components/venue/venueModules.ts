/**
 * META-ORCH-1148 sub-ORCH 2.0 — venue-suite module registry + nav derivation.
 *
 * Pure, dependency-free. The single source of truth for which modules the suite
 * shows and in what order. The booking band (Tables / Availability /
 * Reservations / Waitlist) is gated SOLELY on `reservationsEnabled` — this is
 * the fails-on-revert anchor I-PROPOSED-1148-RESERVATION-TOGGLE-GATES-SUITE.
 *
 * DO NOT show booking modules unconditionally and DO NOT hide them when the
 * toggle is ON — either flips the invariant test (venueModules.test.ts T-1/T-2)
 * to FAIL.
 */

import type { VenueModule } from "../../types/venueReservation";
import {
  BUILT_FEATURES,
  builtPreset,
  featureSetFrom,
  type VenueFeatureKey,
  type VenueFeatureSet,
  type VenueTypeKey,
} from "../../types/venueFeatures";

/** #4490 — the four rail groups of the feature-driven venue workspace. */
export type VenueModuleGroup = "venue" | "offers" | "bookings" | "operations";

export interface VenueModuleMeta {
  readonly id: VenueModule;
  readonly label: string;
  /** Master-rail band header (Design §2.1). Band A = Command, Band B = Booking. */
  readonly band: "command" | "booking";
  /** #4490 — rail group in the feature-driven layout. */
  readonly group: VenueModuleGroup;
  /** One-line job description (reused by the ComingSoon interstitial). */
  readonly summary: string;
}

/** Canonical metadata, declaration-ordered. */
export const VENUE_MODULES: Readonly<Record<VenueModule, VenueModuleMeta>> = {
  overview: {
    id: "overview",
    label: "Overview",
    band: "command",
    group: "venue",
    summary: "Your venue listing, AI scores, gallery, and guest feedback.",
  },
  // #4420 (round-3 item 19) — Mingla Local reviews, their own module. Not in
  // `deriveVenueModules` (whose branches stay pinned): the shell adds it right
  // after Overview only when the page has a reviews panel to show (a verified
  // venue with a place), so the module is never an empty page.
  reviews: {
    id: "reviews",
    label: "Reviews",
    band: "command",
    group: "venue",
    summary: "Read and reply to Mingla Local reviews of this place.",
  },
  tables: {
    id: "tables",
    label: "Tables",
    band: "booking",
    group: "bookings",
    summary: "Set up your tables, zones, and party-size limits.",
  },
  availability: {
    id: "availability",
    label: "Availability",
    band: "booking",
    group: "offers",
    summary: "Set reservation hours, turn times, and blackout dates.",
  },
  reservations: {
    id: "reservations",
    label: "Reservations",
    band: "booking",
    group: "bookings",
    summary: "See and manage today's and upcoming bookings.",
  },
  waitlist: {
    id: "waitlist",
    label: "Waitlist",
    band: "booking",
    group: "bookings",
    summary: "Quote waits and seat walk-ins from a live queue.",
  },
  // ORCH-1186-C — DISPLAY-ONLY menu builder. COMMAND band (always visible,
  // independent of the reservations toggle). NOT a booking module.
  menu: {
    id: "menu",
    label: "Menu",
    band: "command",
    group: "operations",
    summary: "Build your menu — categories, items, and prices guests see online.",
  },
  // Issue #1735 — the combined Insights suite (site check + competitor watch;
  // #1737 adds the pricing instrument). COMMAND band, present in BOTH
  // derivation branches unconditionally
  // (I-PROPOSED-1735-INSIGHTS-COMMAND-BAND-ADDITIVE). Label per approved
  // decision row 15; summary verbatim design v2 §1.2b.
  insights: {
    id: "insights",
    label: "Insights",
    band: "command",
    group: "operations",
    summary: "Your site, your pricing, your competition.",
  },
  // Issue #1791 (#1767 Phase 3) — the live Orders queue. COMMAND band, present
  // in BOTH derivation branches unconditionally, exactly like `menu` and
  // `insights`: a venue can take orders without taking reservations, so gating
  // this on the reservations toggle would hide the surface that watches money
  // from the venues most likely to be using it. Ordering has its own master
  // switch (`venue_ordering_settings.ordering_enabled`, default OFF) INSIDE the
  // module — the module is always reachable, the ordering is opt-in.
  orders: {
    id: "orders",
    label: "Orders",
    band: "command",
    group: "operations",
    summary: "Live tickets from every table, room, and counter.",
  },
  // #4490 — feature-driven modules. `spaces` ships in P1; the others are
  // reserved and stay hidden until their phase ships (BUILT_FEATURES).
  offers: {
    id: "offers",
    label: "Offers",
    band: "command",
    group: "offers",
    summary: "Everything guests can buy at this venue.",
  },
  spaces: {
    id: "spaces",
    label: "Spaces",
    band: "command",
    group: "offers",
    summary: "The rooms and areas of your venue, and what each one fits.",
  },
  today: {
    id: "today",
    label: "Today",
    band: "booking",
    group: "bookings",
    summary: "Who is in, who is coming and what is waiting on you.",
  },
  calendar: {
    id: "calendar",
    label: "Calendar",
    band: "booking",
    group: "bookings",
    summary: "Every space, every day.",
  },
  requests: {
    id: "requests",
    label: "Requests",
    band: "booking",
    group: "bookings",
    summary: "Requests to answer and deposits to collect.",
  },
  guestlist: {
    id: "guestlist",
    label: "Guest list",
    band: "booking",
    group: "bookings",
    summary: "Names for the door, promoter links and entry terms.",
  },
  members: {
    id: "members",
    label: "Members",
    band: "booking",
    group: "bookings",
    summary: "Monthly members and their plans.",
  },
  checkin: {
    id: "checkin",
    label: "Check-in",
    band: "command",
    group: "operations",
    summary: "Scan passes and sell at the gate.",
  },
  // #4490 spec 08 O1 — the Till (floor design rail: first under Operations).
  // Selecting it opens the full-screen Till route; see the shells.
  till: {
    id: "till",
    label: "Till",
    band: "command",
    group: "operations",
    summary: "Sell anything you offer from one screen.",
  },
  // #4490 spec 08 O3 — Kitchen and bar (floor design rail: after the Till).
  // Selecting it opens the full-screen station route; see the shells.
  stations: {
    id: "stations",
    label: "Kitchen and bar",
    band: "command",
    group: "operations",
    summary: "Each station gets its own screen.",
  },
  // #4490 spec 08 O5 part B — Close the day (floor design rail: after Kitchen
  // and bar). Selecting it opens the full-screen close route; see the shells.
  close: {
    id: "close",
    label: "Close the day",
    band: "command",
    group: "operations",
    summary: "Count the cash and close the day.",
  },
  settings: {
    id: "settings",
    label: "Settings",
    band: "command",
    group: "operations",
    summary: "Venue type and features, terms, details and team.",
  },
};

/** The Band B booking modules in display order (between Overview and Settings). */
export const VENUE_BOOKING_MODULES: readonly VenueModule[] = [
  "tables",
  "availability",
  "reservations",
  "waitlist",
];

/**
 * Visible module list, gated on the single Reservations toggle.
 *  - OFF → `['overview', 'menu', 'settings']` (no booking band).
 *  - ON  → Overview, the four booking modules, Menu, then Settings (Settings
 *    stays last; booking modules between).
 *
 * ORCH-1186-C — `menu` is a COMMAND-band capability present in BOTH branches
 * (it is NOT gated on the reservations toggle). It sits after the booking band
 * and before Settings (a command capability after booking, before settings).
 * Settings STAYS LAST. The booking-band gating is unchanged — the menu addition
 * does not affect I-PROPOSED-1148-RESERVATION-TOGGLE-GATES-SUITE.
 *
 * Issue #1735 (I-PROPOSED-1735-INSIGHTS-COMMAND-BAND-ADDITIVE) — `insights` is
 * likewise COMMAND-band, present in BOTH branches unconditionally, ordered
 * after `menu` (the ORCH-1186-C "newest command capability after menu" rule)
 * with Settings STILL LAST. Dropping it from either branch, gating it on the
 * toggle, or ordering it after Settings flips the #1735 registry tests → FAIL.
 *
 * Issue #1791 (#1767 Phase 3) — `orders` follows the same rule: COMMAND band,
 * present in BOTH branches unconditionally, ordered after `insights` (newest
 * command capability last before Settings), Settings STILL LAST. Gating it on
 * the reservations toggle would hide the queue that watches money from a venue
 * that takes orders but not bookings.
 *
 * Pure; unit-tested (mirrors `deriveHubVisibleTabs`).
 */
/**
 * #4420 (round-3 item 19) — add the Reviews module right after Overview when
 * the page has a reviews panel. Overview must already be visible (scoped venue
 * staff never had the Overview reviews panel, so they do not get the module).
 */
export function withVenueReviewsModule(
  modules: readonly VenueModule[],
  hasReviews: boolean,
): readonly VenueModule[] {
  if (!hasReviews || modules.includes("reviews")) return modules;
  const overviewIndex = modules.indexOf("overview");
  if (overviewIndex < 0) return modules;
  return [
    ...modules.slice(0, overviewIndex + 1),
    "reviews",
    ...modules.slice(overviewIndex + 1),
  ];
}

export function deriveVenueModules(
  reservationsEnabled: boolean,
): readonly VenueModule[] {
  if (!reservationsEnabled) {
    return ["overview", "menu", "insights", "orders", "settings"];
  }
  return [
    "overview",
    ...VENUE_BOOKING_MODULES,
    "menu",
    "insights",
    "orders",
    "settings",
  ];
}

/** True for the Band-B booking modules (which render ComingSoon in 2.0). */
export function isBookingModule(module: VenueModule): boolean {
  return (VENUE_BOOKING_MODULES as readonly VenueModule[]).includes(module);
}

/**
 * #3389 — the `?module=` deep-link reader for `/venue/{venueId}`.
 *
 * The page used to accept only `insights` and `orders`, so Home to-dos that
 * link to `?module=tables` ("add zones") and `?module=menu` ("add item costs")
 * silently landed on Overview. Every id in `VENUE_MODULES` is now accepted;
 * anything else (absent, empty, unknown, wrong case) returns `undefined` so the
 * page keeps its Overview default. Selecting a HIDDEN booking module is safe:
 * the shell leaves it for Overview once the settings say reservations are off
 * (see `shouldLeaveBookingModule`).
 */
export function parseVenueModuleParam(
  value: string | null | undefined,
): VenueModule | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return Object.prototype.hasOwnProperty.call(VENUE_MODULES, value)
    ? (value as VenueModule)
    : undefined;
}

/**
 * #3389 — whether the shell must bounce a booking module back to Overview.
 *
 * Only once the reservation settings have RESOLVED. The shell's old guard ran
 * on the loading frame too, where `reservationsEnabled` reads `false` before
 * the row arrives — so a `?module=tables` link was sent to Overview even for a
 * venue whose reservations are on. A failed settings request is not resolved
 * either: it is not a confirmed OFF, and bouncing on it would lose the
 * requested module before the retry answers.
 */
export function shouldLeaveBookingModule(input: {
  activeModule: VenueModule;
  reservationsEnabled: boolean;
  settingsResolved: boolean;
}): boolean {
  return (
    isBookingModule(input.activeModule) &&
    input.settingsResolved &&
    !input.reservationsEnabled
  );
}

// ---------------------------------------------------------------------------
// #4490 — feature-driven navigation.
//
// Invariant I-4490-VENUE-FEATURES-GATE-SUITE (declared in the derivation test below):
// The venue workspace's modules are derived ONLY from `venue_features` (plus
// whether the venue has spaces). `venue_category` never appears in this file:
// a venue type is a label and a starting preset, it does not decide tabs.
// Enforced by `__tests__/venueFeatures.derivation.issue4490.implementor.test.ts`
// (every feature combination, category has no effect, the classic list is
// reproduced exactly for every backfilled venue).
//
// Two layouts, one derivation:
//  - CLASSIC: a venue that has not started using spaces (no space, Events here
//    off). It shows exactly the pre-#4490 list, order, labels and rail groups,
//    so no existing host sees a different workspace on deploy.
//  - FEATURES: once the venue has a space (or Events here is on), the Offers
//    group appears: Spaces and "Availability & pricing" (hours, special days,
//    closing a day, and Table times when table reservations are on).
// Modules whose phase has not shipped stay hidden through BUILT_FEATURES /
// BUILT_MODULES (P6 ships Members). P2 ships Offers, Today and Check-in; P4
// ships Calendar and Requests (private hire); Today and Check-in show only for a booking feature (entry, group
// packages, private hire, by the hour, events here — reconciliation 34).
// ---------------------------------------------------------------------------

/** Modules whose host surfaces have shipped (P1; P2 adds Offers, Today and Check-in). */
export const BUILT_MODULES: ReadonlySet<VenueModule> = new Set<VenueModule>([
  "overview",
  "reviews",
  "offers",
  "spaces",
  "today",
  // P4: private hire — Calendar and Requests.
  "calendar",
  "requests",
  // 07 I: private list management and promoter links.
  "guestlist",
  // P6: memberships — Members (plans live inside it).
  "members",
  "checkin",
  // 08-O1: the Till (shown only when released, switched on and allowed).
  "till",
  // 08-O3: Kitchen and bar (released, Kitchen and bar screens on, kitchen rights).
  "stations",
  // 08-O5B: Close the day (released, Sell in person on, money rights).
  "close",
  "tables",
  "availability",
  "reservations",
  "waitlist",
  "menu",
  "insights",
  "orders",
  "settings",
]);

export interface VenueNavInput {
  features: VenueFeatureSet;
  /** Active (not archived) spaces at this venue. */
  activeSpaceCount: number;
  /**
   * The host asked for spaces this session (Settings › "Add spaces") before
   * the first one exists. Lets them reach the Spaces module without a space.
   */
  spacesRequested?: boolean;
  /** Any offer that books "Request first" (P3+). */
  hasRequestOffers?: boolean;
  /**
   * #4490 N61/N62: the venue's type. A venue with no stored feature rows reads
   * as the server's legacy backfill (reservations switch, Menu on), which left
   * an event space with only Overview, Menu, Orders and Settings and bounced
   * `?module=spaces` to Overview. With no stored rows the nav follows the
   * type's preset instead (see `navFeatures`).
   */
  venueCategory?: string | null;
  /** True when the venue has never stored a feature row (every version 0). */
  noStoredFeatures?: boolean;
  /**
   * #4490 spec 08 O1: the Till's release switch (flag VENUE_TILL). The Till
   * shows only when it is released AND the venue's `till` feature is on;
   * who may sell is decided after this (`withTillAccess`).
   */
  tillReleased?: boolean;
}

/**
 * The features the nav is drawn from. Stored rows win; a venue that never
 * stored one follows its type's preset, plus the old reservations switch.
 */
export function navFeatures(input: VenueNavInput): VenueFeatureSet {
  if (input.noStoredFeatures !== true || input.venueCategory == null) return input.features;
  const preset = builtPreset(input.venueCategory as VenueTypeKey);
  if (preset.length === 0) return input.features;
  const on: Partial<Record<VenueFeatureKey, boolean>> = {};
  for (const key of preset) on[key] = true;
  if (input.features.table_reservations.enabled) {
    on.table_reservations = true;
    on.waitlist = input.features.waitlist.enabled || on.waitlist === true;
  }
  return featureSetFrom(on);
}

/** True when no feature has a stored row yet (the read is all backfill). */
export function hasNoStoredFeatures(features: VenueFeatureSet): boolean {
  return Object.values(features).every((f) => f.version === 0);
}

const BOOKING_FEATURES: readonly VenueFeatureKey[] = [
  "entry",
  "group_packages",
  "private_hire",
  "by_the_hour",
  "events_here",
];

function featureOn(features: VenueFeatureSet, key: VenueFeatureKey): boolean {
  return BUILT_FEATURES.has(key) && features[key].enabled;
}

/** True when the venue uses the feature layout (see the header above). */
export function venueUsesSpaces(rawInput: VenueNavInput): boolean {
  const input = { ...rawInput, features: navFeatures(rawInput) };
  return (
    input.activeSpaceCount > 0 ||
    input.spacesRequested === true ||
    featureOn(input.features, "events_here") ||
    // P2: a venue that sells Entry needs Offers, Today and Check-in.
    featureOn(input.features, "entry") ||
    // P3/P4: group packages and private hire are sold from Offers too.
    featureOn(input.features, "group_packages") ||
    featureOn(input.features, "private_hire") ||
    featureOn(input.features, "guest_list") ||
    // P5: by the hour sells from Offers; tables live in spaces.
    featureOn(input.features, "by_the_hour") ||
    featureOn(input.features, "floor_plan") ||
    // P6: plans are sold from Offers › Membership and members check in at the door.
    featureOn(input.features, "memberships")
  );
}

/**
 * The visible module list for a venue, in display order.
 * Classic layout = `deriveVenueModules(table_reservations)` exactly.
 */
export function deriveVenueNav(input: VenueNavInput): readonly VenueModule[] {
  const features = navFeatures(input);
  // #4490 N17/N57: Orders only when the venue takes orders (Menu or Table ordering).
  const orders = featureOn(features, "menu") || featureOn(features, "table_ordering");
  const tables = featureOn(features, "table_reservations");
  const anyBooking = BOOKING_FEATURES.some((key) => featureOn(features, key));
  // P6: members come in through the same door (Check-in) and count on Today.
  const door = anyBooking || featureOn(features, "memberships") || featureOn(features, "guest_list");
  const usesSpaces = venueUsesSpaces(input);
  // 08-O1: the Till, first under Operations (floor design rail).
  const till = input.tillReleased === true && featureOn(features, "till");
  // 08-O3: Kitchen and bar, right after the Till (same release switch).
  const stations = input.tillReleased === true && featureOn(features, "kitchen_screens");
  // 08-O5B: Close the day, right after Kitchen and bar (same release switch as the Till).
  const close = till;

  const candidates: Array<[VenueModule, boolean]> = usesSpaces
    ? [
        ["overview", true],
        ["offers", BUILT_MODULES.has("offers")],
        ["spaces", true],
        ["availability", true],
        ["today", door],
        ["calendar", anyBooking],
        [
          "requests",
          featureOn(features, "private_hire") || input.hasRequestOffers === true,
        ],
        ["guestlist", featureOn(features, "guest_list")],
        // P5 (reconciliation 35): tables live under Spaces › Tables, so the
        // Tables module leaves this layout; `?module=tables` is an alias that
        // opens Spaces on its Tables view (see `resolveTablesAlias`).
        ["reservations", tables],
        ["waitlist", featureOn(features, "waitlist")],
        ["members", featureOn(features, "memberships")],
        ["till", till],
        ["stations", stations],
        ["close", close],
        ["checkin", door],
        ["menu", featureOn(features, "menu")],
        ["insights", true],
        ["orders", orders],
        ["settings", true],
      ]
    : [
        ["overview", true],
        ["tables", tables],
        ["availability", tables],
        ["reservations", tables],
        ["waitlist", featureOn(features, "waitlist")],
        ["till", till],
        ["stations", stations],
        ["close", close],
        ["menu", featureOn(features, "menu")],
        ["insights", true],
        ["orders", orders],
        ["settings", true],
      ];
  return candidates
    .filter(([module, visible]) => visible && BUILT_MODULES.has(module))
    .map(([module]) => module);
}

/** Label for a module given the list it sits in (the classic list keeps "Availability"). */
export function venueModuleLabel(
  module: VenueModule,
  modules: readonly VenueModule[],
): string {
  if (module === "availability" && modules.includes("spaces")) {
    return "Availability & pricing";
  }
  return VENUE_MODULES[module].label;
}

/** Rail group for a module given the list it sits in. */
export function venueModuleGroupLabel(
  module: VenueModule,
  modules: readonly VenueModule[],
): "Venue" | "Offers" | "Bookings" | "Operations" {
  const meta = VENUE_MODULES[module];
  if (module === "availability") {
    return modules.includes("spaces") ? "Offers" : "Bookings";
  }
  switch (meta.group) {
    case "venue":
      return "Venue";
    case "offers":
      return "Offers";
    case "bookings":
      return "Bookings";
    default:
      return "Operations";
  }
}

/**
 * #4490 — replaces `shouldLeaveBookingModule` for the feature nav: leave a
 * module that is no longer visible, but only once features have RESOLVED (the
 * #3389 rule: never bounce on the loading frame or on a failed read).
 */
export function shouldLeaveHiddenModule(input: {
  activeModule: VenueModule;
  visible: readonly VenueModule[];
  featuresResolved: boolean;
}): boolean {
  if (!input.featuresResolved) return false;
  if (input.activeModule === "overview" || input.activeModule === "reviews") {
    return false;
  }
  return !input.visible.includes(input.activeModule);
}

/**
 * #4490 — `&item=<id>` deep-link reader (opens a space, offer or booking on
 * arrival). Accepts a uuid only; anything else is ignored.
 */
export function parseVenueItemParam(
  value: string | string[] | null | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed.toLowerCase()
    : undefined;
}

/**
 * #4490 P5 (reconciliation 35) — `?module=tables` once tables live in spaces.
 * In the feature layout it opens Spaces › Tables; in the classic layout (a
 * venue with no space yet) the old Tables module still answers.
 */
export function resolveTablesAlias(input: {
  activeModule: VenueModule;
  usesSpaces: boolean;
  visible: readonly VenueModule[];
}): { module: VenueModule; spacesView: "tables" | null } | null {
  if (input.activeModule !== "tables" || !input.usesSpaces) return null;
  if (!input.visible.includes("spaces")) return null;
  return { module: "spaces", spacesView: "tables" };
}

/**
 * #4490 spec 08 O1 — how staff take an order at this venue: THE one switch
 * between the legacy order pad and the Till (spec 08 §11.4 item 7 / §12 item
 * 15: one store build plus its update; the Till stays off for a venue until
 * its devices update).
 *  - "pad": the Till is not running here (not released, or the venue's `till`
 *    feature is off). The order pad and the open-tabs card work exactly as
 *    before.
 *  - "till": the Till runs here and this person may sell. The pad and the tabs
 *    card are gone; their entry points (New order, open tabs) open the Till.
 *  - "none": the Till runs here but this person may not sell (no pad either).
 * [TRANSITIONAL] the "pad" branch keeps the #1792 order pad and tabs card for
 * venues whose devices predate the Till; exits when every venue runs the Till
 * (no venue with the `till` feature off takes staff orders), then the pad,
 * the tabs card and useVenueOrderTabs are deleted.
 */
export type VenueOrderEntry = "pad" | "till" | "none";

export function venueOrderEntry(input: {
  tillReleased: boolean;
  tillFeatureOn: boolean;
  canSell: boolean;
}): VenueOrderEntry {
  if (!input.tillReleased || !input.tillFeatureOn) return "pad";
  return input.canSell ? "till" : "none";
}
