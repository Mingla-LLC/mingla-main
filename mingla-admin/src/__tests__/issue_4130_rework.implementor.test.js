// Issue #4130 (rework after the tester's FAIL) — each finding pinned so that
// reverting the fix turns this suite red.
//
//   R-1  The staff/test email rule is precise (no "contest", "greatest"),
//        the same on the server and in the browser.
//   R-3  "Waiting on a person" has one definition: Dashboard KPI, Work menu
//        count, Work board column and Team dashboard (the server equality is
//        pinned in the Wave 1 pg17 suite, W1-WAIT).
//   R-4  An announcement whose whole send failed at the queue is a failure.
//   R-5  Settings reads config_key / config_value; a failed read is an error.
//   R-6  Ads: failed loads are errors with Retry, never "No ... need review".
//   R-7  The Dashboard's Work KPI and item show a failed read as failed.
//   R-8  Global Plus switches only through the audited admin RPC.
//   R-9  Impossible limit end dates are refused.
//   R-10 A payout mixing both pricings says "Mixed pricing".
//   R-11 Brands: the column and the KPI count the same thing (public, on sale).
//   R-12 Subscriptions hide staff and test unless asked for.
//   R-13 Plain words: Competitor watch, Ads, the "Done by" list, Data room
//        months; no leftover [TRANSITIONAL] in the Wave 3 migration.
//   R-A  A brand-level staff/test decision (Seth): one rule everywhere, set in
//        the brand drawer with a reason.
//   R-C  Careers is its own page again; Team and roles is the owner's.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brandInternalView, isInternalEmail } from "../lib/peopleSegments.js";
import { columnCards, isWaitingOnPerson, planToolLabel, PLAN_TOOLS, waitingCardsState, waitingColumnCount } from "../lib/opsModel.js";
import { announcementsWithFailedPushes, failedPushTitle, pushDelivery } from "../lib/announcementDelivery.js";
import { needsYouToday } from "../lib/dashboardToday.js";
import { appConfigRow, opsStateWords, weeklySpendWords } from "../lib/systemPages.js";
import { internalToggleLabel, subscriptionErrorMessage } from "../lib/subscriptionsView.js";
import { endsAtFromDay } from "../lib/messagingLimits.js";
import { payoutFeeBadge } from "../lib/minglaMoney.js";
import { monthName } from "../lib/dataRoomAnalytics.js";
import { createPersonActions } from "../lib/personActions.js";
import { redirectHash } from "../lib/adminRoutes.js";
import { canOpenPage, visibleNavGroups } from "../lib/access.js";
import { NAV_GROUPS } from "../lib/constants.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(SRC, "..", "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const sql = (name) => fs.readFileSync(path.join(REPO, "supabase", "migrations", name), "utf8");
const strip = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const W3 = "20280113004130_issue_4130_people_brands_offerings.sql";

describe("R-1 the staff/test email rule is precise", () => {
  const CASES = [
    ["contest.lagos@gmail.com", false],
    ["hello@greatestnights.ng", false],
    ["latest@news.ng", false],
    ["attest@gmail.com", false],
    ["ade@test.ng", false],
    ["ade@usemingla.co", false],
    ["ade@notusemingla.com", false],
    ["no-at-sign-test", false],
    ["", false],
    [null, false],
    ["test@x.com", true],
    ["tester@x.com", true],
    ["seth+test@gmail.com", true],
    ["qa.test1@gmail.com", true],
    ["qa_test@gmail.com", true],
    ["a@usemingla.com", true],
    [" A@UseMingla.COM ", true],
    ["b@example.org", true],
    ["c@example.com", true],
    ["d@example.net", true],
    // #4130: reserved test domains and Google's test devices are staff/test too.
    ["a@foo.test", true],
    ["b@x.invalid", true],
    ["a@foo.example", true],
    ["a@dev.localhost", true],
    ["c@cloudtestlabaccounts.com", true],
    ["d@mytest.com", false],
    ["e@gmail.com", false],
    ["user@test.com", false],
    ["ade@foo.test.com", false],
    ["ade@notcloudtestlabaccounts.com", false],
  ];
  it("each case, in the browser mirror", () => {
    for (const [email, want] of CASES) assert.equal(isInternalEmail(email), want, String(email));
  });
  it("the server rule is the same shape: domains, then a token before the @", () => {
    const rule = sql(W3).match(/FUNCTION public\.admin_internal_email_rule\(p_email text\)[\s\S]*?\$\$;/)[0];
    assert.doesNotMatch(rule, /\(usemingla\|example\\\.com\|test\)/, "the old substring rule is gone");
    // #4130: the domain list now also names cloudtestlabaccounts.com, and reserved test TLDs match on the last label only.
    assert.match(rule, /e\.domain IN \('usemingla\.com', 'example\.com', 'example\.org', 'example\.net', 'cloudtestlabaccounts\.com'\)/);
    assert.match(rule, /e\.domain ~ '\\\.\(test\|invalid\|example\|localhost\)\$'/);
    assert.match(rule, /e\.local ~ '\^test'/);
    assert.match(rule, /e\.local ~ '\(\^\|\[\._\+0-9-\]\)test\(\$\|\[\._\+0-9-\]\)'/);
  });
});

