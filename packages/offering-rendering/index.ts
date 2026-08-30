// @mingla/offering-rendering — ORCH-1138 A2.
//
// Pure-presentational Direction-A layout primitives shared by the public
// trip/event/experience/brand offering pages. Props-only; NO app src/ imports
// (I-MOR-0827-PACKAGE-ISOLATION). Renders on react-native-web AND native RN.
//
// Built first for the trip page (Leg 1); event/experience/brand snap onto these
// same primitives in later legs (the page-specific booking/ticket/summary panel
// is passed in as `stickyPanel` / children).

export { DirectionCIdentityOverlay, ParallaxCoverShell } from "./ParallaxCoverShell";
export type { ParallaxCoverShellProps } from "./ParallaxCoverShell";

// issue #868 [cover-gallery] — the beneath-cover ordered card row over the full
// [cover] ++ gallery hero sequence (card 0 = cover). Injected by ParallaxCoverShell.
export { CoverGalleryRow } from "./CoverGalleryRow";
export type { CoverGalleryRowProps } from "./CoverGalleryRow";

// issue #868 [cover-gallery] — Section M.1a: the pinned pager over [cover] ++
// gallery for the consumer detail screens (which don't mount ParallaxCoverShell).
// Page 0 = the screen's existing <EventCoverMedia>, passed in as coverNode.
export { CoverGalleryPager } from "./CoverGalleryPager";
export type { CoverGalleryPagerProps } from "./CoverGalleryPager";

export {
  buildHeroMediaAccessibleLabel,
  HeroMediaChangeAnnouncer,
  normalizeHeroMediaText,
} from "./heroMediaAccessibility";
export type {
  HeroMediaAccessibleLabelInput,
  HeroMediaChangeAnnouncerProps,
} from "./heroMediaAccessibility";

export { OfferingChrome } from "./OfferingChrome";
export type { OfferingChromeProps } from "./OfferingChrome";

// ORCH-1159 — RN-free close-button visibility predicate (single owner).
export { shouldRenderCloseButton } from "./closeButtonVisibility";
export type { PlatformOSValue } from "./closeButtonVisibility";

export { CountAwareGallery } from "./CountAwareGallery";
export type {
  CountAwareGalleryProps,
  CountAwareGalleryItem,
} from "./CountAwareGallery";
export { pickGalleryLayout } from "./galleryLayout";
export type { GalleryLayout } from "./galleryLayout";

export { ChipGroup } from "./ChipGroup";
export type { Chip, ChipGroupProps } from "./ChipGroup";

// ORCH-1167 [event-page-canonical] — THE ONE shared, shell-agnostic body for the
// standard ticketed-event public page (event_type='event'). Rendered byte-
// identically on buyer-web + business iOS/Android + consumer iOS/Android. Hosts NO
// scroll root (each surface injects its scroll + parallax-cover scaffold around it).
// Carries the inline on-page ticket box (per-tier steppers + live Σ-all-in running
// total (WYSIWYP) + in-box Proceed) and the surface-pinned floating Get-tickets bar.
// ORCH-1167-R2 — EventTicketBox is the extracted inline box, rendered inline on
// phone/native and inside the desktop sticky panel (change 5; one owner).
export {
  EventOfferingBody,
  EventAcquisitionNotice,
  EventOfferingFloatingBar,
  EventTicketBox,
  computeRunningTotal,
  totalSelectedQuantity,
} from "./EventOfferingBody";
export type {
  EventOfferingBodyProps,
  EventOfferingFloatingBarProps,
  EventTicketBoxProps,
} from "./EventOfferingBody";

// ORCH-1157 [rsvp-public-redesign] — the shared Direction-C "Momentum" RSVP hero
// (going-count + capacity meter + faceless anonymous cluster + Going/Maybe/Can't
// decision). Consumed by the business RsvpPublicBody (buyer-web + business +
// preview) AND the consumer ConsumerEventDetailScreen RSVP branch — one unit,
// every surface. RSVP is ticketless: NO price/checkout/cart affordance here.
export { RsvpMomentumDecision } from "./RsvpMomentumDecision";
export type {
  RsvpMomentumDecisionProps,
  RsvpMomentumVariant,
  RsvpGuestStatus,
  RsvpGuestApproval,
} from "./RsvpMomentumDecision";
export {
  deriveMomentum,
  partyTypeLabel,
  RSVP_CLUSTER_SHOWN,
} from "./rsvpMomentum";
export type { RsvpMomentumModel } from "./rsvpMomentum";

