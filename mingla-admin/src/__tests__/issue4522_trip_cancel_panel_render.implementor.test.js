// MINGLA-INVARIANT: I-4522-TRIP-CANCEL-PANEL-RENDERS | issue #4522 | The Refund operations trip cancel panel is compiled and rendered in a test (a syntax error turns it red); a refused part shows its real amount and state in the queue row and the panel; after an action the panel is a new instance for the new state.
// Issue #4522 pass 9 (P9-1, P9-6). The panel is BUILT with esbuild and
// RENDERED with react-dom/server, never read as text.
//
//   G-1  the panel compiles and renders a refused part: title, amount,
//        "Refused by Paystack", the "partly refunded already" choice and its
//        figure field
//   G-2  an unanswered part renders the record / escalate choices
//   G-3  the queue row of a refused-only cancel shows the refused amount and
//        names it refused (it showed "part unconfirmed, NGN 0.00")
//   G-4  the panel key changes when the item's state changes (fresh form)
//
// FAILS-ON-REVERT: removing the "}" closing the reference label (P9-1) makes
// the build in before() throw, so every test fails; the old queue row model
// (unconfirmed only) fails G-3; keying the panel by refund id only fails G-4.
//
// Run: node --test src/__tests__/issue4522_trip_cancel_panel_render.implementor.test.js
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { supabaseStubPlugin } from "./_supabaseStubPlugin.mjs";
import { workspacePackagesPlugin } from "./_workspacePackagesPlugin.mjs";
import { queueRowModel, tripCancelPanelKey } from "../lib/refundOperationsView.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let h;
before(async () => {
  let esbuild;
  try { esbuild = await import("esbuild"); } catch { assert.fail("esbuild is not installed: run `npm ci` in mingla-admin"); }
  const out = await esbuild.build({
    stdin: {
      contents: `import { renderToStaticMarkup } from "react-dom/server";
import { TripCancelRefundPanel } from "../components/refunds/TripCancelRefundPanel.jsx";
const money = (cents, cur) => cur + " " + (cents / 100).toFixed(2);
export const panel = (detail) => renderToStaticMarkup(<TripCancelRefundPanel detail={detail} money={money} busy={false} error="" onResolve={() => {}} />);`,
      resolveDir: HERE, sourcefile: "issue4522.panel.harness.jsx", loader: "jsx",
    },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    loader: { ".js": "jsx" },
    banner: { js: 'import { createRequire as __r } from "node:module"; const require = __r(import.meta.url);' },
    plugins: [supabaseStubPlugin, workspacePackagesPlugin],
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"VITE_SUPABASE_URL":"https://x.supabase.test","VITE_SUPABASE_ANON_KEY":"test"}' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4522-panel-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  h = await import(pathToFileURL(file).href);
});

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
const refused = {
  refund_id: "r-1", order_id: "o-1", trip_name: "Lagos weekend", currency: "ngn", provider: "paystack",
  cancel_amount_cents: 100000000, unconfirmed_amount_cents: 0, refused_amount_cents: 100000000, waiting_since: old,
  charges: [{ attempt_id: "a-1", part: "deposit", ordinal: null, amount_cents: 100000000, currency: "ngn", state: "refused",
    actionable: true, outcomes: ["refunded_elsewhere", "escalate"], charge_cents: 100000000, ops_resolution: null, waiting_since: old }],
};

describe("G-1 / G-2 the panel compiles and renders each part's real state", () => {
  it("a refused part: title, amount, state and the 'partly refunded already' figure", () => {
    const out = text(h.panel(refused));
    assert.match(out, /Trip cancel, part refused by Paystack/);
    assert.match(out, /NGN 1000000\.00/);
    assert.match(out, /Refused by Paystack/);
    assert.match(out, /Paystack shows it partly refunded already/);
    assert.match(out, /Already refunded on this payment \(NGN\)/);
    assert.match(out, /Reference of that other Paystack refund/);
    assert.match(out, /Ask only for what is left/);
  });
  it("an unanswered part: record or escalate", () => {
    const out = text(h.panel({
      ...refused, unconfirmed_amount_cents: 30000000, refused_amount_cents: 0,
      charges: [{ ...refused.charges[0], state: "unanswered", amount_cents: 30000000, outcomes: ["refunded_at_provider", "escalate"] }],
    }));
    assert.match(out, /Trip cancel, part unconfirmed/);
    assert.match(out, /Sent, no answer/);
    assert.match(out, /Paystack refund reference/);
    assert.match(out, /Record refund and finish cancel/);
  });
});

describe("G-3 the queue row shows what is owed on a refused part", () => {
  it("refused only: its amount and state, never 0.00 unconfirmed", () => {
    const row = queueRowModel({ itemKind: "trip_cancel_refund", itemId: "r-1", safeSummary: refused });
    assert.equal(row.amountCents, 100000000);
    assert.equal(row.source, "Trip cancel, part refused by Paystack");
  });
  it("unanswered and refused together add up", () => {
    const row = queueRowModel({ itemKind: "trip_cancel_refund", itemId: "r-1", safeSummary: { ...refused, unconfirmed_amount_cents: 5 } });
    assert.equal(row.amountCents, 100000005);
  });
});

describe("G-4 after an action the panel is a fresh instance for the new state", () => {
  it("the key changes when a part's amount, state or staff record changes", () => {
    const before = tripCancelPanelKey(refused);
    const resized = { ...refused, cancel_amount_cents: 50000000,
      charges: [{ ...refused.charges[0], amount_cents: 50000000, ops_resolution: { outcome: "refunded_elsewhere", at: "t" } }] };
    assert.notEqual(tripCancelPanelKey(resized), before);
    assert.equal(tripCancelPanelKey(refused), before);
  });
});

// Pass 10 (P10-3): an owed part below Paystack's minimum, rendered.
const belowMin = {
  refund_id: "r-b", order_id: "o-b", trip_name: "Tiny trip", currency: "ngn", provider: "paystack",
  cancel_amount_cents: 3000, unconfirmed_amount_cents: 0, refused_amount_cents: 0, below_minimum_amount_cents: 3000,
  waiting_since: new Date().toISOString(),
  charges: [{ attempt_id: "b-1", part: "deposit", ordinal: null, amount_cents: 3000, currency: "ngn", state: "below_minimum",
    actionable: true, outcomes: ["paid_outside_provider", "escalate"], charge_cents: 30000, ops_resolution: null,
    waiting_since: new Date().toISOString() }],
};
describe("P10-3 below the provider minimum", () => {
  it("renders the state, the exact amount, paid outside Paystack with its reference field, and escalate", () => {
    const html = text(h.panel(belowMin));
    assert.match(html, /Trip cancel, owed amount below Paystack's minimum/);
    assert.match(html, /Below Paystack's minimum, not sent/);
    assert.match(html, /NGN 30\.00/);
    assert.match(html, /Paid to the traveler outside Paystack: record it/);
    assert.match(html, /Reference of your payment to the traveler/);
    assert.match(html, /Pay the traveler exactly NGN 30\.00 another way/);
    assert.match(html, /Record payment and finish cancel/);
    assert.match(html, /Escalate/);
    assert.doesNotMatch(html, /sent in the last 15 minutes/);
  });
  it("the queue row names it and its amount", () => {
    const row = queueRowModel({ itemKind: "trip_cancel_refund", itemId: "r-b", safeSummary: belowMin });
    assert.match(JSON.stringify(row), /below Paystack's minimum/);
  });
});
