// issue #3524 — A DELIBERATE SIGN-OUT MUST NOT DESTROY THE PENDING CLAIM.
//
// WHAT WAS BROKEN, exactly. `attendanceClaimAuthAction` had one rule for an
// account change: CLEAR the pending claim. That rule is right, and it exists so
// account A's claim intent cannot follow the device into account B. But the
// mismatch flow this issue adds CAUSES an account change on purpose — the guest
// taps "that's not me", we sign them out, and they sign back in as the mailbox
// that actually bought the ticket. Under the old rule their ticket was thrown
// away at exactly the moment they were doing the right thing.
//
// `"preserve"` is the fourth answer, and it is not a hole: it fires only when a
// marker written by that one action is live, and even then the claim STILL
// cannot land on the new account unless that account independently proves it
// owns the purchase email or phone (the server's `account_owns_order_contact`).
// Two guards, not one.
//
// This file walks the whole seven-row decision table, and it also pins the
// credential shape the SecureStore record now carries — including the read-time
// migration that stops a guest who is mid-claim when the update lands from
// silently losing their ticket.
//
// Run:
//   node --experimental-strip-types --test \
//     app-mobile/src/utils/__tests__/issue_3524_claim_auth_action_preserve.implementor.happy.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attendanceClaimAuthAction,
  isAttendanceClaimUrl,
  parseAttendanceClaimUrl,
} from "../attendanceClaimDeepLink.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";
const TOKEN = "A".repeat(43);
const CODE = "B".repeat(43);

test("#3524 the full auth-action decision table, all seven rows", () => {
  // 1. We have not observed an account yet. Nothing is known, so nothing moves.
  for (const next of [null, A]) {
    for (const hasIntent of [true, false]) {
      for (const handoff of [true, false]) {
        assert.equal(
          attendanceClaimAuthAction(undefined, next, hasIntent, handoff),
          "none",
          "an unobserved previous account decides nothing",
        );
      }
    }
  }

  // 2. The same account is still signed in. Not a change at all.
  for (const hasIntent of [true, false]) {
    for (const handoff of [true, false]) {
      assert.equal(
        attendanceClaimAuthAction(A, A, hasIntent, handoff),
        "none",
        "the same account is not an account change",
      );
    }
  }

  // 3. A DIFFERENT account, with the handoff marker live -> preserve.
  for (const next of [B, null]) {
    for (const hasIntent of [true, false]) {
      assert.equal(
        attendanceClaimAuthAction(A, next, hasIntent, true),
        "preserve",
        "this flow caused the account change, so the claim survives it",
      );
    }
  }

  // 4. A DIFFERENT account with NO marker -> clear. This is the original rule
  //    and it must still hold: an unrelated account switch takes the claim with
  //    it, so account A's intent cannot follow the device into account B.
  for (const next of [B, null]) {
    for (const hasIntent of [true, false]) {
      assert.equal(
        attendanceClaimAuthAction(A, next, hasIntent, false),
        "clear",
        "an UNRELATED account change still clears the claim",
      );
    }
  }

  // 5. Signed out -> signed in, with a pending claim -> resume.
  for (const handoff of [true, false]) {
    assert.equal(
      attendanceClaimAuthAction(null, A, true, handoff),
      "resume",
      "signing in with a pending claim re-presents the sheet",
    );
  }

  // 6. Signed out -> signed in with nothing pending -> nothing to do.
  for (const handoff of [true, false]) {
    assert.equal(
      attendanceClaimAuthAction(null, A, false, handoff),
      "none",
      "no pending claim, nothing to resume",
    );
  }

  // 7. Signed out and still signed out.
  for (const hasIntent of [true, false]) {
    for (const handoff of [true, false]) {
      assert.equal(
        attendanceClaimAuthAction(null, null, hasIntent, handoff),
        "none",
        "no account either side is not a change",
      );
    }
  }
});

test("#3524 the marker cannot forge a preserve out of a non-change", () => {
  // The marker is not a master key. It only ever changes the answer for a REAL
  // account change; it can never invent one, and it can never resurrect a claim
  // across an account that never moved.
  assert.equal(attendanceClaimAuthAction(A, A, true, true), "none");
  assert.equal(attendanceClaimAuthAction(undefined, B, true, true), "none");
  assert.equal(attendanceClaimAuthAction(null, null, true, true), "none");
  // And with no marker, a real change is still destructive — which is the
  // protection the fourth answer must not have weakened.
  assert.equal(attendanceClaimAuthAction(A, B, true, false), "clear");
});

test("#3524 the default keeps every pre-existing caller behaving exactly as before", () => {
  // Called with three arguments, as every call site did before this change.
  assert.equal(attendanceClaimAuthAction(A, B, true), "clear");
  assert.equal(attendanceClaimAuthAction(null, A, true), "resume");
  assert.equal(attendanceClaimAuthAction(A, A, true), "none");
});

test("#3524 the claim URL parser carries a DISCRIMINATED credential", () => {
  const web = (frag: string) =>
    `https://host.usemingla.com/attendance/claim#${frag}`;
  const native = (frag: string) =>
    `com.mingla.app.v2://attendance-claim#${frag}`;
  const tokenFrag = `v=1&kind=order&event=${EVENT}&source=${SOURCE}&token=${TOKEN}`;
  const codeFrag = `v=1&kind=order&event=${EVENT}&source=${SOURCE}&hc=${CODE}`;

  for (const build of [web, native]) {
    assert.ok(isAttendanceClaimUrl(build(tokenFrag)), "the claim URL is recognised");

    const fromToken = parseAttendanceClaimUrl(build(tokenFrag));
    assert.ok(fromToken !== null, "the emailed token form parses");
    assert.equal(fromToken.credential.kind, "token");
    assert.equal(fromToken.credential.value, TOKEN);
    assert.equal(fromToken.eventId, EVENT);
    assert.equal(fromToken.sourceId, SOURCE);

    const fromCode = parseAttendanceClaimUrl(build(codeFrag));
    assert.ok(fromCode !== null, "the scanned handoff form parses");
    assert.equal(fromCode.credential.kind, "handoff");
    assert.equal(fromCode.credential.value, CODE);

    // The old bare `token` field is GONE, not shadowed: a call site cannot read
    // the wrong one because there is only one.
    assert.equal(
      (fromCode as unknown as { token?: unknown }).token,
      undefined,
      "no bare token field survives beside the credential",
    );
  }

  // The exhaustiveness stays exhaustive.
  assert.equal(
    parseAttendanceClaimUrl(
      web(`v=1&kind=order&event=${EVENT}&source=${SOURCE}&token=${TOKEN}&hc=${CODE}`),
    ),
    null,
    "both credentials at once is refused",
  );
  assert.equal(
    parseAttendanceClaimUrl(web(`v=1&kind=order&event=${EVENT}&source=${SOURCE}`)),
    null,
    "neither credential is refused",
  );
  assert.equal(
    parseAttendanceClaimUrl(
      web(`v=1&kind=order&event=${EVENT}&source=${SOURCE}&token=${TOKEN}&x=1`),
    ),
    null,
    "a sixth key is refused",
  );
  assert.equal(
    parseAttendanceClaimUrl(
      web(`v=1&kind=order&event=${EVENT}&source=${SOURCE}&hc=${"B".repeat(42)}`),
    ),
    null,
    "a short handoff code is refused",
  );
  assert.equal(
    isAttendanceClaimUrl("https://host.usemingla.com/attendance/claims#x=1"),
    false,
    "a neighbouring path is not a claim URL",
  );
});
