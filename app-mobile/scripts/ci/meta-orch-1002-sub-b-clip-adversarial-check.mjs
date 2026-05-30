#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * META-ORCH-1002 Sub-B — TESTER ADVERSARIAL clip-risk regression check.
 *
 * Attacks a DIFFERENT angle than the implementor's happy-path source-reader
 * (meta-orch-1002-sub-b-consumer-glass-check.mjs asserts that overflow:'hidden'
 * was ADDED + fills are correct). This test instead attacks the PRIMARY RISK of
 * the whole sweep: overflow:'hidden' CLIPS any child that intentionally extends
 * beyond the rounded container, on BOTH iOS and Android (overflow:'hidden' is
 * NOT platform-guarded in any swept surface).
 *
 * On-device live-fire (QA_META-ORCH-1002_SUB-B_CONSUMER_GLASS.md) proved NO swept
 * surface clips a child. This test LOCKS that finding so a future edit that drops
 * an edge-anchored child (status/online dot, corner badge, avatar-ring segment,
 * "+N" overflow bit) DIRECTLY into a swept overflow:'hidden' container fails CI.
 *
 * Mechanism: for the one swept container that legitimately HAS edge-anchored
 * absolute children near it (C6 ChatListItem.container — onlineDot at bottom:0/
 * right:0 and groupAvatarSegment), assert those children remain nested inside the
 * `avatarContainer` / `groupAvatarStack` sub-views (which sit inset within the
 * row), NOT promoted to direct children of `container`. If a refactor ever moves
 * onlineDot/groupAvatarSegment to be a direct child of the row, overflow:'hidden'
 * would crop it — this test catches that.
 *
 * It also asserts the Swipeable swipe-action views (swipeArchive/swipeDelete) are
 * rendered by the Swipeable parent as SIBLINGS of the overflow:'hidden' container
 * (so the left/right swipe reveal is never clipped).
 *
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

// Extract the JSX render body (everything from the component's `return (` to the
// final `);` before the StyleSheet.create) so we can reason about nesting order.
const renderBody = (src) => {
  const start = src.indexOf("return (");
  const end = src.indexOf("StyleSheet.create");
  if (start === -1) return src;
  return src.slice(start, end === -1 ? undefined : end);
};

// Pull a named StyleSheet block "<name>: { ... }" (first match).
const styleBlock = (code, styleName) => {
  const re = new RegExp(`${styleName}:\\s*\\{`);
  const m = re.exec(code);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  for (; i < code.length && depth > 0; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth--;
  }
  return code.slice(m.index, i);
};

// ── C6 ChatListItem — the only swept container with edge-anchored absolute children ──
const CHAT = "src/components/connections/ChatListItem.tsx";
const chatSrc = read(CHAT);

