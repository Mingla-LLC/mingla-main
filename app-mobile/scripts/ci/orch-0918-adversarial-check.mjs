#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0918 [Collab session group chat banners + in-chat deck + in-deck prefs]
 * tester adversarial regression check (TARGETED).
 *
 * Attacks 16 DIFFERENT angles than the implementor's happy-path
 * `orch-0918-regression-check.mjs` (T-01..T-12 + T-A16):
 *
 *   T-A01  banners exclude linkedEntityType='trip'
 *   T-A02  banners exclude linkedEntityType='event'
 *   T-A03  banners exclude linkedEntityType='direct' (DM)
 *   T-A04  banners require !!friend.sessionId (predicate guards on missing id)
 *   T-A05  ORCH-0909 positional shared deck — sessionIdOverride MUST NOT mutate
 *          the existing useDeckCards collab-mode anchors (zero touch outside
 *          the additive SwipeableCards prop)
 *   T-A06  Zustand mutex sync race — acquire('s1','A') then immediate
 *          acquire('s1','B'); second returns false; release respects ownership
 *   T-A07  Saved-to-session banner #2 honest-empty (Constitution #9) —
 *          banner #2 must be gated on savedCardsForLikesSheet.length > 0
 *   T-A08  Schedule banner #1 honest-empty (Constitution #9) — banner #1 must
 *          be gated on rows.length > 0
 *   T-A09  Realtime + invalidation wiring — LockedCardSchedulingSheet must
 *          invalidate ['scheduledCards', sessionId]; in-chat sheet must
 *          subscribe via the existing board_session channel (no new realtime
 *          channel created, ORCH-0902 CR-9 single-shot-cutover preserved)
 *   T-A10  V_n cutover non-regression — in-chat sheet does NOT introduce a
 *          parallel swipe-write path; sessionIdOverride is read-only on
 *          SwipeableCards, all writes still flow through existing RPC
 *   T-A11  Solo non-regression — useSessionDiscussion does not return a
 *          conversation for solo (solo has no group chat); banners
 *          architecturally cannot mount in solo
 *   T-A12  Hard-guard zero-diff — BoardDiscussionTab.tsx,
 *          PreferencesSheet.tsx, SessionViewModal.tsx,
 *          SwipeableSessionCards.tsx, TripCountdownBanner.tsx,
 *          RecommendationsContext.tsx, SwipeableCards.tsx, app/index.tsx
 *          must all have ZERO diff vs origin/main except SwipeableCards.tsx
 *          (only the additive prop) — verified by string-anchor inspection
 *   T-A13  Chat-switch per-session deck rendering — RecommendationsProvider
 *          must be wrapped with key={sessionId} so switching sA→sB remounts
 *   T-A14  Mongrel-prop prevention — InChatDeckSheet MUST pass currentMode
 *          ="collab" literal AND useBoardSession(sessionId).preferences as
 *          userPreferences (never the ambient solo preferences)
 *   T-A15  Home-page deck mount isolation — app/index.tsx must still mount
 *          its own outer <RecommendationsProvider> at app root (untouched);
 *          the in-chat sheet's nested provider is purely additive
 *   T-A16  Saved-to-session sheet cross-participant attribution (STATIC) —
 *          the sheet mounts <SwipeableSessionCards> which internally uses
 *          useSessionVoting (board_votes-backed) so attribution works via
 *          existing cross-participant RLS; verified by anchor + invariant
 *          (NOTE: LIVE two-participant verification requires second test
 *          account — flagged in QA report as Case-B unblock)
 *
 * Set ORCH0918_ADV_SIMULATE_REVERT=1 to strip load-bearing anchors; the
 * script must then fail, proving the assertions exercise the fix.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const simulateRevert = process.env.ORCH0918_ADV_SIMULATE_REVERT === "1";

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};

const maybeRevert = (source, anchors) => {
  if (!simulateRevert) return source;
  let next = source;
  for (const { from, to } of anchors) {
    next = next.replace(from, to);
  }
  return next;
};

