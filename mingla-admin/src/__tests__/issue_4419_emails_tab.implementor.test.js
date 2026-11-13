// Issue #4419 — Admin shows the exact email that went out, and where it is
// in its life. Implementor tests for the Emails tab and one email's page.
//
//   E-1  addresses: old Scheduled / Sent / History links open Emails (with
//        the Scheduled filter kept); #/email/<uuid> opens that email and is
//        never rewritten; anything else is not an email id (SC-10)
//   E-2  failure codes in plain words; unknown is "other"; the partial count
//   E-3  the list: loading, error (never "No emails yet"; Try again calls
//        again), empty, no matches, populated; non-admins get the Scheduled
//        chips only (SC-9)
//   E-4  every state of one email's page: pill, frame label, banner, actions;
//        legacy sends say Rebuilt; cancelled names who; the design's
//        corrections (no time-left guess, "Counted when it was scheduled",
//        no "Send to the rest") (SC-5, SC-6, SC-8)
//   E-5  the frame: sandbox="allow-popups" only, srcdoc is the stored HTML,
//        plain text is a text node
//   E-6  after it left us: opens labelled approximate, "Click tracking is
//        off" while no click event exists, no measured-looking zeros
//   E-7  sending refresh stops when it leaves Sending and when the page closes
//   E-8  export is counts and reasons only; Duplicate keeps words and audience
//   E-9  dialogs close by clicking outside, Escape, then × (Modal)
//   R-1..R-5  tester rework (P2-1 wording, P3-1..P3-4)
//
// FAILS-ON-REVERT: putting the old Scheduled / Sent views back in
// lib/emailViews.js reds E-1; dropping the rebuilt branch from bannersFor reds
// E-4; showing a 0 for clicks without click events reds E-6.
//
// Run: node --test src/__tests__/issue_4419_emails_tab.implementor.test.js
// (from mingla-admin, after `npm ci`; components are built with esbuild and
// Supabase is replaced by a stub, so nothing leaves this machine).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  EMAIL_VIEWS,
  emailDetailHash,
  emailDetailIdFromHash,
  emailListFilterFromHash,
  emailViewFromHash,
  emailViewHash,
} from "../lib/emailViews.js";
import { redirectHash } from "../lib/adminRoutes.js";
import { EMAIL_FAILURE_WORDS, emailFailureWords, partialCountWords } from "../lib/emailFailureWords.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
let h;

before(async () => {
  let esbuild;
  try { esbuild = await import("esbuild"); } catch { assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test"); }
  const fake = {
    name: "fake-supabase",
    setup(build) {
      build.onResolve({ filter: /lib\/supabase(\.js)?$/ }, () => ({ path: "fake-supabase", namespace: "fake" }));
      build.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
        loader: "js",
        contents: `
export const supabase = {
  rpc: () => Promise.resolve({ data: null, error: null }),
  from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
  storage: { from: () => ({}) },
  auth: { getSession: () => Promise.resolve({ data: { session: null } }), refreshSession: () => Promise.resolve({}), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
};
export const SESSION_EXPIRED_MESSAGE = "Your session expired.";
export const SUPABASE_URL = "https://fake.test"; export const SUPABASE_ANON_KEY = "fake";
export async function invokeWithRefresh() { return { data: null, error: null }; }
`,
      }));
    },
  };
  const contents = `
import { renderToStaticMarkup } from "react-dom/server";
import { EmailsListBody } from "../components/email/campaigns/EmailsListView.jsx";
import { EmailDetailBody } from "../components/email/campaigns/EmailDetailPage.jsx";
import { EmailViewer } from "../components/email/campaigns/EmailViewer.jsx";
import * as model from "../components/email/campaigns/campaignModel.js";
export { model };
export function list(props) { return renderToStaticMarkup(<EmailsListBody now={Date.parse("2026-11-13T12:00:00Z")} onFilter={() => {}} onQuery={() => {}} onRetry={() => {}} onOpen={() => {}} onWrite={() => {}} onPage={() => {}} {...props} />); }
export function detail(props) { return renderToStaticMarkup(<EmailDetailBody onBack={() => {}} onRetry={() => {}} onAction={() => {}} {...props} />); }
export function viewer(props) { return renderToStaticMarkup(<EmailViewer {...props} />); }
export function listElement(props) { return EmailsListBody({ onFilter() {}, onQuery() {}, onOpen() {}, onWrite() {}, onPage() {}, ...props }); }
`;
  const out = await esbuild.build({
    stdin: { contents, resolveDir: HERE, sourcefile: "issue4419.harness.jsx", loader: "jsx" },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    plugins: [fake],
    loader: { ".js": "jsx", ".png": "dataurl", ".svg": "dataurl", ".css": "empty" },
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4419-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  h = await import(pathToFileURL(file).href);
});

