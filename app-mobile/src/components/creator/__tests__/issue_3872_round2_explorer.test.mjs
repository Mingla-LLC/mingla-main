import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// #3872 round 2 (Explorer). Runs under `node --experimental-strip-types --test`.
// Fails before the round-2 build: programNav.ts and creatorProgramMapping.ts did
// not exist, setup steps `router.replace`d (Back skipped the checklist), the
// profile step sent the paid-ads toggle (default off), the contract card said
// "Next · due nov 25" after release, and money_state was never read.
import {
  SETUP_CHECKLIST_HREF,
  isSetupStepPath,
  nextSetupNav,
  programBackNav,
  programFallbackHref,
  runProgramNav,
} from "../../programs/programNav.ts";
import {
  PAID_ADS_NOTICE,
  cityHint,
  cityOptions,
  homeCityFrom,
  homeCityFromSetResult,
  homeCitySetParams,
  notLiveNotice,
  profileCityId,
  profileSaveParams,
} from "../../../services/creatorProgramMapping.ts";
import {
  contractCardLabel,
  contractMoneyLine,
  releasedCardText,
} from "../../../utils/programFormat.ts";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// ── W5.3 navigation ────────────────────────────────────────────────────────

test("W5.3 Continue pushes the next setup step and never replaces", () => {
  assert.deepEqual(nextSetupNav("rates"), { kind: "push", href: "/creator/setup/rates" });
  assert.deepEqual(nextSetupNav(null), { kind: "dismissTo", href: SETUP_CHECKLIST_HREF });
  assert.deepEqual(nextSetupNav("bogus"), { kind: "dismissTo", href: SETUP_CHECKLIST_HREF });
  const setupNav = read("src/components/creator/setupNav.ts");
  assert.doesNotMatch(setupNav, /router\.replace\(/, "setupNav must not replace (it dropped the checklist)");
  assert.match(setupNav, /runProgramNav\(router, nextSetupNav\(next\)\)/);
});

test("W5.3 Back on a setup step returns to the checklist; other screens fall back sensibly", () => {
  for (const step of ["profile", "rates", "showcase", "socials", "payout", "agreement"]) {
    assert.ok(isSetupStepPath(`/creator/setup/${step}`));
    assert.deepEqual(programBackNav(`/creator/setup/${step}`, true), { kind: "dismissTo", href: "/creator/setup" });
    assert.deepEqual(programBackNav(`/creator/setup/${step}/`, false), { kind: "dismissTo", href: "/creator/setup" });
  }
  assert.equal(isSetupStepPath("/creator/setup"), false);
  assert.deepEqual(programBackNav("/creator/setup", true), { kind: "back" });
  assert.deepEqual(programBackNav("/creator/setup", false), { kind: "replace", href: "/creator" });
  assert.deepEqual(programBackNav("/creator/contract/abc", false), { kind: "replace", href: "/creator" });
  assert.equal(programFallbackHref("/local/review"), "/");
  assert.equal(programFallbackHref(null), "/");
});

test("W5.3 runProgramNav calls the matching router method (dismissTo falls back to replace)", () => {
  const calls = [];
  const router = {
    back: () => calls.push(["back"]), push: (h) => calls.push(["push", h]),
    replace: (h) => calls.push(["replace", h]), dismissTo: (h) => calls.push(["dismissTo", h]),
  };
  runProgramNav(router, { kind: "push", href: "/creator/setup/rates" });
  runProgramNav(router, { kind: "dismissTo", href: "/creator/setup" });
  runProgramNav(router, { kind: "back" });
  runProgramNav({ ...router, dismissTo: undefined }, { kind: "dismissTo", href: "/creator/setup" });
  assert.deepEqual(calls, [["push", "/creator/setup/rates"], ["dismissTo", "/creator/setup"], ["back"], ["replace", "/creator/setup"]]);
});

// ── W2.1 paid ads ──────────────────────────────────────────────────────────

test("W2.1 the profile payload always opts into paid ads, and the toggle is gone", () => {
  const params = profileSaveParams({ displayName: "  Ada Films ", bio: " hi ", niches: ["food"], languages: ["English"], usageAdsOptIn: false });
  assert.equal(params.p_usage_ads_opt_in, true);
  assert.equal(params.p_display_name, "Ada Films");
  assert.equal(params.p_home_city_id, null);
  assert.equal(PAID_ADS_NOTICE, "Hosts can use your videos in their paid ads. This is part of every Mingla gig.");
  const profile = read("app/creator/setup/profile.tsx");
  assert.doesNotMatch(profile, /ToggleRow|adsOptIn|Off means organic posts only/);
  assert.match(profile, /<ProgramNotice text=\{PAID_ADS_NOTICE\} \/>/);
  const service = read("src/services/creatorProgramService.ts");
  assert.match(service, /programWrite\('creator_profile_save', profileSaveParams\(input\)\)/);
  assert.doesNotMatch(service, /usageAdsOptIn/);
});

// ── W5.2 home city ─────────────────────────────────────────────────────────

const rows = [
  { city_id: null, name: "Accra", region: null, country_code: "gh", is_live: false },
  { city_id: "c-raleigh", name: "Raleigh", region: null, country_code: "US", is_live: true },
  { city_id: "c-durham", name: "Durham", region: null, country_code: "US", is_live: true },
  { city_id: "c-raleigh", name: "Raleigh", region: null, country_code: "US", is_live: true },
  { city_id: null, name: "  ", country_code: "US", is_live: false },
  "junk",
];

test("W5.2 search rows: live cities first by name, then the rest; duplicates and blanks dropped", () => {
  const options = cityOptions(rows);
  assert.deepEqual(options.map((o) => [o.name, o.isLive]), [["Durham", true], ["Raleigh", true], ["Accra", false]]);
  assert.equal(options[2].countryCode, "GH");
  assert.equal(options[2].id, null);
  assert.equal(cityHint(options[0]), "Live · US");
  assert.equal(cityHint(options[2]), "GH");
  assert.deepEqual(cityOptions(null), []);
  // A row claiming live without an id is not live.
  assert.equal(cityOptions([{ city_id: null, name: "Lagos", country_code: "NG", is_live: true }])[0].isLive, false);
});

test("W5.2 saving: live city by id, non-live by name + country; the notice names the city", () => {
  const [durham, , accra] = cityOptions(rows);
  assert.deepEqual(homeCitySetParams(durham), { p_city_id: "c-durham", p_name: null, p_country_code: null });
  assert.deepEqual(homeCitySetParams(accra), { p_city_id: null, p_name: "Accra", p_country_code: "GH" });
  assert.equal(profileCityId({ id: "c-durham", isLive: true }), "c-durham");
  assert.equal(profileCityId({ id: null, isLive: false }), null);
  assert.equal(profileCityId(null), null);
  assert.equal(notLiveNotice("Accra"), "Mingla isn’t live in Accra yet. Hosts there can’t hire you until we launch; we’ll tell you when we do.");
});

test("W5.2 home_city reads map to the screen shape", () => {
  assert.deepEqual(homeCityFrom({ id: "c1", name: "Raleigh", is_live: true }), { id: "c1", name: "Raleigh", isLive: true, countryCode: null });
  assert.deepEqual(homeCityFrom({ id: null, name: "Accra", is_live: false }), { id: null, name: "Accra", isLive: false, countryCode: null });
  assert.equal(homeCityFrom(null), null);
  assert.equal(homeCityFrom({ id: "c1", name: "" }), null);
  assert.deepEqual(homeCityFromSetResult({ ok: true, home_city: { id: null, name: "Accra", is_live: false } }), { id: null, name: "Accra", isLive: false, countryCode: null });
  const service = read("src/services/creatorProgramService.ts");
  assert.match(service, /programRead<unknown>\('creator_city_search', \{ p_query: q \}\)/);
  assert.match(service, /programWrite<unknown>\('creator_home_city_set', homeCitySetParams\(option\)\)/);
  assert.match(service, /home_city:creator_profile_home_city/);
});

// ── W3.1–W3.3 contract card ────────────────────────────────────────────────

const now = new Date(2026, 9, 26, 12, 0);

test("W3.1 the due date keeps its capital month", () => {
  assert.equal(contractCardLabel("script_drafting", "2026-11-25", now, "en-US"), "Next · due Nov 25");
  assert.equal(contractCardLabel("posting", null, now, "en-US"), "Next");
  const screen = read("app/creator/contract/[contractId].tsx");
  assert.doesNotMatch(screen, /toLowerCase\(\)/);
});

test("W3.2 after release the card is the day-30 check, not a creator Next", () => {
  assert.equal(contractCardLabel("released", "2026-11-25", now, "en-US"), "Day-30 check · Nov 25");
  assert.equal(contractCardLabel("day30", null, now, "en-US"), "Day-30 check");
  assert.equal(contractCardLabel("completed", "2026-11-25", now, "en-US"), "Done");
});

test("W3.3 money words come from money_state; paid names the date; null says nothing", () => {
  assert.equal(contractMoneyLine("paid", "2026-11-27T15:00:00Z", now, "en-US"), "Paid to your bank on Nov 27");
  assert.equal(contractMoneyLine("paid", null, now, "en-US"), "Paid to your bank");
  assert.equal(contractMoneyLine("ready", null, now), "Released and on its way to your bank");
  assert.equal(contractMoneyLine("on_the_way", null, now), "On its way to your bank");
  assert.equal(contractMoneyLine(null, null, now), "");
  assert.equal(releasedCardText("released", "paid", "2026-11-27T15:00:00Z", now, "en-US"), "Paid to your bank on Nov 27. Keep the posts live for 30 days.");
  assert.equal(releasedCardText("released", null, null, now), "Keep the posts live for 30 days.");
  assert.doesNotMatch(releasedCardText("released", "ready", null, now), /Paid/);
  const screen = read("app/creator/contract/[contractId].tsx");
  assert.match(screen, /releasedCardText\(state, w\.money_state, w\.money_paid_at\)/);
  assert.match(screen, /contractCardLabel\(state, due\)/);
});

// ── W2.2 / W5.1 / keyboard rule (source contracts) ─────────────────────────

test("W2.2 ProgramScreen pads the top inset itself and the scroll view adds none", () => {
  const ui = read("src/components/programs/ProgramUi.tsx");
  const screen = ui.slice(ui.indexOf("export function ProgramScreen"), ui.indexOf("// ── Cards"));
  assert.doesNotMatch(screen, /<SafeAreaView\b/);
  assert.match(screen, /paddingTop: insets\.top/);
  assert.match(screen, /automaticallyAdjustContentInsets=\{false\}/);
  assert.match(screen, /contentInsetAdjustmentBehavior="never"/);
});

test("keyboard rule: focused field scrolls above the keyboard and the footer hides while typing", () => {
  const ui = read("src/components/programs/ProgramUi.tsx");
  const screen = ui.slice(ui.indexOf("export function ProgramScreen"), ui.indexOf("// ── Cards"));
  assert.match(screen, /<KeyboardAwareScrollView\b/);
  assert.match(screen, /const showFooter = Boolean\(footer\) && !typing/);
});

test("W5.1 program sheets stop below the top safe area and keep search fixed above the list", () => {
  const ui = read("src/components/programs/ProgramUi.tsx");
  assert.match(ui, /topInset=\{sheetTopInset\(insets\.top\)\}/);
  const base = read("src/components/ui/BaseBottomSheet.tsx");
  assert.match(base, /topInset = 0,/);
  assert.match(base, /topInset=\{topInset\}/);
  const pickers = read("src/components/programs/ProgramPickers.tsx");
  assert.match(pickers, /subheader=\{searchable \? <SearchInput/);
  const city = read("src/components/creator/HomeCityField.tsx");
  assert.match(city, /subheader=\{<SearchInput/);
  assert.match(city, /notLiveNotice\(value\.name\)/);
});
