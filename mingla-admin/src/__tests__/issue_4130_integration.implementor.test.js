// Issue #4130 (integration) — the pieces the waves left for the conductor:
//
//   INT-1  Payment readiness has one owner (Wave 2a): Brands, People and
//          Payments name a brand the same way. A Paystack-only brand reads
//          "paystack_ready" from the Payments facts, which is the code the
//          Brands board's server helper returns (pg17 suite
//          issue_4130_integration I-02 proves the server side on the same facts).
//   INT-2  Settings' Competitor watch is Competitor Ops, for exactly who could
//          open Tool leads.
//   INT-3  The Dashboard's "Needs you today" lists failed announcement pushes
//          (Wave 6's reading), for admins only; a failed read is never "nothing".
//   INT-4  Calendar Event runway: the designed table, "Make a card" through the
//          existing checked Work add with a confirmation, "Plan a post" through
//          the existing Add content form; no new sender.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROVIDER_LABEL,
  READINESS_LABEL,
  derivePaymentReadiness,
  parseReadinessCode,
  readinessCode,
} from "../lib/paymentReadiness.js";
import { bestReadiness, paymentReadiness } from "../lib/peopleSegments.js";
import { AREA, canOpenOwnPage } from "../lib/access.js";
import { COMPETITOR_WATCH_FROM } from "../lib/systemPages.js";
import { needsYouToday } from "../lib/dashboardToday.js";
import {
  liveLabel,
  promotionWindow,
  runwayAction,
  runwayCardItem,
  runwayPostTitle,
} from "../lib/calendarRunway.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(SRC, "..", "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// The facts admin_list_brand_payment_readiness returns, one row per case. The
// pg17 suite builds the same brands and asserts the board's code for each.
const FACTS = {
  paystackOnly: {
    payment_provider: "paystack", paystack_recipient_active: true, paystack_bank_mask: "••••4130",
    paystack_subaccount_code: null, stripe_connect_id: null, has_stripe_account: false,
    stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_detached: false, stripe_past_due_count: 0,
  },
  paystackStaleStripe: {
    payment_provider: "paystack", paystack_recipient_active: false, paystack_subaccount_code: null,
    stripe_connect_id: null, has_stripe_account: true, stripe_charges_enabled: true, stripe_payouts_enabled: true,
    stripe_detached: false, stripe_past_due_count: 0,
  },
  paystackSubaccount: {
    payment_provider: "paystack", paystack_recipient_active: false, paystack_subaccount_code: "ACCT_int4130",
    has_stripe_account: false,
  },
  stripeNoPayouts: {
    payment_provider: "stripe", has_stripe_account: true, stripe_charges_enabled: true, stripe_payouts_enabled: false,
    stripe_detached: false, stripe_past_due_count: 0,
  },
  stripeOverdue: {
    payment_provider: "stripe", has_stripe_account: true, stripe_charges_enabled: true, stripe_payouts_enabled: true,
    stripe_detached: false, stripe_past_due_count: 1,
  },
  stripeReady: {
    payment_provider: "stripe", has_stripe_account: true, stripe_charges_enabled: true, stripe_payouts_enabled: true,
    stripe_detached: false, stripe_past_due_count: 0,
  },
};
// The codes issue_4130_integration.implementor.happy.pg17.test.sql asserts.
const SERVER_CODES = {
  paystackOnly: "paystack_ready",
  paystackStaleStripe: "paystack_no_setup",
  paystackSubaccount: "paystack_needs_action",
  stripeNoPayouts: "stripe_needs_action",
  stripeOverdue: "stripe_needs_action",
  stripeReady: "stripe_ready",
};