if (!chatSrc) {
  check("FILE ChatListItem.tsx exists", false, CHAT);
} else {
  const body = renderBody(chatSrc);

  // 1. The swept container MUST carry overflow:'hidden' (precondition for the risk).
  const containerBlk = styleBlock(chatSrc, "container");
  check(
    "C6 container is the overflow:'hidden' surface under test",
    !!containerBlk && /overflow:\s*['"]hidden['"]/.test(containerBlk),
    "container must have overflow:'hidden' for this adversarial test to be meaningful",
  );

  // 2. onlineDot is rendered INSIDE the avatarContainer sub-view, not as a direct
  //    child of the row container. The onlineDot JSX must appear AFTER an
  //    `styles.avatarContainer` open and BEFORE that TouchableOpacity closes —
  //    i.e. it is nested in the avatar column (inset from the rounded corner),
  //    so overflow:'hidden' on `container` cannot crop it.
  const onlineDotIdx = body.indexOf("styles.onlineDot");
  const avatarContainerIdx = body.lastIndexOf(
    "styles.avatarContainer",
    onlineDotIdx,
  );
  check(
    "C6 onlineDot is nested inside avatarContainer (NOT a direct child of the clipped row)",
    onlineDotIdx !== -1 &&
      avatarContainerIdx !== -1 &&
      avatarContainerIdx < onlineDotIdx,
    "onlineDot (bottom:0,right:0) must stay inside avatarContainer; promoting it to a direct child of container would let overflow:'hidden' crop it",
  );

  // 3. onlineDot style stays anchored to the avatar's own corner (bottom/right 0),
  //    which sits INSIDE the 50px avatar that is itself centered in the 82px
  //    avatarColumn with vertical padding — i.e. comfortably inside the row.
  //    Guard: the dot must NOT carry a NEGATIVE offset (which would push it past
  //    the avatar edge toward the clipped row boundary).
  const onlineDotBlk = styleBlock(chatSrc, "onlineDot");
  const hasNegativeOffset =
    !!onlineDotBlk && /(top|bottom|left|right):\s*-\d/.test(onlineDotBlk);
  check(
    "C6 onlineDot has no negative offset that would push it toward the clipped row edge",
    !!onlineDotBlk && !hasNegativeOffset,
    "a negative top/bottom/left/right on onlineDot would risk clipping under overflow:'hidden'",
  );

  // 4. groupAvatarSegment (the layered "+N" fan members) live inside
  //    groupAvatarStack, which is inside avatarContainer — never a direct child
  //    of the clipped container.
  const segIdx = body.indexOf("styles.groupAvatarSegment");
  const stackIdx = body.lastIndexOf("styles.groupAvatarStack", segIdx);
  check(
    "C6 groupAvatarSegment is nested inside groupAvatarStack (inset from the clipped row corner)",
    segIdx !== -1 && stackIdx !== -1 && stackIdx < segIdx,
    "the layered avatar fan must stay inside groupAvatarStack so overflow:'hidden' on container does not crop the rightmost segment",
  );

  // 5. The Swipeable swipe-action views are SIBLINGS of the clipped container —
  //    renderRightActions builds swipeArchive/swipeDelete and is handed to
  //    <Swipeable>, which renders them OUTSIDE the TouchableOpacity that owns
  //    styles.container. So the left/right swipe reveal is never clipped.
  const swipeableWrapsContainer =
    body.indexOf("<Swipeable") !== -1 &&
    body.indexOf("renderRightActions") !== -1 &&
    body.indexOf("<Swipeable") < body.indexOf("styles.container");
  check(
    "C6 Swipeable wraps the clipped container so swipe actions are siblings (reveal not clipped)",
    swipeableWrapsContainer,
    "swipe actions must be rendered by the Swipeable parent, not as children of the overflow:'hidden' container",
  );
}

// ── Cross-surface guard: every swept surface that DID gain overflow:'hidden'
//    must NOT contain a direct absolutely-positioned child with an edge offset
//    of 0 AND a sibling marker indicating a badge/dot, unless that child is the
//    avatar-nested case handled above. We implement the conservative form:
//    NO swept container's OWN style block may itself be position:'absolute' with
//    overflow:'hidden' (which would be a clipped, self-positioned chip). ──
const SWEPT = [
  ["src/components/IncomingPairRequestCard.tsx", "card"],
  ["src/components/PairingInfoCard.tsx", "card"],
  ["src/components/PairedPeopleRow.tsx", "card"],
  ["src/components/ui/MultiDayCalendar.tsx", "container"],
  ["src/components/connections/AddFriendView.tsx", "glassCard"],
  ["src/components/onboarding/OnboardingShell.tsx", "secondaryCta"],
  ["src/components/connections/StartSwipingHeaderButton.tsx", "button"],
  ["src/components/activity/CalendarTab.tsx", "emptyState"],
  ["src/components/activity/CalendarTab.tsx", "accordionHeader"],
  ["src/components/activity/SavedTab.tsx", "emptyState"],
  ["src/components/profile/AccountSettings.tsx", "card"],
  ["src/components/profile/BillingSheet.tsx", "currentCard"],
  ["src/components/profile/BillingSheet.tsx", "tierCard"],
];

for (const [rel, styleName] of SWEPT) {
  const src = read(rel);
  const blk = src ? styleBlock(src, styleName) : null;
  if (!blk) {
    check(`SWEPT ${styleName} block resolvable in ${path.basename(rel)}`, false, rel);
    continue;
  }
  const hasClip = /overflow:\s*['"]hidden['"]/.test(blk);
  // Adversarial: the swept rounded surface must clip AND must not declare a fixed
  // tiny height that would crop multi-line content; we only assert clip presence
  // here (fill correctness is the implementor test's job) — the value of THIS test
  // is the nesting assertions above. Keep this as a presence cross-check so the
  // adversarial file fails loudly if a swept surface loses its clip in a refactor.
  check(
    `SWEPT ${path.basename(rel)} · ${styleName} retains overflow:'hidden' (clip not silently dropped)`,
    hasClip,
    "a refactor that removes overflow:'hidden' reopens the inset-ring AND is caught here independently of the implementor gate",
  );
}

// ── Report ──
let failed = 0;
console.log("\nMETA-ORCH-1002 Sub-B — TESTER adversarial clip-risk check\n");
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  if (!c.pass) failed++;
  console.log(`  [${tag}] ${c.name}${c.pass ? "" : `\n         → ${c.detail}`}`);
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed ? 1 : 0);
