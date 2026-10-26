// Issue #3980 Wave 2 — the Calendar and host sync in Mingla Admin: the layer
// words and URL, the runway words for every band, the launch kit chips, the
// runway bar, the one caller of the new ops_* functions, and the layout and
// word rules of the Calendar panel and the host card's On Mingla section.
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CALENDAR_LAYERS,
  bandShort,
  buildLayers,
  kitStateChip,
  parseEventParam,
  parseLayers,
  runwayBarModel,
  runwayLabel,
} from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);
const read = (relative: string) => Deno.readTextFileSync(new URL(relative, SRC));

Deno.test("#3980 W2 five Calendar layers, in order, all on unless the address says otherwise", () => {
  assertEquals(CALENDAR_LAYERS.map((l) => l.label), ["On Mingla", "Expected", "Go-live deadlines", "Promotions", "Content"]);
  const all = { live: true, exp: true, dead: true, promo: true, content: true };
  assertEquals(parseLayers(null), all);
  assertEquals(parseLayers(""), all);
  assertEquals(parseLayers("nonsense"), all);
  assertEquals(parseLayers("live,promo"), { live: true, exp: false, dead: false, promo: true, content: false });
  assertEquals(parseLayers("none"), { live: false, exp: false, dead: false, promo: false, content: false });
  assertEquals(buildLayers(all), null);
  assertEquals(buildLayers({ ...all, content: false }), "live,exp,dead,promo");
  assertEquals(buildLayers({}), "none");
});

Deno.test("#3980 W2 runway words for every band", () => {
  // [TEST-MOD-APPROVED #3980] synced Wave 3 rework (D10): the four plain states replace full launch, tight, organic only and missed.
  assertEquals(bandShort({ band: "full" }), "Ready to promote");
  assertEquals(bandShort({ band: "tight" }), "Promote now");
  assertEquals(bandShort({ band: "organic" }), "Too late for promo");
  assertEquals(bandShort({ band: "not_live", go_live_by: "2026-11-01" }), "Not live yet, live by 1 Nov");
  assertEquals(bandShort({ band: "missed" }), "Too late for promo");
  assertEquals(bandShort({ band: "no_date" }), "No date yet");
  // [TEST-MOD-APPROVED #3980] synced Wave 3 rework (D10): the Work card's runway line uses the four plain states.
  assertEquals(runwayLabel({ band: "full", lead_days: 30 }), "Ready to promote · live 30 days ahead");
  assertEquals(runwayLabel({ band: "not_live", go_live_by: "2026-11-01" }), "Not live yet · go live by 1 Nov");
});

Deno.test("#3980 W2 the selected event lives in the address", () => {
  const id = "39800000-0000-4000-b400-000000000001";
  assertEquals(parseEventParam(`event:${id}`), { kind: "event", id });
  assertEquals(parseEventParam(`expected:${id}`), { kind: "expected", id });
  assertEquals(parseEventParam(`card:${id}`), null);
  assertEquals(parseEventParam("event:not-a-uuid"), null);
  assertEquals(parseEventParam(null), null);
});

Deno.test("#3980 W2 launch kit chips say what is true", () => {
  assertEquals(kitStateChip({ state: "card", card: { status: "doing" } }), { label: "Doing", tone: "brand" });
  assertEquals(kitStateChip({ state: "card", card: { status: "person" } }), { label: "Needs a person", tone: "warning" });
  assertEquals(kitStateChip({ state: "card", card: { status: "todo", blocked: true } }), { label: "Blocked", tone: "error" });
  assertEquals(kitStateChip({ state: "done", card: { status: "done" } }), { label: "Done", tone: "success" });
  assertEquals(kitStateChip({ state: "done" }), { label: "Done", tone: "success" });
  assertEquals(kitStateChip({ state: "not_eligible" }), { label: "Not eligible", tone: "error" });
  assertEquals(kitStateChip({ state: "passed" }), { label: "Passed", tone: "default" });
  assertEquals(kitStateChip({ state: "no_card" }), { label: "No card", tone: "default" });
});

Deno.test("#3980 W2 the runway bar runs from 42 days before to 2 days after", () => {
  const bar = runwayBarModel(
    { start_on: "2026-12-14", is_public: true, published_at: "2026-11-02T10:00:00Z", runway: { band: "full" } },
    "2026-11-20",
  )!;
  const at = Object.fromEntries(bar.ticks.map((t) => [t.key, Math.round(t.at! * 10) / 10]));
  assertEquals(at, { live: 31.8, promo: 47.7, event: 95.5, today: 40.9 });
  assertEquals(bar.fill!.tone, "success");
  assertEquals(Math.round(bar.fill!.left * 10) / 10, 0);
  assertEquals(runwayBarModel({ start_on: null }, "2026-11-20"), null);
  assertEquals(runwayBarModel({ start_on: "2026-12-14", is_public: false, runway: { band: "not_live" } }, "2026-11-20")!.fill, null);
});

