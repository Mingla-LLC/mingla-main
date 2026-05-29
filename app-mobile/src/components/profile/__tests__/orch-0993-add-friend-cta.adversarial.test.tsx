// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-0993 [Add Friend button on public profile] — TESTER adversarial
// regression test. Attacks a DIFFERENT angle than the implementor's happy-path
// test (which asserts the friends/Message gate structure + the else-branch).
//
// This test attacks the FAILURE + RACE + PRECEDENCE surface of the CTA, the
// states production actually spends most of its time in:
//   T-06  network-error TRUTHFULNESS — on a network throw the pill must NOT
//         flip to "Requested"; it returns to its pre-action state, shows the
//         inline `error_network` copy, fires an error haptic, no false success.
//   T-07  `addFriend` "User not found" throw → classified `unavailable` →
//         `error_unavailable` copy (the blocked / not-found fail-closed path).
//   T-08  STALE pending row + accepted edge coexist → friends WINS (NOT
//         "Requested"): the `profile?.isFriend ? 'friends'` precedence is first
//         in the ternary so an accepted edge dominates any stale pending row.
//   T-09  rapid double-tap IDEMPOTENCY — the in-flight guard short-circuits the
//         2nd tap (`if (ctaInFlight) return;`) AND the button is `disabled`
//         while submitting; the DB `sender_id,receiver_id` UNIQUE constraint is
//         the backstop (asserted live against the migration, not just claimed).
//
// app-mobile has no jest/RTL runner; the repo convention for mobile regression
// tests is node:assert source-assertions (see the implementor's happy test +
// YourCircleSection.happy.test.tsx). Run with:  node <thisfile>
//
// These assertions are written so each FAILS when the specific guard/branch
// they protect is reverted (see the QA report for the captured fails-on-revert
// run), and they do NOT overlap the happy test's gate/else-branch assertions.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../../../..');
const SCREEN = 'app-mobile/src/components/profile/ViewFriendProfileScreen.tsx';
const EN_PROFILE = 'app-mobile/src/i18n/locales/en/profile.json';

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

// ── Helper: isolate the parent screen's relationship derivation + the three
//    async handlers, so our regex assertions can't accidentally match the
//    presenter sub-component or unrelated code. ──
function sliceBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.notStrictEqual(start, -1, `marker not found: ${startMarker}`);
  const end = endMarker ? src.indexOf(endMarker, start) : src.length;
  return src.slice(start, end === -1 ? src.length : end);
}

