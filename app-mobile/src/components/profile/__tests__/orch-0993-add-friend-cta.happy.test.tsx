// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-0993 [Add Friend button on public profile] — implementor happy-path
// regression test. Proves the EXISTING friend Message path is preserved when the
// new Add-Friend CTA `else` branch is added:
//   T-04  friend profile shows Message and NO Add-Friend pill
//   T-10  the existing Message button fires onMessage(userId) unchanged
//
// app-mobile has no jest/RTL runner; the repo convention for mobile regression
// tests is node:assert source-assertions (see YourCircleSection.happy.test.tsx).
// This test asserts against ViewFriendProfileScreen.tsx source so it FAILS on
// revert of the gate/derivation and PASSES when restored.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../../../..');
const SCREEN = 'app-mobile/src/components/profile/ViewFriendProfileScreen.tsx';

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function runOrch0993HappyTest() {
  const src = read(SCREEN);

  // ── T-04 + T-10: the existing Message button stays gated on profile.isFriend
  //    and fires onMessage(userId) exactly as before. The new CTA must be an
  //    `else` branch so the friend-only Message gate is structurally intact. ──

  // The Message gate condition is unchanged (onMessage && profile.isFriend).
  assert.match(
    src,
    /onMessage && profile\.isFriend/,
    'Message button must remain gated on `onMessage && profile.isFriend` (T-04/T-10)',
  );

  // The Message button still fires onMessage(userId) unchanged (T-10).
  assert.match(
    src,
    /onPress=\{\(\) => onMessage\(userId\)\}/,
    'Message button must still call onMessage(userId) unchanged (T-10)',
  );

  // The Message render is reached ONLY in the friends relationship state —
  // proving Add-Friend never co-renders with Message (T-04).
  assert.match(
    src,
    /relationship === 'friends' \?[\s\S]*?onMessage && profile\.isFriend/,
    "Message must render only under relationship === 'friends' (T-04)",
  );

  // The Add-Friend CTA is the `else` branch (stranger/outgoing/incoming), so it
  // is structurally impossible for a stranger to see Message (T-04).
  assert.match(
    src,
    /\) : \(\s*<AddFriendCta/,
    'Add-Friend CTA must be the else branch of the friends/Message gate (T-04)',
  );

  // Relationship derivation reads the existing useFriendRequests owner (I-CONST-2/4),
  // friends wins over a stale pending row (SPEC §3.4).
  assert.match(src, /useFriendRequests\(currentUserId\)/, 'must consume existing useFriendRequests(currentUserId)');
  assert.match(
    src,
    /profile\?\.isFriend\s*\?\s*'friends'/,
    'friends must win over any pending row in the derivation (SPEC §3.4)',
  );

  // Self-guard: own profile renders neither button (SC-6).
  assert.match(src, /const isSelf =/, 'self-guard must exist (SC-6)');
  assert.match(src, /isSelf \? null :/, 'self → render nothing in CTA region (SC-6)');

  // SC-9 mirror: the screen introduces NO new Realtime subscription
  // (full SC-9 grep gate runs separately over the whole diff).
  assert.doesNotMatch(src, /\.channel\(/, 'no new Realtime subscription in the screen (SC-9)');
}

if (require.main === module) {
  try {
    runOrch0993HappyTest();
    console.log('PASS ORCH-0993 Add-Friend CTA happy-path regression (T-04 + T-10)');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runOrch0993HappyTest };