describe("#4130 INT-1 Brands and Payments agree on payment readiness", () => {
  it("a Paystack-only brand: the Payments verdict and the Brands code are the same", () => {
    const verdict = derivePaymentReadiness(FACTS.paystackOnly);
    assert.equal(verdict.provider, "paystack");
    assert.equal(verdict.state, "ready");
    assert.equal(readinessCode(verdict), "paystack_ready");
    const onBrands = paymentReadiness("paystack_ready");
    assert.equal(onBrands.ready, true);
    assert.equal(onBrands.label, `${verdict.stateLabel} · ${verdict.providerLabel}`);
    assert.equal(bestReadiness([{ payment_readiness: "paystack_ready" }]).short, "Paystack");
  });
  it("every case the server pins reads the same in Payments", () => {
    for (const [name, facts] of Object.entries(FACTS)) {
      const code = readinessCode(derivePaymentReadiness(facts));
      assert.equal(code, SERVER_CODES[name], name);
      const named = paymentReadiness(code);
      assert.deepEqual({ provider: named.provider, state: named.state }, parseReadinessCode(code), name);
      assert.equal(named.label, `${READINESS_LABEL[named.state]} · ${PROVIDER_LABEL[named.provider]}`, name);
    }
  });
  it("the boards use the Payments words and no transitional rule is left", () => {
    const segments = stripComments(read("lib/peopleSegments.js"));
    assert.match(segments, /from "\.\/paymentReadiness\.js"/);
    assert.equal(/Needs a bank|Paystack ready|Stripe ready/.test(segments), false, "no second set of readiness words");
    assert.equal(/TRANSITIONAL/.test(read("lib/peopleSegments.js")), false);
    assert.equal(paymentReadiness("needs_bank"), null);
    const sql = fs.readFileSync(path.join(REPO, "supabase/migrations/20280118004130_issue_4130_integration.sql"), "utf8");
    assert.match(sql, /FUNCTION public\.admin_brand_payment_readiness_w3\(p_brand_id uuid\)[\s\S]*?SELECT public\.admin_brand_payment_readiness\(p_brand_id\)/);
    assert.equal(/TRANSITIONAL/.test(sql), false);
    assert.equal(/'needs_bank'\)\s*$/m.test(sql), false);
  });
});