// ORCH-1338 [guest-read-backend] — THE ONE shared social-proof payload contract
// (types + the sample-size constant; dep-free, no fetch — I-MOR-0827). Shapes are
// camelCase-identical to the pg_public_social_proof / peer_list_event_guests RPC
// payloads; consumed as PROPS by ORCH-1339 (card), 1340 (avatars), 1341 (sheet).
export { SOCIAL_PROOF_SAMPLE_MAX } from "./socialProofTypes";
export type {
  SocialProofEntityType,
  SocialProofSampleEntry,
  SocialProofSummary,
  PeerGuestRow,
  PeerGuestListPage,
} from "./socialProofTypes";

// ORCH-1339 [momentum-card-cross-entity] — the shared glyph-only cross-entity
// momentum unit (event/trip/experience) + its dep-free honest derivation.
// Props-only (the surfaces fetch pg_public_social_proof and pass the payload);
// gates are SERVER-authoritative (D2); cluster is GLYPH-only until ORCH-1340.
export { OfferingMomentum } from "./OfferingMomentum";
export type { OfferingMomentumProps } from "./OfferingMomentum";
export { deriveSocialProofMomentum } from "./socialProofMomentum";
export type { SocialProofMomentumModel } from "./socialProofMomentum";

// ORCH-1340 [card-real-avatars] — THE ONE disk system (photo|glyph|+N|see-row)
// rendered by BOTH momentum cards. Photos come ONLY from the server-filtered
// avatar sample (the payload IS the privacy boundary — no name can reach it);
// the glyph disk is the honest loading/fallback/anonymous state
// (I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED).
export { GuestAvatarCluster } from "./GuestAvatarCluster";
export type { GuestAvatarClusterProps } from "./GuestAvatarCluster";

// ORCH-1292 [public-page-tag-slug-labels] — the in-package canonical taxonomy
// label resolver. Turns party/vibe/music SLUGS into their display LABELS at the
// shared pill/chip render sites (EventOfferingBody / RsvpOfferingBody /
// RsvpMomentumDecision). Self-contained (I-MOR-0827); kept in set-equality +
// label-parity with supabase/functions/_shared/eventTaxonomy.ts by the
// orch-1292-taxonomy-label-parity.mjs drift gate.
export { taxonomyLabel, TAXONOMY_LABELS } from "./taxonomyLabels";

// ORCH-1163 [rsvp-shared-body] — THE ONE shared, shell-agnostic body for the public
// RSVP page (event_type='rsvp'). Rendered byte-identically on buyer-web + business
// iOS/Android + consumer iOS/Android. Hosts NO scroll root / cover host (each surface
// injects its scaffold). The surface lifts the decision state via useRsvpOfferingState
// and passes it to BOTH <RsvpOfferingBody> (inline box §0-5) and
// <RsvpOfferingDecisionDock> (pinned floating dock §0-9). FLOW A (Going-confirm dialog
// + success popup) + FLOW B (per-guest plus-one contacts) are owned here. RSVP is
// ticketless: NO price/checkout/cart affordance.
// ORCH-1163-R2 [floating-parity] — the inline box is now the single-owner
// <RsvpDecisionBox> (parallel to EventTicketBox; rendered inline on phone AND in the
// desktop sticky panel) and the floating control is the separate
// <RsvpOfferingFloatingBar> (parallel to EventOfferingFloatingBar; the surface pins
// it absolute-bottom with zIndex:6 as a ParallaxCoverShell sibling). Both read ONE
// lifted useRsvpOfferingState. RsvpOfferingDecisionDock stays as a back-compat alias
// of the floating bar.
export {
  RsvpOfferingBody,
  RsvpDecisionBox,
  RsvpOfferingFloatingBar,
  RsvpOfferingDecisionDock,
  useRsvpOfferingState,
  rsvpErrorMessageForCode,
} from "./RsvpOfferingBody";
export type {
  RsvpOfferingBodyProps,
  RsvpOfferingConfig,
  RsvpOfferingState,
  RsvpDecisionBoxProps,
  RsvpOfferingFloatingBarProps,
  RsvpOfferingDecisionDockProps,
  RsvpGuestContact,
  RsvpSubmitResult,
  ChipInResult,
  // ORCH-1295 [chip-in-post-payment-polish] — BUG 2 host-supplied phone field.
  RsvpPhoneFieldRenderArgs,
  RsvpPhoneFieldRenderer,
} from "./RsvpOfferingBody";
export type { RsvpGoingConfirmDialogProps } from "./RsvpGoingConfirmDialog";
// ORCH-1163-R3 — the floating-bar "Add your details" modal (self-sufficient
// contact + +1 forms; one decision owner, two entry points).
export type { RsvpDetailsModalProps } from "./RsvpDetailsModal";
export type {
  RsvpSuccessPopupProps,
  RsvpConfirmationDetails,
  RsvpPassCredential,
  RsvpAnonymousRecovery,
} from "./RsvpSuccessPopup";
// ORCH-1291 [rsvp-chip-in] — the shared voluntary-gift panel + the payment
// hand-off type (surfaces provide onChipIn; the body mounts the panel).
export type { RsvpChipInPanelProps, ChipInPanelState } from "./RsvpChipInPanel";