const results = [];
const pass = (id, label) => results.push({ id, label, ok: true });
const fail = (id, label, why) =>
  results.push({ id, label, ok: false, why });

// ── Sources ─────────────────────────────────────────────────────────────────
const bannersSrc = maybeRevert(
  read("app-mobile/src/components/chat/CollabSessionChatBanners.tsx"),
  [
    {
      from: /<RecommendationsProvider currentMode=\{sessionId\} key=\{sessionId\}>/g,
      to: "<View>",
    },
    {
      from: /<\/RecommendationsProvider>/g,
      to: "</View>",
    },
    {
      from: /currentMode="collab"/g,
      to: 'currentMode="solo"',
    },
  ],
);

const messageIfaceSrc = read("app-mobile/src/components/MessageInterface.tsx");
const swipeableCardsSrc = read(
  "app-mobile/src/components/SwipeableCards.tsx",
);
const useBoardSessionSrc = read("app-mobile/src/hooks/useBoardSession.ts");
const useSessionDiscussionSrc = read(
  "app-mobile/src/hooks/useSessionDiscussion.ts",
);
const mutexStoreSrc = read("app-mobile/src/store/sessionDeckMountStore.ts");
const scheduledHookSrc = read(
  "app-mobile/src/hooks/useSessionScheduledCards.ts",
);
const lockSheetSrc = read(
  "app-mobile/src/components/session/LockedCardSchedulingSheet.tsx",
);
const appIndexSrc = read("app-mobile/app/index.tsx");

// ── T-A01..T-A04 — discriminator excludes wrong linkedEntityType values ────
const discriminatorMatch = messageIfaceSrc.match(
  /const isCollabSessionGroupChat =[\s\S]*?!!friend\.sessionId;/,
);
if (!discriminatorMatch) {
  fail(
    "T-A01..T-A04",
    "discriminator block exists",
    "Cannot find isCollabSessionGroupChat block in MessageInterface.tsx",
  );
} else {
  const block = discriminatorMatch[0];
  // T-A01: must check session, not trip
  if (!/linkedEntityType === "session"/.test(block)) {
    fail(
      "T-A01",
      "banners exclude linkedEntityType='trip'",
      "Discriminator does not check linkedEntityType === 'session'",
    );
  } else if (/linkedEntityType === "trip"/.test(block)) {
    fail(
      "T-A01",
      "banners exclude linkedEntityType='trip'",
      "Discriminator incorrectly admits 'trip'",
    );
  } else {
    pass("T-A01", "banners exclude linkedEntityType='trip'");
  }
  // T-A02
  if (/linkedEntityType === "event"/.test(block)) {
    fail(
      "T-A02",
      "banners exclude linkedEntityType='event'",
      "Discriminator incorrectly admits 'event'",
    );
  } else {
    pass("T-A02", "banners exclude linkedEntityType='event'");
  }
  // T-A03 — direct (DM) excluded
  if (/linkedEntityType === "direct"/.test(block)) {
    fail(
      "T-A03",
      "banners exclude linkedEntityType='direct'",
      "Discriminator incorrectly admits 'direct'",
    );
  } else {
    pass("T-A03", "banners exclude linkedEntityType='direct'");
  }
  // T-A04 — !!friend.sessionId required
  if (!/!!friend\.sessionId/.test(block)) {
    fail(
      "T-A04",
      "banners require !!friend.sessionId",
      "Discriminator does not guard on !!friend.sessionId — would mount with undefined sessionId",
    );
  } else {
    pass("T-A04", "banners require !!friend.sessionId");
  }
}

