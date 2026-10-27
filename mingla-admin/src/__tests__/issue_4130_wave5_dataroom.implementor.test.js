// Issue #4130 (Wave 5) — Data room analytics.
//
//   1. Working / Not working is computed from the funnels with the thresholds
//      in lib/dataRoomAnalytics.js, and those thresholds are shown on screen.
//   2. Funnel steps carry plain labels and the share kept from the step before.
//   3. All users: running totals per segment and "new this month".
//   4. A retention cell the server sent as null reads "too new", never "0%".
//   5. Page usage shows "Needs app tagging and a PostHog read key" and no
//      numbers of any kind.
//   6. The page: the approved tabs in order, All users first on Overview, the
//      old documents list kept as the Documents tab, every number read through
//      the gated admin_data_room_* RPCs (no table read from the browser), and
//      the Data room access area unchanged.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DATA_ROOM_TABS,
  dataRoomTabFor,
  VERDICT_RULES,
  verdictRulesText,
  funnelSteps,
  funnelVerdicts,
  cumulativeMonths,
  lastMonthNew,
  retentionCell,
  countChange,
  last30,
  PAGE_USAGE_NEEDS,
} from "../lib/dataRoomAnalytics.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const FUNNELS = {
  explorer: [
    { key: "signed_up", count: 200 },
    { key: "onboarded", count: 80 }, // keeps 40% -> neither (not under 40)
    { key: "saw_deck", count: 70 }, // keeps 87.5% -> working
    { key: "saved_card", count: 20 }, // keeps 28.6% -> not working
    { key: "got_ticket", count: 2 }, // keeps 10% -> not working
  ],
  host: [
    { key: "became_host", count: 50 },
    { key: "created_brand", count: 40 }, // 80% working
    { key: "added_bank", count: 9 }, // 22.5% not working
    { key: "published", count: 8 }, // prev 9 < 10 -> left out
    { key: "first_sale", count: 1 }, // prev 8 < 10 -> left out
    { key: "first_payout", count: 1 },
  ],
  checkout: [
    { key: "started", count: 300 },
    { key: "completed", count: 270 }, // 90% working
    { key: "checked_in", count: 30 }, // 11.1% not working
  ],
};

describe("#4130 Wave 5 — Working / Not working from the funnels", () => {
  it("uses the stated thresholds and leaves out steps with too few people", () => {
    assert.equal(VERDICT_RULES.workingAtLeast, 60);
    assert.equal(VERDICT_RULES.notWorkingBelow, 40);
    assert.equal(VERDICT_RULES.minPeople, 10);
    const { working, notWorking } = funnelVerdicts(FUNNELS);
    assert.deepEqual(working.map((x) => x.kept), [90, 87.5, 80]);
    assert.deepEqual(working.map((x) => x.to), ["Paid or got a free ticket", "Looked at the deck", "Created a brand"]);
    assert.deepEqual(notWorking.map((x) => x.kept), [10, 11.1, 22.5]);
    for (const x of [...working, ...notWorking]) assert.ok(x.prev >= 10, `${x.to} has ${x.prev} before it`);
    assert.ok(!notWorking.some((x) => x.to === "First paid sale"), "a step after fewer than 10 people is left out");
    assert.ok(![...working, ...notWorking].some((x) => x.kept === 40), "exactly 40% is neither");
  });

  it("says the thresholds on screen", () => {
    const text = verdictRulesText();
    assert.match(text, /60% or more/);
    assert.match(text, /under 40%/);
    assert.match(text, /fewer than 10 people/);
    assert.match(read("components/dataRoom/DataRoomOverview.jsx"), /\{verdictRulesText\(\)\}/);
  });

  it("an empty answer gives no verdicts rather than inventing any", () => {
    assert.deepEqual(funnelVerdicts({}), { working: [], notWorking: [] });
    assert.deepEqual(funnelVerdicts(null), { working: [], notWorking: [] });
  });
});

