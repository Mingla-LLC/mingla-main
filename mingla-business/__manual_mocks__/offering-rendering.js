// Manual jest mock for @mingla/offering-rendering — #1062 [biz-jest-residual-burndown]
// Wave 1 / B3a.
//
// WHY: the real barrel `packages/offering-rendering/index.ts` eagerly re-exports
// ~30 react-native / expo-native component `.tsx` files (ParallaxCoverShell,
// EventCoverMedia, QuantityRow, RsvpMomentumDecision, …). Under the default
// node/ts-jest config those cannot load — `react/jsx-runtime` is unresolvable
// from `packages/` (no react there; mingla-business owns react) and react-native's
// entry is Flow ESM. So ANY node-env service/util test that transitively imports
// the barrel (publicEventsService, publicExperienceService, mapboxStaticImage, …)
// dies at module-load before a single assertion runs.
//
// NON-FAKING: those node tests only consume the barrel's PURE, RN-free helpers.
// This mock re-exports the REAL helper submodules verbatim (`isThemeColor`,
// `buildStaticMapUrl`, `getPublicMapboxToken`, … run their real implementations —
// zero behavior faked) and stubs ONLY the visual components, which no node-env
// test renders. If a suite genuinely needs a component's behavior it runs under a
// dedicated jest.<orch>.render.cjs render config, never here.
//
// Activated ONLY via an explicit moduleNameMapper entry in jest.config.cjs.

const PKG = "../../packages/offering-rendering/";
// The real, RN-free logic submodules (each verified free of react-native imports;
// mapbox* reach expo-constants only, which the config maps to a lightweight mock).
const real = (name) => require(PKG + name);

// Inert passthrough for the RN visual components — never rendered under node.
const Stub = () => null;
Stub.displayName = "OfferingRenderingStub";

module.exports = {
  __esModule: true,

  // ---- REAL pure logic (verbatim re-export — no faking) --------------------
  ...real("themeResolver"), // isThemeColor / isThemeAnimationSlug / isThemeFontSlug / resolveTheme
  ...real("themePalette"),
  ...real("mapboxStaticImage"), // buildStaticMapUrl / getSupabaseFunctionsBaseUrl
  ...real("mapboxToken"), // getPublicMapboxToken
  ...real("normalizeCityCountry"),
  ...real("experienceOpenDaily"),
  ...real("experienceAvailabilityBanner"),
  ...real("experienceOfferingTypes"),
  ...real("formatTripDateRange"),
  ...real("tripDuration"),
  ...real("tripBoxTotals"),
  ...real("tripCountdown"),
  ...real("tripOfferingTypes"),
  ...real("eventBoxTotals"),
  ...real("offeringCta"),
  ...real("quantityRowFormat"),
  ...real("rsvpMomentum"),
  ...real("socialProofMomentum"),
  ...real("socialProofTypes"),
  ...real("taxonomyLabels"),
  ...real("galleryLayout"),
  ...real("closeButtonVisibility"),
  ...real("coverMediaPresentation"),

  // ---- Stubbed RN visual components (never rendered under node/ts-jest) -----
  ParallaxCoverShell: Stub,
  OfferingChrome: Stub,
  OfferingMomentum: Stub,
  CountAwareGallery: Stub,
  ChipGroup: Stub,
  DayByDay: Stub,
  GlassBlur: Stub,
  GuestAvatarCluster: Stub,
  StopSpine: Stub,
  ThemeEntranceAnimation: Stub,
  PublicEventNotFound: Stub,
  PublicEventPage: Stub,
  EventCover: Stub,
  EventCoverMedia: Stub,
  EventOfferingBody: Stub,
  EventOfferingFloatingBar: Stub,
  EventTicketBox: Stub,
  ExperienceOfferingBody: Stub,
  QuantityRow: Stub,
  RefundPolicyDisplay: Stub,
  RsvpChipInPanel: Stub,
  RsvpDetailsModal: Stub,
  RsvpGoingConfirmDialog: Stub,
  RsvpMomentumDecision: Stub,
  RsvpOfferingBody: Stub,
  RsvpSuccessPopup: Stub,
  TripCountdownPill: Stub,
  TripOfferingBody: Stub,
  TripPaymentChoice: Stub,
  TripOfferingPaymentChoice: Stub,
  TripRefundLadder: Stub,
  TripReserveBar: Stub,
};