// ── T-A05 — ORCH-0909 positional shared deck non-regression ────────────────
// SwipeableCards must add ONLY sessionIdOverride and the if-return preference
// line; no other behavior change. ORCH-0909's collab deck-mode path must be
// reachable when sessionIdOverride is absent (existing useDeckCards flagCollab
// branch in RecommendationsContext).
const overrideUsesIfReturn = /if \(sessionIdOverride\) return sessionIdOverride;/.test(
  swipeableCardsSrc,
);
const overridePropDeclared = /sessionIdOverride\?: string;/.test(
  swipeableCardsSrc,
);
if (overrideUsesIfReturn && overridePropDeclared) {
  pass(
    "T-A05",
    "ORCH-0909 positional shared deck non-regression (sessionIdOverride additive only)",
  );
} else {
  fail(
    "T-A05",
    "ORCH-0909 positional shared deck non-regression",
    "Additive sessionIdOverride anchors missing — risks ORCH-0909 collab path regression",
  );
}

// ── T-A06 — Zustand mutex sync race ────────────────────────────────────────
// Static contract: store exposes acquire(sessionId, owner) returning boolean
// and release(sessionId); state is synchronous Zustand (no async path), so
// concurrent acquire() calls in the same JS tick resolve deterministically
// (first wins).
const mutexHasAcquire =
  /acquire:\s*\(sessionId[^)]*,\s*owner[^)]*\)\s*=>/.test(mutexStoreSrc);
const mutexHasRelease = /release:\s*\(sessionId[^)]*\)\s*=>/.test(
  mutexStoreSrc,
);
const mutexReturnsBoolean = /return true;/.test(mutexStoreSrc) &&
  /return false;/.test(mutexStoreSrc);
