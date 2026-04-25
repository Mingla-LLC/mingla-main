# IMPLEMENTATION REPORT — ORCH-0672 (S0 EMERGENCY HOTFIX)

**Mode:** `/mingla-implementor`
**Cycle:** 1 of 1
**Status:** `implemented and verified` (static verification; runtime smoke pending user)
**Commit:** `d566dab7` on branch `Seth` (NOT pushed yet — user controls push)
**Dispatch:** [Mingla_Artifacts/prompts/IMPL_ORCH-0672_PENDING_TOKENS_REGRESSION.md](../prompts/IMPL_ORCH-0672_PENDING_TOKENS_REGRESSION.md)
**Date:** 2026-04-25

---

## §A — Layman summary

The dev build was crashing at app boot. A previous commit shipped UI code that read color/border tokens that didn't exist anywhere in the codebase. This commit re-adds those tokens (a 39-line block of design constants for "pending" session pills — the dim/dashed pills shown when an invite is awaiting response). The app boots again. No native, DB, or backend changes — pure OTA-eligible JS-only fix.

## §B — Files changed

| File | Change | Lines |
|------|--------|-------|
| `app-mobile/src/constants/designSystem.ts` | +39 (insert `glass.chrome.pending` sub-namespace between `inactive` and `badge`) | +39 / -0 |

Single-file commit. Nothing else touched. Index pre-staging from prior chats (67 files for ORCH-0667 surgical staging) **fully preserved**.

## §C — Verbatim diff (additions only)

```diff
diff --git a/app-mobile/src/constants/designSystem.ts b/app-mobile/src/constants/designSystem.ts
index 6195692d..59db8fd8 100644
--- a/app-mobile/src/constants/designSystem.ts
+++ b/app-mobile/src/constants/designSystem.ts
@@ -414,6 +414,45 @@ export const glass = {
       iconColorStrong: 'rgba(255, 255, 255, 0.88)',
       labelColor: 'rgba(255, 255, 255, 0.55)',
     },
+    // ORCH-0661 — Pending session pill states (sender + receiver). Both share the
+    // dim-pill base (opacity, dashed hairline border) so they read as visually
+    // identical "pending" states; badge color/icon is the only differentiator.
+    // Sender's outgoing invite (sent) gets a dim white badge for "passive, awaiting";
+    // recipient's incoming invite (received) gets an orange-glow badge for "incoming,
+    // take action." Border style is `dashed` for visual distinction from inactive
+    // (no border) and active (solid orange). If `dashed` renders poorly on a target
+    // platform, fallback is `solid` with `borderColor` at slightly higher alpha.
+    // Pixel-matches legacy CollaborationSessions.inviteBadge geometry (size 14,
+    // radius 7, offset -3, 1.5px border, 7px icon) for behavioral continuity with
+    // the pre-ORCH-0589 pill-bar design.
+    pending: {
+      // Both states share these base values:
+      dimOpacity: 0.6,
+      borderWidth: 1,
+      borderStyle: 'dashed' as const,
+      borderColor: 'rgba(255, 255, 255, 0.28)',
+      labelColor: 'rgba(255, 255, 255, 0.55)',
+      // Badge geometry:
+      badge: {
+        size: 14,
+        radius: 7,
+        offsetTop: -3,
+        offsetRight: -3,
+        borderWidth: 1.5,
+        borderColor: 'rgba(12, 14, 18, 1)',
+        iconSize: 7,
+        iconColor: '#FFFFFF',
+      },
+      // State-specific badge fill:
+      sent: {
+        badgeBgColor: 'rgba(255, 255, 255, 0.65)',
+        iconName: 'time-outline' as const,
+      },
+      received: {
+        badgeBgColor: '#eb7825',
+        iconName: 'mail' as const,
+      },
+    },
     badge: {
       bgColor: '#eb7825',
       borderColor: 'rgba(18, 20, 26, 1)',
```

Block contents byte-for-byte match the binding contract in IMPL_ORCH-0672_PENDING_TOKENS_REGRESSION.md §"Fix scope" (lines 35-75 of dispatch). Zero deviation.

