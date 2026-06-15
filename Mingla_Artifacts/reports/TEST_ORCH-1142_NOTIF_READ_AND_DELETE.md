# TEST — ORCH-1142 — Business notifications: full-read (tap-to-expand) + delete (soft-delete)

- **ORCH-ID:** ORCH-1142 [notif-read-delete]
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1142-[notif-read-delete]` on `ORCH-1142-notif-read-delete` (HEAD `e7fd81560`)
- **Tester:** mingla-tester+claude · **Date:** 2026-06-15 · **Mode:** TARGETED + SPEC-COMPLIANCE
- **Built against:** SPEC + DESIGN + IMPLEMENTATION reports (all in worktree)
- **Comms ledger:** read on entry. No BLOCK/OPEN row targets ORCH-1142, `mingla-tester`, or `ALL`-that-blocks. Active WARNs (COMMS-0027 OTA cache-poison, -0028 GIPHY key, -0029 trip-migration clobber, -0030/-0031 Google-pods iOS build, -0032 HEIC, -0033 ID collision) are unrelated trip/OTA/build coordination — factored, no action. No new COMMS entry (the live-fire blocker found is an environment-state issue, not a cross-ORCH code discovery — captured as a Discovery + a Seth unblock-ask instead).

---

## 1. VERDICT

**CONDITIONAL PASS — pending Seth's acceptance of the deferred live-fire.**
**P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 2**

The delete-path scope contract (the data-loss / cross-app-leak surface — the actual risk in this ORCH) is **PROVEN** at unit + behavioral + source level with two independent fails-on-revert proofs. tsc is clean on all 4 changed files, the I-PROPOSED-W gate is green (exit 0), the migration version + RLS basis are verified read-only against live prod, and the Android opaque-glass policy + a11y are held in source.

The **UI/runtime EXPAND path, native swipe, web trash button, and realtime multi-device drop could NOT be live-fired** because the business app bundle will not load in this environment — a **pre-existing, unrelated** missing-native-module break (`expo-image-manipulator`, added to main by ORCH-1119 but absent from the shared anchor `node_modules` and from the installed dev build) red-screens the entire business app on both the iOS sim and any web/native bundle. ORCH-1142 did NOT introduce this and does not use that module. Per the tester confidence ladder, UI/runtime findings cap at `probable` when live-fire is blocked → the verdict cannot be a full PASS.

**This is BLOCKED-upgraded-to-CONDITIONAL only if Seth accepts deferring the on-device UI live-fire to post-merge OTA verification.** Without that acceptance, treat as BLOCKED on the live-fire (not a code defect). No code rework is required.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence (confidence) |
|----|-----------|---------|------------------------|
| SC-1 | Tap expands in place → full title+body, marks read first tap, tap again collapses | **suspected** (source proven; not live-fired) | `BusinessNotificationsScreen.tsx:344` `titleLines = expanded ? undefined : 1`, `:415` `numberOfLines={expanded ? undefined : 2}`, `:718-729` handlePress = `markAsRead` + toggle expand Set. Implementor test case 5 green. NOT live-fired — bundle blocked. |
| SC-2 | Deep-link demoted to "Open"; plain tap no longer navigates; no Open when deep_link null | **suspected** (source proven) | `:420-446` Open button gated on `expanded && hasDeepLink`; `:302` `hasDeepLink = deep_link !== null`; navigate only via `handleOpen`→`onOpenDeepLink` (`:731-739`). Row Pressable `handlePress` does NOT navigate. |
| SC-3-iOS / SC-3-Android (swipe delete) | Left-swipe reveals trash; commit removes optimistically + sets `deleted_at`; no reappear | **suspected** (source proven; gesture not live-fired) | `ReanimatedSwipeable` `:545-557`, `SwipeRightAction` worklet `:589-611` commit at 40% width, `softDelete` `:322-357`. Optimistic remove + revert proven by adversarial A4. NOT live-fired. |
| SC-3-Web (visible Delete affordance) | A per-row "Delete" removes the row (no swipe) | **suspected** (source proven) | `WebTrashButton` `:267-288` always-visible trailing trash, `onPress`→`onDelete`→`softDelete`. `isWeb` branch `:526-535` renders row directly. NOT live-fired (web bundle blocked by same module break). |
| SC-4 (Clear read scope) | Soft-deletes read + `stripe.%`/`business.%` only; unread + consumer untouched | **PROVEN** | Adversarial **A1** (behavioral): clearRead builds `.eq("user_id")` + `.not("read_at","is",null)` + `.is("deleted_at",null)` + `.or(stripe.%/business.%)`; optimistic cache removes ONLY read rows (unread + consumer survive). Source `useBusinessNotifications.ts:375-381`. |
| SC-5 (revert on error) | Optimistically-removed rows reappear in prior order; silent `__DEV__` warn | **PROVEN** | Adversarial **A2** (behavioral): clearRead server-error → cache restored to exact prior `["rb","ub","rc"]`. softDelete revert path `:342-354`. |
| SC-6 (realtime multi-device drop) | A soft-delete UPDATE drops the row from another device's cache | **PROVEN at handler level** (multi-device not live-fired) | Adversarial **A3** (behavioral): drives the registered UPDATE handler — business soft-delete drops the row; consumer soft-delete is IGNORED. Source `:121-127`. Two-physical-device drop not live-fired. |
| SC-7 (reference value preserved) | Row persists with `deleted_at` set (no hard delete) | **PROVEN (backend, source-exempt)** | Migration adds nullable `deleted_at`, NO DELETE policy use, soft-delete only. Live prod read-only: UPDATE policy is column-agnostic (`auth.uid()=user_id`) → owner sets `deleted_at` like `read_at`; no hard-delete path in the code. |
| SC-8 (I-PROPOSED-W intact) | Strict-grep gate passes | **PROVEN** | `node .github/scripts/strict-grep/i-proposed-w-notifications-app-type-prefix.mjs` → exit 0, 0 violations, 1559 files. Fetch keeps `.or("type.like.stripe.%,type.like.business.%")` verbatim (`:157`). |
| SC-9 (empty state + Clear read hides) | "You're all caught up" renders; "Clear read" hides when no read rows | **suspected** (source proven) | `hasRead` derivation `:234-237`; route gates Clear-read on `hasRead` (`notifications.tsx:139`); EmptyState renders at `notifications.length === 0` (`:769-787`). NOT live-fired. |

**Migration applied?** NO — confirmed read-only: `public.notifications` currently has `read_at` but NOT `deleted_at`. The orchestrator applies `20261002000000` at merge (version is the next free monotonic slot above the live head `20261001000000`; verified via `list_migrations`).

---

## 3. Findings

### P3-1 — Live-fire of the EXPAND / swipe / web-trash UI was blocked by a pre-existing missing-native-module break (NOT this ORCH)
- **Evidence:** Launching `com.sethogieva.minglabusiness` on iOS sim `17091E60…` against a fresh worktree Metro (port 8083, isolated `TMPDIR=/tmp/orch-1142/eas-tmp` per COMMS-0027) red-screens: `Unable to resolve module expo-image-manipulator from …/mingla-business/src/utils/normalizeTripDayImage.ts`. `expo-image-manipulator` is in `origin/main` `package.json` but is **absent from the shared anchor `node_modules`** (`ls node_modules/expo-image-manipulator` → No such file) and the installed dev build predates the native module. `git diff origin/main...HEAD --name-only` confirms `normalizeTripDayImage.ts` is NOT in the ORCH-1142 diff; `git show origin/main:…/normalizeTripDayImage.ts` shows the import is on main (pre-existing). Physical Android (R58R54YV7JT) has only the consumer app, no business build.
- **Impact:** SC-1/2/3/3-Web/6(multi-device)/9 cannot rise above `suspected`. No user-facing defect in ORCH-1142 — the screen renders only after the bundle loads, which it can't in this environment regardless of ORCH-1142.
- **Required fix:** none in ORCH-1142. Environment fix (Seth/orchestrator): `npm install` in `mingla-business` to land `expo-image-manipulator`, then cut/install a fresh business iOS dev build that includes the native module (per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md`, NOT `npx expo run:ios`; mind COMMS-0030 Google-pods modular-headers), OR verify ORCH-1142's UI on the post-merge dev-channel OTA.
- **Retest:** with a loadable business build, drive the EXPAND tap (full text + Open + collapse), the native left-swipe commit, the web trash button, and a two-device realtime drop.

