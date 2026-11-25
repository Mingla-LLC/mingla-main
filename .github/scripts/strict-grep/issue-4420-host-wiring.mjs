#!/usr/bin/env node
// MINGLA-INVARIANT: I-4420-HOST-WIRING | issue #4420 | The Graphite Glass redesign's structural wiring (which screen mounts which shared piece, which gate shows a pane, which strings the shared pickers carry) stays in place.
// MINGLA-INVARIANT: I-4420-NO-RAW-ALERT | issue #4420 | Host app code raises alerts through showAlert (web shows a Toast or ConfirmDialog); a raw Alert.alert, a silent no-op on react-native-web, appears only in showAlert itself and in the allowlisted native-only files, at no more than their counted calls.
/**
 * issue #4420 — Graphite Glass: structural wiring rules.
 * Invariant: I-4420-HOST-WIRING.
 *
 * WHY. The #4420 screen waves shipped jest files whose assertions were source
 * text (readFileSync + expect on the text). I-PROPOSED-1047-NO-SOLE-SOURCE-PIN
 * forbids new jest source pins and names the replacement for a genuine
 * structural rule: an additive strict-grep gate. Behaviour (pure helpers,
 * rendered components) stays in jest; the rules below are the structural
 * half, kept here so they still run on every PR.
 *
 * RULE. Every entry in RULES names one file (relative to mingla-business/),
 * optionally a slice of it (from the first `from` marker to the next `to`
 * marker after it), and either `has` (must contain / match) or `lacks` (must
 * not). A missing file or a missing slice marker FAILS, so a rename cannot
 * make a rule go dark.
 *
 * DOES NOT CATCH, stated rather than implied: behaviour. A rule proves the
 * wiring text is present, not that it runs; the behavioural jest suites named
 * in each rule's `why` own that.
 *
 * `--self-test` drives the pure checker with fixtures: a present string and a
 * matching regex pass, an absent one and a forbidden one fail, a missing file
 * and a missing slice marker fail.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BUSINESS = path.join(ROOT, "mingla-business");

/** @typedef {{ file: string, why: string, from?: string, to?: string, has?: Array<string|RegExp>, lacks?: Array<string|RegExp> }} Rule */

/** @type {Rule[]} */
// Support switch's Ari mark (#4420 step 7, amended by 38f38e63c6): the untinted
// HomeAriOrb or Icon name="ari"; the animated ari/AriOrb and a tinted orb are out.
export const SUPPORT_ARI_MARK = /<HomeAriOrb\b(?![^>]*\btint\b)[^>]*>|<Icon name="ari"/;
export const SUPPORT_TINTED_HOME_ORB = /<HomeAriOrb\b[^>]*\btint\b/;
export const SUPPORT_OTHER_ARI_ORB = /from "(?![^"]*\/home\/HomeAriOrb")[^"]*AriOrb"/;