describe("#4130 INT-2 Competitor watch in Settings", () => {
  it("shows Competitor Ops, for exactly who could open Tool leads", () => {
    assert.equal(COMPETITOR_WATCH_FROM, "tool-leads");
    const page = stripComments(read("pages/SettingsPage.jsx"));
    assert.match(page, /import \{ CompetitorOpsPanel \} from "\.\/ToolLeadsPage";/);
    assert.match(page, /const canSeeCompetitorWatch = canOpenOwnPage\(access, COMPETITOR_WATCH_FROM\);/);
    assert.match(page, /\{canSeeCompetitorWatch && \(\s*<Section id="competitor-watch" title="Competitor watch">[\s\S]*?<CompetitorOpsPanel addToast=\{addToast\} \/>/);
    assert.equal(/data-slot="competitor-watch"/.test(page), false, "the empty slot is filled");
    const admin = { email: "a@x.test", role: "admin", status: "active", areas: [AREA.ADMIN_CONSOLE] };
    const growth = { email: "g@x.test", role: "growth", status: "active", areas: [AREA.CRM, AREA.BETA_LEADS] };
    assert.equal(canOpenOwnPage(admin, COMPETITOR_WATCH_FROM), true);
    assert.equal(canOpenOwnPage(growth, COMPETITOR_WATCH_FROM), false);
  });
});

describe("#4130 INT-3 Needs you today: failed announcement pushes", () => {
  const rows = [
    { id: "a1", title: "Payouts in 24 hours", published_at: "2026-10-20T10:00:00Z",
      delivery: { campaign_id: "c1", channels: { push_failed: 3, push_accepted: 17, push_retrying: 0 } } },
    { id: "a0", title: "Older", published_at: "2026-10-01T10:00:00Z",
      delivery: { campaign_id: "c0", channels: { push_failed: 1, push_accepted: 9 } } },
    { id: "a2", title: "All fine", published_at: "2026-10-22T10:00:00Z",
      delivery: { campaign_id: "c2", channels: { push_failed: 0, push_accepted: 20 } } },
  ];
  it("names the latest failure, counts the older ones, and links to Announcements", () => {
    const items = needsYouToday({ announcements: { status: "ready", data: rows } });
    const item = items.find((i) => i.id === "announcement-push-failed");
    assert.ok(item);
    assert.equal(item.title, "3 of 20 announcement pushes failed");
    assert.match(item.detail, /"Payouts in 24 hours"/);
    assert.match(item.detail, /1 older announcement has failed pushes too/);
    assert.equal(item.href, "#/community?tab=announcements");
    assert.equal(item.tone, "bad");
  });
  it("a failed read is its own item with Retry; nothing to report is no item", () => {
    const failedItems = needsYouToday({ announcements: { status: "error", error: new Error("x") } });
    assert.equal(failedItems[0].id, "announcements-failed");
    assert.equal(failedItems[0].retry, "announcements");
    assert.equal(needsYouToday({ announcements: { status: "ready", data: [rows[2]] } }).length, 0);
    assert.equal(needsYouToday({}).length, 0);
  });
  it("the Dashboard reads it for admins only, through Wave 6's service", () => {
    const page = stripComments(read("pages/OverviewPage.jsx"));
    assert.match(page, /const isAdmin = Array\.isArray\(access\?\.areas\) && access\.areas\.includes\(AREA\.ADMIN_CONSOLE\);/);
    assert.match(page, /isAdmin \? listAnnouncementDeliveries\(\) : Promise\.resolve\(null\)/);
    assert.match(page, /announcements: isAdmin \? pushes : undefined/);
    assert.match(page, /announcements: pushes\.retry/);
    assert.match(stripComments(read("lib/dashboardToday.js")), /announcementsWithFailedPushes\(announcements\.data\)/);
  });
});

describe("#4130 INT-4 Calendar Event runway", () => {
  const draft = {
    anchor_kind: "event", anchor_id: "e1", title: "Detty December Weekend", host_name: "Harmattan Club",
    is_public: false, start_at: "2026-12-19T20:00:00Z", timezone: "Africa/Lagos", start_on: "2026-12-19",
    go_live_by: "2026-11-21", state: { k: "notlive" },
  };
  const live = { ...draft, anchor_id: "e2", title: "Sea & Soundtrack", is_public: true, go_live_by: null, state: { k: "short" } };
  it("the cells read as designed", () => {
    assert.deepEqual(liveLabel(draft), { label: "Draft", tone: "default" });
    assert.deepEqual(liveLabel(live), { label: "Live", tone: "success" });
    assert.equal(liveLabel({ anchor_kind: "expected" }).label, "No event yet");
    assert.equal(promotionWindow(draft).label, "Go live by 21 Nov");
    assert.equal(promotionWindow(live).label, "Promote now");
    assert.equal(promotionWindow({ state: { k: "late" } }).label, "Too late for promo");
  });
  it("a draft offers Make a card, a live event Plan a post, a past one nothing", () => {
    assert.equal(runwayAction(draft), "card");
    assert.equal(runwayAction(live), "post");
    assert.equal(runwayAction({ ...live, state: { k: "done" } }), null);
    assert.equal(runwayAction({ anchor_kind: "expected", state: { k: "notlive" } }), "card");
  });
  it("Make a card builds a card the server's checks accept, linked to the event", () => {
    const card = runwayCardItem(draft, "me@usemingla.test");
    assert.equal(card.title, "Get Detty December Weekend live");
    assert.ok(card.title.length >= 3 && card.title.length <= 160);
    assert.ok(card.instructions.length >= 10 && card.instructions.length <= 4000);
    assert.match(card.instructions, /19 Dec, 21:00 Lagos/);
    assert.match(card.instructions, /go live by 21 Nov/);
    assert.ok(card.done_means.length >= 5 && card.done_means.length <= 300);
    assert.deepEqual(card.owners, ["me@usemingla.test"]);
    assert.deepEqual(card.links, [{ kind: "event", id: "e1" }]);
    assert.deepEqual(Object.keys(card).sort(), ["done_means", "instructions", "links", "owners", "title"]);
    assert.ok(runwayCardItem({ ...draft, title: "x".repeat(400) }, "m").title.length <= 160);
    assert.equal(runwayPostTitle(live), "Promote Sea & Soundtrack");
  });
  it("the page draws the table and uses only the existing write paths", () => {
    const page = stripComments(read("pages/ContentCalendarPage.jsx"));
    const heads = [...page.slice(page.indexOf("function RunwayTable")).matchAll(/<th scope="col"[^>]*>([^<]*)</g)].map((m) => m[1]).filter(Boolean);
    assert.deepEqual(heads, ["Event", "Host", "When (local)", "Live?", "Promotion window"]);
    assert.match(page, /<RunwayTable rows=\{runwayRows\}/);
    assert.match(page, /await ops\.addWork\(\[runwayCardItem\(cardFor, people\.me\)\]/);
    assert.match(page, /<Modal open=\{!!cardFor\} onClose=\{closeCard\} title="Make a Work card\?"/);
    assert.match(page, /const planPost = \(row\) => \{ setTitle\(runwayPostTitle\(row\)\);[^}]*setAddOpen\(true\); \};/);
    assert.equal(/supabase\.rpc|\bfetch\(|from "\.\.\/lib\/supabase"/.test(page), false, "no new sender on the page");
    // The row buttons only open the confirmation or the form.
    assert.match(page, /onMakeCard=\{\(r\) => setCardFor\(r\)\}/);
  });
});