// ORCH-1138 [trip-page-redesign] — shared "City, Country" route-leg normalizer
// (departure/destination) used identically by the business/web TripPreview and
// the consumer ConsumerTripDetailScreen so the leaving-from/destination block
// stays standardized + balanced on one aligned row across every surface.
export { normalizeCityCountry } from "./normalizeCityCountry";
export type { StructuredPlaceParts } from "./normalizeCityCountry";

// META-ORCH-1174 Leg A.4 [trip-page polish · lucide pills] — the shared lucide-icon
// module (Calendar/Plane/Moon/Users/Globe/MapPin/Minus/Plus/BadgeCheck), drawn as
// react-native-svg paths (NO lucide dep — I-MOR-0827 isolation). Replaces the emoji
// / geometric-glyph pill+row icons across the three shared offering bodies. Each is a
// pure `{ size, color, strokeWidth? }` component on a 24×24 lucide-standard frame.
export {
  Calendar,
  Plane,
  Moon,
  Users,
  Globe,
  MapPin,
  Minus,
  Plus,
  BadgeCheck,
  // ORCH-1183 — Clock (start-time chip) + Sparkles (vibe chips) for the shared
  // ExperienceOfferingBody.
  Clock,
  Sparkles,
  // issue #2508 [maps-app-chooser] — the copy-address control and its confirm.
  Copy,
  Check,
} from "./LucideIcons";
export type { LucideIconProps } from "./LucideIcons";

// ===========================================================================
// ORCH-1183 [experience-standardize] — THE ONE shared, shell-agnostic body for the
// public EXPERIENCE page (event_type='experience'). Rendered byte-identically on
// buyer-web + business iOS/Android + consumer iOS/Android. Promotes the web/business
// FoundationExperiencePreview + the consumer hand-mirrored body into ONE component.
// Hosts NO scroll root / cover host (each surface injects its scaffold). Experiences
// carry ONE combined all-in price (NO installments/deposits/per-stop prices) and a
// STOP/place-based itinerary via the shared <StopSpine>. The reserve bar is the
// shared <TripReserveBar> (single all-in price, no split). One vibe-label map.
// ===========================================================================
export {
  ExperienceOfferingBody,
  EXPERIENCE_VIBE_LABELS,
  experienceVibeLabels,
  experiencePriceLabel,
  experienceAvailabilityBanner,
} from "./ExperienceOfferingBody";
export type { ExperienceOfferingBodyProps, RightNowFacts } from "./ExperienceOfferingBody";
export { StopSpine, stopLabelForIndex } from "./StopSpine";
export type { StopSpineProps } from "./StopSpine";
export type {
  ExperienceOfferingData,
  ExperienceOfferingBrand,
  ExperienceOfferingStop,
  ExperienceOfferingTicket,
  ExperienceOfferingOccurrence,
  ExperienceOfferingCallbacks,
} from "./experienceOfferingTypes";

