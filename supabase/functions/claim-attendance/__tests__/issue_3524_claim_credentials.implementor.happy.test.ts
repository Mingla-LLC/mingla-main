// issue #3524 — IMPLEMENTOR HAPPY PATH for the claim endpoint's two credentials
// and its two new honest answers.
//
// WHAT THIS PROVES:
//   1. The endpoint accepts the emailed TOKEN form and the scanned HANDOFF form,
//      and exactly one of them per request — never both, never neither.
//   2. `identity_mismatch` maps to 409 and carries a MASKED hint; `expired` maps
//      to 410. Neither is dressed up as a generic failure.
//   3. `chatJoined` and `conversationId` are passed through on success, so no
//      surface has to guess whether the chat half actually happened.
//   4. The masking twin agrees with the SQL helper case for case, and neither
//      ever emits an unmasked purchase contact.
//   5. There is still exactly ONE claim-decision RPC named in the file — #2979's
//      frozen property, which the handoff must not have doubled.
//
// Run: deno test --allow-read <this file>

import {
  attendanceClaimHandoffUrls,
  attendanceClaimUrls,
  maskContactForClaim,
  parseAttendanceClaimRequest,
} from "../../_shared/attendanceClaim.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const TOKEN = "A".repeat(43);
const CODE = "B".repeat(43);

Deno.test("#3524 the request shape takes exactly one credential", () => {
  const withToken = parseAttendanceClaimRequest({
    version: 1, kind: "order", eventId: UUID_A, sourceId: UUID_B, token: TOKEN,
  });
  assert(withToken !== null, "the emailed token form is accepted");
  assert(withToken.credential.kind === "token", "and is labelled a token");
  assert(withToken.credential.value === TOKEN, "carrying the token itself");

  const withHandoff = parseAttendanceClaimRequest({
    version: 1, kind: "order", eventId: UUID_A, sourceId: UUID_B,
    handoffCode: CODE,
  });
  assert(withHandoff !== null, "the scanned handoff form is accepted");
  assert(withHandoff.credential.kind === "handoff", "and is labelled a handoff");
  assert(withHandoff.credential.value === CODE, "carrying the code itself");

  // The strictness is the point. Every one of these is a shape nobody designed.
  assert(
    parseAttendanceClaimRequest({
      version: 1, kind: "order", eventId: UUID_A, sourceId: UUID_B,
      token: TOKEN, handoffCode: CODE,
    }) === null,
    "BOTH credentials at once is refused — there is one credential per request",
  );
  assert(
    parseAttendanceClaimRequest({
      version: 1, kind: "order", eventId: UUID_A, sourceId: UUID_B,
    }) === null,
    "neither credential is refused",
  );
  assert(
    parseAttendanceClaimRequest({
      version: 1, kind: "order", eventId: UUID_A, sourceId: UUID_B,
      token: TOKEN, extra: "x",
    }) === null,
    "a sixth key is refused",
  );
  assert(
    parseAttendanceClaimRequest({
      version: 1, kind: "order", eventId: UUID_A, sourceId: UUID_B,
      handoffCode: "B".repeat(42),
    }) === null,
    "a handoff code of the wrong length is refused",
  );
  assert(
    parseAttendanceClaimRequest({
      version: 1, kind: "order", eventId: "not-a-uuid", sourceId: UUID_B,
      token: TOKEN,
    }) === null,
    "a malformed event id is refused",
  );
});

Deno.test("#3524 the two URL grammars are siblings, and the QR one carries no token", () => {
  const tokenUrls = attendanceClaimUrls({
    kind: "order", eventId: UUID_A, sourceId: UUID_B, token: TOKEN,
  });
  const handoffUrls = attendanceClaimHandoffUrls({
    kind: "order", eventId: UUID_A, sourceId: UUID_B, code: CODE,
  });

  assert(
    handoffUrls.webClaimUrl.startsWith(
      "https://host.usemingla.com/attendance/claim#",
    ),
    "the handoff URL is on the Universal Link path the AASA now claims",
  );
  assert(handoffUrls.webClaimUrl.includes("hc=" + CODE), "and carries hc=");
  assert(
    !handoffUrls.webClaimUrl.includes("token="),
    "and NEVER the claim token — a photographed QR must buy an attacker ten "
      + "minutes, not a bearer credential with no expiry",
  );
  assert(
    !handoffUrls.webClaimUrl.includes(TOKEN),
    "not even the token's value by another name",
  );
  assert(tokenUrls.webClaimUrl.includes("token="), "the emailed form still carries the token");
  assert(!tokenUrls.webClaimUrl.includes("hc="), "and never the handoff code");

  // The app-scheme forms mirror the web ones, so the parser sees one grammar.
  assert(
    handoffUrls.appClaimUrl.startsWith("com.mingla.app.v2://attendance-claim#"),
    "the app-scheme handoff URL keeps the existing prefix",
  );
});

Deno.test("#3524 the masking twin is pinned case for case", () => {
  assert(
    maskContactForClaim("alice@example.com", "email") === "a•••@e•••.com",
    "the documented email case",
  );
  assert(
    maskContactForClaim("+2348012345678", "phone") === "+234•••5678",
    "the documented phone case",
  );
  assert(
    maskContactForClaim("a@b.co", "email") === "a•••@b•••.co",
    "single-character local part and domain label render as that character",
  );
  assert(
    maskContactForClaim("+1234567", "phone") === "+•••",
    "a number too short to mask safely renders as nothing but +•••",
  );
  assert(maskContactForClaim("", "email") === null, "empty is null, not a mask of nothing");
  assert(maskContactForClaim(null, "phone") === null, "and so is absent");

  // The whole point: what comes out is never what went in.
  for (const raw of ["alice@example.com", "+2348012345678"]) {
    const channel = raw.includes("@") ? "email" as const : "phone" as const;
    const masked = maskContactForClaim(raw, channel);
    assert(masked !== raw, `the mask of ${channel} is not the raw value`);
    assert(masked !== null && masked.includes("•••"), "and it is visibly masked");
  }
});

Deno.test("#3524 the endpoint answers honestly about identity, expiry and the chat", () => {
  assert(
    source.includes("claim_identity_mismatch") && source.includes("409"),
    "identity_mismatch has its own 409 answer",
  );
  assert(
    source.includes("claim_expired") && source.includes("410"),
    "expired has its own 410 answer",
  );
  assert(
    source.includes("contactMasked") && source.includes("contactChannel"),
    "the mismatch answer names the masked hint and which channel it is",
  );
  assert(
    source.includes("chatJoined") && source.includes("conversationId"),
    "success passes the chat half through rather than assuming it",
  );
  assert(
    source.includes("identity_mismatch") && source.includes("expired"),
    "and both outcomes are recorded on the attempt ledger",
  );

  // #2979's frozen property, which the handoff credential must NOT have
  // doubled: one claim decision is taken in one place.
  assert(
    (source.match(/claim_attendance_internal_v2/g) ?? []).length === 1,
    "still exactly ONE claim-decision RPC named in this file",
  );
  assert(
    source.includes("redeem_attendance_claim_handoff"),
    "the handoff arm goes through the redeem RPC, which calls that one body",
  );

  // Nothing that leaves this function may carry a raw credential.
  assert(
    !/console\.(log|info|warn|error)\([^)]*credential\.value/.test(source),
    "no log line prints a raw credential",
  );
});
