#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression suite — META-ORCH-0991 [Consumer-app modals → slide-down bottom
 * sheets] FINISHING PASS (bugs 3a, 3b, and completing bug 4 tab-bar awareness).
 *
 * Structural/contract test (same harness approach as BaseBottomSheet.test.mjs /
 * BaseBottomSheetRework.test.mjs — the gorhom + RNGH native hosts are not
 * mountable here). Asserts the THREE finishing-pass contracts and that each
 * FAILS-ON-REVERT:
 *
 *   A  BUG 4 (tab-bar awareness ENABLED). The two in-tree, non-wrapInRNModal
 *      sheets opened from HomePage — over which Mingla's floating GlassBottomNav
 *      stays visible — now set `tabBarAware` so their bottom content clears the
 *      floating menu. AND the primitive's sticky-footer branch wraps the footer
 *      with the tab-bar inset ONLY when tabBarAware (so a non-tabBarAware sticky
 *      footer such as TicketCartSheet is never double-padded).
 *      Fails-on-revert: drop `tabBarAware` from the two sheets / drop the footer
 *      tab-bar wrapper → A FAILS.
 *
 *   B  BUG 3a (reliable Discover card tap). BusinessEventCard + the Discover
 *      Ticketmaster grid card open via an RNGH `Gesture.Tap()` with a generous
 *      `maxDistance` (drift-tolerant, coordinates with the parent ScrollView)
 *      instead of a bare <Pressable onPress> the scroll steals on tiny drift.
 *      Fails-on-revert: restore the <Pressable onPress> card host → B FAILS.
 *
 *   C  BUG 3b (event thumbnails). BusinessEventCard renders its cover via the
 *      SHARED EventCoverMedia (@mingla/offering-rendering) — video covers get a
 *      poster, images get the shared onError fallback — instead of a hand-rolled
 *      ExpoImage + a `coverMediaType !== "video"` flat-band fall-through. The
 *      Discover TM card adds onError + recyclingKey + placeholder to its image.
 *      Fails-on-revert: restore the bare ExpoImage / drop onError → C FAILS.
 *
 * FAILS-ON-REVERT anchor: cd68b3805 (HEAD before this finishing pass).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app-mobile/src/components/ui/__tests__ → repo root is 6 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");