describe("R-3 one definition of Waiting on a person", () => {
  const cards = [
    { id: "s1", status: "person", person_reason: "send", draft_ready: true },
    { id: "s2", status: "person", person_reason: "send" },
    { id: "p1", status: "person", person_reason: "spend" },
    { id: "t1", status: "todo" },
    { id: "x1", status: "person", person_reason: "send", archived: true },
  ];
  it("a send card counts whether or not its draft is ready; drafts beside it are not cards", () => {
    assert.equal(isWaitingOnPerson(cards[0]), true);
    assert.equal(waitingColumnCount(columnCards(cards, "person")), 3);
  });
  it("the server count is read as a state: never 0 when the read failed", () => {
    assert.deepEqual(waitingCardsState({ data: { waiting_on_person_mine: 3 } }), { status: "ready", cards: 3 });
    assert.deepEqual(waitingCardsState({ data: null, error: new Error("x") }), { status: "error", cards: null });
    assert.deepEqual(waitingCardsState({ data: null }), { status: "loading", cards: null });
    assert.deepEqual(waitingCardsState({ enabled: false }), { status: "ready", cards: 0 });
  });
  it("every surface reads that one definition", () => {
    const hook = strip(read("hooks/useReviewCount.js"));
    assert.match(hook, /waitingCardsState\(\{ enabled, data: counts\.data, error: counts\.error \}\)/);
    assert.match(hook, /cards: work\.cards,/);
    assert.doesNotMatch(hook, /const cards = needsPerson \+ draftNeeded \+ wording/);
    assert.match(strip(read("components/ops/WorkColumns.jsx")), /col\.key === "person" \? waitingColumnCount\(list\) : list\.length/);
    assert.match(strip(read("components/layout/Sidebar.jsx")), /item\.id === "work-board" \? reviewCount\.cards \|\| 0 : 0/);
    assert.match(strip(read("pages/OverviewPage.jsx")), /\{Number\(review\.cards\)\.toLocaleString\(\)\}/);
    assert.match(strip(read("pages/TeamDashboardPage.jsx")), /waiting\.data\?\.counts\?\.person/);
    const w1 = sql("20280110004130_issue_4130_work_views_and_team_pulse.sql");
    assert.match(w1, /'waiting_on_person_mine', count\(\*\) FILTER \(WHERE w\.status = 'person' AND p\.role = 'owner'\)/);
  });
});

describe("R-4 a whole send that failed at the queue is a failure", () => {
  const whole = { id: "a1", title: "Big news", published_at: "2026-10-26T10:00:00Z",
    delivery: { campaign_id: "c1", state: "failed", audience_count: 40, outbox: { pending: 0, done: 0, failed: 1 }, channels: {} } };
  it("counts as failed, with the campaign for Retry", () => {
    const push = pushDelivery(whole);
    assert.equal(push.failed, 1);
    assert.equal(push.tried, 40);
    assert.equal(push.wholeSendFailed, true);
    assert.equal(announcementsWithFailedPushes([whole])[0].campaignId, "c1");
    assert.equal(failedPushTitle(announcementsWithFailedPushes([whole])[0]), "An announcement didn't send at all");
  });
  it("shows on the Dashboard", () => {
    const items = needsYouToday({ announcements: { status: "ready", data: [whole] } });
    assert.equal(items[0].id, "announcement-push-failed");
    assert.equal(items[0].title, "An announcement didn't send at all");
  });
  it("a partial failure still reads as so many of so many", () => {
    const part = { ...whole, delivery: { ...whole.delivery, state: "partial", outbox: { done: 1, failed: 0 }, channels: { push_accepted: 8, push_failed: 2 } } };
    assert.equal(failedPushTitle(announcementsWithFailedPushes([part])[0]), "2 of 10 announcement pushes failed");
  });
});