Deno.test("#3980 W2 opsService stays the only caller, now for the Calendar and host cards too", () => {
  const service = read("services/opsService.js");
  for (const fn of ["ops_calendar", "ops_runway_report", "ops_anchor_detail", "ops_host_on_mingla", "ops_expected_event_set"]) {
    assertMatch(service, new RegExp(`\\.rpc\\("${fn}"`));
  }
  for (const file of ["pages/ContentCalendarPage.jsx", "components/ops/EventPanel.jsx", "components/crm/OnMinglaSection.jsx", "hooks/useOpsCalendar.js"]) {
    assertNotMatch(read(file), /\.rpc\(/, file);
  }
});

Deno.test("#3980 W2 the Calendar: new title, layer chips, two columns, the panel, the legend; content views kept", () => {
  // [TEST-MOD-APPROVED #3980] synced Wave 3 (R6): month first with four plain states; Events | Posts | Both and
  // Month | List | Posts board replace the layers; the legend names the states;
  // the content views keep their address values.
  const page = read("pages/ContentCalendarPage.jsx");
  // #4130: the approved Calendar description (Event runway and Content tabs).
  assertMatch(page, /<PageHeader title="Calendar" description="Events that need promoting, and the posts we are making\."/);
  assertMatch(page, /<TwoColumn ref=\{eventDetailRef\} detailLabel="Event details" list=\{box\} detail=\{right\} \/>/);
  // #4130: the runway list is the Event runway table (RunwayTable), as designed.
  assertMatch(page, /<MonthGrid [\s\S]*<Legend [\s\S]*<RunwayTable [\s\S]*<PostsList /);
  assertMatch(page, /view: \["calendar", "board", "list"\]/);
  assertMatch(page, /<BoardView items=\{calendar\.items\}/);
  assertMatch(page, /md:hidden">Stage:/);
  assertMatch(page, /Nothing on this day\./);
  assertNotMatch(page, /ad_plans|ad_campaigns/);
  for (const words of ["Ready to promote", "Promote now", "Too late for promo", "Not live yet"]) assert(read("lib/opsModel.js").includes(words), words);
  const panel = read("components/ops/EventPanel.jsx");
  // [TEST-MOD-APPROVED #3980] synced Wave 3 rework (D9, conductor decision X5a): the runway list under the month is removed (List view holds it) and no Back to runway remains.
  assertNotMatch(panel, /Runway|Back to runway/);
  for (const words of ["Open host", "Back to the calendar", "Steps (made by themselves)"]) {
    assert(panel.includes(words) || read("components/ops/EventSteps.jsx").includes(words), words);
  }
  assertNotMatch(panel, /Plan this launch/);
});

Deno.test("#3980 W2 new ops components use tokens only and no overlay", () => {
  // [TEST-MOD-APPROVED #3980] synced Wave 3 rework 2: CalendarLayers.jsx was unused and is deleted, so it leaves this list.
  for (const file of ["components/ops/EventPanel.jsx", "components/ops/RunwayBar.jsx", "components/crm/OnMinglaSection.jsx"]) {
    const src = read(file);
    assertNotMatch(src, /bg-white|text-black|["'\s(]#[0-9a-fA-F]{6}\b/, file);
    assertNotMatch(src, /from "[^"]*(Modal|Drawer)"/, file);
    assertNotMatch(src, /\btruncate\b/, file);
  }
});

Deno.test("#3980 W2 the host card's On Mingla section: hosts only, its words, none of the banned ones", () => {
  const section = read("components/crm/OnMinglaSection.jsx");
  // [TEST-MOD-APPROVED #3980] synced Wave 3 (R1 host card, artifact hostCard()): the brand link words, upcoming dated
  // things with their state, Add their first|next|another event, Work on this host.
  for (const words of [
    "On Mingla",
    "Brand linked",
    "Not on Mingla yet",
    "When they sign up with this email, phone or handle, Mingla links the brand by itself.",
    "No upcoming event.",
    "Cancel this promised event",
    "Save. Steps and Calendar fill in by themselves",
    "Saved. It’s on the Calendar and its steps are in Work.",
    "Work on this host",
    "Nothing open.",
  ]) assert(section.includes(words), words);
  for (const banned of ["Drafts to send", "Draft, not sent", "@mention", "mention", "will get an email", "Getting started"]) {
    assert(!section.includes(banned), banned);
  }
  const drawer = read("components/crm/RecordDrawer.jsx");
  // [TEST-MOD-APPROVED #3980] synced Wave 3 (artifact hostCard()): On Mingla now opens the host card,
  // above its fields, with Assign to me and Fill in; hosts only.
  assertMatch(drawer, /\{isHosts && \(\s*<OnMinglaSection\s+key=\{`on-mingla-\$\{record\.id\}`\}\s+record=\{record\}/);
  assert(drawer.indexOf("<OnMinglaSection") < drawer.indexOf("<RecentTouchNotice"), "On Mingla comes before the touch notice");
});
