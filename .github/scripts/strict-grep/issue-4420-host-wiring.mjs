#!/usr/bin/env node
// MINGLA-INVARIANT: I-4420-HOST-WIRING | issue #4420 | The Graphite Glass redesign's structural wiring (which screen mounts which shared piece, which gate shows a pane, which strings the shared pickers carry) stays in place.
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
      /const furthestValidOrdinal = useMemo\(\(\): number => \{\s*const firstInvalid = visibleStepDefs\.findIndex\(\s*\(\{ index \}\) => validateStep\(index, liveDraft\)\.length > 0,/,
      /index === currentStep && showStepErrors \? stepErrors\[0\]\?\.message : undefined/,
      'state: "error" as const, firstError',
      'previousLabel={isFirstStep ? undefined : isWideDesktop ? "Back" : previousStepLabel ?? "Back"}',
      'return state.lastSavedAt !== null ? "Saved" : "Not saved yet";',
      /<StepperFooter\s+wide=\{isWideDesktop\}/,
      /backDisabled=\{\s*isLastStep\s*\?\s*checkingInvitePublish\s*:\s*currentStep === 6 && inviteNavigation\?\.phase !== "ready"\s*\}/,
      'continueTestID={isLastStep ? "event-wizard-publish" : "event-wizard-continue"}',
    ],
    lacks: ["Draft saved", /styles\.footer\b/],
  },
  {
    file: "src/components/event/EventCreatorWizard.tsx",
    why: "a step jump is guarded like the dock Back: not mid invite save, not during the publish re-read",
    from: "const handleStepPress",
    to: "// ---- Publish gate ----",
    has: ['if (currentStep === 6 && inviteNavigation?.phase !== "ready") return;', "if (checkingInvitePublish || isPublishing) return;", "setShowStepErrors(false);"],
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
  { file: "src/components/messages/webViewportPin.ts", why: "the pin reads the privacy inset", has: ["--mingla-privacy-inset"] },
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
];

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
  const files = { "a.ts": "const x = 1;\nexport const pageWrapperStyle = { bg: color.canvas };\nfoo();", "b.ts": "accent here" };
  const read = (f) => (f in files ? files[f] : null);
  const cases = [
    ["present string passes", { file: "a.ts", why: "w", has: ["const x = 1;"] }, 0],
    ["matching regex passes", { file: "a.ts", why: "w", has: [/foo\(\)/] }, 0],
    ["absent string fails", { file: "a.ts", why: "w", has: ["const y"] }, 1],
    ["forbidden regex fails", { file: "b.ts", why: "w", lacks: [/\baccent\b/] }, 1],
    ["missing file fails", { file: "gone.ts", why: "w", has: ["x"] }, 1],
    ["slice scopes the check", { file: "a.ts", why: "w", from: "export const pageWrapperStyle", to: "};", has: ["color.canvas"], lacks: ["foo()"] }, 0],
    ["missing slice marker fails", { file: "a.ts", why: "w", from: "export const nope", to: "};", has: ["x"] }, 1],
  ];
  const failures = cases.filter(([, rule, want]) => (checkRule(rule, read).length > 0 ? 1 : 0) !== want).map(([name]) => name);
  if (failures.length) {
    console.error(`#4420 host-wiring self-test FAIL: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log(`#4420 host-wiring self-test PASS (${cases.length} cases)`);
  process.exit(0);
}

const readBiz = (rel) => {
  const abs = path.join(BUSINESS, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
};
const problems = RULES.flatMap((rule) => checkRule(rule, readBiz));
if (problems.length) {
  console.error(`FAIL [I-4420-HOST-WIRING]: ${problems.length} wiring rule(s) broken:`);
  for (const p of problems) console.error(`  x ${p}`);
  process.exit(1);
}
console.log(`OK [I-4420-HOST-WIRING]: ${RULES.length} wiring rules hold.`);
