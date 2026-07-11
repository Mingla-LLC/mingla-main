# TEST — ORCH-1358 [social-proof-card-spacing] + ORCH-1359 [guest-list-sheet-identity-display]

**Phase:** TEST (mingla-tester) · **Worktree:** `~/Desktop/mingla-orchs/ORCH-1359-[guest-sheet-polish]` on branch `ORCH-1359-guest-sheet-polish`
**Tester HEAD:** `9e36c08933931fda64ccc9784f769f2ab712a21b` (implementor HEAD `7cb087468` + this tester's adversarial-test commit)
**Base:** rebased clean on `origin/main` @ `c9b8206ea`
**Specs:** `SPEC_ORCH-1358_CARD_SPACING.md`, `SPEC_ORCH-1359_GUEST_LIST_IDENTITY.md` · **Impl report:** `IMPLEMENTATION_ORCH-1358-1359_GUEST_LIST_POLISH.md` (incl. ADDENDUM D + REGRESSION-FIX anon-EXECUTE section)
**Prod live-fire target:** `gqnoajqerqhnvulmnyvv` (Supabase Management API, browser UA, token never printed) — FIFA Grill Night event `de1211d0-b8b7-4590-ba9f-cccaeb89ccc7`

---

## 1. VERDICT — CONDITIONAL PASS

**P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2** (praise). No defects found in any layer.

The code is defect-free and ship-quality. Backend (the net-new, risky layer) is **fully proven** by prod live-fire; the ORCH-1358 card gap is **proven at iOS runtime**; the P2 anon-EXECUTE hardening is **live-correct on prod**; the full battery is green (201/0) with a tester adversarial guard added. The verdict is CONDITIONAL — not a clean PASS — **only** because two runtime surfaces could not be device-proven this session, both blocked by **environment/credential barriers (not defects)**:

- **C-1 — the authed guest ROSTER UI (ORCH-1359 b/c/e/d) was not device-proven.** The consumer app is OAuth-only (Apple/Google) with **no reviewer bypass** (memory: ORCH-1348); the sim's Apple ID is unlinked (would create a new prod account + need Seth's password + full onboarding); non-interactive session → cannot complete OAuth. The roster's DATA is proven by prod live-fire and its RENDERING by the component deno suites + source review, but the rows/tap-to-profile were not exercised on a device.
- **C-2 — Android runtime is blocked by a STALE dev build.** The installed Android consumer dev build crashes at startup: `react-native-keyboard-controller` native module not linked — the exact **COMMS-0047 / ORCH-1171** condition (pre-existing, unrelated to this batch). iOS ran the worktree bundle cleanly.

**Routing:** because the conditions are not pre-accepted in the dispatch, per skill routing I **STOP and surface to Seth** (do not auto-route to CLOSE). Seth either (a) accepts the two runtime deferrals given the overwhelming non-runtime proof, or (b) unblocks (logs an existing consumer into a sim / rebuilds the Android dev build) for a full device pass → PASS.

---

## 2. SC-by-SC matrix

