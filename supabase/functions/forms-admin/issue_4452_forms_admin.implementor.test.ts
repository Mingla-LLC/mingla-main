// #4452 T-5.13 / T-5.13b (SC-78, SC-79): test sends go only to the caller, [Test] prefixed, and mark the form tested.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type AdminDeps, handleAdmin } from "./admin.ts";

const FLOW = { v: 1, steps: [
  { id: "s0", type: "email", name: "Welcome", to: "person", from: "creators", reply_to: "team", subject: "Hi {first_name}", doc: [{ type: "rich_text", html: "<p>x</p>" }], show_answers: false },
  { id: "s1", type: "team", name: "Alert", to: "creators_inbox", include_answers: true },
  { id: "w1", type: "wait", n: 2, unit: "days", at10: true, skip_weekends: false },
  { id: "s2", type: "email", name: "Nudge", to: "person", from: "creators", reply_to: "team", subject: "Nudge", doc: [{ type: "rich_text", html: "<p>y</p>" }], show_answers: false },
] };

function deps(canEdit = true) {
  const sent: Array<{ to: string[]; subject: string }> = [];
  const tested: string[] = [];
  const d: AdminDeps = {
    canEdit: () => Promise.resolve(canEdit),
    callerEmail: () => Promise.resolve("staff@usemingla.com"),
    loadForm: () => Promise.resolve({ id: "f1", key: "creators-join", name: "Creators", audience: "creator", draft: { fields: [] }, flow: FLOW, live_version_id: "v", automation_live: 1 }),
    sendEmail: (e) => (sent.push({ to: e.to, subject: e.subject }), Promise.resolve(true)),
    markTested: (id) => (tested.push(id), Promise.resolve()),
    startTestFlow: () => Promise.resolve("run-1"),
    env: () => undefined,
    signUnsubscribe: () => Promise.resolve("T"),
    trackBase: "https://x/forms-track",
  };
  return { d, sent, tested };
}
const post = (b: unknown) => new Request("https://fn/", { method: "POST", body: JSON.stringify(b) });

Deno.test("SC-78 'Send me a test' sends every email step to the caller only, numbered, and marks tested", async () => {
  const h = deps();
  const out = await (await handleAdmin(post({ action: "test_email", form_id: "f1" }), h.d)).json();
  assertEquals(out.sent, 3);
  assert(h.sent.every((s) => s.to.length === 1 && s.to[0] === "staff@usemingla.com"), "only the caller, never a team inbox");
  assertEquals(h.sent.map((s) => s.subject.slice(0, 11)), ["[Test 1/3] ", "[Test 2/3] ", "[Test 3/3] "]);
  assertEquals(h.tested, ["f1"]);
});

Deno.test("SC-78 one step: '[Test] ' prefix", async () => {
  const h = deps();
  await handleAdmin(post({ action: "test_email", form_id: "f1", step_id: "s0" }), h.d);
  assertEquals(h.sent[0].subject, "[Test] Hi Ada");
});

Deno.test("a viewer without edit access is refused with the edit-access message", async () => {
  const h = deps(false);
  const res = await handleAdmin(post({ action: "test_email", form_id: "f1" }), h.d);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).message, "You don't have edit access");
  assertEquals(h.sent.length, 0);
});

Deno.test("SC-79 test the whole flow starts a test run", async () => {
  const h = deps();
  const out = await (await handleAdmin(post({ action: "test_flow", form_id: "f1" }), h.d)).json();
  assertEquals(out.run_id, "run-1");
  assertEquals(out.message, "Test run sent to you: every email in order, with sample answers.");
});
