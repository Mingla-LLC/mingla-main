// #4490 spec 08 O1 fix round 1 — the old order pad never takes or marks Till
// money. The decision lives in the database (issue_4490_pad_guard, proven in
// issue_4490_ops_o1_fix1.implementor.pg17.test.sql); this pins that the edge
// asks it before any write on both money paths and answers with codes an
// installed pad already shows.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

function body(name: string, next: string): string {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${next}`);
  assert(start >= 0 && end > start, `${name} not found`);
  return source.slice(start, end);
}

Deno.test("F1-PG1 settle asks the guard before reading or writing the order's money (both methods)", () => {
  const settle = body("handleSettle", "billToPhone");
  const guard = settle.indexOf('action: "settle"');
  assert(guard > 0, "settle must call the guard");
  assert(
    guard < settle.indexOf(".update("),
    "the guard runs before the venue_collected write",
  );
  assert(
    guard < settle.indexOf("billToPhone("),
    "the guard runs before bill_to_phone",
  );
  assert(
    settle.includes(
      'if (settleGuard !== "ok") return padGuardRefusal(settleGuard);',
    ),
  );
});

Deno.test("F1-PG2 create asks the guard with the sitting it would join", () => {
  const create = body("handleStaffCreate", "handleSettle");
  assert(create.includes('action: "create"'));
  assert(
    create.indexOf('action: "create"') < create.indexOf("loadMenuSnapshot("),
  );
  assert(create.includes("sessionId,"));
});

Deno.test("F1-PG3 brand membership alone is no longer the pad's floor (only while the guard is not deployed)", () => {
  assertEquals(source.includes("callerIsBrandMember"), false);
  assert(source.includes('supabase.rpc("issue_4490_pad_guard"'));
  const guard = source.slice(
    source.indexOf("async function padGuard"),
    source.indexOf("function padGuardRefusal"),
  );
  // The membership read runs only when the guard function does not exist.
  assertEquals(guard.match(/await memberBeforeTheTill\(/g)?.length, 1);
  assert(
    /error\.code === "PGRST202"\) \{\s*return \(await memberBeforeTheTill/.test(
      guard,
    ),
  );
});

Deno.test("F1-PG4 refusals answer with codes an installed pad already shows; a failed guard read refuses", () => {
  const refusal = source.slice(
    source.indexOf("function padGuardRefusal"),
    source.indexOf("// create — the waiter"),
  );
  assert(refusal.includes('verdict === "till_round" || verdict === "till_on"'));
  assert(refusal.includes('return fail("transition_not_allowed")'));
  assert(refusal.includes('return fail("session_not_addable")'));
  const guard = source.slice(
    source.indexOf("async function padGuard"),
    source.indexOf("function padGuardRefusal"),
  );
  assert(
    /if \(error\) \{[\s\S]*?return "not_authorized";/.test(guard),
    "a failed guard read must refuse",
  );
  const tab = source.slice(
    source.indexOf("function mapTabRpcError"),
    source.indexOf("// Issue #1791 (SPEC #1788"),
  );
  assert(
    /tab_on_till"\)\) \{\s*return fail\("transition_not_allowed"\);/.test(tab),
  );
});
