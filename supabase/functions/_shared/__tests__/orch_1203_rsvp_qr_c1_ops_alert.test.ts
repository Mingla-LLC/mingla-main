// ORCH-1203 GAP-C1 — source-contract guard for the missing-pepper ops alert in
// public-submit-rsvp. Proves: (a) the missing-pepper branch emits an ops alert via
// the SHARED sendOpsAlertEmail helper; (b) it STILL proceeds with the RSVP write
// (qrPepper=null → RPC still called → I-1 non-blocking preserved); (c) the alert is
// wrapped so it can NEVER throw into the RSVP path.
//
// The handler is a monolithic serve() that needs SUPABASE_URL + a live RPC to run
// end-to-end, so (matching the repo's proven source-contract style) this pins the
// load-bearing ordering invariants by asserting the function source. The
// `// [FAILS-ON-REVERT KEY]` lines are proven to go RED when C-1 is reverted.
//
// Run: deno test --allow-read --allow-env
import { assert } from "jsr:@std/assert@1";

const SRC = "supabase/functions/public-submit-rsvp/index.ts";
const src = await Deno.readTextFile(SRC);
const has = (n: string, why: string) =>
  assert(src.includes(n), `must contain \`${n}\` (${why})`);

Deno.test("C-1 — imports the SHARED sendOpsAlertEmail helper (not a new one)", () => {
  // [FAILS-ON-REVERT KEY]
  has(
    'import { sendOpsAlertEmail } from "../_shared/stripeOpsAlertEmail.ts"',
    "reuses the ORCH-0956/1201 ops-alert helper",
  );
});

Deno.test("C-1 — missing-pepper catch emits the ops alert", () => {
  // The alert lives inside the qrTokenPepper() catch block.
  const catchIdx = src.indexOf("} catch (err) {\n    console.error(\n      \"[public-submit-rsvp] qr_token_pepper unavailable");
  assert(catchIdx !== -1, "the missing-pepper catch block must exist");
  const tail = src.slice(catchIdx);
  // [FAILS-ON-REVERT KEY]
  assert(
    tail.indexOf("await sendOpsAlertEmail({") !== -1 &&
      tail.indexOf("await sendOpsAlertEmail({") <
        tail.indexOf("const { data, error } = await admin.rpc(\"submit_event_rsvp\""),
    "ops alert must fire inside the missing-pepper branch, before the RPC call",
  );
});

Deno.test("C-1 — I-1: the RSVP write still proceeds after a missing pepper", () => {
  // qrPepper stays null and the RPC is still called with it — write is non-blocking.
  has("qrPepper = null;", "pepper falls back to null, not an abort");
  // [FAILS-ON-REVERT KEY]
  has(
    "p_qr_token_pepper: qrPepper,",
    "the RPC is still invoked (write never blocked by a missing pepper)",
  );
});

Deno.test("C-1 — the alert is wrapped so it can NEVER throw into the RSVP path", () => {
  const alertIdx = src.indexOf("await sendOpsAlertEmail({");
  assert(alertIdx !== -1, "alert call must exist");
  const head = src.slice(0, alertIdx);
  // [FAILS-ON-REVERT KEY] — the nearest enclosing construct before the alert is a try.
  const lastTry = head.lastIndexOf("try {");
  const lastCatchAfterTry = src.indexOf("} catch (alertErr) {", alertIdx);
  assert(
    lastTry !== -1 && lastCatchAfterTry !== -1,
    "alert must be inside its own try/catch that swallows alertErr",
  );
  has("[public-submit-rsvp] ops alert for missing pepper failed (non-fatal)", "swallow + log");
});

Deno.test("C-1 — alert recipients resolve from env with a safe default", () => {
  has('Deno.env.get("RSVP_QR_ALERT_EMAILS")', "configurable recipients");
  has('?? "seth@usemingla.com"', "safe default recipient when env unset");
});