// ===========================================================================
// META-ORCH-1174 Leg A [trip-page-standardize] — THE ONE shared, shell-agnostic
// body for the public TRIP page (event_type='trip'). Rendered byte-identically on
// buyer-web + business iOS/Android + consumer iOS/Android. Hosts NO scroll root /
// cover host (each surface injects its scaffold). The surface lifts buy-state via
// useTripOfferingState and passes it to BOTH <TripOfferingBody>'s inline §10 box
// AND the pinned <TripReserveBar> (floating/docked) — one owner, never diverge.
// Promotes the forked reserve bar, refund ladder, day-by-day, payment choice into
// shared pure components; adds the NEW reduce-motion-aware <TripCountdownPill>.
// ===========================================================================
export { TripOfferingBody } from "./TripOfferingBody";
export type { TripOfferingBodyProps } from "./TripOfferingBody";
export {
  useTripOfferingState,
  projectTripSchedule,
  selectSellableTier,
  tripTierPriceLabel,
} from "./useTripOfferingState";
export type {
  UseTripOfferingStateInput,
  TripOfferingState,
  TripPaymentPlanChoice,
} from "./useTripOfferingState";
// META-ORCH-1174 Leg B3 — the RN-free §10 multi-package selection + money math
// (per-tier qty clamp, selected lines, summed all-in / due-today). Single owner.
export {
  clampTripTierQuantity,
  tripTierEffectiveMax,
  tripTierUnitAllInCents,
  tripMinTierAllInCents,
  tripSelectedLines,
  tripTotalSelectedQuantity,
  tripSummedAllInCents,
  tripSummedDueTodayCents,
  tripAnyLineOnPlan,
  // ORCH-1181 — per-package deposit-due-today + the shared installment sub-line
  // copy for the checkout/cart ticket tile (business + web + consumer identical).
  tripTierDepositTodayCents,
  formatTripTierInstallmentNote,
} from "./tripBoxTotals";
export type {
  TripTierLike,
  TripSelectedLine,
} from "./tripBoxTotals";
export { TripReserveBar } from "./TripReserveBar";
export type { TripReserveBarProps } from "./TripReserveBar";
export { TripPaymentChoice as TripOfferingPaymentChoice } from "./TripPaymentChoice";
export type { TripPaymentChoiceProps as TripOfferingPaymentChoiceProps } from "./TripPaymentChoice";
export { TripRefundLadder } from "./TripRefundLadder";
export type { TripRefundLadderProps } from "./TripRefundLadder";
export { DayByDay } from "./DayByDay";
export type { DayByDayProps } from "./DayByDay";
export { TripCountdownPill } from "./TripCountdownPill";
export type { TripCountdownPillProps } from "./TripCountdownPill";
export {
  countdownTickMs,
  formatCountdown,
  formatDeadlineCoarse,
} from "./tripCountdown";
export type {
  TripOfferingData,
  TripOfferingBrand,
  TripOfferingTier,
  TripOfferingDay,
  TripOfferingInclusion,
  TripOfferingCallbacks,
  TripReserveLine,
  TripInstallmentTemplate,
  TripRefundPolicyShape,
  TripRefundTier,
  ProjectedTripSchedule,
  ReserveSplitButton,
  ReserveSplitCtas,
} from "./tripOfferingTypes";

export {
  useResponsiveLayout,
  DESKTOP_BREAKPOINT,
} from "./useResponsiveLayout";
export type { ResponsiveLayout } from "./useResponsiveLayout";

// ===========================================================================
// ORCH-1169 [one-rendering-package] — the former @mingla/event-rendering package
// was DISSOLVED into this one package (Seth's decision: ONE rendering package).
// Every symbol that the old event-rendering barrel exported is re-exported below,
// now from LOCAL modules. The shared theming engine, CTA state machine, EventCover/
// EventCoverMedia, types, QuantityRow, RefundPolicyDisplay, mapbox builders, and
// the legacy PublicEventPage all live here. No behavior change — pure refactor.
// ===========================================================================

