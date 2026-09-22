/**
 * issue #3524 — TESTER ADVERSARIAL: the sign-out in the middle of a claim.
 *
 * `"clear"` exists so account A's pending ticket cannot follow the device into
 * account B. `"preserve"` is a hole in that rule unless it is narrow. This file
 * attacks the narrowness from both sides: the flag must preserve when THIS flow
 * caused the account change, it must still clear when anything else did, and it
 * must never MANUFACTURE a claim that was not already pending.
 *
 * Two angles cannot be reached through the pure function because they live in
 * the ORDER of two statements, so they are asserted against the source. That is
 * the same technique `issue_3524_claim_page_no_auto_navigation` uses on
 * `claim.tsx`, and the same one the strict-grep gates use.
 *
 * Run: node --experimental-strip-types --test <this file>
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  attendanceClaimAuthAction,
  type AttendanceClaimAuthAction,
} from "../attendanceClaimDeepLink.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_MOBILE = join(HERE, "..", "..", "..");
const read = (rel: string): string =>
  readFileSync(join(APP_MOBILE, rel), "utf8");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const act = (
  previous: string | null | undefined,
  next: string | null,
  hasIntent: boolean,
  handoff: boolean,
): AttendanceClaimAuthAction =>
  attendanceClaimAuthAction(previous, next, hasIntent, handoff);

test("(1) the deliberate handoff preserves the claim through its own sign-out", () => {
  // The real sequence: signed in as A, sheet says mismatch, guest taps
  // "Sign out and continue". GoTrue drops the session first (A -> null) and the
  // new account arrives afterwards.
  assert.equal(act(A, null, true, true), "preserve");
  assert.equal(act(A, B, true, true), "preserve");
});

test("(2) WITHOUT the marker the same transition still CLEARS — the rule is intact", () => {
  // Somebody signs out and hands the phone over. The next person must not
  // inherit a pending ticket.
  assert.equal(act(A, null, true, false), "clear");
  assert.equal(act(A, B, true, false), "clear");
  assert.equal(act(A, B, false, false), "clear");
});

test("(3) the marker cannot MANUFACTURE a claim that was never pending", () => {
  // A signed-out -> signed-in transition with no intent is "none" whatever the
  // flag says. `preserve` must never be a way to conjure a resume.
  assert.equal(act(null, B, false, true), "none");
  assert.equal(act(null, null, true, true), "none");
  assert.equal(act(null, B, true, true), "resume");
});

test("(4) a cold start is inert — an unseeded previous id is never an account change", () => {
  for (const handoff of [false, true]) {
    for (const hasIntent of [false, true]) {
      assert.equal(act(undefined, A, hasIntent, handoff), "none");
      assert.equal(act(undefined, null, hasIntent, handoff), "none");
    }
  }
});

test("(5) preserve is reachable ONLY through a genuine change of account", () => {
  // Same id in and out — a token refresh, a re-hydration — is not a handoff.
  for (const handoff of [false, true]) {
    assert.equal(act(A, A, true, handoff), "none");
    assert.equal(act(A, A, false, handoff), "none");
  }
});

test("(6) the marker is written with NO await before the sign-out", () => {
  const sheet = read("src/components/AttendanceClaimSheet.tsx");
  const body = sheet.slice(
    sheet.indexOf("const handoffToAnotherAccount"),
    sheet.indexOf("const submitting = phase ==="),
  );
  assert.ok(
    body.length > 0,
    "handoffToAnotherAccount must exist in AttendanceClaimSheet.tsx",
  );
  assert.ok(
    body.includes("saveAttendanceClaimHandoffMarker"),
    "the handoff action must write the marker",
  );
  assert.ok(
    !/\bawait\b/.test(body),
    "THERE MUST BE NO await BETWEEN THE MARKER AND THE SIGN-OUT. GoTrue's auth "
      + "listener fires while signOut is still in flight; an await here lets the "
      + "auth effect take the \"clear\" branch and destroy the pending claim "
      + "before the marker is visible to it.",
  );
  assert.ok(
    body.indexOf("saveAttendanceClaimHandoffMarker")
      < body.indexOf("onUseDifferentAccount()"),
    "the marker must be written BEFORE the sign-out is requested, not after",
  );
});

test("(7) the user ref advances BEFORE the preserve early-return", () => {
  const index = read("app/index.tsx");
  const advance = index.indexOf("attendanceClaimUserRef.current = nextUserId");
  const bail = index.indexOf('if (authAction === "preserve") return');
  assert.ok(advance > 0, "the auth effect must record the new user id");
  assert.ok(bail > 0, "the auth effect must short-circuit on preserve");
  assert.ok(
    advance < bail,
    "IF preserve RETURNED BEFORE ADVANCING THE REF, the follow-up sign-in would "
      + "read the OLD user id, compute another \"preserve\", and the sheet would "
      + "never resume. The guest would sign in correctly and see nothing.",
  );
});

test("(8) the in-session handoff flag is disarmed when the claim finishes", () => {
  // R-2 deletes the marker on a successful claim, a terminal failure, an
  // explicit dismiss, a stale TTL read, and any completed attempt after the new
  // sign-in. The SHEET does delete the SecureStore record on those paths — but
  // the value the decision actually reads is the in-memory ref in app/index.tsx,
  // and the sheet cannot reach it. Today that ref is set false in exactly ONE
  // place, the "clear" branch, and it is seeded from SecureStore only on mount.
  // So after a claim completes the flag stays true for the rest of the app
  // session, outliving the marker's own 30 minutes, and the NEXT account change
  // — an unrelated one — takes "preserve" instead of "clear".
  //
  // The identity predicate still stops the ticket landing on the wrong account.
  // What does not stop is a stranger's pending claim, and the masked purchase
  // address on it, being presented to whoever signs in next.
  const index = read("app/index.tsx");
  const disarms = index.match(
    /attendanceClaimHandoffActiveRef\.current\s*=\s*false/g,
  ) ?? [];
  assert.ok(
    disarms.length >= 2,
    "app/index.tsx disarms the handoff flag in "
      + `${disarms.length} place(s). It needs at least two: the "clear" branch, `
      + "and a completed claim attempt. Otherwise the flag outlives both the "
      + "claim and the marker's 30-minute TTL, and the next unrelated account "
      + "switch preserves a claim it should clear.",
  );
});
