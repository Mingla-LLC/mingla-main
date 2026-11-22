#!/usr/bin/env node
// MINGLA-INVARIANT: I-4490-HOST-WIRING-PINS | issue #4490 | the Host and buyer web wiring that a model test cannot see (paid hire extras, the #4514 form seams, member codes at the door, the guest-list door sale and signed-out promoter page, the table deposit choices, the up-front experience save, the dark web preboot, the reserve sheet, the manage page time, the Calendar week, the Stay workspace layout) keeps its load-bearing lines.
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
    contains: ["%LANG_ISO_CODE%", "%WEB_TITLE%", "</head>"],
    matches: [/<div id="root">[\s\S]*mingla-preboot[\s\S]*Loading…[\s\S]*<\/div>/],
    why: "the Expo template placeholders and the readable loader inside #root stay",
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
  {
    id: "guest-list-door-sale",
    file: `${BIZ}/src/components/venue/features/checkin/VenueGateSale.tsx`,
    contains: [
      "offer.options.filter((o) => o.id === guestListSale.priceOptionId)",
      "{o.name} × {guestListSale.count}",
      "count: guestListSale.count",
    ],
    why: "the reduced-price door sale is locked to the configured option and party count",
  },
  {
    id: "guest-list-sale-action",
    file: `${BIZ}/src/services/venueOffersService.ts`,
    contains: ['action: "sell_guest_list"'],
    why: "the door sale uses the guest-list sale action",
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
];

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