const ID = "44190000-0000-4000-8000-0000000000e1";
const HTML = '<!doctype html><html><body><h1>Lagos this weekend, Maya</h1><a href="https://usemingla.com/blog/x">Read</a></body></html>';
const TEXT = "Hi Maya,\n\n<script>alert(1)</script> rooftops";

function fixture(state, extra = {}) {
  const base = {
    campaign: {
      id: ID, subject: "Lagos this weekend: 5 rooftop nights", state, state_label: null, raw_status: state,
      from: { name: "Mingla", email: "hello@campaigns.usemingla.com" }, to_label: null, recipient_type: "bulk",
      audience: { mode: "segment", filters: { city: "Lagos" } }, created_at: "2026-11-12T13:02:00Z", created_by_name: "Abimbola A.",
      scheduled_for: "2026-11-15T08:00:00Z", timezone: "Africa/Lagos", started_at: null, completed_at: null,
      cancelled_at: null, cancelled_by_name: null, rescheduled: [], can_change: true, document: [{ type: "rich_text", html: "<p>Hi</p>" }],
    },
    counts: { matched: 7412, internal: 18, no_consent: 301, unsubscribed: 196, no_contact: 31, duplicate: 16, to_send: 6850, accepted: 0, failed: 0, pending: 0 },
    view: { kind: "preview", subject: "Lagos this weekend: 5 rooftop nights", preheader: "Plus a new guide", html: HTML, text: TEXT, rendered_at: null, notes: [] },
    failure: { summary_code: null, raw: null, by_reason: [] },
    engagement: null,
  };
  const merged = { ...base, ...extra, campaign: { ...base.campaign, ...(extra.campaign || {}) }, counts: { ...base.counts, ...(extra.counts || {}) }, view: { ...base.view, ...(extra.view || {}) } };
  return merged;
}