describe("R-5 Settings app config", () => {
  it("rows are read from config_key and config_value", () => {
    assert.deepEqual(appConfigRow({ id: "1", config_key: "global_plus_access", config_value: "true", value_type: "boolean" }),
      { id: "1", key: "global_plus_access", value: "true", value_type: "boolean", description: "" });
  });
  it("the page asks for those columns and shows a failed read as an error", () => {
    const page = strip(read("pages/SettingsPage.jsx"));
    assert.match(page, /\.select\("id, config_key, config_value, value_type, description"\)\.order\("config_key"\)/);
    assert.match(page, /\) : loadError \? \(\s*<LoadError title="Couldn't load app config"/);
    assert.match(page, /update\(\{ config_value: editing\.value \}\)/);
    assert.doesNotMatch(page, /\.order\("key"\)/);
  });
});

describe("R-6 Ads: a failed load is an error with Retry", () => {
  const page = strip(read("pages/CampaignsPage.jsx"));
  it("review queue, recovery queue and campaign list", () => {
    assert.match(page, /\) : loadErrors\.review \? \(\s*<LoadError/);
    assert.match(page, /\) : loadErrors\.recovery \? \(\s*<LoadError/);
    assert.match(page, /\) : loadErrors\.campaigns \? \(\s*<LoadError/);
  });
});