export const RULES = [
  // ---- Ari history pane (was ari/__tests__/issue_4420_ari_history_pane) ----
  {
    file: "src/components/ari/ConversationDrawer.tsx",
    why: "the drawer renders one body as a sheet or a pane, and every action lives in that body",
    has: [
      /presentation\?: "sheet" \| "pane"/,
      /if \(asPane\) \{[\s\S]*testID="ari-conversation-pane"[\s\S]*\{body\}/,
      /<Sheet visible=\{visible\}[^>]*>\s*\{body\}\s*<\/Sheet>/,
      "if (!asPane) onClose();",
      "Rename conversation",
      "Regenerate title",
      "New conversation",
      "Select",
    ],
  },
  {
    file: "src/screens/ari/AriChatScreen.tsx",
    why: "the pane shows on wide desktop only; the sheet and the Chats button stay elsewhere",
    has: [
      /const historyPane = isWideDesktop && !setup && !embedded && !websiteSplit;/,
      /\{historyPane \? \(\s*<ConversationDrawer\s+presentation="pane"/,
      "visible={drawerOpen && brandScopeStable && !historyPane}",
      /\{historyPane \? null : \(\s*<Pressable[\s\S]{0,200}setDrawerOpen\(true\)/,
    ],
  },
  // ---- Item discounts (was discounts/__tests__/issue_4420_item_discount_tokens) ----
  {
    file: "src/components/discounts/ItemDiscountControls.tsx",
    why: "selected labels are textStrong and the selected limit/day uses the neutral selected material, not orange",
    has: [/segmentTextOn: \{ color: color\.textStrong \}/, /dayTextOn: \{[^}]*color\.textStrong/, "materials.selected.solidFill"],
    lacks: [/\baccent\b/],
  },
  ...["src/components/venue/VenueSettingsModule.tsx", "src/components/venue/MenuItemSheet.tsx", "src/components/event/TicketTierEditSheet.tsx"].map(
    (file) => ({ file, why: "the venue and event screens still mount ItemDiscountControls", has: ["ItemDiscountControls"] }),
  ),
  // ---- Event wizard stepper (was event/__tests__/issue_4420_event_wizard_stepper) ----
  {
    file: "src/components/event/EventCreatorWizard.tsx",
    why: "both stepper layouts are pressable, reach comes from validateStep, errors show on the stepper, the shared StepperFooter owns Back/Continue",
    has: [
      /<Stepper\s+layout="list"[\s\S]{0,260}furthestValidIndex=\{furthestValidOrdinal\}\s+onStepPress=\{handleStepPress\}/,
      /<Stepper\s+layout="chips"[\s\S]{0,260}furthestValidIndex=\{furthestValidOrdinal\}\s+onStepPress=\{handleStepPress\}/,
      /const furthestValidOrdinal = useMemo\(\(\): number => \{\s*const firstInvalid = visibleStepDefs\.findIndex\(\s*\(\{ index \}\) => validateStep\(index, liveDraft(?:, venueOpts)?\)\.length > 0,/, // #4490 07-A: the at-venue option rides along (Party Type optional at a venue)
      /index === currentStep && showStepErrors \? stepErrors\[0\]\?\.message : undefined/,
      'state: "error" as const, firstError',
      'previousLabel={isFirstStep ? undefined : isWideDesktop ? "Back" : previousStepLabel ?? "Back"}',
      'return state.lastSavedAt !== null ? "Saved" : "Not saved yet";',
      /<StepperFooter\s+wide=\{isWideDesktop\}/,
      /backDisabled=\{\s*isLastStep\s*\?\s*checkingInvitePublish\s*:\s*currentStep === 6 && inviteNavigation\?\.phase === "saving"\s*\}/,
      'continueTestID={isLastStep ? "event-wizard-publish" : "event-wizard-continue"}',
    ],
    lacks: ["Draft saved", /styles\.footer\b/],
  },
  {
    file: "src/components/event/EventCreatorWizard.tsx",
    why: "a step jump is guarded like the dock Back: not mid invite save, not during the publish re-read",
    from: "const handleStepPress",
    to: "// ---- Publish gate ----",
    has: ['if (currentStep === 6 && inviteNavigation?.phase === "saving") return;', "if (checkingInvitePublish || isPublishing) return;", "setShowStepErrors(false);"],
  },
  {
    file: "src/components/event/EventCreatorWizard.tsx",
    why: "Blast is dropped from the wizard's collapsed rail",
    from: "const DESKTOP_WIZARD_NAV_ITEMS",
    to: "] as const;",
    lacks: ['label: "Blast"'],
  },
  // ---- Time zones (was event/__tests__/issue_4420_timezone_names + utils/__tests__/issue_4420_timezone_city_label) ----
  {
    file: "src/components/event/CreatorStep2When.tsx",
    why: "the When step labels the field and picker rows with the city name and searches with the shared matcher",
    has: [
      "export const timezoneDisplayName = timezoneCityName;",
      "const name = timezoneDisplayName(draft.timezone);",
      "{timezoneDisplayName(tz)}",
      "timezoneMatchesQuery(tz, q)",
    ],
    lacks: [/>\s*\{tz\}\s*</],
  },
  ...["src/components/brand/BrandEditTimezoneField.tsx", "src/components/venue/VenueAvailabilityModule.tsx"].map((file) => ({
    file,
    why: "every time zone picker searches with the shared matcher",
    has: ["timezoneMatchesQuery"],
  })),
  { file: "src/components/trip/BookingDeadlinePicker.tsx", why: "the trip deadline names the city, not the slug", has: ["timezoneCityName(brandTimezone"] },
  // ---- Stripe Connect appearance (was stripe/__tests__/issue_4420_connect_graphite_appearance) ----
  ...[
    "connect-pages/ConnectAccountManagementBody.web.tsx",
    "connect-pages/ConnectOnboardingBody.web.tsx",
    "connect-pages/ConnectPartnerAccountManagementBody.web.tsx",
    "connect-pages/ConnectPartnerOnboardingBody.web.tsx",
    "connect-pages/ConnectTaxRegistrationsBody.web.tsx",
    "ConnectOnboardingNative.native.tsx",
  ].map((site) => ({
    file: `src/components/stripe/${site}`,
    why: "every Connect init passes the shared Graphite appearance",
    has: ["loadConnectAndInitialize", "MINGLA_CONNECT_APPEARANCE"],
    lacks: [/colorPrimary:/],
  })),
  {
    file: "src/components/stripe/connectEmbeddedPageHelpers.ts",
    why: "the page chrome around the Connect iframe is Graphite, not paper",
    from: "export const pageWrapperStyle",
    to: "};",
    has: ["color.canvas"],
    lacks: ["color.paper"],
  },
  // ---- Promote / chat layout (was marketing/__tests__/issue_4420_layout_pass_c) ----
  {
    file: "src/components/marketing/MarketingSubNav.tsx",
    why: "one action per section: no compact circle over the pills on phone",
    has: ['testID="marketing-desk-header"'],
    lacks: ["compact={!isWideDesktop}"],
  },
  {
    file: "app/(tabs)/marketing/_layout.tsx",
    why: "a campaign/template detail hides the section pills; the pinned screen clears the privacy strip",
    has: ["isMarketingDetailRoute(pathname)", "{hideActions ? null : <MarketingSubNav />}", "webPrivacyMaxHeight()"],
  },
  ...["app/messages/[conversationId].tsx", "src/components/messages/BrandEnquiryThreadScreen.tsx"].map((file) => ({
    file,
    why: "every pinned chat screen is capped clear of the privacy strip",
    has: ["webPrivacyMaxHeight()"],
  })),
  { file: "src/components/messages/webViewportPin.ts", why: "the pin is capped by the app root, which ends at the privacy strip (#2331)", has: ['document.getElementById("root")'] },
  {
    file: "src/components/programs/ProgramKit.tsx",
    why: "a long program row value wraps instead of crushing the row title",
    has: [/rowRight: \{[\s\S]*?flexShrink: 1,[\s\S]*?maxWidth: "58%"/],
  },
  // ---- Who covers the costs (mounts; behaviour in pricing/__tests__/issue_4420_who_covers_neutral_selected) ----
  ...["src/components/event/CreatorStep5Tickets.tsx", "src/components/trip/TripCreatorStep4Pricing.tsx", "src/components/experience/ExperiencePricingStep.tsx"].map(
    (file) => ({ file, why: "the three wizards still mount the shared WhoCoversCostsSection", has: ["WhoCoversCostsSection"] }),
  ),
  // ---- Support ticket details pane (behaviour in support/__tests__/issue_4420_ticket_details_pane) ----
  {
    file: "src/components/support/SupportThreadCore.tsx",
    why: "the details pane renders only on wide desktop, beside the thread; phone keeps the single column",
    has: [/const showDetailsPane = isWideDesktop && ticket !== null/, 'testID="support-ticket-details"', /<KeyValue items=\{details\}/, /\) : \(\s*threadColumn\s*\)\}/],
  },
  // ---- Guest view host bar (was venue/__tests__/issue_4420_guest_view_host_bar) ----
  ...["app/reserve/[brandId]/index.tsx", "app/o/venue/[orderId].tsx"].map((file) => ({
    file,
    why: "the guest page shows the bar only for a stored host session, lazily, and calls no auth hook",
    has: [
      /const hostViewer = useSignedInHostViewer\(\);/,
      /\{hostViewer \? \(/,
      /React\.lazy\(\(\) =>\s*import\("\.\.\/\.\.\/\.\.\/src\/components\/venue\/GuestViewHostBar"\)/,
    ],
    lacks: [/\buseAuth\w*\s*\(/, /from\s+["'][^"']*AuthContext["']/],
  })),
  {
    file: "src/components/venue/guestViewHostSession.ts",
    why: "the session read uses the stored session, not AuthContext",
    has: ["supabase.auth.getSession()"],
    lacks: [/from\s+["'][^"']*AuthContext["']/, /\buseAuth\w*\s*\(/],
  },
  {
    file: "src/components/venue/GuestViewHostBar.tsx",
    why: "the bar says Guest view and returns to Mingla Host home",
    has: [">Guest view<", ">Back to Mingla Host<", 'router.replace("/(tabs)/home" as never)'],
  },
  // ---- Add a venue lists Stay (was venue/__tests__/issue_4420_tables_zones_and_stays) ----
  {
    file: "app/venue/create.tsx",
    why: "the create flow always passes includeStay; the server switch only disables it",
    has: [/<VenueCategoryPicker[\s\S]*?\n\s*includeStay\n[\s\S]*?stayDisabled=\{!stayAuthoringEnabled\}/],
    lacks: [/includeStay=\{stayAuthoringEnabled\}/],
  },
  {
    file: "src/components/venue/claim/ClaimStepCategory.tsx",
    why: "the claim flow always lists Stay too",
    has: [/\n\s*includeStay\n\s*stayDisabled=\{stayAuthoringFlag\.data !== true\}/],
  },
  // ---- Boot chunk on intent (was __tests__/issue_4420_boot_chunk_on_intent) ----
  // The eager `__common` chunk holds every module two or more lazy chunks reach.
  // A static import coming back re-hoists the module into the boot payload.
  ...[
    ["app/event/[id]/edit.tsx", "EditPublishedScreen", "published editor"],
    ["app/rsvp/[id]/edit.tsx", "EditPublishedScreen", "published editor"],
    ["src/components/event/EditPublishedScreen.tsx", "ChangeSummaryModal", "review sheet"],
    ["src/components/trip/EditPublishedTripScreen.tsx", "ChangeSummaryModal", "review sheet"],
    ["src/components/event/DraftEventFoundationPreview.tsx", "MultiDateDayChooser", "day chooser"],
    ["app/event/[id]/index.tsx", "EventManageMenu", "manage menu"],
    ["src/hooks/useGlobalSearchSheet.ts", "sheetState", "search engine"],
    ["src/services/discountBlastService.ts", "discountService", "discount service"],
    ["src/services/offeringInvitePlanService.ts", "manualGroupService", "manual groups"],
    ["app/checkout/[eventId]/buyer.tsx", "consentDisclosure", "consent body"],
    ["app/checkout-trip/[tripEventId]/buyer.tsx", "consentDisclosure", "consent body"],
    ["app/checkout-experience/[experienceEventId]/buyer.tsx", "consentDisclosure", "consent body"],
    ["app/pay/door/[code].tsx", "consentDisclosure", "consent body"],
    ["src/components/ticketLinks/TicketLinkLanding.tsx", "consentDisclosure", "consent body"],
  ].map(([file, mod, what]) => ({
    file,
    why: `the ${what} loads through a dynamic boundary; a static import re-hoists it into the eager boot chunk`,
    lacks: [new RegExp(`^\\s*(?:import|export)\\s+(?!type\\b)[^;]*?from\\s*["'][^"']*\\/${mod}["']`, "m")],
  })),
  { file: "src/components/event/LazyEditPublishedScreen.tsx", why: "the lazy wrapper really defers the published editor", has: [/import\("\.\/EditPublishedScreen"\)/] },
  { file: "src/components/event/LazyChangeSummaryModal.tsx", why: "the lazy wrapper really defers the review sheet", has: [/import\("\.\/ChangeSummaryModal"\)/] },
  ...["src/lib/search/recents.ts", "src/constants/purchaseTermsDisclosure.ts"].map((file) => ({
    file,
    why: "the split-out module carries no imports of its own, so it cannot drag its old parent back in",
    lacks: [/^\s*import\s/m],
  })),
  // ---- Ari thread start (was ari/__tests__/issue_4420_ari_thread_start; StreamingText renders in jest) ----
  {
    file: "src/screens/ari/AriChatScreen.tsx",
    why: "restoring the thread selection shows the thread loading state, never a bare StreamingText bubble",
    has: [/!conversationSelectionReady \|\| Boolean\(chat\.conversationId && chat\.isLoadingMessages\)[\s\S]*\{threadOpening \? \(\s*<AriThreadLoadingState/],
    lacks: ["<StreamingText"],
  },
  {
    file: "src/components/ari/ConversationDrawer.tsx",
    why: "the web conversations sheet never outgrows a 390 phone browser",
    has: ['webSheet: { width: 440, maxWidth: "100%", maxHeight: "80%" }'],
  },
  {
    file: "src/components/ari/StreamingText.tsx",
    why: "no lone caret style comes back beside the dots",
    lacks: ["styles.cursor"],
  },
  // ---- Ari icon is the orb (was ui/__tests__/issue_4420_ari_icon_is_orb; Icon renders in jest) ----
  ...[
    "app/(tabs)/_layout.tsx",
    "src/components/ui/DesktopSidebar.tsx",
    // #4420 step 7 — the Help page's own rail was dead code (the root shell
    // draws the sidebar) and left with the rebuild; its Ari mark is below.
    "src/components/trip/TripCreatorWizard.tsx",
    "src/components/rsvp/RsvpCreatorWizard.tsx",
    "src/components/event/EventCreatorWizard.tsx",
  ].map((file) => ({
    file,
    why: "an Ari nav entry (tab, sidebar, rail, wizard nav, Help rail) names the orb icon, never the sparkle",
    has: [/\{[^{}]*\b(?:id:\s*"ari"|label:\s*"Ari")[^{}]*\bicon(?:Name)?:\s*"ari"[^{}]*\}/],
    lacks: [/\{[^{}]*\b(?:id:\s*"ari"|label:\s*"Ari")[^{}]*\bicon(?:Name)?:\s*"sparkle"[^{}]*\}/],
  })),
  // ---- Event sheet audit (was event/__tests__/issue_4420_sheet_audit) ----
  {
    file: "src/components/event/EventManageMenu.tsx",
    why: "the Duplicate rows have their own copy glyph; the ticket glyph stays the Orders row's",
    has: [/key: "duplicate",[\s\S]*?icon: "copy"/, /key: "duplicate-as-new",[\s\S]*?icon: "copy"/, /icon: "ticket",\s*label: "Orders"/],
  },
  {
    file: "app/event/[id]/index.tsx",
    why: "Cancel event stays a destructive row in the column's card pattern, not a floating ghost label",
    from: "Cancel event CTA",
    to: "handleCancelDialogOpen}",
    has: [/<GlassCard[^>]*style=\{styles\.cancelCtaWrap\}/, /<ListRow[\s\S]*title="Cancel event"[\s\S]*danger/],
    lacks: [/variant="ghost"/],
  },
  ...[
    ["src/components/event/EditPublishedScreen.tsx", "liveEvent.id"],
  ].map(([file, id]) => ({
    file,
    why: "the published editors render Eligible buyers as the same collapsible section card as their other sections",
    has: ['testID="eligible-buyers-section-header"', "<Text style={styles.sectionLabel}>Eligible buyers</Text>", `<EventTicketCheckoutAccessCard eventId={${id}} embedded />`],
  })),
  // #4522: the published trip editor now uses the trip builder's section titles
  // for every section, so Eligible buyers keeps matching its sibling sections.
  {
    file: "src/components/trip/EditPublishedTripScreen.tsx",
    why: "the published trip editor renders Eligible buyers with the same section title as its other sections",
    has: ['<TripBuilderSectionTitle title="Eligible buyers" />', '<TripBuilderSectionTitle title="Traveler questions" />', "<EventTicketCheckoutAccessCard eventId={trip.id} embedded />"],
  },
  {
    file: "src/components/event/EventTicketCheckoutAccessCard.tsx",
    why: "embedded, the shared card drops its own frame and heading, and uses the Input and Button primitives",
    has: ["const hostStyle = embedded ? styles.hostEmbedded : styles.host;", "const heading = embedded ? null :", /<Input\b/, /<Button\b/],
    lacks: [/<Pressable|<TextInput/],
  },
  // ---- Taxonomy pill (was event/__tests__/issue_4420_taxonomy_pill_one_line) ----
  {
    file: "src/components/event/CreatorStep1Basics.tsx",
    why: "the taxonomy pill label is one line with simple breaking, or Android draws 'Themed' in a pill sized for two words",
    has: [/numberOfLines=\{1\}\s*\n\s*textBreakStrategy="simple"\s*\n\s*>\s*\n\s*\{label\}/],
  },
  {
    file: "src/components/event/CreatorStep1Basics.tsx",
    why: "selecting a taxonomy pill keeps the label weight",
    from: "  taxonomyPillLabelActive: {",
    to: "}",
    lacks: ["fontWeight"],
  },
  // ---- Home on Android (was home/__tests__/issue_4420_home_android_round2) ----
  {
    file: "app/(tabs)/home.tsx",
    why: "only the host's own pull shows the refresh spinner, never Recent's background refetch",
    has: [/refreshing=\{isRefreshing\}[\s\S]*refreshing=\{isRefreshing\}/],
    lacks: [/refreshing=\{[^}]*recent\.isRefreshing/],
  },
  {
    file: "src/components/home/BusinessPulsePanel.tsx",
    why: "the Followers pill keeps '+N this week' on one line",
    has: [/<Text style=\{styles\.followerPillText\} numberOfLines=\{1\} textBreakStrategy="simple">/, "paddingHorizontal: space[4]"],
  },
  { file: "src/components/home/BusinessPulsePanel.tsx", why: "on phones the pulse card keeps the page's one gutter", from: "  rootNarrow: {", to: "}", lacks: ["paddingHorizontal"] },
  { file: "src/components/home/HomeAdsSection.tsx", why: "on phones the ads card keeps the page's one gutter", from: "  sectionNarrow: {", to: "}", lacks: ["paddingHorizontal"] },
  { file: "src/components/home/HomeAdsSection.tsx", why: "the ads card pads the desktop gutter itself", from: "  section: {", to: "}", has: ["paddingHorizontal: space[4]"] },
  // ---- Shared address field floor (was location/__tests__/issue_4420_address_field_height; the Host bundle renders in jest) ----
  {
    file: "../packages/location-input/src/AddressInput.tsx",
    why: "the shared field applies the optional height floor and leaves it off when omitted",
    has: [/tokens\.field\.minHeight !== undefined\s*\?\s*\{ minHeight: tokens\.field\.minHeight \}\s*:\s*null/],
  },
  { file: "../packages/location-input/src/types.ts", why: "the token type carries the optional floor", has: ["minHeight?: number;"] },
  // ---- RSVP guest row (was rsvp/__tests__/issue_4420_guest_row_action_inset) ----
  {
    file: "src/components/rsvp/RsvpGuestConsole.tsx",
    why: "the trailing action cluster keeps a space-scale inset from the clipping card edge",
    from: "  refundTrailing: {",
    to: "}",
    has: ["paddingRight: space[3]", "paddingVertical: space[2]"],
  },
  { file: "src/components/rsvp/RsvpGuestConsole.tsx", why: "the guest card clips its contents, which is why the inset matters", from: "  guestRow: {", to: "}", has: ['overflow: "hidden"'] },
  // ---- Android status bar (was ui/__tests__/issue_4420_android_status_bar) ----
  {
    file: "app/_layout.tsx",
    why: "the root view is painted with the canvas token and the app-wide status bar draws light icons",
    has: [
      "<GestureHandlerRootView style={rootStyles.root}>",
      "root: { flex: 1, backgroundColor: color.canvas }",
      'import { StatusBar as ExpoStatusBar } from "expo-status-bar";',
      '<ExpoStatusBar style="light" />',
    ],
  },
  // ---- Sheet single gutter (was ui/__tests__/issue_4420_sheet_single_gutter) ----
  ...[
    ["src/components/event/CreatorStep2When.tsx", "sheetContent"],
    ["src/components/event/CreatorStep2WhenRepeatPickerSheet.tsx", "sheetContent"],
    ["src/components/event/MultiDateOverrideSheet.tsx", "sheetContent"],
    ["src/components/event/TicketTierEditSheet.tsx", "sheetContent"],
    ["src/components/door/DoorModeScreen.tsx", "sheetBody"],
    ["src/components/guests/AddCompGuestSheet.tsx", "body"],
  ].map(([file, name]) => ({
    file,
    why: `${name} sits inside Sheet, which owns the one side gutter; it adds no paddingHorizontal of its own`,
    from: `  ${name}: {`,
    to: "}",
    lacks: ["paddingHorizontal"],
  })),
  {
    file: "src/components/ui/SheetMobile.tsx",
    why: "Sheet's mobile body owns the gutter",
    has: ["export const SHEET_SIDE_GUTTER = space[5];", /body: \{[^}]*paddingHorizontal: SHEET_SIDE_GUTTER/],
  },
  // ---- TopSheet native layer (was ui/__tests__/issue_4420_topsheet_native_layer) ----
  {
    file: "src/components/ui/TopSheet.tsx",
    why: "the native overlay root fills the screen and carries an explicit layer above the floating Blast button (zIndex 30)",
    has: ["style={styles.nativeRoot}"],
  },
  {
    file: "src/components/ui/TopSheet.tsx",
    why: "nativeRoot: absolute fill, elevation, and a zIndex above 30",
    from: "  nativeRoot: {",
    to: "},",
    has: ["...StyleSheet.absoluteFillObject", /elevation:\s*\d+/, /zIndex:\s*(?:3[1-9]|[4-9]\d|\d{3,})\b/],
  },
  { file: "src/components/marketing/MarketingActionButton.tsx", why: "the floating Blast button's layer is the one the TopSheet outranks", from: "  floating: {", to: "},", has: ["zIndex: 30"] },
  {
    file: "src/components/ui/UniversalCreatorSheet.tsx",
    why: "root option subtitles read in full (no line clamp) and step titles share sentence case",
    has: ["<Text style={styles.headerTitle}>Create an event</Text>", "<Text style={styles.headerTitle}>Create an experience</Text>"],
    lacks: ["Create An Experience"],
  },
  {
    file: "src/components/ui/UniversalCreatorSheet.tsx",
    why: "root option subtitles carry no line clamp",
    from: 'step === "root"',
    to: 'step === "event"',
    has: ["<Text style={styles.rowSubtitle}>"],
    lacks: ["numberOfLines"],
  },
  // ---- Venue wizard desktop template (was venue/__tests__/issue_4420_journey_wizard_desktop) ----
  {
    file: "src/components/venue/VenueCreatorWizard.tsx",
    why: "desktop renders the step list in a rail beside the form pane; phones keep the inline stepper above the same pane; the template is sized from the desktop layout tokens",
    has: [
      "const { isWideDesktop } = useResponsiveLayout();",
      /isWideDesktop \? \([\s\S]*?<Stepper\s+layout="list"[\s\S]*?testID="venue-wizard-stepper"/,
      "<View style={styles.desktopFormPane}>{pane}</View>",
      /\) : \(\n\s*<>[\s\S]*?<Stepper\s+steps=\{stepperSteps\}[\s\S]*?\{pane\}/,
      "width: DESKTOP_WIZARD_RAIL_WIDTH",
      "maxWidth: DESKTOP_WIZARD_FORM_MAX_WIDTH",
      "paddingHorizontal: DESKTOP_BEZEL_MARGIN",
    ],
  },
  {
    file: "src/components/experience/ExperiencePricingStep.tsx",
    why: "the price option card spaces its children through contentStyle (GlassCard style cannot reach children, #1532)",
    has: [/contentStyle=\{styles\.optionContent\}\s*\n\s*testID=\{`experience-price-option-/, /optionContent: \{\s*gap: space\[2\],\s*\}/],
  },
  // ---- Help & Support (#4420 step 7; behaviour in support/__tests__/issue_4420_help_support_entry, issue_4420_support_handover, support/__tests__/issue_4420_support_column) ----
  {
    file: "src/components/support/SupportColumn.tsx",
    why: "the Support switch's Ari mark is the existing orb: HomeAriOrb (components/home/HomeAriOrb) with no tint, so it keeps Ari's orange as on the Ari tab and Home, or Icon name=\"ari\"; never the animated components/ari/AriOrb (reanimated and Ari's chat chunk on this screen) and never a hand-drawn mark; the column reaches both sides only through the lazy boundaries",
    has: [SUPPORT_ARI_MARK, "LazySupportAriChat", "LazySupportPersonPane", "loadSupportScreens", "openHelpCentre(HELP_CENTRE_URL)"],
    lacks: [/<Svg\b/, /from "react-native-svg"/, SUPPORT_TINTED_HOME_ORB, SUPPORT_OTHER_ARI_ORB, /from "[^"]*(?:AriChatScreen|SupportThread|SupportPersonPane|supportService|supportRequestModel|supportHandoverService)"/, /\bTextInput\b/, /React\.lazy\(/],
  },
  {
    file: "app/account/support.tsx",
    why: "spec 4.3: the route statically imports only the shell; Ari's chat and the conversation load lazily",
    has: ["AnnouncementsPanel", "SupportColumn", "HelpSupportHubTabs", "resolveHelpSupportEntry", "useCommunityUnreadCount"],
    lacks: [/from "[^"]*(?:AriChatScreen|SupportThread|SupportPersonPane|SupportTabPanel|supportService|supportRequestModel|supportHandoverService|helpSupportLastTab|CommunityTabPanel|GuidesTabPanel)"/, /React\.lazy\(/, /\bTextInput\b/, "community-floating-action"],
  },
  {
    file: "src/components/support/LazySupportScreens.tsx",
    why: "the two Help & Support sides are sibling top-level boundaries; Ari's is the same module the Ari tab loads (one chunk)",
    has: ['import("../../screens/ari/AriChatScreen")', 'import("./supportScreens")', "export const LazySupportAriChat", "export const LazySupportPersonPane"],
    lacks: [/React\.lazy\(/, /from "[^"]*AriChatScreen"/],
  },
  ...[
    "src/components/support/AnnouncementsPanel.tsx",
    "src/components/support/HelpSupportHubTabs.tsx",
    "src/components/support/helpSupportRoute.ts",
    "src/components/support/helpSupportHubCopy.ts",
    "src/components/support/supportHandover.ts",
    "src/components/support/SupportPersonPane.tsx",
    "src/hooks/supportTicketKeys.ts",
  ].map((file) => ({
    file,
    why: "no lazy boundary nested inside the support feature (it hoists shared modules into __common); the shell keeps AsyncStorage and expo modules off the boot path",
    lacks: [/React\.lazy\(/, /from "@react-native-async-storage\/async-storage"/, /from "expo-(?!router)[^"]*"/],
  })),
];

// ---- No raw Alert.alert (I-4420-NO-RAW-ALERT) ----
// react-native-web implements Alert.alert as a no-op, so a raw call on a
// web-reachable path is a silent failure (Constitution 3). Every alert goes
// through src/components/ui/showAlert.ts. The files below run ONLY on a phone
// and keep their raw calls, each marked "I-4420-NO-RAW-ALERT native-only"
// (except AuthContext.tsx, whose bytes are pinned by the #1044 and #1881
// tests, so its six native sign-in alerts carry no marker);
// the number is a ceiling, so a new raw call there fails too. Comment lines
// and __tests__ are ignored. Behaviour: ui/__tests__/issue_4420_show_alert.
export const RAW_ALERT_ALLOW = {
  "src/components/ui/showAlert.ts": 1,
  "src/context/AuthContext.tsx": 6,
  "src/components/door/tap/TapToPaySaleScreen.tsx": 1,
  "src/components/door/useDoorModeTapSale.ts": 1,
  "app/(tabs)/marketing/campaigns/compose.tsx": 1,
  "src/components/marketing/ComposerV2/TemplatePreviewDrawer.tsx": 1,
  "src/components/marketing/ComposerV2/SelectionFormattingTooltip.tsx": 1,
};
export const RAW_ALERT_ROOTS = ["app", "src"];

/** Pure: raw-alert problems for `files` ({ path, text }[], paths relative to mingla-business/). */
export function checkRawAlerts(files, allow = RAW_ALERT_ALLOW) {
  const problems = [];
  for (const { path: rel, text } of files) {
    if (/(^|\/)__tests__\//.test(rel)) continue;
    const count = text
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .reduce((n, line) => n + (line.match(/\bAlert\s*\.\s*alert\s*\(/g) ?? []).length, 0);
    const ceiling = allow[rel] ?? 0;
    if (count > ceiling) {
      problems.push(
        ceiling === 0
          ? `${rel}: ${count} raw Alert.alert call(s); use showAlert (src/components/ui/showAlert.ts) — Alert.alert shows nothing on web`
          : `${rel}: ${count} raw Alert.alert call(s), allowlist ceiling is ${ceiling} (native-only); use showAlert`,
      );
    }
  }
  return problems;
}

const listSources = (dir, rel = "") => {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listSources(dir, child));
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(child);
  }
  return out;
};

const label = (p) => (p instanceof RegExp ? String(p) : JSON.stringify(p));
const hit = (text, p) => (p instanceof RegExp ? p.test(text) : text.includes(p));

/** Pure checker: returns a list of problem strings for one rule against `read(file)` (null = missing). */
export function checkRule(rule, read) {
  const problems = [];
  const src = read(rule.file);
  if (src === null) return [`${rule.file}: file is missing (${rule.why})`];
  let text = src;
  if (rule.from !== undefined) {
    const start = src.indexOf(rule.from);
    const end = start === -1 ? -1 : src.indexOf(rule.to ?? "", start + rule.from.length);
    if (start === -1 || end === -1) return [`${rule.file}: slice marker ${JSON.stringify(start === -1 ? rule.from : rule.to)} not found (${rule.why})`];
    text = src.slice(start, end);
  }
  for (const p of rule.has ?? []) if (!hit(text, p)) problems.push(`${rule.file}: missing ${label(p)} — ${rule.why}`);
  for (const p of rule.lacks ?? []) if (hit(text, p)) problems.push(`${rule.file}: forbidden ${label(p)} — ${rule.why}`);
  return problems;
}

if (process.argv.includes("--self-test")) {
  const files = {
    "a.ts": "const x = 1;\nexport const pageWrapperStyle = { bg: color.canvas };\nfoo();",
    "b.ts": "accent here",
    "s-home.tsx": 'import { HomeAriOrb } from "../home/HomeAriOrb";\n<HomeAriOrb size={18} still testID="o" />',
    "s-icon.tsx": 'import { Icon } from "../ui/Icon";\n<Icon name="ari" size={18} />',
    "s-tint.tsx": 'import { HomeAriOrb } from "../home/HomeAriOrb";\n<HomeAriOrb size={18} still tint={color.ink} />',
    "s-anim.tsx": 'import { HomeAriOrb } from "../home/HomeAriOrb";\nimport { AriOrb } from "../ari/AriOrb";\n<HomeAriOrb size={18} still />',
    "s-svg.tsx": 'import Svg, { Circle } from "react-native-svg";\n<Svg width={18}><Circle r={9} /></Svg>',
  };
  const read = (f) => (f in files ? files[f] : null);
  const cases = [
    ["present string passes", { file: "a.ts", why: "w", has: ["const x = 1;"] }, 0],
    ["matching regex passes", { file: "a.ts", why: "w", has: [/foo\(\)/] }, 0],
    ["absent string fails", { file: "a.ts", why: "w", has: ["const y"] }, 1],
    ["forbidden regex fails", { file: "b.ts", why: "w", lacks: [/\baccent\b/] }, 1],
    ["missing file fails", { file: "gone.ts", why: "w", has: ["x"] }, 1],
    ["slice scopes the check", { file: "a.ts", why: "w", from: "export const pageWrapperStyle", to: "};", has: ["color.canvas"], lacks: ["foo()"] }, 0],
    ["missing slice marker fails", { file: "a.ts", why: "w", from: "export const nope", to: "};", has: ["x"] }, 1],
    ["support: untinted HomeAriOrb passes", { file: "s-home.tsx", why: "w", has: [SUPPORT_ARI_MARK], lacks: [/<Svg\b/, SUPPORT_TINTED_HOME_ORB, SUPPORT_OTHER_ARI_ORB] }, 0],
    ["support: Icon name=ari passes", { file: "s-icon.tsx", why: "w", has: [SUPPORT_ARI_MARK], lacks: [/<Svg\b/, SUPPORT_TINTED_HOME_ORB, SUPPORT_OTHER_ARI_ORB] }, 0],
    ["support: tinted HomeAriOrb fails", { file: "s-tint.tsx", why: "w", has: [SUPPORT_ARI_MARK], lacks: [/<Svg\b/, SUPPORT_TINTED_HOME_ORB, SUPPORT_OTHER_ARI_ORB] }, 1],
    ["support: importing ari/AriOrb fails", { file: "s-anim.tsx", why: "w", has: [SUPPORT_ARI_MARK], lacks: [/<Svg\b/, SUPPORT_TINTED_HOME_ORB, SUPPORT_OTHER_ARI_ORB] }, 1],
    ["support: a hand-drawn mark fails", { file: "s-svg.tsx", why: "w", has: [SUPPORT_ARI_MARK], lacks: [/<Svg\b/, SUPPORT_TINTED_HOME_ORB, SUPPORT_OTHER_ARI_ORB] }, 1],
  ];
  const failures = cases.filter(([, rule, want]) => (checkRule(rule, read).length > 0 ? 1 : 0) !== want).map(([name]) => name);
  const alertCases = [
    ["raw Alert.alert outside the allowlist fails", [{ path: "src/x.tsx", text: "Alert.alert(\"a\");" }], 1],
    ["showAlert passes", [{ path: "src/x.tsx", text: "showAlert(\"a\");" }], 0],
    ["a commented Alert.alert passes", [{ path: "src/x.tsx", text: "// Alert.alert is a no-op on web\n * Alert.alert(" }], 0],
    ["tests are ignored", [{ path: "src/__tests__/x.test.tsx", text: "Alert.alert(\"a\");" }], 0],
    ["an allowlisted file within its ceiling passes", [{ path: "src/context/AuthContext.tsx", text: "Alert.alert(1);\nAlert.alert(2);" }], 0],
    ["an allowlisted file over its ceiling fails", [{ path: "src/components/door/useDoorModeTapSale.ts", text: "Alert.alert(1);\nAlert.alert(2);" }], 1],
  ];
  for (const [name, files, want] of alertCases) {
    if ((checkRawAlerts(files).length > 0 ? 1 : 0) !== want) failures.push(name);
  }
  if (failures.length) {
    console.error(`#4420 host-wiring self-test FAIL: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log(`#4420 host-wiring self-test PASS (${cases.length + alertCases.length} cases)`);
  process.exit(0);
}

const readBiz = (rel) => {
  const abs = path.join(BUSINESS, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
};
const problems = RULES.flatMap((rule) => checkRule(rule, readBiz));
const sourceFiles = RAW_ALERT_ROOTS.flatMap((root) => listSources(BUSINESS, root));
for (const rel of Object.keys(RAW_ALERT_ALLOW)) {
  if (!sourceFiles.includes(rel)) problems.push(`${rel}: allowlisted for raw Alert.alert but missing (I-4420-NO-RAW-ALERT); drop or rename the entry`);
}
problems.push(...checkRawAlerts(sourceFiles.map((rel) => ({ path: rel, text: readBiz(rel) ?? "" }))));
if (problems.length) {
  console.error(`FAIL [I-4420-HOST-WIRING]: ${problems.length} wiring rule(s) broken:`);
  for (const p of problems) console.error(`  x ${p}`);
  process.exit(1);
}
console.log(`OK [I-4420-HOST-WIRING]: ${RULES.length} wiring rules hold; no raw Alert.alert outside showAlert and ${Object.keys(RAW_ALERT_ALLOW).length - 1} native-only files (I-4420-NO-RAW-ALERT).`);
