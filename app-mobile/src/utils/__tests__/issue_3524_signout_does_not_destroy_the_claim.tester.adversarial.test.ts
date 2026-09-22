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
  attendanceClaimHandoffIsLive,
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

// ───────────────────────────────────────────────────────────────────────────
// RETEST (P2-1). The flag now ages out. Angle 8 above only counted disarm
// sites; these measure the boundary itself, and the wiring that carries the
// sheet's decision to the ref the shell actually reads.
// ───────────────────────────────────────────────────────────────────────────

/**
 * The TTL constant lives beside the SecureStore marker it governs, in
 * `attendanceClaimService.ts`, which pulls in the Supabase client and cannot be
 * imported by this runner. It is read out of the source instead — deliberately,
 * because reading it here is also what pins the flag and the marker to ONE
 * number rather than two that can drift.
 */
const ttlSource = readFileSync(
  join(APP_MOBILE, "src/services/attendanceClaimService.ts"),
  "utf8",
);
const ttlMatch = ttlSource.match(
  /ATTENDANCE_CLAIM_HANDOFF_TTL_MS\s*=\s*([0-9*\s_]+);/,
);
const TTL: number = ttlMatch
  // eslint-disable-next-line no-eval
  ? Number(eval(ttlMatch[1].replace(/_/g, "")))
  : Number.NaN;
const START = 1_000_000;

test("(9) the TTL is the marker's own thirty minutes, and the boundary is inclusive", () => {
  assert.ok(ttlMatch !== null, "ATTENDANCE_CLAIM_HANDOFF_TTL_MS must be one exported constant");
  assert.equal(TTL, 30 * 60 * 1000, "the flag must age out on the marker's clock");
  assert.ok(
    ttlSource.includes("const HANDOFF_TTL_MS = ATTENDANCE_CLAIM_HANDOFF_TTL_MS"),
    "the marker's own read must use the SAME constant the flag does — two "
      + "thirty-minute literals are two numbers that can drift",
  );
  assert.equal(
    attendanceClaimHandoffIsLive(true, START, START + TTL, TTL),
    true,
    "EXACTLY at thirty minutes is still live — the marker's own read uses "
      + "`<= TTL`, and a flag that died a millisecond earlier than the record "
      + "it mirrors would clear a claim the marker would still have preserved",
  );
  assert.equal(
    attendanceClaimHandoffIsLive(true, START, START + TTL + 1, TTL),
    false,
    "one millisecond past thirty minutes is dead",
  );
  assert.equal(
    attendanceClaimHandoffIsLive(true, START, START + TTL - 1, TTL),
    true,
    "one millisecond before thirty minutes is live",
  );
  assert.equal(
    attendanceClaimHandoffIsLive(true, START, START, TTL),
    true,
    "the instant it is written it is live",
  );
});

test("(10) an inactive flag is dead no matter how fresh the start time", () => {
  assert.equal(attendanceClaimHandoffIsLive(false, START, START, TTL), false);
  assert.equal(attendanceClaimHandoffIsLive(false, null, START, TTL), false);
  // A clock that jumps backwards (timezone change, NTP correction) must not
  // resurrect anything or make a live flag look ancient.
  assert.equal(
    attendanceClaimHandoffIsLive(true, START, START - 5_000, TTL),
    true,
    "a backwards clock jump leaves the flag live rather than clearing a claim "
      + "the guest is in the middle of",
  );
});

test("(11) an expired flag makes the account change CLEAR again, not preserve", () => {
  // This is the whole point: the TTL only matters because it feeds the table.
  const live = attendanceClaimHandoffIsLive(true, START, START + TTL, TTL);
  const stale = attendanceClaimHandoffIsLive(true, START, START + TTL + 1, TTL);
  assert.equal(act(A, null, true, live), "preserve");
  assert.equal(
    act(A, null, true, stale),
    "clear",
    "once the thirty minutes are up, an account change is an ordinary account "
      + "change again — the pending claim must not follow the device",
  );
});

test("(12) reading the flag disarms it, the way a stale marker read deletes it", () => {
  const index = read("app/index.tsx");
  const body = index.slice(
    index.indexOf("const attendanceClaimHandoffLive"),
    index.indexOf("const attendanceClaimSettled"),
  );
  assert.ok(body.length > 0, "the shell must have one place that answers this");
  assert.ok(
    body.includes("attendanceClaimHandoffActiveRef.current = false")
      && body.includes("attendanceClaimHandoffStartedAtRef.current = null")
      && body.includes("clearAttendanceClaimHandoffMarker"),
    "a stale read must disarm BOTH halves and delete the marker, or the ref "
      + "and the record it mirrors drift apart again",
  );
  assert.ok(
    !/\bawait\b/.test(body),
    "and it must stay synchronous — an async read here resolves after the auth "
      + "effect has already decided, which is why this is a ref at all",
  );
});

test("(13) the sheet tells the shell the claim is over, on every path that deletes the marker", () => {
  const sheet = read("src/components/AttendanceClaimSheet.tsx");
  const settled = (sheet.match(/onClaimSettled\(\)/g) ?? []).length;
  const cleared = (sheet.match(/clearAttendanceClaimHandoffMarker\(\)/g) ?? []).length;
  assert.ok(
    settled >= cleared && settled >= 2,
    `the sheet deletes the marker in ${cleared} place(s) and reports settled in `
      + `${settled}. The shell's ref is the value the decision actually reads and `
      + "the sheet cannot touch it, so every marker delete must be accompanied "
      + "by the callback or the two disagree.",
  );
  const index = read("app/index.tsx");
  assert.ok(
    index.includes("onClaimSettled={attendanceClaimSettled}"),
    "and the shell must actually pass it",
  );
});