export { PublicEventPage } from "./PublicEventPage";
// ORCH-1138 A1/A2 — the shared theming engine, extracted out of PublicEventPage
// so trip/experience/brand pages derive accent/surface/text from ONE algorithm.
// (The surface theming helpers offeringSurfaceStyles/resolveOfferingSurface/
// OfferingSurfaceStyles are now LOCAL — no longer a cross-package re-export.)
export {
  createThemePalette,
  resolveOfferingSurface,
  offeringSurfaceStyles,
  // ORCH-1138 Leg-1 (native-parity fix #2) — weight-aware theme font family.
  // A loaded custom font ignores fontWeight on native; bold text must point
  // fontFamily at the 700-weight loaded family. boldFontFamily(theme) returns it.
  FONT_FAMILY_BOLD_MAP,
  boldFontFamily,
  // #2539 — `hexToRgba` is deliberately NOT re-exported here. 18 test files
  // hand-build a PARTIAL mock of this barrel, so every NEW name added to it is
  // `undefined` inside those suites and blows up at render in whatever
  // component imports it. PublicBrandPage.tsx deep-imports it from
  // "./themePalette" instead, which no barrel mock can intercept.
} from "./themePalette";
export type { ThemePalette, OfferingSurfaceStyles } from "./themePalette";
export { PublicEventNotFound } from "./PublicEventNotFound";
export { EventCoverMedia } from "./EventCoverMedia";
export { ThemeEntranceAnimation } from "./ThemeEntranceAnimation";
export {
  computeForeground,
  isThemeAnimationSlug,
  isThemeColor,
  isThemeFontSlug,
  resolveTheme,
} from "./themeResolver";
export {
  FONT_FAMILY_MAP,
  MINGLA_DEFAULT_THEME,
  THEME_ANIMATION_SLUGS,
  THEME_FONT_SLUGS,
} from "./designTokens";
export type {
  EventCoverMediaErrorEvent,
  EventCoverMediaProps,
} from "./EventCoverMedia";
// ORCH-1167-R7 — the R6 `driveMutedAutoplay` play()-hammer driver was REMOVED:
// proven (Playwright vs. live WebKit) to be the BUG, not the fix. Manually
// calling play() (esp. at readyState 0) poisons WebKit's one-time inline-autoplay
// eligibility for the element (NotAllowedError, permanently denied), which is why
// the cover stayed paused under Safari's native play button. The cover now drives
// its muted ambient autoplay via the native `autoplay`/`muted`/`playsinline`
// ATTRIBUTES only (the proven-working bare-element pattern), inside
// EventCoverWebVideo. The driver module + its export are gone.
// ORCH-0847 Phase A2 — shared ticket-tier quantity stepper used by
// mingla-business public cart screen AND consumer-app TicketCartSheet.
export { QuantityRow } from "./QuantityRow";
export type {
  QuantityRowProps,
  QuantityRowTicket,
  QuantityRowTheme,
} from "./QuantityRow";
// ORCH-0964 — shared cover media (image + GIF + video, web + native) used by
// mingla-business cards/public pages, app-mobile, AND the shared brand page.
export { EventCover } from "./EventCover";
export type { EventCoverProps } from "./EventCover";
export { resolveEventCoverMediaPresentation } from "./coverMediaPresentation";
export { shouldFreezeCoverForReduceMotion } from "./coverMediaPresentation";
// ORCH-1016 — shared trip date-range formatter (consumer TripCard/detail +
// business TripPreview/public page format trip dates identically).
export { formatTripDateRange } from "./formatTripDateRange";
export type { FormatTripDateRangeOptions } from "./formatTripDateRange";
// META-ORCH-1174 Leg A.3 — the Hermes-safe trip timestamp normalizer + the shared
// "N days · M nights" deriver. Both per-surface adapters import deriveTripDuration
// so the §3 dates pill + §4 days&nights pill compute identically on NATIVE too
// (the RPC's space-separated timestamps broke the prior new Date(...) on Hermes).
export {
  normalizeTimestampIso,
  parseTripTimestampMs,
  deriveTripDuration,
} from "./tripDuration";
// ORCH-1016 — shared refund ladder (consumer trip detail + business public/
// preview render the identical ladder; business side is a re-export shim).
export { RefundPolicyDisplay } from "./RefundPolicyDisplay";
export type {
  RefundPolicyDisplayProps,
  RefundPolicyShape,
  RefundPolicyTier,
} from "./RefundPolicyDisplay";
// ORCH-0964 — BlurView wrapper that skips backdrop-filter on mobile web (where
// stacked blur hard-crashes the renderer). Used by public brand + event pages.
export { GlassBlur } from "./GlassBlur";
export {
  eventAcquisitionNoticeCopy,
  forwardableAcquisitionState,
  nextEventAcquisitionBoundaryDelayMs,
  resolveEventTerminal,
  resolveEventAcquisitionState,
} from "./eventAcquisitionLifecycle";
export type {
  EventAcquisitionInput,
  EventAcquisitionNoticeCopy,
  EventAcquisitionOperatorStatus,
  EventAcquisitionState,
  EventTerminalResolution,
  EventTerminalSource,
} from "./eventAcquisitionLifecycle";
// ORCH-1162 Bug 2 — the SINGLE shared static-Mapbox URL builder. The trip,
// event, and experience public pages all draw their "Where you'll be" map from
// this one primitive (mingla-business + app-mobile re-export it, never re-fork).
// I-PROPOSED-1162-MAP-PRIMITIVE-SINGLE-OWNER.
// ORCH-1165: the static map is now server-proxied (vendor-neutral static-map edge fn);
// buildStaticMapUrl composes a token-less proxy URL via the Supabase functions
// base. getPublicMapboxToken stays exported (sourced from ./mapboxToken) for
// backward-compat with existing import paths — it is no longer used by the static
// map itself.
export { buildStaticMapUrl, getSupabaseFunctionsBaseUrl } from "./mapboxStaticImage";
export { getPublicMapboxToken } from "./mapboxToken";
export type { StaticMapParams } from "./mapboxStaticImage";
// issue #2468 — THE ONE "open in maps" deep-link builder. Sibling of the static
// map builder above ON PURPOSE: the thumbnail and the link now read the SAME
// stored coordinate, so they can no longer point at two different places.
export {
  buildMapsDeepLink,
  buildMapsUrl,
  canOpenMapsTarget,
  normalizeMapsGeo,
  selectVenueMapsTarget,
  // issue #2508 — the same owner, now also per-app, so the chooser never
  // composes a URL of its own.
  buildMapsAppLink,
  listMapsAppChoices,
  selectAddressCopyText,
  MAPS_APP_LABELS,
} from "./mapsDeepLink";
export type {
  BuildMapsUrlParams,
  MapsDeepLink,
  MapsGeoPoint,
  MapsOpenTarget,
  MapsPlatform,
  VenueMapsTargetParams,
  BuildMapsAppLinkParams,
  MapsAppChoice,
  MapsAppId,
} from "./mapsDeepLink";
// issue #2508 [maps-app-chooser] — the shared "which map app?" chooser and the
// copy-address button. ONE implementation for every public offering surface, so
// the explorer, the buyer web and the business app cannot drift.
export {
  useVenueMapsActions,
  VenueCopyAddressButton,
  MapsAppChooserDialog,
} from "./VenueMapsActions";
export type {
  UseVenueMapsActionsParams,
  VenueMapsActionsState,
  VenueCopyAddressButtonProps,
  MapsAppChooserDialogProps,
  VenueCopyState,
} from "./VenueMapsActions";
// issue #2469 — the ONE owner of the venueName/address split. Beside the maps
// builder because the label it produces is what goes on the pin.
export { extractPublicEventLocation } from "./publicEventLocation";
export type { PublicEventLocationParts } from "./publicEventLocation";
// ORCH-1117 — the single buy/unavailable state machine consumed by BOTH the
// inline ticket row AND the per-host floating Buy bar (no forked gate logic).
export {
  resolveOfferingCta,
  computeOfferingVariant,
  ticketSaleEnded,
  ticketIsSoldOut,
  ticketIsDoorOnly,
  // ORCH-1150 — RSVP Going/Not-going CTA machine (money-free).
  resolveRsvpCta,
} from "./offeringCta";
export type {
  CtaState,
  OfferingVariant,
  ResolveOfferingCtaInput,
  // ORCH-1150
  RsvpCtaState,
  RsvpCtaDescriptor,
  ResolveRsvpCtaInput,
} from "./offeringCta";
// ORCH-1153 WS2 — the canonical rule-based open-daily detector (one owner, all
// surfaces). Replaces the consumer occurrence-density heuristic.
export { isOpenDailyExperience } from "./experienceOpenDaily";
export type {
  IsOpenDailyExperienceInput,
  OpenDailyRecurrenceRule,
} from "./experienceOpenDaily";
// ORCH-1186 Fix 1 — the canonical adaptive availability-banner computation (pure,
// dep-free; the shared body wraps it). Exported for the deno unit test.
export { experienceAvailabilityBanner as computeExperienceAvailabilityBanner } from "./experienceAvailabilityBanner";
export type {
  AvailabilityBanner,
  AvailabilityBannerInput,
  AvailabilityOccurrence,
} from "./experienceAvailabilityBanner";
export type {
  PublicEventProps,
  PublicBrandProps,
  PublicTicketProps,
  ViewerRole,
  PublicEventCallbacks,
  PublicEventPageProps,
  PublicEventNotFoundProps,
  EventCoverMediaType,
  EventFormat,
  EventStatus,
  TicketVisibility,
  TicketAvailableAt,
  // issue #868 [cover-gallery] — ADDITIONAL image/GIF cover-gallery item type.
  OfferingGalleryImage,
} from "./types";
export type {
  ResolvedTheme,
  ThemeAnimationSlug,
  ThemeFontSlug,
  ThemeInput,
} from "./designTokens";
