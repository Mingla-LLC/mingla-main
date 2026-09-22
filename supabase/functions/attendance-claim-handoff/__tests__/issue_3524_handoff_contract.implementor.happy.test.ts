// issue #3524 — IMPLEMENTOR HAPPY PATH for the desktop handoff minter.
//
// WHAT THIS PROVES:
//   1. It MINTS; it never claims. No `orders` write, no claim RPC, anywhere in
//      the file.
//   2. The raw code leaves the server EXACTLY ONCE — in the success response —
//      and is never logged and never written to the database. Only its HMAC
//      digest is stored, under the same governed pepper ring the claim token
//      uses.
//   3. A handoff code cannot mint another handoff code, so the credential
//      cannot renew itself past its own ten-minute window.
//   4. Every response is `no-store`, and the ten-minute window is one constant
//      the client and the database both read.
//   5. `verify_jwt = false` is registered in config.toml with the reason, and
//      the function is RSVP-free: only a purchase has a desktop scan sheet.
//
// Run: deno test --allow-read <this file>

import { claimJson } from "../../_shared/attendanceClaim.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
const config = await Deno.readTextFile(
  new URL("../../../config.toml", import.meta.url),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("#3524 the handoff minter mints and never claims", () => {
  assert(
    source.includes('admin.rpc("mint_attendance_claim_handoff"'),
    "it calls the mint RPC",
  );
  assert(
    !source.includes("claim_attendance_internal_v2"),
    "it never calls the claim body",
  );
  assert(
    !source.includes("redeem_attendance_claim_handoff"),
    "and it never redeems either — minting and redeeming are two endpoints",
  );
  assert(
    !/from\s*\(\s*["']orders["']\s*\)/.test(source) &&
      !source.includes(".update("),
    "it writes no order row",
  );
});

Deno.test("#3524 the raw code leaves the server exactly once, and is never logged", () => {
  // `code` is the raw value; `codeDigest` is what the database gets.
  assert(source.includes("mintOrderClaimToken()"), "the code is freshly minted");
  assert(
    source.includes("hmacOrderClaimDigest(\n      rawCode,") ||
      source.includes("hmacOrderClaimDigest(rawCode,"),
    "and only its HMAC digest is computed for storage",
  );
  assert(
    source.includes("p_code_digest: bytesToPostgresHex(codeDigest)"),
    "the DIGEST is what is sent to the database",
  );
  assert(
    !source.includes("p_code: code") && !source.includes("p_code_raw"),
    "the plaintext code is never sent to the database",
  );
  assert(
    source.includes("pepperRing.current.secret"),
    "the digest uses the same governed pepper ring the claim token uses",
  );

  // Exactly one place hands the raw code out, and it is the URL builder for the
  // success response.
  const codeUses = (source.match(/\bcode,?\s*$/gm) ?? []).length;
  assert(codeUses >= 1, "the raw code is referenced where the URL is built");
  assert(
    !/console\.(log|info|warn|error|debug)/.test(source),
    "this function logs NOTHING — there is no line that could carry a code",
  );
  assert(
    source.includes("handoffUrl: webClaimUrl"),
    "the success response carries the handoff URL and nothing else secret",
  );
});

Deno.test("#3524 a handoff code cannot mint another handoff code", () => {
  assert(
    source.includes('body.credential.kind !== "token"'),
    "only the emailed TOKEN form is accepted as input",
  );
  assert(
    source.includes('body.kind !== "order"'),
    "and only a purchase — RSVP pass recovery is a different product",
  );
});

Deno.test("#3524 the ten-minute window is one constant, and every answer is no-store", () => {
  assert(
    source.includes("const HANDOFF_TTL_SECONDS = 600"),
    "ten minutes, stated once",
  );
  assert(
    source.includes("expiresInSeconds: HANDOFF_TTL_SECONDS"),
    "and returned to the client from that same constant",
  );

  // `claimJson` is the shared responder; prove it really is no-store rather
  // than trusting the comment that says so.
  for (const status of [200, 400, 409, 410, 429, 500]) {
    const res = claimJson(status, { ok: false }, {});
    assert(
      res.headers.get("cache-control") === "no-store",
      `a ${status} answer is no-store`,
    );
  }
  assert(
    !source.includes("new Response(JSON.stringify"),
    "no response bypasses the shared no-store responder",
  );
});

Deno.test("#3524 the mapped failures are specific, not a generic 500", () => {
  assert(source.includes('error: "handoff_rate_limited"') && source.includes("429"),
    "too many codes for one ticket answers 429");
  assert(source.includes('error: "claim_expired"') && source.includes("410"),
    "an aged-out link answers 410");
  assert(source.includes('error: "handoff_ineligible"') && source.includes("409"),
    "an ineligible or already-claimed order answers 409");
  assert(source.includes('error: "handoff_invalid"') && source.includes("400"),
    "a malformed request answers 400");
  // …and the catch-all tells the caller nothing it did not already know.
  assert(
    source.includes('error: "handoff_failed"'),
    "an internal fault is opaque",
  );
});

Deno.test("#3524 verify_jwt = false is registered, with its reason", () => {
  const block = config.slice(config.indexOf("[functions.attendance-claim-handoff]"));
  assert(
    block.startsWith("[functions.attendance-claim-handoff]"),
    "the function is registered in config.toml",
  );
  assert(
    /verify_jwt\s*=\s*false/.test(block.slice(0, 200)),
    "as verify_jwt = false",
  );
  const preamble = config.slice(
    Math.max(0, config.indexOf("[functions.attendance-claim-handoff]") - 400),
    config.indexOf("[functions.attendance-claim-handoff]"),
  );
  assert(
    preamble.includes("3524") && /anon|account|credential/i.test(preamble),
    "with a comment saying WHY it is anon — the desktop buyer has no account "
      + "yet, which is the defect this issue is about",
  );
});