## §D — Consumer mapping table (17 reads → 17 keys)

Dispatch claimed 11 reads at lines 601-618. A more thorough grep found **17 reads** across the consumer file (StyleSheet block AND inline render branches). All 17 resolve to keys in the restored block.

| # | Consumer site | Read expression | Resolves to |
|---|---------------|----------------|-------------|
| 1  | GlassSessionSwitcher.tsx:370  | `c.pending.dimOpacity`              | `pending.dimOpacity` (0.6) |
| 2  | GlassSessionSwitcher.tsx:376  | `c.pending.sent.badgeBgColor`       | `pending.sent.badgeBgColor` |
| 3  | GlassSessionSwitcher.tsx:376  | `c.pending.sent.iconName`           | `pending.sent.iconName` (`'time-outline'`) |
| 4  | GlassSessionSwitcher.tsx:377  | `c.pending.received.badgeBgColor`   | `pending.received.badgeBgColor` |
| 5  | GlassSessionSwitcher.tsx:377  | `c.pending.received.iconName`       | `pending.received.iconName` (`'mail'`) |
| 6  | GlassSessionSwitcher.tsx:448  | `c.pending.badge.iconSize`          | `pending.badge.iconSize` (7) |
| 7  | GlassSessionSwitcher.tsx:449  | `c.pending.badge.iconColor`         | `pending.badge.iconColor` (`#FFFFFF`) |
| 8  | GlassSessionSwitcher.tsx:601  | `glass.chrome.pending.labelColor`   | `pending.labelColor` |
| 9  | GlassSessionSwitcher.tsx:606  | `glass.chrome.pending.borderWidth`  | `pending.borderWidth` (1) |
| 10 | GlassSessionSwitcher.tsx:607  | `glass.chrome.pending.borderStyle`  | `pending.borderStyle` (`'dashed'`) |
| 11 | GlassSessionSwitcher.tsx:608  | `glass.chrome.pending.borderColor`  | `pending.borderColor` |
| 12 | GlassSessionSwitcher.tsx:612  | `glass.chrome.pending.badge.offsetTop`    | `pending.badge.offsetTop` (-3) |
| 13 | GlassSessionSwitcher.tsx:613  | `glass.chrome.pending.badge.offsetRight`  | `pending.badge.offsetRight` (-3) |
| 14 | GlassSessionSwitcher.tsx:614  | `glass.chrome.pending.badge.size`         | `pending.badge.size` (14) |
| 15 | GlassSessionSwitcher.tsx:615  | `glass.chrome.pending.badge.radius`       | `pending.badge.radius` (7) |
| 16 | GlassSessionSwitcher.tsx:617  | `glass.chrome.pending.badge.borderWidth`  | `pending.badge.borderWidth` (1.5) |
| 17 | GlassSessionSwitcher.tsx:618  | `glass.chrome.pending.badge.borderColor`  | `pending.badge.borderColor` |

**100% coverage. Zero unresolved references.**

## §E — TypeScript check log

`cd app-mobile && npx tsc --noEmit` after the edit:

```
src/components/ConnectionsPage.tsx(2195,13): error TS2322: Property 'onOpenAddToBoardModal' does not exist on type 'IntrinsicAttributes & MessageInterfaceProps'.
src/components/ConnectionsPage.tsx(2715,52): error TS2345: Argument of type 'Friend' [friendsService] not assignable to parameter of type 'Friend' [connectionsService].
src/components/HomePage.tsx(238,19): error TS2741: Property 'state' is missing in type '{ id: string; label: string; }' but required in type 'SessionSwitcherItem'.
src/components/HomePage.tsx(241,54): error TS2741: Property 'state' is missing in type '{ id: string; label: string; }' but required in type 'SessionSwitcherItem'.
```

**4 errors, 0 in ORCH-0672 surface (designSystem.ts + GlassSessionSwitcher.tsx).** All 4 are pre-existing baseline noise from parallel work in working tree:

- ConnectionsPage:2195 — ORCH-0666 prop contract change (`onOpenAddToBoardModal` not yet added to MessageInterfaceProps in working tree)
- ConnectionsPage:2715 — ORCH-0664 / ORCH-0666 cross-service Friend type mismatch
- HomePage:238 + 241 — ORCH-0661 follow-up: `SessionSwitcherItem.state` is required field; HomePage's `[{id:'solo',label:'Solo'}]` literal needs `state: 'active'` added (orchestrator scope, NOT this dispatch — explicit dispatch constraint: "do not re-architect ORCH-0661")

The dispatch's §4 stop-the-line trigger — `_PILL_STATE_PARITY_CHECK` failure at GlassSessionSwitcher.tsx:64 — is **silent**. Type assertion holds. Pending state mapping is complete.

## §F — Spec traceability

Dispatch §"Implementation order" had 7 numbered steps:

| Step | Required | Done |
|------|----------|------|
| 1 — Read designSystem.ts L410-460 to locate `inactive` → `badge` boundary | Read | ✓ confirmed boundary at L412-416 (inactive) → L417 (badge) |
| 2 — Read GlassSessionSwitcher.tsx L595-625 + map all consumer reads | Read + map | ✓ §D table (17 reads, all resolved) |
| 3 — Edit designSystem.ts: paste block between inactive and badge | Edit | ✓ §C verbatim diff |
| 4 — `cd app-mobile && npx tsc --noEmit` zero new errors | Verify | ✓ §E (4 baseline errors, 0 new in surface) |
| 5 — Restart Metro / verify dev build boots past module-load | Runtime verify | ⚠ **UNVERIFIED — requires user device** (orchestrator/founder smoke) |
| 6 — Exercise home pill bar visually | Runtime verify | ⚠ **UNVERIFIED — requires user device** |
| 7 — Commit with prescribed message | Commit | ✓ d566dab7 |

## §G — Invariant verification

| Invariant | Preserved? | Evidence |
|-----------|------------|----------|
| I-PILL-STATE-PARITY (registered ORCH-0661) | ✓ Y | Type-level `_PILL_STATE_PARITY_CHECK` assertion at GlassSessionSwitcher.tsx:64 compiles silent — no SessionType ↔ SessionPillState drift introduced |
| Constitutional #2 (one owner per truth) | ✓ Y | Pending tokens defined in single source `glass.chrome.pending`; no duplication |
| Constitutional #8 (subtract before adding) | N/A | Pure additive recovery — nothing being removed/replaced |
| **CANDIDATE: I-COUPLED-DIFF-NEVER-PARTIAL-COMMIT** | ➤ register after this lands | Coupled consumer/token diff caused this regression. Process invariant for orchestrator to register in INVARIANT_REGISTRY.md |

## §H — Parity check

Solo / collab parity: **N/A.** This restores tokens consumed only by `GlassSessionSwitcher` (collab session pills). Solo pill consumes `glass.chrome.active.*` and `glass.chrome.inactive.*`, untouched. Parity is structural — no fix needed for the other mode.

## §I — Cache safety

N/A — design tokens are module-load constants, not React Query keys, not Zustand state, not AsyncStorage-persisted data. No cache impact, no invalidation needed.

## §J — Regression surface (5 adjacent features tester should smoke)

