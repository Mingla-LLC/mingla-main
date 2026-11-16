// MINGLA-INVARIANT: I-4452-FORMS-ADMIN-CORS | issue #4452 | forms-admin answers the browser preflight and every response, errors included, carries the Admin CORS headers; the edit-access check is unchanged.
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

// #4452 B19: Admin calls forms-admin from the browser. The
// preflight is answered and every answer, errors included, carries the CORS headers;
// before this, OPTIONS got 405 with none and "Send me a test" could never run.
// FAILS-ON-REVERT: dropping the OPTIONS answer or withCors() fails both tests below.
const cors = (res: Response) => ({
  origin: res.headers.get("access-control-allow-origin"),
  headers: (res.headers.get("access-control-allow-headers") ?? "").split(",").map((h) => h.trim()),
});

Deno.test("B19 the browser preflight is answered with the Admin CORS headers and runs no check", async () => {
  let checked = false;
  const h = deps();
  h.d.canEdit = () => (checked = true, Promise.resolve(true));
  const res = await handleAdmin(new Request("https://fn/", { method: "OPTIONS", headers: { origin: "https://admin.usemingla.com" } }), h.d);
  assertEquals(res.status, 200);
  const c = cors(res);
  assertEquals(c.origin, "*");
  for (const name of ["authorization", "apikey", "content-type", "x-client-info"]) assert(c.headers.includes(name), name);
  assert((res.headers.get("access-control-allow-methods") ?? "").includes("POST"));
  assertEquals(checked, false, "the preflight never reaches the edit-access check");
  assertEquals(h.sent.length, 0);
});

Deno.test("B19 every answer carries CORS: success, 403, 404, 405, 409 and a server failure", async () => {
  const ok = await handleAdmin(post({ action: "test_email", form_id: "f1" }), deps().d);
  const viewer = await handleAdmin(post({ action: "test_email", form_id: "f1" }), deps(false).d);
  const gone = deps();
  gone.d.loadForm = () => Promise.resolve(null);
  const missing = await handleAdmin(post({ action: "test_email", form_id: "nope" }), gone.d);
  const get = await handleAdmin(new Request("https://fn/", { method: "GET" }), deps().d);
  const unpublished = deps();
  const f = await unpublished.d.loadForm("f1");
  unpublished.d.loadForm = () => Promise.resolve(f ? { ...f, live_version_id: null } : null);
  const first = await handleAdmin(post({ action: "test_flow", form_id: "f1" }), unpublished.d);
  const broken = deps();
  broken.d.sendEmail = () => Promise.reject(new Error("network"));
  const failed = await handleAdmin(post({ action: "test_email", form_id: "f1" }), broken.d);
  assertEquals([ok.status, viewer.status, missing.status, get.status, first.status, failed.status], [200, 403, 404, 405, 409, 500]);
  for (const res of [ok, viewer, missing, get, first, failed]) assertEquals(cors(res).origin, "*", `status ${res.status}`);
  assertEquals((await failed.json()).message, "Something on the server failed. Try again.");
  assertEquals((await viewer.json()).message, "You don't have edit access", "the auth check is unchanged");
});
