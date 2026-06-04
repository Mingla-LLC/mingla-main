import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1065 [consumer-experience-deck-card] — checkout regression (COMMS-0014/0016).
//
// An event_type='experience' eventId MUST check out through the EXISTING
// ticket-checkout-create event path with NO event_type allowlist rejection and
// NO parallel money function. ticket-checkout-create only special-cases
// event_type==='trip'; 'experience' falls through to the default event path
// (inheriting the ORCH-1006 all-in pricing engine for free).
//
// Source-text analysis (the fn calls serve() at module load + reaches Stripe, so
// it cannot be invoked in a unit test) + a filesystem assertion that no new
// money function file was introduced.
//
// Fails-on-revert (LOCKED): this test fails if a parallel experience-checkout
// edge function is introduced, OR if ticket-checkout-create grows an event_type
// allowlist that rejects 'experience'.

const root = new URL("../../../..", import.meta.url).pathname;
const source = await Deno.readTextFile(
  `${root}/supabase/functions/ticket-checkout-create/index.ts`,
);

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}
const active = stripComments(source);

Deno.test("ORCH-1065 T-08a: ticket-checkout-create only special-cases event_type==='trip'", () => {
  // The only event_type equality branches in the active source are for 'trip'.
  const eqMatches = [...active.matchAll(/event_type\s*===?\s*["']([a-z_]+)["']/g)].map(
    (m) => m[1],
  );
  // 'experience' must NOT appear as a special-cased / rejected event_type.
  assertEquals(
    eqMatches.includes("experience"),
    false,
    "ticket-checkout-create must NOT branch on event_type==='experience' — it falls through to the event path",
  );
  // 'trip' is the established special case (sanity anchor; if this changes the
  // test author must re-verify the experience fall-through still holds).
  assert(
    eqMatches.includes("trip"),
    "expected the trip special-case anchor to remain present",
  );
});

Deno.test("ORCH-1065 T-08b: no event_type allowlist that rejects experiences", () => {
  // Defensive: there must be no allowlist array of event types that would
  // exclude 'experience' (e.g. ["event","trip"] used to gate checkout).
  const allowlistReject =
    /\[\s*["']event["']\s*,\s*["']trip["']\s*\]/.test(active);
  assertEquals(
    allowlistReject,
    false,
    "ticket-checkout-create must not carry an [event,trip] allowlist that excludes experience",
  );
});

Deno.test("ORCH-1065 T-08c: no parallel experience money function exists (COMMS-0014/0016)", () => {
  const fnDir = `${root}/supabase/functions`;
  const names: string[] = [];
  for (const entry of Deno.readDirSync(fnDir)) {
    if (entry.isDirectory) names.push(entry.name);
  }
  // No edge function whose name implies a separate experience checkout/money path.
  const offenders = names.filter(
    (n) =>
      /experience/i.test(n) &&
      (/checkout/i.test(n) || /create/i.test(n) || /payment/i.test(n) || /order/i.test(n)),
  );
  assertEquals(
    offenders,
    [],
    `No parallel experience money fn allowed; found: ${offenders.join(", ")}`,
  );
  // ticket-checkout-create itself remains the canonical money fn.
  assert(
    names.includes("ticket-checkout-create"),
    "ticket-checkout-create must remain the canonical checkout fn",
  );
});
