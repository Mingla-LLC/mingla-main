#!/usr/bin/env node
// MINGLA-INVARIANT: I-4490-HOST-WIRING-PINS | issue #4490 | the Host and buyer web wiring that a model test cannot see keeps its load-bearing lines; the pinned seams are listed on the next comment line and each one is checked by this gate.
// Pinned seams: paid hire extras, the #4514 form seams, member codes at the door, the guest-list door sale and signed-out promoter page, the table deposit choices, the up-front experience save, the dark web preboot, the reserve sheet, the manage page time, the Calendar week, the Stay workspace layout, the Till's refusal words, pay-sheet resume and kitchen banners, the iPhone Till's one modal per presenter, venue-only Home listing every venue type, the station rail routing, the Till's client request ids made as UUIDs that venue-till accepts, one per payment or refund attempt, with the paid step showing the server's recorded amount, the split step inside the one pay sheet with one attempt per share, and the session and seat sheets opened from the catalog, the step-up PIN pad inside the sheet that asked, the Till route through the PIN gate, the PIN session in memory only, Who's selling as screen content.
/**
 * #4490 W3 fix 1 — the structural pins of eight #4490 mingla-business jest
 * suites, moved here as the additive strict-grep gate that
 * I-PROPOSED-1047-NO-SOLE-SOURCE-PIN asks for ("for a genuine structural rule,
 * an additive strict-grep gate"). The suites keep every behavioural test (they
 * run the real functions); only the source-text reads moved, word for word.
 *
 * Plain run: every pin is checked; a missing line fails with its reason.
 * --self-test: each pin is broken in memory (its first required line removed,
 * or a forbidden line added) and must turn the gate red.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BIZ = "mingla-business";

/** The web preboot paints the app canvas: the two design tokens, resolved. */
function designTokenHex(token) {
  const ds = fs.readFileSync(path.join(ROOT, BIZ, "src/constants/designSystem.ts"), "utf8");
  const ref = new RegExp(`\\b${token}: palette\\.graphite\\[(\\d+)\\]`).exec(ds);
  const block = /graphite: \{([\s\S]*?)\n\s{2}\}/.exec(ds);
  if (ref === null || block === null) return null;
  const hex = new RegExp(`\\b${ref[1]}: "(#[0-9a-fA-F]{6})"`).exec(block[1]);
  return hex === null ? null : hex[1];
}