### ORCH-1358 (card spacing)

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1-iOS | Momentum card has a visible 16px gap above it on a ticketed event detail | **PASS (proven)** | iOS runtime: FIFA Grill Night cold-landing, `ios_11_mom.png` — momentum card ("2 going · 28 spots left · filling up", meter, avatar cluster, "See who's going") sits with clear top breathing room below the pill cluster ("R&B/Soul"/"30 tickets left"), NOT flush. Worktree bundle (marginTop:16). |
| SC-1-Android | Same on Android | **BLOCKED (C-2)** | Android dev build stale — startup crash (react-native-keyboard-controller, COMMS-0047). Shared RN StyleSheet (`marginTop:16`, platform-agnostic) + iOS proven + fails-on-revert test → parity-inferred, not device-proven. |
| SC-2 | Same gap on trip/experience (`OfferingMomentum`) + RSVP (`RsvpMomentumDecision`) | **PASS (source+test)** | Both twins carry byte-identical `marginTop:16` (diff verified); `orch_1358_card_spacing.test.ts` asserts both (4/4). iOS proof is the `OfferingMomentum` twin (event uses it). |
| SC-3-Web | Buyer-web + business-preview render the gap, no extra edit | **PASS (source)** | `mingla-business/PublicEventPage.tsx` (buyer-web, anon-reachable) + FoundationEventPreview/TripPreview/ExperiencePreview import `EventOfferingBody` from `@mingla/offering-rendering` → embeds `OfferingMomentum`. Change is style-only (zero API/prop delta); diff touches ZERO mingla-business files → automatic parity, no break. Not runtime-rendered this session (web build). |
| SC-4 | No regression to internal spacing/meter/cluster; `marginBottom:16`+`padding:18` unchanged | **PASS** | Diff adds only `marginTop:16`+comment; `marginBottom:16`/`padding:18` intact; T-3 asserts. iOS render shows intact card internals. |

### ORCH-1359 (identity display)

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 (b) | Named row shows name only — no `@username` line | **PASS (data live-fire + source/test); roster UI runtime BLOCKED (C-1)** | Client `line2` for named = `cityFor(guest.location)` (the `@username`/"On Mingla" branch removed — diff verified); `orch_1359_guest_sheet_identity.test.ts` T-1 pins it; fails-on-revert reproduced (Step 0.5-B). |
| SC-2 (c) | Named guest w/ location "Austin,…" shows the city | **PASS (data proven live)** | **Prod live-fire:** authed viewer → `sethogievabelgium` returned `location:"Raleigh, NC, United States"`; `cityFor` first-segment → "Raleigh". `ios_12` shows this guest's real photo in the anon cluster. Row-copy render = component test + source. |
| SC-3 (c, rule 9) | Null location → name only, no placeholder | **PASS** | `cityFor(null)→null → line2 null` (source); component test; Constitution #9 honored. |
| SC-4 (c, privacy) | Anon/private + unlinked rows get `location=NULL`; blocked absent | **PASS (proven live)** | **Prod:** unlinked row (buyer_user_id NULL) → `location:null, isMinglaUser:false`. Private-visibility (verified ROLLBACK txn, prod restored) → `location:null, isMinglaUser:true`. Blocked-pair (verified ROLLBACK txn) → row EXCLUDED (`returned:1`). |
| SC-5 (e) | Unlinked → "Not on Mingla"; anon-private → "Keeping it low-key" (distinct) | **PASS (data live + source/test); roster UI runtime BLOCKED (C-1)** | Server distinguishes: unlinked `isMinglaUser:false` vs private `isMinglaUser:true` (both proven live). Client maps to the two distinct captions (diff + component test T-3/T-3b); fails-on-revert reproduced (Step 0.5-B). |
| SC-6 (backend) | Location on named rows, null elsewhere; guards + grants intact; private raises; anon → auth_required | **PASS (fully proven live)** | See §Backend Live-Fire below — all seven cases proven on prod. |
| SC-7 (d) | Tap named name → `ViewFriendProfileScreen` overlay over detail; Back → detail; anon/unlinked/You non-pressable; clean z-order | **PASS (source+test); device interaction BLOCKED (C-1)** | Wiring verified in diff (close-before-navigate `onClose()→onOpenProfile`; `canOpenProfile` gate; detail-local absolute-fill overlay zIndex 100; no `Linking.openURL`); `orch_1359_guest_sheet_open_profile.test.ts` (9/9). Overlay open/close + Android GlassBottomNav z-order **not device-exercised** (auth barrier). |

---

## 3. Backend live-fire (SC-6) — prod `gqnoajqerqhnvulmnyvv`, 2026-07-11

Headless-insufficient per SC-6 — all runs are authed-impersonated (`set_config('request.jwt.claims',…)`) or grant-level, against real prod data. Negative privacy cases used **verified-ROLLBACK** transactions (prod confirmed unchanged after each).