function runOrch0993AdversarialTest() {
  const src = read(SCREEN);

  // ────────────────────────────────────────────────────────────────────────
  // T-08 — PRECEDENCE: friends WINS over any stale pending row.
  // The derivation ternary MUST test `profile?.isFriend` FIRST and resolve to
  // 'friends' before ever considering outgoingRequest/incomingRequest. If the
  // order were inverted (pending checked first), a stale outgoing row would
  // mis-render "Requested" for an actual friend. We assert the EXACT precedence
  // chain shape: isFriend → 'friends' → outgoing → 'outgoing_pending' →
  // incoming → 'incoming_pending' → 'stranger'.
  // ────────────────────────────────────────────────────────────────────────
  const derivation = sliceBetween(
    src,
    'const relationship:',
    'const classifyCtaError',
  );
  // friends is the FIRST arm of the ternary (wins).
  assert.match(
    derivation,
    /profile\?\.isFriend[\s\S]*?\?\s*'friends'/,
    "T-08: derivation must resolve to 'friends' as the FIRST ternary arm (friends wins over stale pending)",
  );
  // outgoing is evaluated only AFTER friends, incoming only after outgoing,
  // stranger is the final fallthrough — assert the full ordered chain.
  assert.match(
    derivation,
    /\?\s*'friends'[\s\S]*?outgoingRequest[\s\S]*?'outgoing_pending'[\s\S]*?incomingRequest[\s\S]*?'incoming_pending'[\s\S]*?'stranger'/,
    "T-08: precedence chain must be friends → outgoing_pending → incoming_pending → stranger (in that order)",
  );
  // Guard the order specifically: 'friends' must appear BEFORE 'outgoing_pending'
  // in the source (a reverted/inverted ternary would fail this).
  assert.ok(
    derivation.indexOf("'friends'") < derivation.indexOf("'outgoing_pending'"),
    "T-08: 'friends' arm must precede 'outgoing_pending' (accepted edge dominates a stale pending row)",
  );
  // The outgoing/incoming rows must be scoped to status === 'pending' so a stale
  // accepted/declined/cancelled row never drives the pending states.
  assert.match(
    src,
    /r\.type === 'outgoing' && r\.receiver_id === userId && r\.status === 'pending'/,
    "T-08: outgoing match must require status === 'pending' (stale non-pending rows excluded)",
  );
  assert.match(
    src,
    /r\.type === 'incoming' && r\.sender_id === userId && r\.status === 'pending'/,
    "T-08: incoming match must require status === 'pending' (stale non-pending rows excluded)",
  );

  // ────────────────────────────────────────────────────────────────────────
  // T-07 — "User not found" / blocked → classified as `unavailable`.
  // classifyCtaError MUST map the addFriend "User not found" throw (and
  // block/visibility throws) to the 'unavailable' kind, which renders the
  // `error_unavailable` copy. A reverted classifier (e.g. defaulting these to
  // 'generic') fails this.
  // ────────────────────────────────────────────────────────────────────────
  const classifier = sliceBetween(src, 'const classifyCtaError', 'const handleAddFriend');
  assert.match(
    classifier,
    /not found|not available|blocked|can't view|cannot view/i,
    "T-07: classifier must recognize not-found/blocked/visibility messages",
  );
  assert.match(
    classifier,
    /\)\)\s*return 'unavailable'/,
    "T-07: not-found/blocked branch must return the 'unavailable' kind",
  );

  // ────────────────────────────────────────────────────────────────────────
  // T-06 — NETWORK-ERROR TRUTHFULNESS (the most important adversarial check).
  // On ANY mutation throw, the handler must NOT optimistically advance the
  // relationship (no manual setState to outgoing_pending / 'Requested'); the
  // pill returns to its pre-action state purely via `finally { setCtaInFlight
  // (null) }`, an error haptic fires, and the error kind is set. The derived
  // state stays 'stranger' because the DB write never succeeded (no
  // friendsKeys.requests row → no 'Requested'). We prove the handler:
  //   (a) sets in-flight before the await,
  //   (b) on catch fires the ERROR haptic + sets the error kind,
  //   (c) NEVER writes the relationship locally (no optimistic flip),
  //   (d) clears in-flight in finally (pill restored).
  // ────────────────────────────────────────────────────────────────────────
  const handleAdd = sliceBetween(src, 'const handleAddFriend', 'const handleAcceptRequest');

  // network/offline messages classify to 'network' (→ error_network copy).
  assert.match(
    classifier,
    /network|offline|fetch|connection|timeout/i,
    "T-06: classifier must recognize network/offline messages → 'network' kind",
  );
  assert.match(
    classifier,
    /\)\)\s*return 'network'/,
    "T-06: network branch must return the 'network' kind (→ error_network copy)",
  );
  // catch fires the ERROR haptic (not Success) — no false success.
  assert.match(
    handleAdd,
    /catch[\s\S]*?Haptics\.notificationAsync\(\s*Haptics\.NotificationFeedbackType\.Error\s*\)/,
    'T-06: a throw must fire the ERROR haptic in the catch (truthful failure)',
  );
  // catch sets the error kind via the classifier.
  assert.match(
    handleAdd,
    /catch[\s\S]*?setCtaError\(\s*classifyCtaError\(err\)\s*\)/,
    'T-06: a throw must surface an inline error (setCtaError) — Constitution #3 no silent failure',
  );
  // The pill is restored in `finally` (pre-action state), regardless of throw.
  assert.match(
    handleAdd,
    /finally\s*\{\s*setCtaInFlight\(null\)/,
    'T-06: in-flight must clear in finally so the pill returns to its pre-action state on error',
  );
  // CRITICAL: the handler must NOT optimistically flip to outgoing_pending /
  // 'Requested' anywhere — the ONLY path to 'Requested' is the cache
  // invalidation after a SUCCESSFUL DB write (SPEC §3.2/§7.1). A handler that
  // locally forced the state would show a false "Requested" on a network error.
  assert.doesNotMatch(
    handleAdd,
    /set\w*[Rr]elationship|setOutgoing|'outgoing_pending'|'Requested'/,
    "T-06: handleAddFriend must NOT optimistically set 'Requested'/outgoing — state only flips via cache invalidation on real success (no false success on network error)",
  );
  // Success haptic only fires AFTER the awaited addFriend resolves (success path).
  assert.match(
    handleAdd,
    /await addFriend\([\s\S]*?Haptics\.notificationAsync\(\s*Haptics\.NotificationFeedbackType\.Success\s*\)/,
    'T-06: Success haptic fires only after addFriend resolves (never before/regardless)',
  );

  // ────────────────────────────────────────────────────────────────────────
  // T-09 — RAPID DOUBLE-TAP IDEMPOTENCY.
  // (a) Each handler short-circuits if an action is already in flight
  //     (`if (ctaInFlight) return;`) — the 2nd tap is a no-op.
  // (b) The presenter button is `disabled` while submitting AND made
  //     non-interactive (pointerEvents none), so the 2nd tap can't even fire.
  // (c) DB backstop: the friend_requests UNIQUE(sender_id, receiver_id)
  //     constraint guarantees idempotency even if two INSERTs raced.
  // ────────────────────────────────────────────────────────────────────────
  // (a) every handler guards on ctaInFlight at entry.
  for (const [name, marker, endMarker] of [
    ['handleAddFriend', 'const handleAddFriend', 'const handleAcceptRequest'],
    ['handleAcceptRequest', 'const handleAcceptRequest', 'const doCancelRequest'],
    ['doCancelRequest', 'const doCancelRequest', 'const [customHolidays'],
  ]) {
    const body = sliceBetween(src, marker, endMarker);
    assert.match(
      body,
      /if \(ctaInFlight[\s\S]*?\)\s*return;/,
      `T-09: ${name} must short-circuit when an action is already in flight (double-tap guard)`,
    );
  }
  // (b) presenter disables + makes the pill non-interactive while submitting.
  assert.match(src, /disabled=\{submitting\}/, 'T-09: pill must be disabled while submitting');
  assert.match(
    src,
    /submitting \? \{ pointerEvents: 'none'/,
    'T-09: pill must be pointerEvents:none while submitting (backs up disabled)',
  );
  // (c) DB UNIQUE backstop exists in the schema (idempotent INSERT race guard).
  const baselineSql = read(
    'supabase/migrations/20260505000000_baseline_squash_orch_0729.sql',
  );
  assert.match(
    baselineSql,
    /ADD CONSTRAINT "friend_requests_sender_id_receiver_id_key" UNIQUE \("sender_id", "receiver_id"\)/,
    'T-09: friend_requests UNIQUE(sender_id,receiver_id) DB backstop must exist (idempotency on race)',
  );

  // ────────────────────────────────────────────────────────────────────────
  // SC-8 corroboration — no 'profile' source value introduced anywhere
  // (addFriend INSERT defaults source to 'app'); no enum migration shipped.
  // ────────────────────────────────────────────────────────────────────────
  assert.doesNotMatch(
    src,
    /source:\s*['"]profile['"]/,
    "SC-8: the screen must NOT pass a 'profile' source (defaults to 'app', no enum migration)",
  );

  // ────────────────────────────────────────────────────────────────────────
  // Copy contract — the three error kinds map to the exact LOCKED copy keys
  // (SPEC §7.3). A reverted/renamed key fails this.
  // ────────────────────────────────────────────────────────────────────────
  const enProfile = JSON.parse(read(EN_PROFILE)).friend || {};
  assert.strictEqual(
    enProfile.error_network,
    "You're offline. Check your connection and try again.",
    'T-06: error_network copy must match SPEC §7.3 exactly',
  );
  assert.strictEqual(
    enProfile.error_unavailable,
    "This person isn't available right now.",
    'T-07: error_unavailable copy must match SPEC §7.3 exactly',
  );
  // Presenter selects the matching copy per error kind.
  assert.match(
    src,
    /error === 'network'\s*\?\s*t\('profile:friend\.error_network'\)/,
    'T-06: presenter must render error_network for the network kind',
  );
  assert.match(
    src,
    /error === 'unavailable'\s*\?\s*t\('profile:friend\.error_unavailable'\)/,
    'T-07: presenter must render error_unavailable for the unavailable kind',
  );
}

if (require.main === module) {
  try {
    runOrch0993AdversarialTest();
    console.log(
      'PASS ORCH-0993 Add-Friend CTA adversarial regression (T-06 network-truth + T-07 unavailable + T-08 friends-wins + T-09 double-tap/DB-backstop)',
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runOrch0993AdversarialTest };