### P4-1 (praise) — Adversarial-grade scope hardening, honest revert grammar
`clearRead` is scoped four ways (`user_id` + read + not-already-deleted + business-type `.or`) and the optimistic cache filter mirrors it exactly; `softDelete` is single-PK only. Both silent-revert on error with the same grammar as `markAsRead`. The protective comments at the delete code + migration cite ORCH-1142 + the SUB-C §4.4 supersession so a future session won't "restore" the no-swipe rule. Clean.

### P4-2 (note) — Implementor's own fails-on-revert is real and comment-proof
The implementor's source-assertion test strips `//` line-comments before asserting, so the protective comment that also mentions `.is("deleted_at", null)` cannot produce a false pass. Independently reproduced (Step 0.5 below).

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

- **Commit run:** worktree HEAD `e7fd81560` (the squashed IMPLEMENT commit; the report's in-flight hashes `488ffca8b`/`2bcf4e847` were pre-squash).
- **Baseline:** `npx jest orch_1142_notif_softdelete_scope.test.ts` → **5 passed**. Inbox test `useBusinessNotificationsInbox.test.ts` → **4 passed**.
- **Revert:** true line-deletion of `.is("deleted_at", null)` (line 158, the fetch filter) from `fetchBusinessNotifications`.
- **Result on revert:** **case 1 RED** — `expect(fetch).toMatch(/\.is\(\s*["']deleted_at["']\s*,\s*null\s*\)/)` failed at `orch_1142_notif_softdelete_scope.test.ts:71`; suite `1 failed, 4 passed`. The line-comment mentioning the same clause did NOT mask the failure (comment-stripping works).
- **Restore:** copied the file back → **5 passed**. Tree confirmed clean (`git status` shows only the new tester test untracked; hook at HEAD).
- **Verdict:** implementor's fails-on-revert is **independently confirmed real**.

---

## 5. Adversarial test added (tester-owned, DIFFERENT angle)

- **Path:** `mingla-business/src/hooks/__tests__/orch_1142_clearRead_scope.tester_adversarial.test.ts` (NEW; append-only).
- **Angle vs implementor:** the implementor's test is a **static source-regex** assertion. This test is **behavioral** — it executes `clearRead`, `softDelete`, and the registered realtime UPDATE handler against a recording query-builder spy + a real `QueryClient`, and asserts on the actual constructed server filter chain + the resulting cache state:
  - **A1** — clearRead removes ONLY read rows from cache (unread business + read consumer survive) AND builds a `user_id` + `read_at IS NOT NULL` + `deleted_at IS NULL` + business-type `.or` chain.
  - **A2** — clearRead server-error reverts the cache to the exact prior rows (no silent data-loss of unread/consumer).
  - **A3** — realtime UPDATE drops a soft-deleted BUSINESS row, IGNORES a soft-deleted CONSUMER row.
  - **A4** — softDelete targets `.eq("id")` only, never `.eq("user_id")`/`.or` (can't degrade to bulk).
- **Run:** **4 passed**.
- **Fails-on-revert verified at `e7fd81560`:** true line-deletion of `.not("read_at", "is", null)` from `clearRead` → **A1 RED** at `orch_1142_clearRead_scope.tester_adversarial.test.ts:189` (`Expected: ["read_at","is",null] · Received: undefined` — the read-scope is gone, which is exactly the widening that would let `clearRead` soft-delete UNREAD rows). Restored → 4 passed. This is the load-bearing data-loss boundary of I-PROPOSED-BH.
- **In closing diff:** both the implementor happy-path test AND this tester adversarial test appear in `git diff origin/main...HEAD --name-only` (implementor's is committed; tester's is the one untracked file to be committed into the closing PR). One test-env shim noted: the test defines `globalThis.__DEV__ = false` so the hook's dev-warn-guarded revert path executes under node (product code unchanged).

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | suspected (not live-fired) | Tap = mark-read + expand; Open/swipe/trash all wired. Source-coherent; UI not driven. |
| 2 | One owner per truth | PASS | `useBusinessNotifications` is the single cache owner; `deleted_at` written only via softDelete/clearRead by PK/scoped filter. |
| 3 | No silent failures | PASS | Revert on error is intentional + non-alarming (mark-read grammar); `__DEV__` warn. Not a swallowed error masking success. |
| 4 | One query key per entity (factory) | PASS | `businessNotificationKeys.all(userId)` used everywhere. |
| 5 | Server state server-side | PASS | No Zustand; React Query only. |
| 6 | Logout clears everything | N/A | No new persisted client state (expand Set is ephemeral component state). |
| 7 | Label `[TRANSITIONAL]` + exit | PASS | Full-swipe tuning noted as final mechanism, no transitional marker needed. |
| 8 | Subtract before adding | PASS | Migration additive nullable; supersedes SUB-C §4.4 via soft-delete, documented. |
| 9 | No fabricated data | PASS | No fake counts; frozen read count is the real filtered length. |
| 10 | Currency-aware | N/A | No money rendering changed. |
| 11 | One auth instance | PASS | Route uses `useAuth` once; screen takes `userId` prop. |
| 12 | Validate at right time | PASS | `read_at`/`deleted_at` server-stamped ISO. |
| 13 | Exclusion consistency | PASS | Fetch `.is("deleted_at",null)` + realtime drop + clearRead `.is("deleted_at",null)` all consistent; I-PROPOSED-W `.or` kept everywhere. |
| 14 | Persisted-state startup gate | N/A | No persisted hydration added. |

No violations → no automatic P0.

---

## 7. Device / parity matrix

| Surface | In scope | Verdict | Evidence / reason |
|---------|----------|---------|-------------------|
| Consumer iOS | NO | N/A | Additive NULL column; consumer fetch untouched. Not Seth's ask. |
| Consumer Android | NO | N/A | Same. |
| Buyer/anon Web | NO | N/A | No notifications surface. |
| Business iOS | YES | **BLOCKED (live-fire)** | iOS sim `17091E60…` business app red-screens on pre-existing `expo-image-manipulator` missing-module (P3-1); not loadable. Source PASS. |
| Business Android | YES | **BLOCKED (no build)** | Physical Android R58R54YV7JT has only the consumer app; no Android business dev build available. Source PASS. |
| Admin Web | NO | N/A | Exempt from I-PROPOSED-W; not in ask. |
| Business Web preview | YES | **BLOCKED (live-fire)** | Same `expo-image-manipulator` resolution break (no `.web` shim) blocks the web bundle. Source PASS. |

- **Physical iPhone HITL:** not invoked — the blocker is upstream of any device (bundle won't load on sim either), so a HITL step would hit the identical red screen. Captured as the Seth unblock-ask in §9.
- **Edge-fn live deploy state:** N/A — ORCH-1142 deploys no edge functions (migration only).

---

## 8. Discoveries for Orchestrator

- **DISC-1142-A (environment, not code):** the shared anchor `node_modules` (`/Users/sethogieva/Desktop/mingla-main/mingla-business/node_modules`, symlinked by every worktree) is **stale** — it lacks `expo-image-manipulator` which `origin/main` `package.json` declares (ORCH-1119). Result: the WHOLE business app bundle red-screens on dev (sim + web) for ANY branch off current main, blocking all business-app live-fire testing program-wide until `npm install` is run AND a fresh business dev build that includes the native module is cut/installed (mind COMMS-0030 Google-pods modular-headers on the iOS build). This is a latent blocker for every future business-app TEST dispatch, not just ORCH-1142.
- **DISC-1142-B (provenance):** the IMPLEMENTATION report cites commits `488ffca8b` (screen) + `2bcf4e847` (fails-on-revert) but the worktree HEAD is the single squashed commit `e7fd81560`. Re-ran the fails-on-revert against `e7fd81560` (the real closing commit) — confirmed real. No issue, just reconcile the hash at CLOSE.
- **At CLOSE:** flip `I-PROPOSED-BH` ACTIVE (the jest source-assertion + this tester behavioral test both enforce it); annotate META-ORCH-1074 SUB-C_DESIGN §4.4 supersession; apply migration `20261002000000` (re-verify head; via Management API per the hazard memo); commit the tester adversarial test into the closing PR.

---

## 9. Accepted conditions (CONDITIONAL PASS prerequisites — require Seth's affirmative)

The verdict is CONDITIONAL on Seth accepting deferral of the on-device UI live-fire (SC-1/2/3/3-Web/6-multidevice) to **post-merge dev-channel OTA verification**, because:
1. The delete-path SCOPE (the data-loss / cross-app-leak risk this ORCH actually carries) is fully proven at unit + behavioral + source + fails-on-revert level.
2. The UI live-fire blocker is a pre-existing environment break wholly unrelated to ORCH-1142 (DISC-1142-A), affecting all business-app testing, and resolving it requires a native rebuild + `npm install` decision that is Seth's to make.

If Seth does NOT accept the deferral, this is **BLOCKED on live-fire** (not a code rework) — unblock by landing `expo-image-manipulator` in node_modules + a fresh business dev build, then re-dispatch TEST to drive the 5 deferred SCs.

---

## 10. Test artifacts

- Implementor happy-path (source-regex): `mingla-business/src/hooks/__tests__/orch_1142_notif_softdelete_scope.test.ts` — 5 passed; fails-on-revert reproduced @ `e7fd81560` (case 1 RED on `.is("deleted_at",null)` deletion).
- Tester adversarial (behavioral): `mingla-business/src/hooks/__tests__/orch_1142_clearRead_scope.tester_adversarial.test.ts` — 4 passed; fails-on-revert @ `e7fd81560` (A1 RED on `.not("read_at","is",null)` deletion).
- I-PROPOSED-W gate: exit 0, 0 violations.
- tsc: 0 errors in the 4 ORCH-1142 files (263 pre-existing project-wide baseline errors, none in scope).
- Pre-existing unrelated test failures (NOT ORCH-1142): `orch1004AllowlistIntegrity.test.ts`, `brandListState.test.ts` — confirmed failing identically with the new test file absent.