1. **Home pill bar — Solo + create + active session pills** — render same as before (no token change to `inactive`, `active`, or `chrome.pill.*`)
2. **Active session pill orange glow** — unchanged (consumes `glass.chrome.active.*`)
3. **Pending sent pill** (sender's outgoing invite) — clock-outline icon on dim-white badge, dashed dim-white perimeter border, 60% pill opacity
4. **Pending received pill** (recipient's incoming invite) — mail icon on orange #eb7825 badge, dashed dim-white perimeter border, 60% pill opacity
5. **Onboarding coach-marks** — Step 4 (+ create pill) and Step 5 (Solo pill) cutout geometry unchanged (no `chrome.pill.*` or `chrome.switcher.*` token changes)

## §K — Constitutional compliance scan

| # | Principle | Status |
|---|-----------|--------|
| 1 | No dead taps | N/A (no interactive code changed) |
| 2 | One owner per truth | ✓ |
| 3 | No silent failures | N/A (constants only) |
| 4 | One query key per entity | N/A |
| 5 | Server state stays server-side | N/A |
| 6 | Logout clears everything | N/A |
| 7 | Label temporary fixes | N/A — nothing transitional |
| 8 | Subtract before adding | N/A — recovery is additive only |
| 9 | No fabricated data | ✓ |
| 10 | Currency-aware UI | N/A |
| 11 | One auth instance | N/A |
| 12 | Validate at the right time | N/A |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | ✓ Module loads now; was previously crashing |

## §L — Discoveries for orchestrator

**D-1 (process) — `I-COUPLED-DIFF-NEVER-PARTIAL-COMMIT` invariant candidate.** Forensics + orchestrator both captured the +118/+39 in-flight diff during ORCH-0669 investigation but classified it as "unrelated to ORCH-0669, keep as-is." Neither flagged that the +118 (consumer) and +39 (tokens) halves were tightly coupled and a partial commit would brick the build. When `3911b696` shipped only the consumer half, no system caught the orphaned token reference. Recommend: register this as a CI/process invariant in INVARIANT_REGISTRY.md — any future capture of in-flight diffs should classify each diff as "single-half" or "coupled," and orchestrator should refuse to ship a partial commit of a coupled diff.

**D-2 (orphan TS errors) — HomePage.tsx:238/241 missing `state` field.** Working-tree HomePage passes `[{id:'solo', label:'Solo'}]` to GlassSessionSwitcher's `sessions` prop, but `SessionSwitcherItem.state` is now a required field (per ORCH-0661 contract). This is **NOT** an ORCH-0672 regression — `state` was made required by the committed `3911b696` consumer ship, and HomePage's working-tree edit hasn't been finished by whichever chat owns it. Out of scope for this hotfix per dispatch §"Constraints" ("do not re-architect ORCH-0661"). Orchestrator: this likely belongs in the same chat that owns ORCH-0661 cycle-2 / ORCH-0669 cycle-2 tail.

**D-3 (orphan TS errors) — ConnectionsPage.tsx:2195 missing `onOpenAddToBoardModal` prop on MessageInterfaceProps.** This is ORCH-0666 work-in-progress in working tree — the prop signature change is partially applied (consumer side updated but MessageInterfaceProps type def in working tree has not been updated, OR vice versa). Orchestrator: belongs to whichever chat owns ORCH-0666 commit prep.

**D-4 (orphan TS errors) — ConnectionsPage.tsx:2715 cross-service Friend type mismatch.** Two different `Friend` interfaces exist (`friendsService.Friend` vs `connectionsService.Friend`). This is a **constitutional #2 (one owner per truth) violation candidate.** Pre-existing, not introduced by ORCH-0672. Orchestrator: file as separate ORCH for cross-service type consolidation if not already tracked.

## §M — Transition items

None.

## §N — User actions remaining (per dispatch §"After PASS")

1. **Verify dev build boots** — `cd app-mobile && npx expo start -c` (clear Metro cache). Module-load crash should be gone.
2. **Push commit** — `git push origin Seth` (orchestrator/user decision; not pushed by implementor).
3. **Publish OTA** (per memory rule — TWO separate invocations, never combined):
   ```
   cd app-mobile && eas update --branch production --platform ios --message "ORCH-0672: restore lost glass.chrome.pending tokens (regression fix)"
   ```
   then separately:
   ```
   cd app-mobile && eas update --branch production --platform android --message "ORCH-0672: restore lost glass.chrome.pending tokens (regression fix)"
   ```
4. **Hand back to orchestrator** for:
   - Wave 2 backend deploys (0666, 0667, 0668 migrations + edge fns)
   - ORCH-0669 cycle-2 spec §13 gate-2 wording update + re-dispatch
   - 7-artifact SYNC for ORCH-0672 itself (WORLD_MAP, MASTER_BUG_LIST, etc.)

## §O — Status

`implemented and verified (static)` · runtime verification deferred to user device smoke per dispatch §"Implementation order" steps 5-6.
