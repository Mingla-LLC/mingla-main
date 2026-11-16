// #4435: delete-user asks the database who takes over a session the leaving
// user created (one owner of the handover rule). While the database function
// is missing it keeps the old pick. FAILS-ON-REVERT: restoring the in-function
// transfer in index.ts fails the wiring test.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handOverOwnedSessions, type HandoverClient } from "./sessionHandover.ts";

function client(rpcResult: (sessionId: string) => { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: string[] = [];
  const c: HandoverClient = {
    rpc: (fn, args) => {
      calls.push(`rpc:${fn}:${args.p_session_id}:${args.p_leaving}`);
      return Promise.resolve(rpcResult(String(args.p_session_id)));
    },
    updateCreator: (sessionId, owner) => {
      calls.push(`update:${sessionId}:${owner}`);
      return Promise.resolve({ error: null });
    },
  };
  return { c, calls };
}

Deno.test("the database picks the heir for every owned session", async () => {
  const { c, calls } = client((id) => ({ data: id === "s1" ? "heir-1" : null, error: null }));
  const warnings: string[] = [];
  const handed = await handOverOwnedSessions(c, "leaver", ["s1", "s2"], new Map([["s1", "old-pick"]]), (m) => warnings.push(m));
  assertEquals(handed, 1);
  assertEquals(calls, ["rpc:issue_4435_hand_over_creator:s1:leaver", "rpc:issue_4435_hand_over_creator:s2:leaver"]);
  assertEquals(warnings, []);
});

Deno.test("a missing database function falls back to the old pick; other errors only warn", async () => {
  const missing = client(() => ({ data: null, error: { code: "PGRST202", message: "not found" } }));
  assertEquals(await handOverOwnedSessions(missing.c, "leaver", ["s1", "s2"], new Map([["s1", "old-pick"]]), () => {}), 1);
  assertEquals(missing.calls.filter((call) => call.startsWith("update")), ["update:s1:old-pick"]);
  const failing = client(() => ({ data: null, error: { code: "57014", message: "timeout" } }));
  const warnings: string[] = [];
  assertEquals(await handOverOwnedSessions(failing.c, "leaver", ["s1"], new Map([["s1", "old-pick"]]), (m) => warnings.push(m)), 0);
  assertEquals(failing.calls.filter((call) => call.startsWith("update")), []);
  assertEquals(warnings.length, 1);
});

Deno.test("index.ts hands over through the shared module, not its own update", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("handOverOwnedSessions("));
  assertEquals(source.includes("[...transfers.entries()].map"), false);
});