const FAILS_ON_REVERT_COMMIT = "cd68b3805";

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/** Strip comments so doc-comments that NAME a pattern do not trip code-only
 *  assertions. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function run() {
  const BASE = "app-mobile/src/components/ui/BaseBottomSheet.tsx";
  const baseCode = stripComments(read(BASE));

  const NOTIF = "app-mobile/src/components/NotificationsSheet.tsx";
  const notifCode = stripComments(read(NOTIF));

  const FRIEND = "app-mobile/src/components/FriendRequestsModal.tsx";
  const friendCode = stripComments(read(FRIEND));

  const BIZCARD = "app-mobile/src/components/discover/BusinessEventCard.tsx";
  const bizCardRaw = read(BIZCARD);
  const bizCode = stripComments(bizCardRaw);

  const DISCOVER = "app-mobile/src/components/DiscoverScreen.tsx";
  const discoverRaw = read(DISCOVER);
  const discoverCode = stripComments(discoverRaw);

  const TICKETCART = "app-mobile/src/components/expandedCard/TicketCartSheet.tsx";
  const ticketCartCode = stripComments(read(TICKETCART));

  // ── A: BUG 4 — tab-bar awareness enabled on the in-tree sheets ─────────────
  // The two non-wrapInRNModal HomePage sheets (nav stays visible behind them)
  // must opt into tabBarAware.
  assert.match(
    notifCode,
    /\btabBarAware\b/,
    "A NotificationsSheet sets tabBarAware (in-tree sheet under the visible floating nav)",
  );
  // NotificationsSheet stays a non-wrapInRNModal sheet (the precondition).
  assert.match(
    notifCode,
    /wrapInRNModal=\{false\}/,
    "A NotificationsSheet remains wrapInRNModal={false} (HomePage z-stacks it; nav visible)",
  );
  assert.match(
    friendCode,
    /\btabBarAware\b/,
    "A FriendRequestsModal sets tabBarAware (in-tree sheet under the visible floating nav)",
  );
  // FriendRequestsModal must NOT have become a wrapInRNModal sheet.
  assert.doesNotMatch(
    friendCode,
    /wrapInRNModal/,
    "A FriendRequestsModal stays a non-wrapInRNModal sheet (its absolute float keeps the nav visible)",
  );

  // Primitive: the sticky-footer branch wraps the footer with bottomInset ONLY
  // when tabBarAware (a non-tabBarAware sticky footer is never double-padded).
  assert.match(
    baseCode,
    /tabBarAware\s*\?\s*\(\s*<View\s+style=\{\{\s*paddingBottom:\s*bottomInset\s*\}\}>\{stickyFooter\}<\/View>\s*\)\s*:\s*\(?\s*stickyFooter/,
    "A primitive wraps the sticky footer with bottomInset padding ONLY when tabBarAware",
  );
  // Primitive: the sticky scroll body uses the footer-clearance helper (no tab
  // bar height above the pinned footer).
  assert.match(
    baseCode,
    /const\s+withFooterClearance\s*=/,
    "A primitive has a withFooterClearance helper (OS-inset-only for the sticky scroll body)",
  );
  // tabBarExtra only adds the nav height when tabBarAware (additive, opt-in).
  assert.match(
    baseCode,
    /const\s+tabBarExtra\s*=\s*tabBarAware\s*\?\s*BOTTOM_NAV_CONTENT_HEIGHT\s*:\s*0/,
    "A primitive adds the nav height to the inset ONLY when tabBarAware",
  );
  // Adversarial: TicketCartSheet (a sticky-footer sheet) must NOT be tabBarAware
  // (it is mounted inside a wrapInRNModal parent; the nav is hidden) — proves we
  // did not blanket-pad every sticky footer.
  assert.doesNotMatch(
    ticketCartCode,
    /tabBarAware/,
    "A (adversarial) TicketCartSheet is NOT tabBarAware (mounted inside a wrapInRNModal parent; nav hidden)",
  );

  // ── B: BUG 3a — reliable Discover card tap via RNGH Gesture.Tap ────────────
  assert.match(
    bizCode,
    /import\s*\{[^}]*\bGesture\b[^}]*\bGestureDetector\b[^}]*\}\s*from\s*['"]react-native-gesture-handler['"]/,
    "B BusinessEventCard imports Gesture + GestureDetector from react-native-gesture-handler",
  );
  assert.match(
    bizCode,
    /Gesture\.Tap\(\)[\s\S]*?\.maxDistance\(\s*\d+\s*\)/,
    "B BusinessEventCard opens via a drift-tolerant Gesture.Tap().maxDistance(...)",
  );
  // The card host is a GestureDetector, no longer a bare <Pressable onPress>.
  assert.match(
    bizCode,
    /<GestureDetector\s+gesture=\{tapGesture\}>/,
    "B BusinessEventCard wraps its card body in a GestureDetector",
  );
  assert.doesNotMatch(
    bizCode,
    /<Pressable\b[\s\S]*?onPress=\{handlePress\}/,
    "B BusinessEventCard no longer uses a bare <Pressable onPress> (the scroll-stolen host)",
  );

  // Discover TM card (EventGridCard) opens via Gesture.Tap too, with the save
  // tap composed so the heart wins in its region.
  assert.match(
    discoverCode,
    /import\s*\{[^}]*\bGesture\b[^}]*\bGestureDetector\b[^}]*\}\s*from\s*['"]react-native-gesture-handler['"]/,
    "B DiscoverScreen imports Gesture + GestureDetector",
  );
  assert.match(
    discoverCode,
    /cardTapGesture[\s\S]*?Gesture\.Tap\(\)[\s\S]*?\.maxDistance\(\s*\d+\s*\)/,
    "B EventGridCard card-open uses Gesture.Tap().maxDistance(...)",
  );
  assert.match(
    discoverCode,
    /requireExternalGestureToFail\(\s*saveTapGesture\s*\)/,
    "B EventGridCard open-tap defers to the save-heart tap (no double action on the heart)",
  );

  // ── C: BUG 3b — shared EventCoverMedia + image robustness ──────────────────
  assert.match(
    bizCode,
    /import\s*\{[^}]*\bEventCoverMedia\b[^}]*\}\s*from\s*['"]@mingla\/offering-rendering['"]/,
    "C BusinessEventCard imports the SHARED EventCoverMedia (COMMS-0007)",
  );
  assert.match(
    bizCode,
    /<EventCoverMedia[\s\S]*?mediaType=\{data\.coverMediaType\}/,
    "C BusinessEventCard renders its cover via EventCoverMedia (video poster + image fallback)",
  );
  // The hand-rolled flat-band fall-through for video covers is GONE.
  assert.doesNotMatch(
    bizCode,
    /coverMediaType\s*!==\s*["']video["']/,
    "C BusinessEventCard no longer falls through to a flat hue band for video covers",
  );
  assert.doesNotMatch(
    bizCode,
    /from\s+["']expo-image["']/,
    "C BusinessEventCard no longer renders a bare ExpoImage (cover is shared-package-owned)",
  );

  // Discover TM card image robustness: onError fallback + recyclingKey + placeholder.
  assert.match(
    discoverCode,
    /recyclingKey=\{card\.id\}/,
    "C Discover TM card gives expo-image a stable recyclingKey (no recycled wrong image)",
  );
  assert.match(
    discoverCode,
    /onError=\{\(\)\s*=>\s*setHasImageError\(true\)\}/,
    "C Discover TM card falls back on image error (never a blank cell)",
  );
  assert.match(
    discoverCode,
    /placeholder=\{\{\s*blurhash:/,
    "C Discover TM card shows a placeholder blurhash while decoding",
  );
}

try {
  run();
  console.log(
    `PASS META-ORCH-0991 FINISHING PASS regression suite (bugs 3a/3b/4 tab-bar); fails-on-revert anchor ${FAILS_ON_REVERT_COMMIT}`,
  );
} catch (error) {
  console.error(error);
  process.exit(1);
}
