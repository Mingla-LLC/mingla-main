import {
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findRelatedSignals } from "../components/community/supportWorkflowUtils.js";

const read = (relative: string) => Deno.readTextFile(new URL(`../${relative}`, import.meta.url));
const page = await read("pages/SupportDeskPage.jsx");
const service = await read("services/supportProductWorkflowService.js");
const modals = await read("components/community/SupportWorkflowModals.jsx");
const supportSend = await Deno.readTextFile(
  new URL("../../../supabase/functions/support-send/index.ts", import.meta.url),
);

Deno.test("the inbox distinguishes live chats from staff-created internal tickets", () => {
  assertMatch(page, /source_label:\s*"Live chat"/);
  assertMatch(page, /source_label:\s*"Staff-created"/);
  assertMatch(page, /Support inbox/);
  assertMatch(page, /No customer linked/);
  assertMatch(page, /Internal only · no customer message was sent/);
  assertMatch(page, /table: "support_internal_threads"/);
  assertMatch(page, /table: "support_product_signals"/);
});

Deno.test("staff replies fail closed until an active next-update promise exists", () => {
  assertMatch(page, /Set the next update first/);
  assertMatch(page, /function hasActiveNextUpdate\(ticket\)/);
  assertMatch(page, /disabled=\{acting \|\| !reply\.trim\(\) \|\| !hasActiveNextUpdate\(selectedTicket\)\}/);
  assertMatch(supportSend, /senderIsStaff && \(!Number\.isFinite\(nextUpdateMs\) \|\| nextUpdateMs <= Date\.now\(\)\)/);
  assertMatch(supportSend, /next_update_required/);
  assertMatch(page, /actorMode:\s*"staff"/);
});

Deno.test("workflow writes use gated RPCs and never a browser table mutation", () => {
  for (const rpc of [
    "issue_3720_create_internal_thread",
    "issue_3720_set_next_update",
    "issue_3720_update_internal_thread",
    "issue_3720_create_product_signal",
    "issue_3720_update_product_signal",
    "issue_3720_link_product_signal_source",
  ]) assertMatch(service, new RegExp(`rpc\\("${rpc}"`));
  assertNotMatch(service, /\.insert\s*\(/);
  assertNotMatch(service, /\.update\s*\(/);
});

Deno.test("private Product signal UI makes the human review boundary explicit", () => {
  assertMatch(modals, /This stays inside Mingla/);
  assertMatch(modals, /does not create a public GitHub issue/);
  assertMatch(modals, /Product must review it first/);
  assertNotMatch(modals, /gh\s+issue|api\.github\.com|github_token/i);
});

Deno.test("the core workflow is deterministic and does not embed a model service", () => {
  const source = `${page}\n${service}\n${modals}`;
  assertNotMatch(source, /openai|anthropic|gemini|claude|embedding|vector[_-]?store/i);
  assertMatch(modals, /findRelatedSignals\(signals, form\.title, form\.productArea\)/);
});

Deno.test("support workflow controls reuse the premium shared controls and keep primary actions text-only", () => {
  assertMatch(page, /<Segmented/);
  assertMatch(page, /<Select/);
  assertMatch(modals, /Select, TEXTAREA_CLASS/);
  assertNotMatch(page, /icon=\{(?:FilePlus2|Inbox|Sparkles)\}/);
  assertNotMatch(modals, /icon=\{(?:FilePlus2|Clock3|Lightbulb|Bug|Save)\}/);
  assertMatch(page, /aria-label=\{`Open \$\{t\.source_label\.toLowerCase\(\)\}: \$\{t\.subject\}`\}/);
});

Deno.test("related-signal suggestions are deterministic and require meaningful overlap", () => {
  const signals = [
    { id: "a", title: "Host calendar card fails to publish", product_area: "Host app" },
    { id: "b", title: "Explorer profile photo", product_area: "Consumer app" },
    { id: "c", title: "Calendar filters", product_area: "Host app" },
  ];
  assertEquals(
    findRelatedSignals(signals, "Host calendar publishing fails", "Host app")
      .map((signal: { id: string }) => signal.id),
    ["a", "c"],
  );
  assertEquals(findRelatedSignals(signals, "Different request", "Other"), []);
});