| # | Assertion | Method | Result |
|---|-----------|--------|--------|
| 1 | Location on a named public/friends guest WHO HAS a `profiles.location` | authed viewer `955576c8` → RPC on FIFA | `sethogievabelgium` → `location:"Raleigh, NC, United States"`, `isMinglaUser:true, isAnonymous:false` ✓ |
| 2 | Location NULL on unlinked/anon-buyer row | same call | order w/ `buyer_user_id NULL` → `location:null, isMinglaUser:false, isAnonymous:true` ✓ |
| 3 | Location NULL on private-visibility linked row (+ stays isMinglaUser:true) | BEGIN; flip guest→private; RPC; ROLLBACK | guest → `location:null, isMinglaUser:true, isAnonymous:true`; **prod restored to `friends`/Raleigh** ✓ |
| 4 | Blocked-pair viewer → named guest EXCLUDED (no name AND no location) | BEGIN; insert block; RPC; ROLLBACK | `returned:1` (only the unlinked row); named guest gone; **blocked_users restored to 0** ✓ |
| 5 | `guest_list_private` RAISE when host toggle ON | authed RPC on "BBQ Pool Party" (`privateGuestList=true`) | `ERROR P0001: guest_list_private` (line 36 RAISE) ✓ |
| 6 | anon → `authentication_required` | RPC with empty jwt claims | `ERROR P0001: authentication_required` (line 14 RAISE) ✓ |
| 7 | Migration IS applied to prod (location live) | `pg_get_functiondef LIKE '%named_location%'` + `'%''location''%'` | both `true` ✓ |

Final prod-clean confirmation: `orphan_blocks=0`, FIFA guest `visibility_mode=friends` (restored). No prod left dirty.

## 4. Adversarial anon-EXECUTE re-probe (P2) — prod

The P2 hardening the migration briefly regressed and the orchestrator fixed. **Live-confirmed correct:**

- `has_function_privilege('anon','public.peer_list_event_guests(uuid,integer,integer)','EXECUTE')` = **`false`** ✓
- `has_function_privilege('authenticated', …, 'EXECUTE')` = **`true`** ✓
- Raw ACL: `{postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}` — **anon absent, no PUBLIC entry** ✓
- Re-confirmed at report finalization (post-rollback-tests): `anon_exec=false, auth_exec=true` — stable ✓

---

## 5. Findings

**None (P0–P3).** No defect in any layer. Two P4 (praise):

- **P4-1** — The `named_location` projection reuses the *exact* identity CASE guard as `display_name` in both branches, and `isAnonymous = NOT is_named` derives from that same predicate, so the privacy weld is structural, not incidental. Verified live: private + blocked rows leak neither name nor city. Clean, correct, defense-in-depth.
- **P4-2** — The anon-EXECUTE regression was closed *properly*: the migration file now names `anon` in the REVOKE (`FROM PUBLIC, anon`), a new T-10 guard pins it against this recreating migration, and the previously bug-pinning T-8 was corrected. The false-green root cause was found and eliminated.

---

## 6. Step 0.5 — independent re-run of the implementor's fails-on-revert proofs

Re-run at tester HEAD (true line-deletion → run → restore via `git checkout`; hashes cited):

| Implementor claim | My revert | Result | Restore |
|---|---|---|---|
| Migration anon-strip (T-8/T-10) | `FROM PUBLIC, anon;` → `FROM PUBLIC;` in `20261229000000…sql` | `orch_1359_peer_guest_location.test.ts` → **T-8 + T-10 FAILED** (8 passed / 2 failed) | restored → 10/10; line 306 back to `FROM PUBLIC, anon;` |
| Client copy (item e) | unlinked `line2` `"Not on Mingla"` → `null` in `EventGuestListSheet.tsx` | `orch_1359_guest_sheet_identity.test.ts` → **T-3 + T-3b FAILED** (6 passed / 2 failed) | restored → clean |

