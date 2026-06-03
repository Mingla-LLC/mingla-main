// ORCH-1059 — collab "Notify the group" return-to-chat + chip-separator removal.
//
// Source-static regression (RN component + Supabase service: behavior is wired
// across three files, so we assert on the wiring text — the same pattern the
// ORCH-1041 / WaveC .mjs gates use). This is intentionally adversarial: each
// assertion fails if the specific Fix-1 / Fix-2 line is reverted.
//
// Fix 1 (return to chat on success only):
//   (a) postCollabDeadEndBanner returns a success boolean — `true` only when a
//       row landed; `false` on debounce + on error.
//   (b) SwipeableCards calls onAfterNotify ONLY when the post succeeded
//       (guarded by `if (posted)`), never unconditionally.
//   (c) CollabDeckSheet wires onAfterNotify to a handler that dismisses the
//       prefs sub-sheet AND calls onClose (returns to group chat).
//
// Fix 2 (no bullet/period separator between location chips):
//   (d) CollabLocationChips renders NO `•` bullet and NO `BulletSeparator`,
//       using gap-only spacing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const appMobileSrc = join(here, '..', '..', '..'); // .../app-mobile/src

const bannerService = readFileSync(
  join(appMobileSrc, 'services', 'collabDeadEndBannerService.ts'),
  'utf8',
);
const swipeableCards = readFileSync(
  join(appMobileSrc, 'components', 'SwipeableCards.tsx'),
  'utf8',
);
const collabDeckSheet = readFileSync(
  join(appMobileSrc, 'components', 'connections', 'CollabDeckSheet.tsx'),
  'utf8',
);
const locationChips = readFileSync(
  join(appMobileSrc, 'components', 'collab', 'CollabLocationChips.tsx'),
  'utf8',
);

// ---- Fix 1a: postCollabDeadEndBanner returns a success boolean ----

test('ORCH-1059 T-01: postCollabDeadEndBanner is typed Promise<boolean>, not Promise<void>', () => {
  assert.match(
    bannerService,
    /export async function postCollabDeadEndBanner\([^)]*\):\s*Promise<boolean>/,
    'postCollabDeadEndBanner must return Promise<boolean>',
  );
  assert.ok(
    !/export async function postCollabDeadEndBanner\([^)]*\):\s*Promise<void>/.test(bannerService),
    'must NOT still return Promise<void>',
  );
});

test('ORCH-1059 T-02: success path returns true, debounce + error paths return false', () => {
  // The success toast line must be immediately followed by `return true;`.
  assert.match(
    bannerService,
    /toastManager\.success\('Group notified'[^;]*\);\s*\n\s*return true;/,
    'success path must return true after the success toast',
  );
  // Debounce branch returns false (no row posted).
  assert.match(
    bannerService,
    /toastManager\.warning\('Already flagged just now\.'[^;]*\);\s*\n\s*return false;/,
    'debounce path must return false',
  );
  // Catch block returns false (error → stay put).
  assert.match(
    bannerService,
    /toastManager\.error\("Couldn't notify the group\. Tap to retry\."[^;]*\);\s*\n\s*return false;/,
    'error path must return false',
  );
});

// ---- Fix 1b: SwipeableCards dismisses-to-chat ONLY on success ----

test('ORCH-1059 T-03: SwipeableCards declares the onAfterNotify prop', () => {
  assert.match(swipeableCards, /onAfterNotify\?:\s*\(\)\s*=>\s*void;/, 'prop type declared');
  assert.match(swipeableCards, /\n\s*onAfterNotify,\s*\n/, 'prop destructured');
});

test('ORCH-1059 T-04: onAfterNotify fires ONLY when the post succeeded (guarded by posted)', () => {
  // Capture the boolean.
  assert.match(
    swipeableCards,
    /const posted = await postCollabDeadEndBanner\(/,
    'must capture the boolean result of postCollabDeadEndBanner',
  );
  // Guard the navigation behind `if (posted)`.
  assert.match(
    swipeableCards,
    /if \(posted\)\s*\{\s*\n\s*onAfterNotify\?\.\(\);\s*\n\s*\}/,
    'onAfterNotify must be called ONLY inside `if (posted)`',
  );
  // Adversarial: there must be NO unconditional onAfterNotify call (i.e. a call
  // not preceded on the same logical block by the posted guard). We assert the
  // only onAfterNotify invocation in the file is the guarded one.
  const invocations = swipeableCards.match(/onAfterNotify\?\.\(\)/g) ?? [];
  assert.equal(
    invocations.length,
    1,
    'exactly one onAfterNotify invocation (the success-guarded one) — no unconditional fire',
  );
});

// ---- Fix 1c: CollabDeckSheet returns to chat (dismiss prefs + onClose) ----

test('ORCH-1059 T-05: CollabDeckSheet wires onAfterNotify to dismiss prefs sub-sheet + onClose', () => {
  // Handler exists and does both: close prefs sub-sheet, then onClose().
  assert.match(
    collabDeckSheet,
    /const handleAfterNotify = useCallback\(\(\) => \{\s*\n\s*setShowPrefsSheet\(false\);\s*\n\s*onClose\(\);\s*\n\s*\}/,
    'handleAfterNotify must dismiss the prefs sub-sheet then call onClose (return to chat)',
  );
  // Handler is passed into SwipeableCards.
  assert.match(
    collabDeckSheet,
    /onAfterNotify=\{handleAfterNotify\}/,
    'handleAfterNotify must be wired to SwipeableCards.onAfterNotify',
  );
  // Must NOT abuse onSessionLost for this (distinct semantic).
  assert.ok(
    !/onAfterNotify=\{onClose\}\s*\n[\s\S]*onSessionLost=\{handleAfterNotify\}/.test(collabDeckSheet),
    'must not conflate onAfterNotify with onSessionLost',
  );
});

// ---- Fix 2: no bullet/period separator between the chips ----

test('ORCH-1059 T-06: CollabLocationChips renders NO bullet/period separator', () => {
  // No literal bullet glyph anywhere in the file.
  assert.ok(!locationChips.includes('•'), 'no `•` bullet glyph may remain in CollabLocationChips');
  // The BulletSeparator component must be gone.
  assert.ok(
    !/BulletSeparator/.test(locationChips),
    'the BulletSeparator component must be removed',
  );
  // No `bullet` style block.
  assert.ok(!/\bbullet:\s*\{/.test(locationChips), 'the `bullet` style must be removed');
  // Spacing-only separation: a columnGap on the container.
  assert.match(locationChips, /columnGap:\s*spacing\./, 'chips must be spaced via columnGap (gap-only)');
});

test('ORCH-1059 T-07: chip styling + GPS/pending behavior preserved (no regression)', () => {
  // Keep the canonical glass.discover.chip token usage.
  assert.match(locationChips, /const g = glass\.discover;/, 'glass.discover.chip tokens preserved');
  assert.match(locationChips, /g\.chip\.inactive\.bg/, 'inactive chip bg token preserved');
  // Keep the kind→icon map (gps / place / pending) — "Getting a fix…" pending state.
  assert.match(locationChips, /pending:\s*'hourglass-outline'/, 'pending (getting-a-fix) glyph preserved');
  assert.match(locationChips, /gps:\s*'navigate-outline'/, 'gps glyph preserved');
});