describe("R-7 the Dashboard's Work KPI and item", () => {
  it("a failed Work read is a failed item, not nothing", () => {
    const items = needsYouToday({ work: { status: "error" } });
    assert.equal(items[0].id, "work-failed");
    assert.equal(items[0].retry, "work");
  });
  it("the KPI has a failed state with Retry", () => {
    const page = strip(read("pages/OverviewPage.jsx"));
    // #4130: the tile counts only the viewer's own cards, so it says "Waiting on you".
    assert.match(page, /work\.status === "error" \? \(\s*<KpiFailed label="Waiting on you"/);
    assert.match(page, /review\.cardsError \? \{ status: "error" \}/);
  });
});

describe("R-8 Global Plus", () => {
  it("switches through the audited RPC with a reason, never a table write", () => {
    const svc = strip(read("services/subscriptionsService.js"));
    assert.match(svc, /supabase\.rpc\("admin_set_global_plus", \{ p_on: on === true, p_reason: reason \?\? null \}\)/);
    assert.doesNotMatch(svc, /\.update\(\{ config_value/);
    const page = strip(read("pages/SubscriptionManagementPage.jsx"));
    assert.match(page, /await setGlobalPlus\(next, globalReason\.trim\(\)\)/);
    assert.match(page, /disabled=\{globalSaving \|\| !globalReason\.trim\(\)\}/);
  });
  it("the server refuses a no-op, and the page says so", () => {
    const w2b = sql("20280112004130_issue_4130_messaging_limits_and_subscriptions.sql");
    assert.match(w2b, /FUNCTION public\.admin_set_global_plus\(p_on boolean, p_reason text\)[\s\S]*?RAISE EXCEPTION 'reason_required'[\s\S]*?RAISE EXCEPTION 'no_change'[\s\S]*?admin_write_audit\('subscriptions\.global_plus_set'/);
    assert.match(subscriptionErrorMessage(new Error("no_change")), /Nothing changed/);
  });
});

describe("R-9 impossible end dates", () => {
  it("are refused, not rolled over", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    assert.ok(endsAtFromDay("2026-02-30", now).error);
    assert.ok(endsAtFromDay("2026-13-01", now).error);
    assert.ok(endsAtFromDay("2026-04-31", now).error);
    assert.equal(endsAtFromDay("2026-02-28", now).value, "2026-03-01T00:00:00.000Z");
    assert.equal(endsAtFromDay("2028-02-29", now).value, "2028-03-01T00:00:00.000Z");
  });
});

describe("R-10 a payout on both pricings", () => {
  it("is Mixed pricing, never older", () => {
    // 3% blended share: older by the share alone, but the server saw both kinds.
    assert.equal(payoutFeeBadge(30000, 1000000, "mixed").text, "Mixed pricing · 3%");
    assert.equal(payoutFeeBadge(30000, 1000000, "mixed").older, false);
    assert.equal(payoutFeeBadge(30000, 1000000, "older").text, "3% · older pricing");
    assert.equal(payoutFeeBadge(45000, 1000000, "current").text, "4.5%");
    assert.equal(payoutFeeBadge(30000, 1000000).text, "3% · older pricing");
  });
  it("the server sets pricing from each sale", () => {
    const w2a = sql("20280111004130_issue_4130_mingla_money.sql");
    assert.match(w2a, /WHEN COALESCE\(items\.older_items, 0\) > 0 AND COALESCE\(items\.current_items, 0\) > 0 THEN 'mixed'/);
    assert.match(strip(read("pages/BusinessMoneyLedgerPage.jsx")), /pricing=\{row\.pricing\}/);
  });
});

describe("R-11 Brands: column and KPI count public offerings on sale", () => {
  it("the board column counts public offerings only, and says so", () => {
    for (const name of [W3, "20280118004130_issue_4130_integration.sql"]) {
      const board = sql(name).match(/FUNCTION public\.admin_list_brands_board[\s\S]*?\$\$;/)[0];
      assert.match(board, /e\.deleted_at IS NULL AND e\.visibility = 'public'[\s\S]{0,120}admin_offering_is_current\(e\.status, d\.start_at\)\) AS live_offerings/, name);
    }
    assert.match(read("pages/BrandsPage.jsx"), /label: "Live public offerings"/);
  });
});

describe("R-12 Subscriptions hide staff and test by default", () => {
  it("the toggle says how many are hidden", () => {
    assert.equal(internalToggleLabel(false, 4), "Show staff and test (4)");
    assert.equal(internalToggleLabel(false, 0), "Show staff and test");
    assert.equal(internalToggleLabel(true, 4), "Hide staff and test");
  });
  it("the service asks the server to hide them unless shown", () => {
    const svc = strip(read("services/subscriptionsService.js"));
    assert.match(svc, /p_show_internal: showInternal === true/);
    const w2b = sql("20280112004130_issue_4130_messaging_limits_and_subscriptions.sql");
    assert.match(w2b, /SELECT \* FROM base WHERE COALESCE\(p_show_internal, false\) OR NOT base\.internal/);
  });
});

describe("R-13 plain words", () => {
  it("Competitor watch", () => {
    assert.equal(opsStateWords("failed_terminal"), "Failed");
    assert.equal(opsStateWords("budget_deferred"), "Waiting for budget");
    assert.equal(weeklySpendWords({ weekly_actual_cents: 125, weekly_reserved_cents: 60, weekly_remaining_cents: 815 }), "$1.25 spent · $0.60 set aside · $8.15 left");
    const panel = read("pages/ToolLeadsPage.jsx");
    const ops = panel.slice(panel.indexOf("export function CompetitorOpsPanel"));
    for (const jargon of ["Generation {cap.generation}", "Safe reason", "¢ reserved", "provider generation", "Brand internal id"]) {
      assert.equal(ops.includes(jargon), false, jargon);
    }
  });
  it("Ads", () => {
    const ads = read("pages/CampaignsPage.jsx");
    for (const jargon of ["STAFF REVIEW", "server-owned and survive a browser reload", "governed provider objects", "frozen account-currency cap"]) {
      assert.equal(ads.includes(jargon), false, jargon);
    }
  });
  it("the Done by list names what each choice does", () => {
    assert.equal(planToolLabel("person"), "A person");
    assert.equal(planToolLabel("save_drafts"), "Agent: write message drafts");
    for (const t of PLAN_TOOLS) assert.ok(planToolLabel(t) && !planToolLabel(t).includes("_"), t);
    assert.match(read("components/ops/PlanSteps.jsx"), /<option key=\{t\} value=\{t\}>\{planToolLabel\(t\)\}<\/option>/);
  });
  it("Data room months are unambiguous", () => {
    assert.equal(monthName("2026-10"), "October 2026");
    assert.match(read("components/dataRoom/DataRoomOverview.jsx"), /const latestName = latest \? monthName\(latest\.month\) : "";/);
  });
  it("no leftover [TRANSITIONAL] in the Wave 3 migration", () => {
    assert.equal(/TRANSITIONAL/.test(sql(W3)), false);
  });
});

describe("R-A one brand-level staff/test rule", () => {
  it("brands, offerings, calendar and the Data room ask one function", () => {
    for (const name of [W3, "20280114004130_issue_4130_dashboard_outreach_inbound.sql", "20280116004130_issue_4130_data_room_analytics.sql", "20280118004130_issue_4130_integration.sql"]) {
      // The one helper itself is the only place that reads the owner.
      const text = sql(name).replace(/FUNCTION public\.admin_brand_is_internal\(p_brand_id uuid\)[\s\S]*?\$\$;/, "");
      assert.equal(/admin_account_is_internal\(br?\.account_id\)/.test(text), false, `${name} judges a brand by its owner directly`);
    }
    assert.match(sql(W3), /FUNCTION public\.admin_brand_is_internal\(p_brand_id uuid\)[\s\S]*?admin_internal_brands ib WHERE ib\.brand_id = p_brand_id[\s\S]*?admin_account_is_internal\(b\.account_id\)/);
    assert.match(sql("20280116004130_issue_4130_data_room_analytics.sql"), /analytics_dr_brand_internal\(p_brand_id uuid\)[\s\S]*?SELECT public\.admin_brand_is_internal\(p_brand_id\)/);
  });
  it("the drawer action runs one audited RPC and needs a reason", async () => {
    const calls = [];
    const actions = createPersonActions({ rpc: async (name, params) => { calls.push([name, params]); return { data: { is_internal: false }, error: null }; } });
    await actions.setBrandInternal("b1", false, " Real host ");
    await actions.setBrandInternal("b1", null, "Owner decides");
    assert.deepEqual(calls, [
      ["admin_set_internal_brand", { p_brand_id: "b1", p_internal: false, p_reason: "Real host" }],
      ["admin_set_internal_brand", { p_brand_id: "b1", p_internal: null, p_reason: "Owner decides" }],
    ]);
    await assert.rejects(actions.setBrandInternal("b1", true, "  "));
    assert.equal(calls.length, 2, "no reason, no call");
  });
  it("the drawer offers the right action for each state", () => {
    const staffOwned = brandInternalView({ internal: true });
    assert.equal(staffOwned.actionLabel, "Treat as a real host…");
    assert.equal(staffOwned.canClear, false);
    const decided = brandInternalView({ internal: false, internal_decision: { is_internal: false, reason: "Real host", marked_by: "seth@x" } });
    assert.equal(decided.actionLabel, "Treat as staff or test…");
    assert.equal(decided.canClear, true);
    assert.match(decided.why, /Marked as a real host by seth@x: Real host\./);
    const drawer = strip(read("components/brands/BrandDrawer.jsx"));
    assert.match(drawer, /personActions\.setBrandInternal\(brandId, modal\.internal, reason\)/);
  });
});

describe("R-C Careers is its own page again", () => {
  const owner = { email: "o@x.test", role: "owner", status: "active", areas: ["admin_console", "team_manage", "crm"] };
  const admin = { email: "a@x.test", role: "admin", status: "active", areas: ["admin_console", "crm"] };
  it("an admin (not the owner) sees Careers but not Team and roles", () => {
    assert.equal(canOpenPage(admin, "careers"), true);
    assert.equal(canOpenPage(admin, "admin"), false);
    const menu = visibleNavGroups(NAV_GROUPS, admin).flatMap((g) => g.items.map((i) => i.id));
    assert.ok(menu.includes("careers"));
    assert.equal(menu.includes("admin"), false);
    assert.equal(canOpenPage(owner, "admin"), true);
  });
  it("Company is Team and roles, Careers, Data room", () => {
    assert.deepEqual(NAV_GROUPS.find((g) => g.label === "Company").items.map((i) => i.id), ["admin", "careers", "data-room"]);
  });
  it("old links land on Careers", () => {
    assert.equal(redirectHash("#/careers"), null);
    assert.equal(redirectHash("#/admin?tab=careers"), "#/careers");
    assert.equal(redirectHash("#/admin?tab=careers&posting=p1"), "#/careers?posting=p1");
  });
});