const STATES = {
  scheduled: fixture("scheduled"),
  sending: fixture("sending", { campaign: { started_at: "2026-11-13T09:00:04Z", can_change: false }, counts: { accepted: 2140, pending: 4710 }, view: { kind: "exact", rendered_at: "2026-11-13T09:00:04Z" } }),
  sent: fixture("sent", { campaign: { started_at: "2026-11-08T08:00:03Z", completed_at: "2026-11-08T08:06:00Z", can_change: false }, counts: { accepted: 6842, failed: 8 }, view: { kind: "exact", rendered_at: "2026-11-08T08:00:03Z" },
    engagement: { accepted: 6842, events: 9000, delivered: 6790, bounced: { hard: 30, soft: 4 }, complained: 1, opened_unique: 2100, opened_total: 3300, clicked_unique: 0, clicked_total: 0, top_links: [], tracking: { opens_seen: true, clicks_seen: false, clicks_seen_anywhere: false } } }),
  partial: fixture("partial", { campaign: { started_at: "2026-11-01T08:00:02Z", completed_at: "2026-11-01T08:04:00Z", can_change: false }, counts: { accepted: 4102, failed: 2748 }, view: { kind: "exact" },
    failure: { summary_code: "rate_limited", raw: "Resend 429: Too many requests. You can only make 2 requests per second.", by_reason: [{ code: "rate_limited", count: 2748 }] } }),
  failed: fixture("failed", { campaign: { started_at: "2026-11-03T12:00:05Z", completed_at: "2026-11-03T12:00:11Z", can_change: false }, counts: { accepted: 0, failed: 0 }, view: { kind: "exact" },
    failure: { summary_code: "provider_key", raw: "Resend 401: API key is invalid", by_reason: [{ code: "provider_key", count: 214 }] } }),
  cancelled: fixture("cancelled", { campaign: { cancelled_at: "2026-11-13T10:20:00Z", cancelled_by_name: "Seth O.", completed_at: "2026-11-13T10:20:00Z", can_change: false } }),
  legacy: fixture("sent", { campaign: { scheduled_for: null, started_at: "2026-10-02T09:00:00Z", completed_at: "2026-10-02T09:03:00Z", can_change: false }, counts: { accepted: 3911, failed: 2 }, view: { kind: "rebuilt", notes: ["blog_from_saved_snapshot"] } }),
};

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("E-1 addresses", () => {
  it("one Emails tab replaces Scheduled and Sent; old links still open it", () => {
    assert.deepEqual(EMAIL_VIEWS.map((v) => v.id), ["write", "emails", "templates", "unsubscribes"]);
    assert.equal(emailViewFromHash("#/email?view=scheduled"), "emails");
    assert.equal(emailListFilterFromHash("#/email?view=scheduled"), "scheduled", "the #4383 Overview link keeps its filter");
    assert.equal(emailViewFromHash("#/email?view=sent"), "emails");
    assert.equal(emailListFilterFromHash("#/email?view=sent"), "all");
    assert.equal(emailViewFromHash("#/email?view=history"), "emails");
    assert.equal(emailListFilterFromHash("#/email?view=emails&filter=attention"), "attention");
    assert.equal(emailListFilterFromHash("#/email?view=emails&filter=__proto__"), "all");
    assert.equal(emailViewHash("emails", "attention"), "#/email?view=emails&filter=attention");
    assert.equal(emailViewHash("emails"), "#/email?view=emails");
  });
  it("#/email/<uuid> opens that email and nothing rewrites it", () => {
    assert.equal(emailDetailIdFromHash(`#/email/${ID}`), ID);
    assert.equal(emailDetailIdFromHash(`#/email/${ID.toUpperCase()}?x=1`), ID);
    for (const bad of ["#/email/123", "#/email/../../admin", `#/email/${ID}/extra`, "#/email", "#/emails/" + ID, "#/email/' or 1=1"]) {
      assert.equal(emailDetailIdFromHash(bad), null, bad);
    }
    assert.equal(redirectHash(`#/email/${ID}`), null, "redirectHash leaves an email page alone");
    assert.equal(emailDetailHash(ID), `#/email/${ID}`);
    assert.equal(emailDetailHash("nope"), "#/email?view=emails");
  });
  it("the page routes the list and the detail; the old Scheduled and Sent views are gone", () => {
    const page = read("pages/EmailPage.jsx");
    assert.match(page, /activeSubTab === "emails" && address\.detailId && \(\s*<EmailDetailPage/);
    assert.match(page, /activeSubTab === "emails" && !address\.detailId && \(\s*<EmailsListView/);
    assert.doesNotMatch(page, /function ScheduledSubView|function HistorySubView|catch \{\s*\/\/ Table may not exist\s*\}\s*\}, \[\]\);\s*useEffect\(\(\) => \{ fetchHistory/);
    assert.doesNotMatch(page, /from\("admin_email_log"\)\s*\.select\("\*"/, "the page never reads the whole campaign table");
  });
});

describe("E-2 failure words", () => {
  it("each code has its sentence; unknown is other", () => {
    assert.equal(emailFailureWords("rate_limited"), "Our email provider paused us for sending too fast, partway through.");
    assert.equal(emailFailureWords("provider_key"), "The email provider turned down our sending key, so nobody got this email. An engineer needs to update the key.");
    assert.equal(emailFailureWords("invalid_address"), "Some addresses were turned down as invalid.");
    assert.equal(emailFailureWords("provider_down"), "The email provider didn't answer.");
    assert.equal(emailFailureWords("blog_post_not_published"), "The blog post in this email was unpublished, so we stopped sending.");
    assert.equal(emailFailureWords("email_snapshot_failed"), "We couldn't save a copy of this email, so we didn't send it. Tell engineering.");
    assert.equal(emailFailureWords("nope"), EMAIL_FAILURE_WORDS.other);
    assert.equal(emailFailureWords("__proto__"), EMAIL_FAILURE_WORDS.other);
    assert.equal(emailFailureWords(undefined), EMAIL_FAILURE_WORDS.other);
    assert.equal(partialCountWords(4102, 2748), "4,102 people got it. 2,748 did not.");
    assert.equal(partialCountWords(1, 1), "1 person got it. 1 did not.");
  });
});

const ROWS = [
  { id: ID, subject: "Lagos this weekend", preheader: "Plus a guide", thumb_url: "https://cdn.test/a.png", audience: { mode: "segment", filters: { city: "Lagos" } }, recipient_type: "bulk", by_name: "Abimbola A.", state: "scheduled", state_label: "Scheduled", scheduled_for: "2026-11-15T08:00:00Z", timezone: "Africa/Lagos", matched: 7412, will_receive: 6850, accepted: 0, failed: 0, has_snapshot: false, delivered: null },
  { id: "44190000-0000-4000-8000-0000000000e2", subject: "Old launch", preheader: "", thumb_url: null, audience: { mode: "everyone" }, recipient_type: "bulk", by_name: null, state: "sent", state_label: "Sent", completed_at: "2026-11-08T08:06:00Z", timezone: "UTC", matched: 4120, will_receive: 3913, accepted: 3911, failed: 2, has_snapshot: false, delivered: 3800 },
  { id: "44190000-0000-4000-8000-0000000000e3", subject: "Welcome", preheader: "Steps", thumb_url: null, audience: { mode: "person" }, recipient_type: "individual", to_label: "maya.o@…", by_name: "Seth O.", state: "sending", state_label: "Starting", matched: 1, will_receive: 1, accepted: 0, failed: 0, has_snapshot: false, delivered: null },
];
const COUNTS = { all: 3, scheduled: 1, sending: 1, sent: 1, attention: 0, cancelled: 0 };

describe("E-3 the list in every state", () => {
  it("loading: five skeleton rows, busy", () => {
    const html = h.list({ status: "loading", isAdmin: true });
    assert.equal((html.match(/data-skeleton-row=""/g) || []).length, 5);
    assert.match(html, /aria-busy="true"/);
  });
  it("error: says it couldn't load, offers Try again, never 'No emails yet'", () => {
    const html = h.list({ status: "error", isAdmin: true, error: { message: "Failed to fetch" } });
    assert.match(html, /Couldn(&#x27;|')t load your emails/);
    assert.match(html, />Try again</);
    assert.doesNotMatch(html, /No emails yet/);
    // Try again calls the loader.
    let retried = 0;
    const tree = h.listElement({ status: "error", isAdmin: true, error: null, onRetry: () => { retried += 1; } });
    const find = (node) => {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) { for (const n of node) { const f = find(n); if (f) return f; } return null; }
      if (node.props?.children === "Try again" && node.props?.onClick) return node;
      return find(node.props?.children);
    };
    const button = find(tree);
    assert.ok(button, "a Try again button");
    button.props.onClick();
    assert.equal(retried, 1);
  });
  it("empty: No emails yet with Write an email", () => {
    const html = h.list({ status: "ready", rows: [], counts: { ...COUNTS, all: 0, scheduled: 0, sending: 0, sent: 0 }, total: 0, isAdmin: true });
    assert.match(html, /No emails yet/);
    assert.match(html, />Write an email</);
  });
  it("no matches: Nothing matches with Show all emails", () => {
    const html = h.list({ status: "ready", rows: [], counts: COUNTS, total: 0, filter: "cancelled", query: "zz", isAdmin: true });
    assert.match(html, /Nothing matches/);
    assert.match(html, /for “zz”/);
    assert.match(html, />Show all emails</);
  });
  it("populated: one button per email, pill, the time that matters, counts, footer", () => {
    const html = h.list({ status: "ready", rows: ROWS, counts: COUNTS, total: 3, isAdmin: true });
    assert.equal((html.match(/data-email-row="/g) || []).length, 3);
    assert.match(html, /<button type="button" data-email-row="44190000-0000-4000-8000-0000000000e1"/);
    assert.match(html, /Goes out Sun 15 Nov · 09:00 \(Africa\/Lagos\) · in 2 days/);
    assert.match(html, /Sent 5 days ago · before exact copies/);
    assert.match(html, />Starting</);
    assert.match(html, /Starting now/);
    assert.match(html, /6,850<\/b> will get it/);
    assert.match(html, /3,911<\/b> accepted/);
    assert.match(html, /4,120 matched · 3,800 delivered/);
    assert.match(html, /One person · maya\.o@…/);
    assert.match(html, /src="https:\/\/cdn\.test\/a\.png"/);
    assert.match(html, /Newest first · scheduled emails pinned on top/);
    assert.match(html, /1–3 of 3/);
    for (const chip of ["All", "Scheduled", "Sending", "Sent", "Needs attention", "Cancelled"]) assert.match(html, new RegExp(`aria-pressed="(true|false)"[^>]*>${chip}<`), chip);
  });
  it("a teammate who is not an admin gets the Scheduled chips and is told why", () => {
    const html = h.list({ status: "ready", rows: [ROWS[0]], counts: { ...COUNTS, all: 1, sent: 0, sending: 0 }, total: 1, isAdmin: false });
    assert.doesNotMatch(html, />Sent<|>Needs attention<|>Cancelled</);
    assert.match(html, /Only admins see sent emails/);
  });
});

describe("E-4 one email's page in every state", () => {
  const expectations = {
    scheduled: { pill: "Scheduled", label: "Preview", banner: "Not sent yet. This is a preview.", actions: "change_time,edit_words,send_test,cancel" },
    sending: { pill: "Sending", label: "Exact copy", banner: "Sending now", actions: "change_time" },
    sent: { pill: "Sent", label: "Exact copy", banner: "Exact copy of what was sent", actions: "duplicate,send_test,export" },
    partial: { pill: "Partially sent", label: "Exact copy", banner: "Partially sent: 4,102 of 6,850 got it", actions: "duplicate,send_test,export" },
    failed: { pill: "Failed", label: "Exact copy", banner: "Failed. Nobody got this email.", actions: "duplicate,export" },
    cancelled: { pill: "Cancelled", label: "Preview", banner: "Cancelled by Seth O.", actions: "duplicate" },
    legacy: { pill: "Sent", label: "Rebuilt", banner: "Rebuilt from saved blocks", actions: "duplicate,send_test,export" },
  };
  for (const [name, want] of Object.entries(expectations)) {
    it(`${name}: pill, frame label, banner, actions`, () => {
      const html = h.detail({ status: "ready", detail: STATES[name], isAdmin: true });
      assert.match(html, new RegExp(`>${want.pill}<`));
      assert.match(html, new RegExp(`data-view-label="[a-z]+"[^>]*>${want.label}<`));
      assert.ok(decode(html).includes(want.banner), `${name} banner: ${want.banner}`);
      assert.match(html, new RegExp(`data-actions="${want.actions}"`));
      assert.doesNotMatch(html, /Send to the rest/, "no Send to the rest (D2)");
      assert.doesNotMatch(html, /min left/, "no time-left guess");
    });
  }
  it("the design's corrections and the plain-English failures (SC-8)", () => {
    const scheduled = decode(h.detail({ status: "ready", detail: STATES.scheduled, isAdmin: true }));
    assert.ok(scheduled.includes("Counted when it was scheduled. Anyone who unsubscribes before then is skipped."));
    assert.ok(!scheduled.includes("Recounted when it sends"));
    const sent = decode(h.detail({ status: "ready", detail: STATES.sent, isAdmin: true }));
    assert.ok(sent.includes("Saved when sending started, for a sample person (Maya). Personal fields like first name were filled in for each person."));
    const partial = decode(h.detail({ status: "ready", detail: STATES.partial, isAdmin: true }));
    assert.ok(partial.includes("Our email provider paused us for sending too fast, partway through. 4,102 people got it. 2,748 did not."));
    // The raw provider text only under the fold.
    const fold = partial.indexOf("Technical detail for engineering");
    assert.ok(fold > 0);
    assert.ok(partial.indexOf("Resend 429") > fold, "raw text only inside the fold");
    const failed = decode(h.detail({ status: "ready", detail: STATES.failed, isAdmin: true }));
    assert.ok(failed.includes("An engineer needs to update the key."));
    assert.ok(failed.includes("Not sent"));
  });
  it("the timeline matches the row (SC-6)", () => {
    const steps = (d) => h.model.timelineSteps(d).map((s) => [s.tone, s.label, s.value, s.who]);
    assert.deepEqual(steps(STATES.scheduled).map((s) => s.slice(0, 3)), [["done", "Created", "Thu 12 Nov · 14:02 (Africa/Lagos)"], ["done", "Scheduled for", "Sun 15 Nov · 09:00 (Africa/Lagos)"], ["todo", "Sending started", "Not yet"], ["todo", "Finished", "Not yet"]]);
    assert.equal(steps(STATES.scheduled)[0][3], "by Abimbola A.");
    assert.deepEqual(steps(STATES.sending).slice(2).map((s) => s.slice(0, 2).concat(s[3])), [["now", "Sending started", "In progress"], ["todo", "Finished", ""]]);
    assert.equal(steps(STATES.sending)[3][2], "Not yet", "no time-left estimate");
    assert.deepEqual(steps(STATES.sent)[3].slice(0, 2), ["done", "Finished"]);
    assert.deepEqual(steps(STATES.partial)[3].slice(0, 2), ["half", "Stopped early"]);
    assert.deepEqual(steps(STATES.failed)[3], ["bad", "Failed", "Tue 3 Nov · 13:00 (Africa/Lagos)", "Nobody got it"]);
    assert.deepEqual(steps(STATES.cancelled)[2], ["off", "Cancelled", "Fri 13 Nov · 11:20 (Africa/Lagos)", "by Seth O."]);
    const oldCancel = fixture("cancelled", { campaign: { cancelled_at: "2026-11-13T10:20:00Z", cancelled_by_name: null } });
    assert.equal(steps(oldCancel)[2][3], "by someone, before this was recorded");
    assert.deepEqual(steps(STATES.legacy)[1].slice(1), ["Sent right away", "No schedule", "Send now"]);
    const queued = fixture("sending", { campaign: { state_label: "Starting", started_at: null } });
    assert.equal(steps(queued)[2][2], "Starting now");
    assert.match(h.detail({ status: "ready", detail: queued, isAdmin: true }), /Starting to send/);
  });
  it("loading, error and not found", () => {
    assert.match(h.detail({ status: "loading" }), /data-detail-state="loading"/);
    const err = decode(h.detail({ status: "error", error: { message: "Failed to fetch" } }));
    assert.ok(err.includes("Couldn't open this email"));
    assert.ok(err.includes("Try again") && err.includes("Back to all emails"));
    const missing = decode(h.detail({ status: "not_found" }));
    assert.ok(missing.includes("This email doesn't exist or was removed."));
    assert.ok(!missing.includes(">Try again<"));
  });
  it("only admins get Duplicate and Export on sent emails", () => {
    assert.deepEqual(h.model.actionsFor(STATES.sent, { isAdmin: false }), []);
    assert.deepEqual(h.model.actionsFor(STATES.scheduled, { isAdmin: false }).map((a) => a.id), ["change_time", "edit_words", "send_test", "cancel"]);
    const started = fixture("scheduled", { campaign: { can_change: false } });
    assert.equal(h.model.actionsFor(started).find((a) => a.id === "cancel").disabled, true);
  });
});

describe("E-5 the frame", () => {
  it("the stored HTML in a sandboxed iframe, allow-popups only", () => {
    const html = h.viewer({ detail: STATES.sent });
    const iframe = html.match(/<iframe[^>]*>/)[0];
    assert.match(iframe, /title="Email as sent"/);
    assert.match(iframe, /sandbox="allow-popups"/);
    assert.doesNotMatch(iframe, /allow-scripts|allow-same-origin/);
    const srcdoc = decode(iframe.match(/srcDoc="([^"]*)"|srcdoc="([^"]*)"/).slice(1).find(Boolean));
    assert.equal(srcdoc, HTML);
    assert.match(html, /Mingla &lt;hello@campaigns\.usemingla\.com&gt;/);
    assert.match(html, /Maya \(sample recipient\)/);
  });
  it("plain text is a text node, never HTML", () => {
    const html = h.viewer({ detail: STATES.sent, initialMode: "text" });
    assert.match(html, /<pre data-plain-text=""/);
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /<iframe/);
  });
  it("mobile is 360 px, desktop 640 px", () => {
    assert.match(h.viewer({ detail: STATES.sent, initialWidth: "mobile" }), /max-w-\[360px\]/);
    assert.match(h.viewer({ detail: STATES.sent }), /max-w-\[640px\]/);
  });
});

describe("E-6 after it left us (Part B)", () => {
  it("opens labelled approximate; clicks say tracking is off until a click exists", () => {
    const html = decode(h.detail({ status: "ready", detail: STATES.sent, isAdmin: true }));
    assert.ok(html.includes("After it left us"));
    assert.ok(html.includes("Opened (approximate)"));
    assert.ok(html.includes("Click tracking is off"));
    assert.ok(html.includes("30 permanent · 4 temporary"));
    const view = h.model.engagementView(STATES.sent);
    assert.deepEqual(view.rows.find((r) => r.label === "Clicked"), { label: "Clicked", value: "—", sub: "Click tracking is off" });
  });
  it("no open events: says so instead of a measured zero", () => {
    const d = fixture("sent", { engagement: { ...STATES.sent.engagement, opened_unique: 0, opened_total: 0, tracking: { opens_seen: false, clicks_seen: false, clicks_seen_anywhere: true } } });
    const rows = h.model.engagementView(d).rows;
    assert.deepEqual(rows.find((r) => r.label === "Opened (approximate)"), { label: "Opened (approximate)", value: "—", sub: "Opens aren't tracked for this sender, or nobody opened yet." });
    assert.deepEqual(rows.find((r) => r.label === "Clicked"), { label: "Clicked", value: "—", sub: "No clicks yet." });
  });
  it("clicks and top links once tracking reports them", () => {
    const d = fixture("sent", { engagement: { ...STATES.sent.engagement, clicked_unique: 12, clicked_total: 20, top_links: [{ url: "https://usemingla.com/blog/x", unique: 12, total: 20 }], tracking: { opens_seen: true, clicks_seen: true, clicks_seen_anywhere: true } } });
    const html = decode(h.detail({ status: "ready", detail: d, isAdmin: true }));
    assert.ok(html.includes("20 clicks in all"));
    assert.ok(html.includes("https://usemingla.com/blog/x"));
    assert.ok(html.includes("12 people · 20 clicks"));
  });
  it("a scheduled email has no engagement section; a failed read says so", () => {
    assert.equal(h.model.engagementView(STATES.scheduled), null);
    assert.equal(h.model.engagementView({ ...STATES.sent, engagement: null }).state, "unavailable");
  });
});

describe("E-7 sending refresh", () => {
  function fakeTimers() {
    const timers = { live: new Map(), next: 1 };
    timers.setInterval = (fn) => { const id = timers.next++; timers.live.set(id, fn); return id; };
    timers.clearInterval = (id) => { timers.live.delete(id); };
    timers.tick = async () => { for (const fn of [...timers.live.values()]) await fn(); };
    return timers;
  }
  it("refreshes every 5 s and stops once the email leaves Sending", async () => {
    const timers = fakeTimers();
    const answers = [STATES.sending, STATES.sending, STATES.sent];
    let calls = 0;
    h.model.startSendingPoll({ refresh: async () => answers[calls++], timers });
    assert.equal(h.model.SENDING_POLL_MS, 5000);
    await timers.tick(); await timers.tick();
    assert.equal(timers.live.size, 1, "still sending, still polling");
    await timers.tick();
    assert.equal(timers.live.size, 0, "stopped once it left Sending");
    await timers.tick();
    assert.equal(calls, 3);
  });
  it("stops when the page closes; a failed refresh keeps polling", async () => {
    const timers = fakeTimers();
    let calls = 0;
    const stop = h.model.startSendingPoll({ refresh: async () => { calls += 1; return null; }, timers });
    await timers.tick();
    assert.equal(timers.live.size, 1);
    stop();
    assert.equal(timers.live.size, 0);
    stop();
    await timers.tick();
    assert.equal(calls, 1);
  });
  it("the page wires it to the Sending state and its unmount", () => {
    const page = read("components/email/campaigns/EmailDetailPage.jsx");
    assert.match(page, /if \(!sending\) return undefined;\s*return startSendingPoll\(\{ refresh: \(\) => load\(\{ quiet: true \}\) \}\);\s*\}, \[sending, load\]\);/);
  });
});

describe("E-8 export and duplicate", () => {
  it("export is counts and reasons only, never an address", () => {
    const withPerson = fixture("partial", { ...STATES.partial, campaign: { ...STATES.partial.campaign, to_label: "maya.okafor@example.com" } });
    const rows = h.model.exportRows(withPerson);
    assert.deepEqual(Object.keys(rows[0]), ["measure", "count"]);
    assert.ok(rows.some((r) => r.measure === "Failed: Our email provider paused us for sending too fast, partway through." && r.count === "2748"));
    assert.equal(JSON.stringify(rows).includes("@"), false);
    const sentRows = h.model.exportRows(STATES.sent);
    assert.deepEqual(sentRows.find((r) => r.measure === "Clicked (people)"), { measure: "Clicked (people)", count: "click tracking is off" });
  });
  it("Duplicate keeps the words and blocks; its audience goes through the drafts' host-default guard", () => {
    const d = h.model.duplicateDraft(STATES.sent);
    assert.equal(d.subject, STATES.sent.campaign.subject);
    assert.deepEqual(d.document, STATES.sent.campaign.document);
    assert.deepEqual(d.audience, { audienceMode: "segment", filters: { city: "Lagos" } });
    assert.deepEqual(h.model.duplicateDraft(fixture("sent", { campaign: { audience: { mode: "everyone" } } })).audience, { audienceMode: "everyone", filters: {} });
    const composer = read("components/email/EmailComposer.jsx");
    assert.match(composer, /initialDraft = null \}\) \{/);
    // The composer never applies a duplicated audience directly (#3720 guard).
    assert.match(composer, /applyComposerState\(composerStateFromDraft\(initialDraft, EMPTY_FILTERS\)\);/);
  });
});

describe("E-9 dialogs close by clicking outside, Escape, then ×", () => {
  it("the shared Modal closes on a backdrop click, Escape and its Close button", () => {
    const modal = read("components/ui/Modal.jsx");
    assert.match(modal, /onMouseDown=\{\(e\) => \{ if \(e\.target === overlayRef\.current\) onClose\(\); \}\}/);
    assert.match(modal, /if \(e\.key !== "Escape"\) return;/);
    assert.match(modal, /aria-label="Close"/);
    const actions = read("components/email/campaigns/EmailActions.jsx");
    // A dialog that is busy refuses to close mid-request.
    assert.equal((actions.match(/onClose=\{\(\) => \(busy \? null : onClose\(\)\)\}/g) || []).length, 2);
  });
});

describe("R tester rework", () => {
  it("R-1 (P2-1) an unreadable copy after some were sent never says we didn't send it", () => {
    const d = fixture("partial", { campaign: { started_at: "2026-11-01T08:00:02Z", completed_at: "2026-11-01T08:04:00Z", can_change: false }, counts: { accepted: 640, failed: 0 }, view: { kind: "exact" },
      failure: { summary_code: "email_snapshot_failed", raw: "email_snapshot_failed:email_snapshot_document_invalid", by_reason: [] } });
    const html = decode(h.detail({ status: "ready", detail: d, isAdmin: true }));
    assert.ok(!html.includes("so we didn't send it"), "no 'we didn't send it' when 640 got it");
    assert.ok(html.includes("We couldn't read the saved copy of this email partway through, so we stopped sending."));
    assert.ok(html.includes("Partially sent: 640 of 6,850 got it"));
    // Nobody got it: the D7 words stay.
    const none = fixture("failed", { counts: { accepted: 0 }, view: { kind: "preview" }, failure: { summary_code: "email_snapshot_failed", raw: "x", by_reason: [] } });
    assert.ok(decode(h.detail({ status: "ready", detail: none, isAdmin: true })).includes("so we didn't send it"));
  });
  it("R-2 (P3-1) a new address on the Email page re-opens the list with its filter", () => {
    const page = read("pages/EmailPage.jsx");
    assert.match(page, /return \{\s*hash,\s*view: detailId/);
    assert.match(page, /<EmailsListView\s+(?:\/\/[^\n]*\n\s*)*key=\{address\.hash\}/);
    assert.match(page, /initialFilter=\{address\.filter\}/);
    assert.match(page, /window\.addEventListener\("hashchange", sync\)/);
  });
  it("R-3 (P3-2) relative times round to the nearest unit", () => {
    const now = Date.parse("2026-11-13T12:00:00Z");
    const at = (ms) => new Date(now + ms).toISOString();
    const H = 3_600_000;
    assert.equal(h.model.relativeWords(at(47 * H + 59 * 60_000), now), "in 2 days");
    assert.equal(h.model.relativeWords(at(36 * H), now), "in 2 days");
    assert.equal(h.model.relativeWords(at(30 * H), now), "in 1 day");
    assert.equal(h.model.relativeWords(at(23 * H + 40 * 60_000), now), "in 1 day");
    assert.equal(h.model.relativeWords(at(90 * 60_000), now), "in 2 hours");
    assert.equal(h.model.relativeWords(at(59 * 60_000 + 40_000), now), "in 1 hour");
    assert.equal(h.model.relativeWords(at(-5 * 24 * H), now), "5 days ago");
    assert.equal(h.model.relativeWords(at(20_000), now), "just now");
  });
  it("R-4 (P3-3) error screens speak plainly; the raw code only under the fold", () => {
    const server = { message: "campaign_list_failed:boom", status: 500 };
    const html = decode(h.list({ status: "error", isAdmin: true, error: server }));
    assert.ok(html.includes("Something went wrong on our side. Nothing was changed."));
    assert.ok(!/connection/i.test(html), "a server error never blames the connection");
    const fold = html.indexOf("Technical detail for engineering");
    assert.ok(fold > 0 && html.indexOf("campaign_list_failed") > fold, "the code only inside the fold");
    const network = decode(h.list({ status: "error", isAdmin: true, error: { name: "TypeError", message: "Failed to fetch" } }));
    assert.ok(network.includes("We couldn't reach the server. Check your connection and try again."));
    const detail = decode(h.detail({ status: "error", error: { message: "campaign_read_failed:timeout", status: 500 } }));
    assert.ok(detail.includes("Something went wrong on our side."));
    assert.ok(detail.indexOf("campaign_read_failed") > detail.indexOf("Technical detail for engineering"));
    assert.ok(!/connection dropped/i.test(detail));
    for (const page of ["components/email/campaigns/EmailDetailPage.jsx", "components/email/campaigns/EmailsListView.jsx"]) {
      assert.doesNotMatch(read(page), /communicationsErrorMessage|The connection dropped/, page);
    }
  });
  it("R-5 (P3-4) the heading shows the subject as Maya saw it", () => {
    const d = fixture("sent", { campaign: { subject: "Lagos this weekend, {first_name}" }, view: { kind: "exact", subject: "Lagos this weekend, Maya" } });
    const html = decode(h.detail({ status: "ready", detail: d, isAdmin: true }));
    const heading = html.match(/<h2[^>]*>([^<]*)<\/h2>/)[1];
    assert.equal(heading, "Lagos this weekend, Maya");
    assert.ok(!html.includes("{first_name}"));
  });
  it("R-7 (P3-1) all seven personal fields are filled in the list row", () => {
    const rows = [{ ...ROWS[0], subject: "{name} {first_name}", preheader: "{display_name}|{username}|{country}|{language}|{joined_date}" }];
    const html = decode(h.list({ status: "ready", rows, counts: {}, total: 1, filter: "all", query: "", page: 0, isAdmin: true }));
    assert.ok(html.includes("Maya Okafor|@mayaexplores|Nigeria|English|15 Jan 2026"), "preview line");
    assert.ok(html.includes("Maya Maya"), "subject");
    assert.ok(!/\{[a-z_]+\}/.test(html.replace(/<[^>]*>/g, " ")), "no token left");
  });
  it("R-6 the list row shows the subject and preview line as Maya sees them, never {first_name}", () => {
    const rows = [{ ...ROWS[0], subject: "Lagos, {first_name}", preheader: "{first_name}, five rooftops this weekend" }];
    const html = decode(h.list({ status: "ready", rows, counts: {}, total: 1, filter: "all", query: "", page: 0, isAdmin: true }));
    assert.ok(html.includes("Maya, five rooftops this weekend"));
    assert.ok(html.includes("Lagos, Maya"));
    assert.ok(!html.includes("{first_name}"));
  });
});
