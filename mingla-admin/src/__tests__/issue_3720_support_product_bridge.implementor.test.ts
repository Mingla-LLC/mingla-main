// [TEST-MOD #4382] Rewritten for the Support Desk redesign. The rules this
// suite has always pinned still hold, now against the new files:
//   - the inbox tells customer tickets from staff tickets, and staff threads
//     are support tickets (no separate table);
//   - staff reply with no promise; "Send and wait" sets one;
//   - every workflow write is a gated RPC or support-send, never a browser
//     table write;
//   - Send to Product says plainly it stays inside Mingla until Triage;
//   - no model service is embedded;
//   - "is this already on the board?" matching is deterministic.
import {
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { searchOpenItems } from "../components/support/productBoardModel.js";

const read = (relative: string) => Deno.readTextFile(new URL(`../${relative}`, import.meta.url));
const page = await read("pages/SupportDeskPage.jsx");
const panel = await read("components/support/TicketPanel.jsx");
const composer = await read("components/support/SupportComposer.jsx");
const model = await read("components/support/supportComposerModel.js");
const metrics = await read("lib/supportTicketMetrics.js");
const service = await read("services/supportProductWorkflowService.js");
const desk = await read("services/supportDeskService.js");
const sendToProduct = await read("components/support/SendToProductModal.jsx");
const supportSend = await Deno.readTextFile(
  new URL("../../../supabase/functions/support-send/index.ts", import.meta.url),
);

Deno.test("the inbox tells customer tickets from staff tickets; staff threads are tickets", () => {
  assertMatch(metrics, /label: `Staff · \$\{VISIBILITY_LABEL\[ticket\.visibility\] \|\| "Internal"\}`/);
  assertMatch(metrics, /\{ value: "staff", label: "Staff" \}/);
  assertMatch(panel, /No customer linked/);
  assertNotMatch(`${page}${panel}${desk}`, /support_internal_threads/);
  assertMatch(page, /table: "support_product_signals"/);
  assertMatch(page, /table: "support_tickets"/);
});

Deno.test("staff replies need no promise; Send and wait sets one", () => {
  assertNotMatch(supportSend, /next_update_required/);
  assertMatch(supportSend, /p_wait_until: send\.setWaiting\?\.nextUpdateAt \?\? null/);
  assertMatch(model, /actorMode: "staff"/);
  assertMatch(model, /if \(!isInternal && waiting\) \{\n\s+body\.setWaiting =/);
  assertMatch(composer, /Send and wait/);
  assertNotMatch(composer, /hasActiveNextUpdate/);
});

Deno.test("workflow writes use gated RPCs and never a browser table mutation", () => {
  for (const rpc of [
    "issue_4382_create_staff_ticket",
    "issue_3720_update_product_signal",
    "issue_3988_reassign_product_signal",
  ]) assertMatch(service, new RegExp(`rpc\\("${rpc}"`));
  for (const rpc of [
    "issue_3720_create_product_signal",
    "issue_3720_create_brand_message_product_signal",
    "issue_3720_link_product_signal_source",
    "issue_3720_link_brand_message_product_signal",
  ]) assertMatch(service, new RegExp(`"${rpc}"`));
  assertMatch(desk, /rpc\("issue_4382_register_support_attachment"/);
  for (const source of [service, desk, page, panel, composer]) {
    assertNotMatch(source, /\.insert\s*\(/);
    assertNotMatch(source, /\.update\s*\(/);
    assertNotMatch(source, /\.delete\s*\(\s*\)/); // a table delete; URLSearchParams.delete(key) is fine
  }
});

Deno.test("Send to Product makes the human review boundary explicit", () => {
  assertMatch(sendToProduct, /This stays inside Mingla/);
  assertMatch(sendToProduct, /Nothing goes to GitHub until an admin or founding partner writes public-safe wording in Triage/);
  assertMatch(sendToProduct, /Is this already on the board\?/);
  assertNotMatch(sendToProduct, /gh\s+issue|api\.github\.com|github_token/i);
});

Deno.test("the core workflow is deterministic and does not embed a model service", () => {
  const source = `${page}\n${panel}\n${composer}\n${service}\n${desk}\n${sendToProduct}`;
  assertNotMatch(source, /openai|anthropic|gemini|claude|embedding|vector[_-]?store/i);
  assertMatch(sendToProduct, /searchOpenItems\(signals, query\)/);
});

Deno.test("open-item search is deterministic, skips closed items and needs a shared word", () => {
  const signals = [
    { id: "a", state: "new", title: "Payout page shows wrong total", product_area: "Host app · Payouts" },
    { id: "b", state: "told", title: "Payout balance fixed", product_area: "Host app · Payouts" },
    { id: "c", state: "planned", title: "Payout balance shows zero", product_area: "Host app" },
    { id: "d", state: "wont_do", title: "Payout balance colour", product_area: "Host app" },
  ];
  assertEquals(searchOpenItems(signals, "payout balance").map((s: { id: string }) => s.id), ["c", "a"]);
  assertEquals(searchOpenItems(signals, "door scanner"), []);
  assertEquals(searchOpenItems(signals, ""), []);
});