const PINS = [
  // publicIndexHtmlCanvas (#4490 N35/N42/N73)
  {
    id: "web-preboot-canvas",
    file: `${BIZ}/public/index.html`,
    slice: '<style id="mingla-preboot">',
    contains: () => [`background-color: ${designTokenHex("canvas")};`, `color: ${designTokenHex("text2")};`],
    why: "the web document must be dark (the app canvas) before any JavaScript runs",
  },
  {
    id: "web-preboot-template",
    file: `${BIZ}/public/index.html`,
    contains: ["%LANG_ISO_CODE%", "%WEB_TITLE%", "</head>", "#root:not(:empty) ~ .mingla-preboot"],
    matches: [/<div id="root"><\/div>\s*<div class="mingla-preboot"[\s\S]*Loading…[\s\S]*<\/div>/],
    why: "the Expo template placeholders stay, #root stays the empty Expo scaffold (#922 critical entry), and the readable loader beside it shows only until #root has content",
  },
  // venueTableDepositUi (spec 07 B)
  {
    id: "table-deposit-modes",
    file: `${BIZ}/src/components/venue/features/floor/TableForm.tsx`,
    contains: [
      "Your usual deposit rule",
      "Per guest",
      "Per table",
      "Share of the minimum spend",
      "disabled: !shareReady",
      "Turn on Minimum spend tables and set a minimum spend first.",
      "Paid when they book. Take it off their bill at the venue.",
      // 08 O4 (spec 07 §11 B1): the short hint where the Till credits the deposit.
      'features.till === true ? "Comes off their bill."',
      "step={5}",
    ],
    why: "the four deposit modes are visible and the share option explains why it is disabled",
  },
  {
    id: "select-sheet-disabled-row",
    file: `${BIZ}/src/components/ui/SelectSheet.tsx`,
    contains: [
      "disabled={option.disabled === true}",
      "accessibilityState={{ checked: on, disabled: option.disabled === true }}",
      "accessibilityHint={option.helper}",
    ],
    why: "a disabled select row is truly non-interactive and says why",
  },
  // experienceUpfrontDraft (N129)
  {
    id: "experience-upfront-draft",
    file: `${BIZ}/src/components/experience/ExperienceCreatorWizard.tsx`,
    matches: [/supabase\.rpc\("biz_create_experience"[\s\S]{0,600}?p_payload: upfrontDraftPayload\(buildPayload\(false\)\)/],
    why: "the up-front experience draft goes through the unnamed-price filter",
  },
  // venueHireExtrasAndFormSeams (spec 07-C, #4514 seams)
  {
    id: "hire-extras-editor",
    file: `${BIZ}/src/components/venue/features/offers/HireEditor.tsx`,
    contains: ['import { ExtrasEditor } from "./ExtrasEditor"', 'action: "set_extras"', "<ExtrasEditor", 'title="Paid extras"'],
    why: "hire extras are authored with the shared editor and saved with the hire action",
  },
  {
    id: "hire-extras-guest",
    file: `${BIZ}/src/components/venue/offers/HireRequest.tsx`,
    contains: ["extras: pickedExtras.map((id) => ({ id }))", 'testID="issue-4490-hire-request-extras"'],
    why: "a guest picks hire extras on the request",
  },
  {
    id: "hire-extras-host-quote",
    file: `${BIZ}/src/components/venue/features/requests/VenueRequestsModule.tsx`,
    contains: ['label="Hire and extras"', 'testID="venue-request-quote-included-extras"', "Includes ${extra.name}"],
    why: "the host sees the extras when editing the whole quote",
  },
  ...[
    [`${BIZ}/src/components/venue/VenueDetailsEditor.tsx`, "formAttachRow?: React.ReactNode"],
    [`${BIZ}/src/components/venue/features/offers/PackageEditor.tsx`, "questionsSource?: React.ReactNode"],
    [`${BIZ}/src/components/venue/features/offers/HireEditor.tsx`, "questionsSource?: React.ReactNode"],
    ["packages/brand-rendering/PublicVenueScreen.tsx", "formSection?: (context: PublicVenueThemedContext) => BrandRenderingReactNode"],
  ].map(([file, signature]) => ({
    id: `form-seam ${path.basename(file)}`,
    file,
    contains: ["[TRANSITIONAL] blocked on #4514", signature],
    why: "every #4514 form slot stays optional and explicitly transitional",
  })),
  {
    id: "public-form-section-place",
    file: "packages/brand-rendering/PublicVenueScreen.tsx",
    contains: [
      "formSection === undefined ? null : formSection(themedSlotContext)",
      "formSectionNode !== null && index === formSectionAfter",
      "formSectionNode !== null && formSectionAfter < 0 ? formSectionNode : null",
    ],
    matches: [/sectionId === "about" \|\| sectionId === "location" \|\| sectionId === "hours"/],
    why: "the public form sits after the last About, Location or Hours section and is absent by default",
  },
  {
    id: "offer-questions-source-steps",
    file: `${BIZ}/src/components/venue/features/offers/PackageEditor.tsx`,
    contains: ["<RulesStep {...stepProps} currency={currency} questionsSource={questionsSource} />"],
    matches: [/<StepHead title="Deposit and rules"[^>]*\/>\s*\{questionsSource\}/],
    why: "the package questions source sits in its required step",
  },
  {
    id: "hire-questions-source-step",
    file: `${BIZ}/src/components/venue/features/offers/HireEditor.tsx`,
    contains: ["<BookStep {...stepProps} venueName={venueName} questionsSource={questionsSource} />"],
    matches: [/<StepHead title="How guests book"[^>]*\/>\s*\{questionsSource\}/],
    why: "the hire questions source sits in its required step",
  },
  // venueMemberCodes (#4490 M)
  {
    id: "member-code-pass",
    file: `${BIZ}/src/components/venue/offers/VisitMembership.tsx`,
    contains: ["Can’t scan? Your code: ${memberCode}", 'testID="issue-4490-member-code"'],
    why: "the member page shows the code under the pass",
  },
  {
    id: "member-code-panel",
    file: `${BIZ}/src/components/venue/features/members/MemberPanel.tsx`,
    contains: ['label: "Member code"'],
    why: "the Host member panel shows the code",
  },
  {
    id: "member-code-door",
    file: `${BIZ}/src/components/venue/features/checkin/VenueCheckInModule.tsx`,
    contains: ["Array.from({ length: 6 }", 'kind: "admit_code"', 'testID="venue-checkin-member-code"'],
    why: "the door takes a six-box member code",
  },
  // venueGuestListI (spec 07-I)
  // #4490 spec 08 §13 (decided 22 Nov): door sales work with or without the
  // Till. Till on: the reduced price is sold in the Till's Entry tab, locked to
  // the configured option and party count. Till off: the gate sale sheet sells
  // it, locked the same way, through the guest-list sale action.
  {
    id: "guest-list-door-sale",
    file: `${BIZ}/src/components/venue/features/checkin/VenueCheckInModule.tsx`,
    contains: [
      "openTill({ offerId: next.offeringId ?? null, priceOptionId: next.priceOptionId, count: next.count ?? count, entryId: entry.id })",
      "const route = guestListDoorSale(next.result as string);",
      "setSale({ open: true, offerId: next.offeringId ?? null });",
    ],
    why: "the reduced-price door sale opens the Till (Till on) or the gate sale sheet (Till off) with the configured option and party count",
  },
  {
    id: "guest-list-gate-sale-locked",
    file: `${BIZ}/src/components/venue/features/checkin/VenueGateSale.tsx`,
    contains: [
      "offer.options.filter((o) => o.id === guestListSale.priceOptionId)",
      "{o.name} × {guestListSale.count}",
      "count: guestListSale.count",
    ],
    why: "with the Till off the gate sale sheet's reduced-price sale is locked to the configured option and party count",
  },
  {
    id: "guest-list-gate-sale-action",
    file: `${BIZ}/src/services/venueOffersService.ts`,
    contains: ['action: "sell_guest_list"'],
    why: "with the Till off the door sale uses the guest-list sale action",
  },
  {
    id: "door-sale-one-switch",
    file: `${BIZ}/src/components/venue/features/checkin/doorSaleEntry.ts`,
    contains: [
      'import { venueOrderEntry } from "../../venueModules";',
      '=== "pad"\n    ? "gate_sale"\n    : "till";',
    ],
    why: "the door chooses the gate sale or the Till by the same switch as the order pad (spec 08 §13)",
  },
  {
    id: "guest-list-till-locked",
    file: `${BIZ}/src/components/venue/till/TillScreen.tsx`,
    contains: [
      "(o) => o.status === \"active\" && (state?.guestListEntryId == null || (state.counts[o.id] ?? 0) > 0),",
    ],
    why: "a guest-list sale in the Till offers only the prefilled reduced option",
  },
  {
    id: "guest-list-sale-action",
    file: `${BIZ}/src/services/venueTillService.ts`,
    contains: ['return saleAction({ action: "add_offer", ...input });', "guestListEntryId: string | null"],
    why: "the Till's Entry line carries the guest-list name so paying marks the arrival",
  },
  {
    id: "promoter-route-signed-out",
    file: `${BIZ}/app/visit/list/[token].tsx`,
    absent: ["useAuth"],
    why: "the promoter route never requires sign-in",
  },
  {
    id: "promoter-screen",
    file: `${BIZ}/src/components/venue/features/guestlist/VisitGuestList.tsx`,
    contains: ["Add a name", "Remove", 'onChange={selectDate} accessibilityLabel="Night"'],
    absent: ["useAuth"],
    absentMatches: [/sign[ -]?up/i],
    matches: [/const selectDate = \(nextDate: string\): void => \{\s*setDate\(nextDate\);\s*setError\(null\);\s*setNotice\(null\);\s*\};/],
    why: "the promoter page is signed out, has no public sign-up, and clears old feedback when the night changes",
  },
  // venueFix4 (fix round 4)
  {
    id: "flyer-column-shell",
    file: "packages/offering-rendering/ParallaxCoverShell.tsx",
    contains: [
      "flyerColumnStickyTop(deskScrollHeight, deskColHeight)",
      "top: flyerStickyTop,",
      'flyerWidthCap !== null ? { width: flyerWidthCap, alignSelf: "center" } : null',
    ],
    absent: ["maxHeight: flyerCap"],
    why: "the flyer column is measured, narrowed (never cropped) and ends above the privacy strip",
  },
  {
    id: "manage-page-time",
    file: `${BIZ}/app/reserve/[brandId]/manage.tsx`,
    contains: ["guestManageWhen(reservation.reservedForUtc, reservation.timezone)", "Your reservation · Mingla"],
    absent: ["Intl.DateTimeFormat(undefined"],
    why: "the manage page says the time in the venue's zone",
  },
  {
    id: "manage-button-words",
    file: `${BIZ}/src/components/venue/GuestVenueReservation.tsx`,
    contains: [">Manage booking</Text>", "styles.priceArea", "priceAreaLoading", 'accessibilityLabel="Send me occasional Mingla updates"'],
    absent: ["Change or cancel"],
    why: "the confirmation's button says what the page does; the price area keeps one height; the switch has a name",
  },
  {
    id: "manage-view-zone",
    file: "supabase/functions/_shared/guestReservationManageView.ts",
    contains: ["issue_4490_venue_timezone", "timezone,"],
    why: "the manage answer carries the venue's zone",
  },
  {
    id: "reserve-sheet-head",
    file: `${BIZ}/src/components/venue/PublicVenueReservationSheet.tsx`,
    contains: ["<PickerSheetHead title={title} onClose={onClose}"],
    why: "the reserve sheet has the kit's head with a Close",
  },
  {
    id: "calendar-week",
    file: `${BIZ}/src/components/venue/features/calendar/VenueCalendarModule.tsx`,
    contains: [
      "{...hoverTitle(block.label)}",
      'setAttribute("title", label)',
      "export const WEEK_DEFAULT_MIN_WIDTH = 1280;",
      "isWideDesktop && width >= WEEK_DEFAULT_MIN_WIDTH",
    ],
    absentMatches: [/numberOfLines=\{compact \? 1 : 2\}/],
    why: "a Calendar cell keeps two lines and its full text; the week opens by itself only when seven days fit",
  },
  {
    id: "booking-share-classified",
    file: `${BIZ}/src/components/venue/offers/VisitBooking.tsx`,
    matches: [/\/\/ SHARE-NON-CONTENT:receipt\n\s*await Share\.share\(\{ message \}\);/],
    why: "the booking 'tell your group' share is classified for the #1615 gate",
  },
  // venueClickTestFixes (Stay workspace round 4J)
  {
    id: "stay-settings-stacked",
    file: `${BIZ}/src/components/stay/StaySuiteShell.tsx`,
    contains: ['layout="stacked"', "setRequestLeave(requestLeave)", "setRequestLeave(null)", '"beforeunload"'],
    why: "Stay Settings keeps the features panel single-column and registers and clears the page-exit gate",
  },
  {
    id: "features-panel-auto",
    file: `${BIZ}/src/components/venue/features/VenueTypeAndFeaturesPanel.tsx`,
    contains: ['layout = "auto"'],
    why: "the features panel defaults to the automatic layout",
  },
  // #4490 08-O3 fix 1 (O3-T7): the source-text reads of four Till / station
  // jest suites (tillFix2, tillFix3, tillKitchen, venueStationsNav), word for
  // word; the suites keep every behavioural test.
  {
    id: "till-error-codes-have-words",
    // The refusal words moved to their own leaf (tillErrorCopy.ts, re-exported by
    // tillCopy.ts) so the guest pay page and Team load them without the Till.
    file: `${BIZ}/src/components/venue/till/tillErrorCopy.ts`,
    slice: "export const TILL_ERROR_COPY = {",
    contains: () => tillServerCodes().map((code) => `\n  ${code}:`),
    why: "every refusal the venue-till edge can send has its own row in the Till's words (O1-B1)",
  },
  {
    id: "till-pay-sheet-typed-amount",
    file: `${BIZ}/src/components/venue/till/PaymentSheet.tsx`,
    contains: ["const payAmount = amountMinor ?? due;", "error={amountError}"],
    matches: [/disabled=\{!canChooseMethod\}[\s\S]*disabled=\{!canChooseMethod\}/],
    absentMatches: [/amountMinor <= due \? amountMinor : due/, /(disabled=\{!canChooseMethod\}[\s\S]*){3}/],
    why: "a typed amount is taken as typed and both method rows stay blocked while it is refused (O1-B1)",
  },
  {
    id: "till-pay-sheet-resume",
    file: `${BIZ}/src/components/venue/till/PaymentSheet.tsx`,
    matches: [
      // 08-O4: a share's own live payment is resumed by its share id (TEST-MOD-APPROVED #4490).
      /resumeLivePayment\(sale, Date\.now\(\), share\?\.id \?\? null\)/,
      /scanApi\s*\n?\s*\.fetchStatus\(live\.code\)/,
      /setStep\("scan"\)/,
      /setTapResumed\(true\)/,
      /resumed=\{tapResumed\}/,
      /<TillScanPanel/,
    ],
    absentMatches: [/<TillScanPanel[\s\S]*<TillScanPanel/],
    why: "the pay sheet reopens a live payment on the one existing scan panel or the tap panel in resumed mode (O2-B1)",
  },
  {
    id: "till-tap-panel-resumed",
    file: `${BIZ}/src/components/venue/till/TillTapPanel.tsx`,
    matches: [
      /if \(resumed\) return undefined;/,
      /await cancelTillCardPayment\(\{ venueId, paymentId \}\);\s*\n\s*onScanInstead\(\);/,
      /testID="till-tap-cancel-resumed"/,
    ],
    why: "a resumed tap starts no reader and cancels through pay_card_cancel (O2-B1)",
  },
  {
    id: "till-kitchen-banners",
    file: `${BIZ}/src/components/venue/till/TillScreen.tsx`,
    contains: [
      'testID="till-ready-banner"',
      'runStationAction("picked_up", round.orderId, station)',
      'testID="till-unaccepted-banner"',
      'kind: "kitchen_ticket", venueId, orderId: waitingRound.orderId',
    ],
    why: "the Till shows Ready to take out with Picked up, and Nobody has accepted with Print ticket (§11 T5/T7)",
  },
  {
    id: "venue-staff-home-any-type",
    file: `${BIZ}/src/components/home/VenueStaffHome.tsx`,
    contains: [
      "listVenueStaffVenues(venuesQuery.data)",
      "router.push(`/venue/${venue.id}` as never)",
      "No venue access yet",
    ],
    absentMatches: [/venueCategory === "stay" \|\| venue\.venueCategory === "restaurant"/],
    why: "venue-only Home reads its list through the model (every venue type) and lands on /venue/<id> (08-O3 fix 2)",
  },
  {
    id: "till-iphone-one-modal-per-presenter",
    file: `${BIZ}/src/components/venue/till/TillScreen.tsx`,
    contains: [
      "const nestInBasket = basketSheetsNest(layout, Platform.OS);",
      "{nestInBasket ? null : basketLaunchedSheets}",
      'onClose={closeBasket} snapPoint={0.9} testID="till-basket-sheet"',
      "onPick={openCheckSheet}",
      "onDismissed={checkActionsGone}",
      'snapPoint={0.6} onDismissed={onDismissed} testID="till-check-actions-sheet"',
    ],
    matches: [
      /testID="till-basket-sheet">\s*<View style=\{styles\.sheetPad\}>\{basket\}<\/View>[\s\S]{0,600}\{nestInBasket \? basketLaunchedSheets : null\}\s*\{refundIn === "basket" \? refundSheet : null\}\s*<\/Sheet>/,
      /const basketLaunchedSheets = \(\s*<>\s*<PaymentSheet[\s\S]*?<NameSheet[\s\S]*?<VoidSheet[\s\S]*?<CheckActionsSheet[\s\S]*?<MoveSheet[\s\S]*?<HandoverSheet[\s\S]*?<LineRefundSheet[\s\S]*?<\/>\s*\);/,
    ],
    absentMatches: [/<PaymentSheet[\s\S]*<PaymentSheet/, /<RefundSheet[\s\S]*<RefundSheet/, /onPick=\{\(next\) => setCheckSheet\(next\)\}/],
    why: "on an iPhone the sheets the basket opens present from the basket's own modal, and Move / Hand over / Rename open only once the actions sheet has gone: iOS refuses a second modal from one presenter (O3-S1)",
  },
  // #4490 08-O4: the split is a step INSIDE the one pay sheet (never a second
  // native sheet); a share payment carries its share and its own request id;
  // the session and seat sheets open from the catalog, never from the basket.
  {
    id: "till-split-inside-pay-sheet",
    file: `${BIZ}/src/components/venue/till/PaymentSheet.tsx`,
    contains: [
      "<SplitSheet",
      "shareId: share?.id ?? null,",
      "tillAttemptKey({ method, amountMinor: payAmount, tipMinor, cashGivenMinor, shareId: share?.id ?? null })",
      "tillAttemptKey({ method, tipMinor, shareId: share?.id ?? null })",
    ],
    matches: [/\} else if \(step === "split"\) \{\s*body = \(\s*<SplitSheet/],
    absentMatches: [/<Sheet[\s\S]*<Sheet\b/],
    why: "the split sheet is a step of the pay sheet and each share payment is its own attempt with its shareId (08-O4)",
  },
  {
    id: "till-split-sheet-no-modal",
    file: `${BIZ}/src/components/venue/till/SplitSheet.tsx`,
    // 08-O5 fix 4: the buttons go through submit(), which calls onSetSplit and then shows the server's shares.
    contains: ["export function SplitSheet(", "submit({ mode: \"by_item\", shares: byItemPayload(units, assign) })", "void onSetSplit(split);"],
    absentMatches: [/<Sheet\b/, /\bModal\b/, /amountMinor: (evenAmounts|itemAmounts)/],
    why: "the split step presents no native sheet of its own and sends units or a head count, never an amount (08-O4)",
  },
  {
    id: "till-o4-sheets-outside-basket",
    file: `${BIZ}/src/components/venue/till/TillScreen.tsx`,
    contains: ["<SessionSheet\n        offer={sessionFor}", "<SeatSheet\n        table={seatFor}"],
    absentMatches: [
      /const basketLaunchedSheets = \(\s*<>(?:(?!<\/>\s*\);)[\s\S])*<(SessionSheet|SeatSheet)/,
      /<SessionSheet\n[\s\S]*<SessionSheet\n/,
      /<SeatSheet\n[\s\S]*<SeatSheet\n/,
    ],
    why: "Start a session and Seat open from the catalog at the screen root, one sheet at a time (08-O3 fix 3 rule, 08-O4)",
  },
  {
    id: "till-hears-station-changes",
    file: `${BIZ}/src/hooks/useVenueTill.ts`,
    matches: [/table: "venue_orders", filter: `venue_id=eq\.\$\{venueId\}`/],
    why: "the Till hears station changes on venue_orders (§11 T6)",
  },
  {
    id: "stations-shell-routing-venue",
    file: `${BIZ}/src/components/venue/VenueSuiteShell.tsx`,
    contains: [
      'import { stationHref, StationsLauncher } from "./station/StationsLauncher";',
      "stationsDeepLinkRef",
      "venueAccess.canKitchen === true",
    ],
    matches: [/=== "stations"[\s\S]{0,80}push\(stationHref\(venueId\)/],
    absentMatches: [/StationScreen/],
    why: "the venue shell opens the station route from the rail and ?module=stations, with a static launcher (O3 A2)",
  },
  {
    id: "stations-shell-routing-stay",
    file: `${BIZ}/src/components/stay/StaySuiteShell.tsx`,
    contains: [
      'import { stationHref, StationsLauncher } from "../venue/station/StationsLauncher";',
      "stationsDeepLinkRef",
      "venueAccess.canKitchen === true",
    ],
    matches: [/=== "stations"[\s\S]{0,80}push\(stationHref\(venueId\)/],
    absentMatches: [/StationScreen/],
    why: "the Stay shell opens the station route from the rail and ?module=stations, with a static launcher (O3 A2)",
  },
  // tillRequestIds (08-O3 fix 4, O3-S2): venue-till refuses a clientRequestId that
  // is not a UUID, and randomId() is not one on Hermes, so every Till payment and
  // refund id is made with randomUuid() (newTillRequestId), never randomId().
  {
    id: "till-request-id-maker",
    file: `${BIZ}/src/components/venue/till/tillPayModel.ts`,
    contains: ['import { randomUuid } from "../../../utils/randomId";', "export const newTillRequestId = (): string => randomUuid();"],
    absentMatches: [/newTillRequestId = \(\): string => randomId\(/],
    why: "the Till's one request-id maker returns a UUID on every engine (O3-S2)",
  },
  {
    id: "till-pay-sheet-request-id",
    file: `${BIZ}/src/components/venue/till/PaymentSheet.tsx`,
    // TEST-MOD-APPROVED #4490 (08-O3 fix 5): the sheet's one id per opening became
    // one id per attempt (tillAttemptFor, whose maker is newTillRequestId).
    contains: [
      "const attempt = useRef<TillAttempt | null>(null);",
      "clientRequestId: current.id,",
    ],
    absent: ['from "../../../utils/randomId"'],
    absentMatches: [/clientRequestId: randomId\(/, /requestId\.current/],
    why: "pay_cash, pay_own_machine, pay_code_create and pay_tap_start send a UUID clientRequestId (O3-S2), one per attempt (O3-S3)",
  },
  {
    id: "till-screen-refund-request-ids",
    file: `${BIZ}/src/components/venue/till/TillScreen.tsx`,
    // TEST-MOD-APPROVED #4490 (08-O3 fix 5): one id per refund attempt.
    contains: [
      "reason, clientRequestId: current.id });",
      "clientRequestId: current.id,",
      "const refundAttempt = useRef<TillAttempt | null>(null);",
    ],
    absentMatches: [/clientRequestId: randomId\(/],
    why: "both refund forms send a UUID clientRequestId (O3-S2), one per refund attempt (O3-S3)",
  },
  // 08-O3 fix 5 (O3-S3): a part payment's id never pays the rest; the attempt id
  // comes from the one UUID maker; the paid step shows the server's amount.
  {
    id: "till-attempt-ids",
    file: `${BIZ}/src/components/venue/till/tillPayModel.ts`,
    contains: [
      "makeId: () => string = newTillRequestId",
      'export const tillAttemptKeepsId = (code: string): boolean => code === "network" || code === "till_failed";',
    ],
    why: "every Till payment and refund attempt gets its own UUID; only an unclear failure keeps it for the retry",
  },
  {
    id: "till-pay-rest-new-attempt",
    file: `${BIZ}/src/components/venue/till/PaymentSheet.tsx`,
    contains: [
      "onPress={payRest} testID=\"till-pay-rest\"",
      "const payRest = (): void => {",
      "amountMinor: recordedPaidMinor(paid)",
    ],
    matches: [/const payRest = \(\): void => \{\s*attempt\.current = null;\s*setAmountMinor\(null\);/],
    absentMatches: [/amountMinor: payAmount, changeMinor/],
    why: "\"Pay <rest>\" is a new payment with a new request id, and the paid step shows what the server recorded (O3-S3)",
  },
  {
    id: "venue-till-recorded-payment",
    file: "supabase/functions/venue-till/index.ts",
    contains: ['"till_request_reused",', "amountMinor: facts.amountMinor,"],
    why: "venue-till answers a payment with the amount the server recorded and maps a reused request id to its own words (O3-S3)",
  },
  {
    id: "till-tap-request-ids",
    file: `${BIZ}/src/components/venue/till/TillTapPanel.tsx`,
    contains: ["clientRequestId: randomUuid(),"],
    absentMatches: [/clientRequestId: randomId\(/],
    why: "door-tap-intent's till scope gets a UUID clientRequestId (its isUuid rule)",
  },
  {
    id: "door-tap-flow-request-id",
    file: `${BIZ}/src/services/terminal/tapToPayFlow.ts`,
    contains: ["this.clientRequestId = randomUuid();"],
    absentMatches: [/clientRequestId = randomId\(/],
    why: "a fresh tap attempt's clientRequestId is a UUID (door_tap_intents.client_request_id is uuid)",
  },
  {
    id: "venue-till-request-id-rule",
    file: "supabase/functions/venue-till/index.ts",
    contains: ["const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;"],
    matches: [/(!UUID\.test\(requestId\)[\s\S]*){4}/],
    why: "venue-till keeps refusing a non-UUID clientRequestId (the rule is right; the client was wrong)",
  },
  {
    id: "till-request-id-proof-mirrors-server",
    file: `${BIZ}/src/components/venue/till/__tests__/tillRequestIds.issue4490.o3fix4.render.test.tsx`,
    contains: ["const SERVER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;"],
    why: "the no-crypto render proof checks the exact pattern venue-till enforces",
  },
  // #4490 08-O5 part A: the step-up PIN pad renders INSIDE the sheet that asked
  // (void, refund, line refund), never as a second native sheet; the Till
  // route opens through the gate that shows Who's selling on a Till device;
  // the PIN session lives in memory only and is cleared on sign-out.
  {
    id: "till-step-up-inside-its-sheet",
    file: `${BIZ}/src/components/venue/till/TillScreen.tsx`,
    contains: [
      'import { TillStepUpHost, useStepUpSheet } from "./TillStepUp";',
      // 08-O5 fix 6: while the pad shows, swipe, back and Close cancel it like
      // Cancel (the waiting refund never locks the sheet).
      '<Sheet visible={payment !== null} onClose={onClose} {...stepUpSheet.sheet} testID="till-refund">',
      '<Sheet visible={row !== null} onClose={onClose} {...stepUpSheet.sheet} testID="till-void">',
      '<Sheet visible={row !== null} onClose={onClose} {...stepUpSheet.sheet} testID="till-line-refund">',
    ],
    matches: [
      /testID="till-void">[\s\S]{0,400}<TillStepUpHost venueId=\{stepUp\.venueId\} approvers=\{stepUp\.approvers\}>\s*<SheetScrollLayout/,
      /testID="till-line-refund">[\s\S]{0,400}<TillStepUpHost venueId=\{stepUp\.venueId\} approvers=\{stepUp\.approvers\}>\s*<SheetScrollLayout/,
      /testID="till-refund">[\s\S]{0,400}<TillStepUpHost venueId=\{stepUp\.venueId\} approvers=\{stepUp\.approvers\}>\s*<SheetScrollLayout/,
    ],
    why: "the fresh-PIN prompt for a refund or a sent void shows inside the open sheet: iOS refuses a second modal from one presenter (08-O3 fix 3)",
  },
  {
    id: "till-step-up-host-has-no-sheet",
    file: `${BIZ}/src/components/venue/till/TillStepUp.tsx`,
    contains: [
      // 08-O5 fix 5: the sheet's body stays mounted (hidden) under the pad, so a
      // refusal after the PIN is shown; the host leaving mid-PIN cancels it.
      '<View style={showing ? styles.hidden : styles.fill} testID="till-step-up-content">{children}</View>',
      "if (showingRef.current) answerStepUp(null);",
    ],
    absent: ["<Sheet", "<Modal", "ConfirmDialog"],
    why: "the step-up pad shows inside the sheet's own body (kept mounted, hidden, so what asked can still answer in words); it never opens a sheet or modal of its own, and never leaves a step-up hanging when its sheet closes",
  },
  {
    id: "till-route-opens-through-the-pin-gate",
    // The route's screen moved into the Host venue owner (the route file is a
    // thin shell rendering LazyVenueTillRoute): the pin follows it.
    file: `${BIZ}/src/components/venue/host/venueHostRoutes.tsx`,
    contains: ["<TillGate venueId={venueId}"],
    absent: ["<TillScreen "],
    why: "a Till device login must open on Who's selling (spec 08 §3 O5), every other account on the Till as before",
  },
  {
    id: "till-pin-session-memory-only",
    file: `${BIZ}/src/services/tillStaffSession.ts`,
    contains: ["registerSignOutCleanup(clearAllTillStaffSessions);", "let state: State = { sessions: {}, ended: {}, stepUp: null };"],
    absentMatches: [/from "@react-native-async-storage/, /\blocalStorage\./, /\bsessionStorage\./, /expo-secure-store/, /zustand\/middleware/],
    why: "the PIN session token lives in memory only and sign-out clears it (Constitution 5, 6, 14; spec 08 §3 O5)",
  },
  // #4490 08-O5 fix 2 (carried 1): a Till device login has no Orders screen, so
  // the Till carries "Sold out after payment": its banner and ONE sheet, whose
  // card (Swap item / Refund, the PIN asked again) renders inside that sheet.
  {
    id: "till-gate-carries-the-sold-out-slot",
    file: `${BIZ}/src/components/venue/till/TillGate.tsx`,
    matches: [
      /<TillScreen venueId=\{venueId\} \{\.\.\.screenProps\} soldOutSlot=\{<TillSoldOutHost venueId=\{venueId\} \/>\} \/>/,
      /stepUpApprovers=\{approvers\(staff\.people\)\}\s*soldOutSlot=\{<TillSoldOutHost venueId=\{venueId\} \/>\}/,
    ],
    why: "both Till entries (a plain account and a Till device in a PIN session) show guest orders that sold out after payment",
  },
  // #4490 08-O5 fix 2 (O5-B1): your own Team row opens your own Till PIN; the
  // sheet on it is read-only (no role, access or remove control).
  {
    id: "team-own-row-opens-your-till-pin",
    file: `${BIZ}/app/brand/[id]/team.tsx`,
    contains: [
      "if (!rowTappable(entry, tillReleased)) return;",
      'isSelf={detailEntry?.status === "self"}',
      "showSelfRowAboveEmpty(acceptedEntries, tillReleased)",
    ],
    absent: ['if (entry.status === "self") return;'],
    why: "no member could set their own Till PIN while the Team screen ignored taps on your own row",
  },
  {
    id: "member-sheet-own-row-is-read-only",
    file: `${BIZ}/src/components/team/MemberDetailSheet.tsx`,
    contains: ['entry.role === "venue_staff" && !isSelf', "(isPending || isAccepted) && !isSelf", "own={isSelf}"],
    why: "your own row shows only your Till PIN: you cannot change your own role, venue access or remove yourself from this sheet",
  },
  {
    id: "till-sold-out-one-sheet",
    file: `${BIZ}/src/components/venue/till/TillSoldOut.tsx`,
    contains: ['testID="till-sold-out-sheet"', "<OrderSoldOutSection venueId={venueId} orderId={row.orderId} currency={row.currency} />"],
    absent: ["<Modal", "ConfirmDialog"],
    absentMatches: [/<Sheet[\s\S]*<Sheet /],
    why: "the sold-out list is one native sheet; the swap list, refund confirm and PIN pad render inside it (iOS: one modal per presenter)",
  },
  {
    id: "who-is-selling-no-sheet",
    file: `${BIZ}/src/components/venue/till/WhoIsSelling.tsx`,
    contains: ['testID="till-who"'],
    absent: ["<Sheet", "<Modal", "ConfirmDialog"],
    why: "Who's selling and its PIN pad are full-screen content of the Till route, never a native sheet",
  },
  // #4490 08-O5 part B: Close the day has ONE sheet (count, drawer and reopen
  // are its modes); the reopen PIN shows inside it; the parts it renders
  // open no sheet of their own; the route opens through the PIN gate; a close
  // and a drawer save keep one request id while retried; Account's sign-out
  // on a Till device goes through the Till's own sign-out step.
  {
    id: "day-close-one-sheet",
    file: `${BIZ}/src/components/venue/close/DayCloseScreen.tsx`,
    contains: ['testID="day-close-sheet"', 'sheet?.kind === "count"', 'sheet?.kind === "drawer"', 'sheet?.kind === "reopen"'],
    absentMatches: [/<Sheet[\s>][\s\S]*<Sheet[\s>]/, /<Modal\b/, /ConfirmDialog/],
    why: "iOS refuses a second native modal from one presenter (08-O3 fix 3): count, drawer and reopen are modes of one Sheet",
  },
  {
    id: "day-close-reopen-pin-inside-its-sheet",
    file: `${BIZ}/src/components/venue/close/DayCloseReopen.tsx`,
    contains: ["<TillStepUpHost venueId={venueId} approvers={approvers}>{form}</TillStepUpHost>"],
    absentMatches: [/<Sheet[\s>]/, /<Modal\b/, /ConfirmDialog/],
    why: "the fresh PIN for a reopen shows inside the reopen sheet, never as a second sheet",
  },
  ...["DayCloseCount", "DayCloseDrawer", "DayCloseDone", "DayCloseChecks", "DayCloseTotals", "DayCloseLate"].map((name) => ({
    id: `day-close-part-${name}-has-no-sheet`,
    file: `${BIZ}/src/components/venue/close/${name}.tsx`,
    contains: [`export function ${name}(`],
    absentMatches: [/<Sheet[\s>]/, /<Modal\b/, /ConfirmDialog/],
    why: "a part of Close the day renders inside the screen or its one sheet and opens no native modal of its own",
  })),
  {
    id: "close-route-opens-through-the-pin-gate",
    // Moved with the Till route into the Host venue owner (see above).
    file: `${BIZ}/src/components/venue/host/venueHostRoutes.tsx`,
    contains: ["<DayCloseGate venueId={venueId} />"],
    absent: ["<DayCloseScreen "],
    why: "on a Till device login Close the day acts only as the person switched in with a PIN (spec 08 §3 O5)",
  },
  {
    id: "day-close-request-ids",
    file: `${BIZ}/src/components/venue/close/DayCloseScreen.tsx`,
    contains: ["closeAttempt.current = { key, id: newTillRequestId() };", "clientRequestId: closeAttempt.current.id"],
    why: "a retried close carries the same request id, so the server answers the close it already made",
  },
  {
    id: "day-close-drawer-request-ids",
    file: `${BIZ}/src/components/venue/close/DayCloseDrawer.tsx`,
    contains: ["attempt.current = { key, id: newTillRequestId() };"],
    why: "a retried float or paid out records nothing twice",
  },
  {
    id: "account-sign-out-till-device",
    file: `${BIZ}/app/(tabs)/account.tsx`,
    contains: ['await import("../../src/services/tillDeviceSignOut")', "router.push(tillSignOut as never);"],
    absentMatches: [/^import [^\n]*tillDeviceSignOut/m],
    why: "a shared Till login signs out only with a manager's PIN or its own email code (spec 08 §12 item 5), loaded on use",
  },
];

/**
 * Every code the venue-till edge can answer: its TILL_SAFE_CODES list, every
 * literal `code: "…"`, and the one rewritten code. Fails closed: an
 * unreadable list resolves to an unresolvable line.
 */
function tillServerCodes() {
  const edge = fs.readFileSync(path.join(ROOT, "supabase/functions/venue-till/index.ts"), "utf8");
  const list = edge.match(/export const TILL_SAFE_CODES = \[([\s\S]*?)\] as const;/);
  if (list === null) return ["null; TILL_SAFE_CODES not found in venue-till/index.ts"];
  const fromList = [...list[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const literal = [...edge.matchAll(/code: "([a-z_]+)"/g)].map((m) => m[1]);
  const rewritten = [...edge.matchAll(/code: f\.code === "[a-z_]+"\s*\?\s*"([a-z_]+)"\s*:\s*"([a-z_]+)"/g)]
    .flatMap((m) => [m[1], m[2]]);
  const codes = [...new Set([...fromList, ...literal, ...rewritten])].sort();
  if (codes.length <= 50 || !["till_amount_over_due", "till_check_changed", "till_item_not_orderable"].every((c) => codes.includes(c))) {
    return [`null; only ${codes.length} codes read from venue-till/index.ts`];
  }
  return codes;
}

function check(pin, source) {
  const problems = [];
  const text = pin.slice !== undefined ? source.slice(Math.max(0, source.indexOf(pin.slice))) : source;
  if (pin.slice !== undefined && source.indexOf(pin.slice) < 0) problems.push(`missing anchor ${JSON.stringify(pin.slice)}`);
  const contains = typeof pin.contains === "function" ? pin.contains() : pin.contains ?? [];
  for (const needle of contains) {
    if (typeof needle !== "string" || needle.includes("null;")) problems.push(`could not resolve a required line (${needle})`);
    else if (!text.includes(needle)) problems.push(`missing ${JSON.stringify(needle)}`);
  }
  for (const re of pin.matches ?? []) if (!re.test(text)) problems.push(`missing match ${re}`);
  for (const needle of pin.absent ?? []) if (text.includes(needle)) problems.push(`must not contain ${JSON.stringify(needle)}`);
  for (const re of pin.absentMatches ?? []) if (re.test(text)) problems.push(`must not match ${re}`);
  return problems;
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function run() {
  const failures = [];
  for (const pin of PINS) {
    let source;
    try {
      source = read(pin.file);
    } catch {
      failures.push(`${pin.id}: ${pin.file} is missing`);
      continue;
    }
    for (const problem of check(pin, source)) failures.push(`${pin.id} (${pin.file}): ${problem} — ${pin.why}`);
  }
  return failures;
}

function selfTest() {
  let caught = 0;
  const misses = [];
  for (const pin of PINS) {
    const source = read(pin.file);
    if (check(pin, source).length !== 0) misses.push(`${pin.id}: real tree is not green`);
    // Break the pin: drop its first required line, or add a forbidden one.
    const contains = typeof pin.contains === "function" ? pin.contains() : pin.contains ?? [];
    let broken = null;
    if (contains.length > 0) broken = source.split(contains[0]).join("");
    else if ((pin.matches ?? []).length > 0) broken = source.replace(pin.matches[0], "");
    else if ((pin.absent ?? []).length > 0) broken = `${source}\n${pin.absent[0]}\n`;
    if (broken === null || check(pin, broken).length === 0) misses.push(`${pin.id}: a broken copy was not caught`);
    else caught += 1;
  }
  // The token resolver must fail closed on an unknown token.
  if (designTokenHex("no_such_token") !== null) misses.push("an unknown design token resolved");
  if (misses.length > 0) {
    console.error(`issue-4490-host-wiring self-test FAIL:\n  ${misses.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`issue-4490-host-wiring self-test PASS (${caught}/${PINS.length} pins break red, unknown token fails closed)`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = run();
  if (failures.length > 0) {
    console.error(`issue-4490-host-wiring FAIL (${failures.length}):\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`issue-4490-host-wiring PASS: ${PINS.length} Host and buyer web wiring pins hold`);
}