describe("#4130 Wave 5 — funnels, All users, retention", () => {
  it("labels each step and works out the share kept", () => {
    const steps = funnelSteps(FUNNELS, "host");
    assert.equal(steps[0].label, "Became a host");
    assert.equal(steps[0].kept, null);
    assert.equal(steps[2].label, "Added a bank");
    assert.equal(steps[2].kept, 22.5);
    assert.equal(funnelSteps(FUNNELS, "nope").length, 0);
  });

  it("adds months up per segment and reads the newest month", () => {
    const months = [
      { month: "2026-09", explorer: 4, host: 3, both: 0, incomplete: 0 },
      { month: "2026-10", explorer: 16, host: 19, both: 2, incomplete: 10 },
    ];
    assert.deepEqual(cumulativeMonths(months)[1], { month: "2026-10", explorer: 20, host: 22, both: 2, incomplete: 10 });
    assert.deepEqual(lastMonthNew(months), { month: "2026-10", total: 47, explorer: 16, host: 19, both: 2, incomplete: 10 });
    assert.equal(lastMonthNew([]), null);
  });

  it("a cohort too new to measure reads 'too new', a measured zero reads 0%", () => {
    assert.deepEqual(retentionCell(null), { text: "too new", tooNew: true, value: null });
    assert.deepEqual(retentionCell(undefined), { text: "too new", tooNew: true, value: null });
    assert.equal(retentionCell(0).text, "0%");
    assert.equal(retentionCell(0).tooNew, false);
    assert.equal(retentionCell(33.3).text, "33.3%");
  });

  it("a change is green when up, red when down, level when the same", () => {
    assert.deepEqual(countChange(10, 7), { text: "+3 vs the period before", up: true });
    assert.equal(countChange(5, 7).up, false);
    assert.equal(countChange(5, 5).up, null);
    assert.equal(countChange(null, 5), null);
  });

  it("money stays per currency; a missing rate stays missing", () => {
    const money = { last_30d: [
      { kind: "profit", currency: "NGN", cents: 123400, usd_cents: null },
      { kind: "profit", currency: "USD", cents: -250, usd_cents: -250 },
      { kind: "fee", currency: "NGN", cents: 1, usd_cents: 0 },
    ] };
    assert.deepEqual(last30(money, "profit"), [
      { currency: "NGN", cents: 123400, usdCents: null },
      { currency: "USD", cents: -250, usdCents: -250 },
    ]);
  });
});

describe("#4130 Wave 5 — the page", () => {
  const page = read("pages/DataRoomPage.jsx");
  const overview = read("components/dataRoom/DataRoomOverview.jsx");
  const tabs = read("components/dataRoom/DataRoomTabs.jsx");
  const documents = read("components/dataRoom/DataRoomDocuments.jsx");
  const service = read("services/dataRoomAnalyticsService.js");
  const hook = read("hooks/useDataRoomSection.js");

  it("has the approved tabs in order and falls back to Overview", () => {
    assert.deepEqual(DATA_ROOM_TABS.map((t) => t.label),
      ["Overview", "Explorers", "Hosts", "Funnels", "Retention", "Page usage", "Documents"]);
    assert.equal(dataRoomTabFor("bogus").id, "overview");
  });

  it("puts All users first on Overview", () => {
    const body = overview.slice(overview.indexOf("export function DataRoomOverview"));
    const order = ["<AllUsers", "<Headlines", "<Verdicts", "<Weekly"].map((s) => body.indexOf(s));
    assert.ok(order.every((i) => i > 0), "every Overview block is rendered");
    assert.deepEqual([...order].sort((a, b) => a - b), order, "All users, then headlines, then Working / Not working, then charts");
  });

  it("keeps the documents list as the Documents tab", () => {
    assert.match(page, /tab === "documents" \? <DataRoomDocuments \/>/);
    assert.match(documents, /collaboration\.loadDataRoom\(\)/);
    assert.match(documents, /collaboration\.openDataRoomDocument\(document\.key\)/);
    assert.match(documents, /Every room and document open is recorded/);
  });

  it("Page usage needs app tagging and a PostHog read key, and shows no numbers", () => {
    const usage = tabs.slice(tabs.indexOf("function PageUsage"), tabs.indexOf("export function DataRoomTab"));
    assert.match(usage, /Needs app tagging and a PostHog read key/);
    assert.doesNotMatch(usage, /\d{2,}|fmtInt|fmtPct|Chart|useDataRoomSection/);
    assert.equal(PAGE_USAGE_NEEDS.length, 2);
    assert.match(PAGE_USAGE_NEEDS.join(" "), /PostHog/);
  });

  it("reads numbers only through the gated RPCs, and errors are errors", () => {
    assert.match(service, /supabase\.rpc\(`admin_data_room_\$\{section\}`, \{ p_as_of: asOf \|\| null \}\)/);
    assert.match(service, /supabase\.rpc\("admin_data_room_snapshot_dates"\)/);
    assert.doesNotMatch(`${service}\n${page}\n${overview}\n${tabs}\n${hook}`, /\.from\(|functions\.invoke|posthog[.-]|posthog\.com/i);
    assert.match(service, /if \(error\) throw new Error/);
    assert.match(read("components/dataRoom/shared.jsx"), /<LoadError/);
  });

  it("keeps the Data room access area", () => {
    const access = read("lib/access.js");
    assert.match(access, /"data-room": Object\.freeze\(\[DATA_ROOM_AREA\]\)/);
    assert.match(access, /export const DATA_ROOM_AREA = "data_room";/);
  });
});