Both implementor fails-on-revert proofs **independently reproduced**. (Baseline: both suites 10/10 and green at HEAD before revert.)

## 7. Adversarial test added (tester-owned, different angle)

**Path:** `supabase/migrations/__tests__/orch_1359_location_identity_weld.adversarial.test.ts` (NEW file, committed `9e36c089`, registered in `meta-orch-1337-social-proof-tests.yml`, PR-blocking).

**Angle (DIFFERENT from implementor's happy-path):** the implementor pins that location IS emitted on named rows. This attacks the **opposite leak**: a future edit that keeps `named_location` present (happy-path stays green) but **de-couples it from the identity gate**, letting a city surface on a name-anonymized row. Four welds:
- **W-1** location's CASE predicate === display_name's, per branch (no weaker gate).
- **W-2** `is_named` (→ `isAnonymous`) uses the same predicate → an `isAnonymous:true` row structurally cannot carry a city.
- **W-3** the `'location'` payload value is always the gated alias `n.named_location`.
- **W-4** no ungated `p.location` anywhere in the function body.

**fails-on-revert verified at `9e36c089`:** decoupling location's guard from the linked/name check (both branches, keeping `THEN p.location END`) → **W-1 + W-2 FAILED** (2 passed / 2 failed); `git checkout` restore → **4 passed / 0 failed**.

Both the implementor's happy-path suite AND this adversarial suite appear in `git diff origin/main...HEAD --name-only`. Append-only check: **7 passed, 0 failed**.

---

## 8. Constitution 14-rule matrix (independent re-derivation vs diff)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | PASS | Name `Pressable` renders ONLY when `canOpenProfile` (named, non-You, profileId≠null, seam wired); else plain Text. Handler `if(profileId===null||onOpenProfile===undefined)return`. |
| 2 | One owner per truth | PASS | `location`/identity server-owned (RPC); client renders. |
| 3 | No silent failures | PASS | RPC raises explicit exceptions (proven live); client no-op is documented + safe (mirrors message no-sink). |
| 4 | One query key per entity | N/A | `useEventGuestList` unchanged (passthrough). |
| 5 | Server state stays server-side | PASS | `location` from RPC payload; no Zustand. |
| 6 | Logout clears everything | N/A | No new persisted state. |
| 7 | Label `[TRANSITIONAL]` | N/A | None introduced. |
| 8 | Subtract before adding | PASS | `@username` line removed before city added. |
| 9 | No fabricated data | **PASS (core)** | Null location → name-only (no placeholder); proven live (unlinked/private → null → client shows nothing). |
| 10 | Currency-aware | N/A | — |
| 11 | One auth instance | N/A | No new auth. |
| 12 | Validate at right time | N/A | — |
| 13 | Exclusion consistency | PASS | Both-direction block exclusion preserved (proven live: blocked-pair row excluded). |
| 14 | Persisted-state startup | N/A | No new persisted state. |

Zero violations.

## 9. Device / parity matrix

| Surface | ORCH-1358 | ORCH-1359 | Result |
|---------|-----------|-----------|--------|
| Consumer iOS | **PASS (proven runtime)** — card gap on FIFA detail | roster UI **BLOCKED (C-1)** (auth); backend PROVEN, render by test/source | iPhone 17 Pro (iOS 26.4), worktree bundle via Metro 8090 (real `npm ci` — see Discoveries D-1) |
| Consumer Android | **BLOCKED (C-2)** — stale dev build startup crash | **BLOCKED (C-2 + C-1)** | Pixel_8_Pro emulator; `react-native-keyboard-controller` unlinked (COMMS-0047/ORCH-1171). Bundle loaded (5326 modules) but app crashed pre-render. |
| Buyer/anon Web | **PASS (source)** — PublicEventPage → EventOfferingBody → OfferingMomentum; style-only, no break | N/A by design (names never on web, I-1340; anon path `pg_public_social_proof` untouched — confirmed) | Not web-rendered this session |
| Business iOS/Android | N/A | N/A | No consumer offering body / guest sheet |
| Admin Web | N/A | N/A | — |
| Business Web preview | **PASS (source)** — Foundation/Trip/Experience previews render the shared body | N/A | Not rendered this session |

Physical iPhone (HITL): not invoked — non-interactive session (cannot pause for Seth). Stated, not silently skipped.

## 10. Regression sweep

- **Full META-ORCH-1337 deno battery** (exact CI invocation, 20 files incl. my adversarial): **201 passed, 0 failed** (implementor's 197 + tester's 4).
- **mingla-business jest job** (5 suites, 1339/1342): **not executed** (needs a separate `mingla-business` `npm ci`). Reasoned unaffected — the diff touches ZERO mingla-business files and those suites guard 1339/1342 components, not OfferingMomentum spacing; the shared-package change is API-compatible. Low risk; flagged for transparency.
- **Cross-surface OfferingMomentum**: consumers confirmed (buyer-web PublicEventPage + business previews); change style-only; anon path untouched → no break.
- **Append-only gate:** 7 passed, 0 failed.

## 11. Discoveries for Orchestrator

- **D-1 (worktree Metro hazard — resolved):** Metro from the worktree failed to bundle with the **anchor-symlinked `node_modules`** ("Unable to resolve `./mingla-main/app-mobile/node_modules/expo-router/entry`") — the cross-tree symlink pushes Metro's serverRoot to `~/Desktop` and breaks entry resolution. `--clear` did NOT fix it; a real `npm ci` in the worktree (replacing the symlink with a real dir) did. This is the `reference_ota_from_worktree_needs_real_npm_ci` class — **the tester replaced the symlink with a real install to run the sim**. The orchestrator may want to standardize this for worktree sim runs.
- **D-2 (COMMS-0047 live impact):** the installed **Android consumer dev build is stale** — crashes on `react-native-keyboard-controller` (ORCH-1171 native module). Any consumer-app device/runtime QA on Android is blocked until a fresh native build. Also relevant to the CLOSE OTA plan: verify the LIVE consumer production build has this native module before OTA-ing JS that imports it.
- **D-3 (inherited, out of scope):** the `is_named` gate is `visibility_mode IN ('public','friends')` and does **not** verify actual friendship for `'friends'`-visibility guests (any authed non-blocked viewer sees a 'friends' guest as named — proven live). This is **pre-existing ORCH-1338 behavior**, unchanged and unwidened by ORCH-1359 (location rides the identical gate). Flagged for visibility only; not a 1359 defect.

## 12. Accepted conditions (require Seth's decision before CLOSE)

- **C-1** — Authed guest ROSTER UI (ORCH-1359 b/c/e/d) not device-proven (consumer OAuth login barrier, no bypass, non-interactive). Backend data PROVEN live; rendering by component tests + source. → Seth accepts the deferral, OR logs an existing consumer into a sim for a device pass.
- **C-2** — Android runtime blocked by a stale dev build (react-native-keyboard-controller / COMMS-0047, pre-existing). ORCH-1358 gap parity-inferred from the shared RN StyleSheet + iOS proof + test. → Seth accepts, OR rebuilds the Android consumer dev build.

## 13. Comms ledger

Reviewed `COMMS_LEDGER.md` Active entries on entry. Relevant: **COMMS-0047** (react-native-keyboard-controller native module — directly explains the Android stale-build crash, see D-2); **COMMS-0093/0088** (META-ORCH-1337 lineage — this batch is the follow-up); **COMMS-0052** (business-OTA BLOCK — N/A to a tester; I deploy nothing). Global ledger not mutated from the worktree (orchestrator-owned; anchor-edit forbidden by tester hard guards).

---

### Routing
CONDITIONAL PASS with **unaccepted conditions (C-1, C-2)** → **STOP and surface to Seth** (do not auto-route to CLOSE). On acceptance/unblock → CLOSE. No REWORK — zero defects.