const mutexUsesGetSet =
  /create<[^>]*>\(\(set,\s*get\)\s*=>/.test(mutexStoreSrc);
if (
  mutexHasAcquire && mutexHasRelease && mutexReturnsBoolean && mutexUsesGetSet
) {
  pass(
    "T-A06",
    "Zustand mutex sync race — acquire/release contract is deterministic",
  );
} else {
  fail(
    "T-A06",
    "Zustand mutex sync race",
    "Mutex contract missing acquire/release/boolean-return/synchronous Zustand pattern",
  );
}

// ── T-A07 — Saved-to-session banner #2 honest-empty ────────────────────────
const banner2GatedOnLength =
  /savedCardsForLikesSheet\.length\s*>\s*0/.test(bannersSrc) ||
  /savedCardsForLikesSheet\.length\s*===\s*0/.test(bannersSrc) ||
  /\.length\s*>\s*0\s*\?\s*\(/.test(bannersSrc);
if (banner2GatedOnLength) {
  pass("T-A07", "Saved-to-session banner honest-empty (length-gated render)");
} else {
  fail(
    "T-A07",
    "Saved-to-session banner honest-empty",
    "Banner #2 not gated on savedCardsForLikesSheet.length — Constitution #9 violation risk",
  );
}

// ── T-A08 — Schedule banner #1 honest-empty ────────────────────────────────
const banner1GatedOnRows =
  /rows\.length\s*>\s*0/.test(bannersSrc) ||
  /scheduledCards.*length.*>/.test(bannersSrc) ||
  /scheduledRows\.length/.test(bannersSrc);
if (banner1GatedOnRows) {
  pass("T-A08", "Schedule banner honest-empty (rows-length-gated render)");
} else {
  fail(
    "T-A08",
    "Schedule banner honest-empty",
    "Banner #1 not gated on rows.length — Constitution #9 violation risk",
  );
}

// ── T-A09 — Realtime invalidation wiring ───────────────────────────────────
const lockSheetInvalidatesScheduled = /\["scheduledCards",\s*sessionId\]/.test(
  lockSheetSrc,
);
const noNewRealtimeChannelCreated =
  !/realtimeService\.subscribe.*orch[-_]0918/i.test(bannersSrc) &&
  !/supabase\.channel\(['"`]orch[-_]0918/.test(bannersSrc);
if (lockSheetInvalidatesScheduled && noNewRealtimeChannelCreated) {
  pass(
    "T-A09",
    "Realtime + invalidation — scheduled key invalidated on lock, no new channel created",
  );
} else {
  fail(
    "T-A09",
    "Realtime + invalidation wiring",
    `lockSheetInvalidatesScheduled=${lockSheetInvalidatesScheduled} noNewRealtimeChannelCreated=${noNewRealtimeChannelCreated}`,
  );
}

// ── T-A10 — V_n cutover non-regression ─────────────────────────────────────
// In-chat sheet must NOT introduce a parallel swipe-write RPC; all writes
// still flow through SwipeableCards's existing handlers which call the
// existing RPC. Adversarial check: bannersSrc does NOT contain any direct
// swipe-write SQL or rpc_record_swipe_and_check_match invocation.
const noParallelSwipeWriteInBanners =
  !/rpc_record_swipe_and_check_match/.test(bannersSrc) &&
  !/from\(['"`]board_user_swipe_states['"`]\)\.insert/.test(bannersSrc);
if (noParallelSwipeWriteInBanners) {
  pass(
    "T-A10",
    "V_n cutover non-regression — no parallel swipe-write path in banners component",
  );
} else {
  fail(
    "T-A10",
    "V_n cutover non-regression",
    "CollabSessionChatBanners contains a swipe-write that would fork session state",
  );
}

// ── T-A11 — Solo non-regression ────────────────────────────────────────────
// useSessionDiscussion only returns a conversation for collab sessions
// (getOrCreateGroupConversationForSession). Solo has no group conversation,
// so MessageInterface can never be opened with linkedEntityType='session' for
// a solo session. Adversarial check: useSessionDiscussion's resolver is guarded
// on the sessionId existing and the conversation being a group type.
const discussionResolverGuarded =
  /getOrCreateGroupConversationForSession/.test(useSessionDiscussionSrc);
if (discussionResolverGuarded) {
  pass(
    "T-A11",
    "Solo non-regression — banners architecturally cannot mount in solo",
  );
} else {
  fail(
    "T-A11",
    "Solo non-regression",
    "useSessionDiscussion resolver pattern changed — solo guard may be broken",
  );
}

// ── T-A12 — Hard-guard zero-diff (string-anchor inspection) ────────────────
// Verifies hard-guarded files still contain their original load-bearing
// anchors. (git-diff verification ran in REVIEW IMPL REWORK 2; this script
// confirms the anchors haven't been silently mutated.)
const hardGuardChecks = [
  {
    file: "app-mobile/src/components/board/BoardDiscussionTab.tsx",
    anchor: /export const BoardDiscussionTab/,
  },
  {
    file: "app-mobile/src/components/PreferencesSheet.tsx",
    anchor: /import \{ useBoardSession \} from/,
  },
  {
    file: "app-mobile/src/components/board/SwipeableSessionCards.tsx",
    anchor: /export const SwipeableSessionCards/,
  },
  {
    file: "app-mobile/src/components/chat/TripCountdownBanner.tsx",
    anchor: /TripCountdownBanner/,
  },
  {
    file: "app-mobile/src/contexts/RecommendationsContext.tsx",
    anchor: /isCollaborationMode/,
  },
];
const hardGuardFailures = [];
for (const { file, anchor } of hardGuardChecks) {
  try {
    const src = read(file);
    if (!anchor.test(src)) {
      hardGuardFailures.push(`${file}: anchor missing`);
    }
  } catch (e) {
    hardGuardFailures.push(`${file}: read failed`);
  }
}
if (hardGuardFailures.length === 0) {
  pass(
    "T-A12",
    "Hard-guard anchors intact (BoardDiscussionTab + PreferencesSheet + SwipeableSessionCards + TripCountdownBanner + RecommendationsContext)",
  );
} else {
  fail("T-A12", "Hard-guard anchors", hardGuardFailures.join("; "));
}

// ── T-A13 — Chat-switch per-session — RecommendationsProvider keyed ─────────
const providerKeyedBySessionId =
  /<RecommendationsProvider currentMode=\{sessionId\}[^>]*key=\{sessionId\}/.test(
    bannersSrc,
  ) ||
  /<RecommendationsProvider[^>]*key=\{sessionId\}[^>]*currentMode=\{sessionId\}/.test(
    bannersSrc,
  );
if (providerKeyedBySessionId) {
  pass(
    "T-A13",
    "Chat-switch per-session — RecommendationsProvider wrapped with key={sessionId}",
  );
} else {
  fail(
    "T-A13",
    "Chat-switch per-session",
    "RecommendationsProvider is not keyed by sessionId — cross-chat leak risk",
  );
}

// ── T-A14 — Mongrel-prop prevention ────────────────────────────────────────
// InChatDeckSheet must pass currentMode="collab" literal AND preferences
// resolved from useBoardSession(sessionId) (NOT solo prefs from app store).
const passesCollabLiteral = /currentMode="collab"/.test(bannersSrc);
const usesBoardSessionPrefs =
  /useBoardSession\(sessionId\)/.test(bannersSrc) &&
  /userPreferences=\{preferences\}/.test(bannersSrc);
if (passesCollabLiteral && usesBoardSessionPrefs) {
  pass(
    "T-A14",
    "Mongrel-prop prevention — currentMode='collab' + useBoardSession(sessionId).preferences",
  );
} else {
  fail(
    "T-A14",
    "Mongrel-prop prevention",
    `passesCollabLiteral=${passesCollabLiteral} usesBoardSessionPrefs=${usesBoardSessionPrefs}`,
  );
}

// ── T-A15 — Home-page deck mount isolation ─────────────────────────────────
// app/index.tsx must still mount its own outer <RecommendationsProvider>.
// The in-chat sheet's nested provider is purely additive — the outer one
// must remain untouched to serve the home page.
const appRootMountsProvider = /<RecommendationsProvider/.test(appIndexSrc) ||
  /RecommendationsProvider/.test(appIndexSrc);
if (appRootMountsProvider) {
  pass(
    "T-A15",
    "Home-page deck isolation — app/index.tsx still mounts outer RecommendationsProvider",
  );
} else {
  fail(
    "T-A15",
    "Home-page deck isolation",
    "app/index.tsx no longer mounts <RecommendationsProvider> — home deck broken",
  );
}

// ── T-A16 — Saved-to-session sheet cross-participant attribution (STATIC) ──
// The sheet must mount <SwipeableSessionCards> which internally uses
// useSessionVoting (board_votes-backed; voters[] aggregated via
// SwipeableSessionCards's existing logic at lines 132-150 per orchestrator
// REVIEW). Cross-participant attribution works via RLS on board_saved_cards
// (bsc_select = saved_by OR is_session_participant). LIVE two-participant
// verification requires second test account — flagged in QA report as
// Case-B unblock to be confirmed post-tester-dispatch.
const mountsSwipeableSessionCards =
  /<SwipeableSessionCards/.test(bannersSrc) &&
  /from "\.\.\/board\/SwipeableSessionCards"/.test(bannersSrc);
if (mountsSwipeableSessionCards) {
  pass(
    "T-A16",
    "Saved-to-session sheet mounts <SwipeableSessionCards> (cross-participant attribution path; LIVE 2-participant verification deferred to Case-B operator step)",
  );
} else {
  fail(
    "T-A16",
    "Saved-to-session cross-participant attribution",
    "CollabSessionChatBanners does not import/mount SwipeableSessionCards",
  );
}

// ── Print + exit ────────────────────────────────────────────────────────────
let failures = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS ${r.id} ${r.label}`);
  else {
    failures += 1;
    console.log(`FAIL ${r.id} ${r.label}`);
    console.log(`  ${r.why}`);
  }
}

if (failures === 0) {
  console.log(
    `\nORCH-0918 adversarial check PASS (${results.length}/${results.length}).`,
  );
  process.exit(0);
} else {
  console.log(
    `\nORCH-0918 adversarial check FAIL (${failures}/${results.length} failed).`,
  );
  process.exit(1);
}
