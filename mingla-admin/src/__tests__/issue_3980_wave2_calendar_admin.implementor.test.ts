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
  assertEquals(bandShort({ band: "full" }), "Full launch");
  assertEquals(bandShort({ band: "tight" }), "Tight");
  assertEquals(bandShort({ band: "organic" }), "Organic only");
  assertEquals(bandShort({ band: "not_live", go_live_by: "2026-11-01" }), "Go live by 1 Nov");
  assertEquals(bandShort({ band: "missed" }), "Missed");
  assertEquals(bandShort({ band: "no_date" }), "No date yet");
  assertEquals(runwayLabel({ band: "full", lead_days: 30 }), "Full launch · live 30 days ahead");
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
  const page = read("pages/ContentCalendarPage.jsx");
  assertMatch(page, /<PageHeader title="Calendar" description="What is on Mingla, what hosts have promised, and what we post and promote\."/);
  assertMatch(page, /<CalendarLayers layers=\{route\.layers\} onToggle=\{toggleLayer\} \/>/);
  assertMatch(page, /<TwoColumn ref=\{eventDetailRef\}[\s\S]*<CalendarView[\s\S]*extras=\{eventLayers\}[\s\S]*<RunwayLegend \/>[\s\S]*<EventPanel/);
  assertMatch(page, /view: \["calendar", "board", "list"\]/);
  assertMatch(page, /<CalendarView[\s\S]*<BoardView[\s\S]*<ListView/);
  assertMatch(page, /hidden overflow-x-auto[\s\S]*md:block/);
  assertMatch(page, /md:hidden">Stage:/);
  assertMatch(page, /Nothing scheduled\./);
  assertMatch(page, /"Go live: "|d\.label/);
  assertNotMatch(page, /ad_plans|ad_campaigns/);
  const layers = read("components/ops/CalendarLayers.jsx");
  assertMatch(layers, /aria-pressed=\{on\}/);
  for (const words of ["28+ days: full launch", "21 to 27: tight", "Under 21: organic only", "Expected"]) assert(layers.includes(words), words);
  const panel = read("components/ops/EventPanel.jsx");
  for (const words of ["Runway", "Launch kit", "Open host card", "Back to runway", "promised on the host card", "public since"]) {
    assert(panel.includes(words), words);
  }
  assertNotMatch(panel, /Plan this launch/);
});

Deno.test("#3980 W2 new ops components use tokens only and no overlay", () => {
  for (const file of ["components/ops/CalendarLayers.jsx", "components/ops/EventPanel.jsx", "components/ops/RunwayBar.jsx", "components/crm/OnMinglaSection.jsx"]) {
    const src = read(file);
    assertNotMatch(src, /bg-white|text-black|["'\s(]#[0-9a-fA-F]{6}\b/, file);
    assertNotMatch(src, /from "[^"]*(Modal|Drawer)"/, file);
    assertNotMatch(src, /\btruncate\b/, file);
  }
});

Deno.test("#3980 W2 the host card's On Mingla section: hosts only, its words, none of the banned ones", () => {
  const section = read("components/crm/OnMinglaSection.jsx");
  for (const words of [
    "On Mingla",
    "Link the brand above to see its events.",
    "No events on Mingla yet.",
    "Expected next event",
    "Cancel expected event",
    "for the giveaway and ads. Until then it shows dashed on the Calendar.",
    "Work on this host",
    "No open work. Ask your agent to plan the next launch.",
  ]) assert(section.includes(words), words);
  for (const banned of ["Drafts to send", "Draft, not sent", "@mention", "mention", "will get an email", "Getting started"]) {
    assert(!section.includes(banned), banned);
  }
  const drawer = read("components/crm/RecordDrawer.jsx");
  assertMatch(drawer, /\{isHosts && <OnMinglaSection key=\{`on-mingla-\$\{record\.id\}`\} record=\{record\} online=\{online\} \/>\}\s*<RecentTouchNotice/);
});
