# IMPLEMENTATION — ORCH-1358 [social-proof-card-spacing] + ORCH-1359 [guest-list-sheet-identity-display]

**Phase:** IMPLEMENT (mingla-implementor) · **Status:** implemented and verified (source + gate level; RPC live-fire + device runtime deferred to tester per SC-6/SC-7)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1359-[guest-sheet-polish]` on branch `ORCH-1359-guest-sheet-polish` (rebased clean on `origin/main` @ `c9b8206ea`).
**Specs:** `SPEC_ORCH-1358_CARD_SPACING.md`, `SPEC_ORCH-1359_GUEST_LIST_IDENTITY.md` · **Investigation:** `INVESTIGATION_ORCH-1358-1359_GUEST_LIST_POLISH.md`
**Batch:** ships as ONE consumer OTA + one additive migration. **OTA-safe** — pure-JS RN/TS + one additive CREATE-OR-REPLACE RPC. No native module / app.json / config change.

---

## 1. Summary

Two paired follow-ups to META-ORCH-1337, implemented exactly to spec:

- **ORCH-1358 (a):** the "See who's going" momentum card sat flush against the vibe/taxonomy pill cluster. Added `marginTop: 16` to the shared `momentum` style in both byte-parity twins (`OfferingMomentum` + `RsvpMomentumDecision`) → a symmetric 16px top gap on every surface (consumer iOS/Android + buyer-web + business-preview) automatically.
- **ORCH-1359 (b):** named guest rows drop the second `@username` line — name only.
- **ORCH-1359 (c):** in its place, named rows show the guest's public **city** (first comma-segment of `profiles.location`). Net-new: one whitelisted column (`location`) added to the `peer_list_event_guests` RPC (named rows only, same identity gate) + `PeerGuestRow.location`. Null location → name only (Constitution #9, no fabrication).
- **ORCH-1359 (e):** unlinked (no-app) rows now carry a concise **"Not on Mingla"** caption; the on-Mingla-but-private case keeps **"Keeping it low-key"** — the two stay visually distinct.
- **ORCH-1359 (d):** tap-name → profile — **INTENTIONALLY NOT BUILT.** HELD pending a Seth decision (superseding the SEALED DRAFT `I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY`). Guest rows remain non-pressable exactly as today. See §10.

## 2. SPEC success-criteria coverage

### ORCH-1358

| SC | Criterion | Status | Commit |
|----|-----------|--------|--------|
| SC-1 | Momentum card has a 16px gap above it on ticketed event detail (iOS+Android) | ✓ source-verified (`marginTop:16`), device visual → tester | `6e693d9b4` |
| SC-2 | Same gap on trip/experience (`OfferingMomentum`) + RSVP (`RsvpMomentumDecision`) | ✓ both twins patched identically | `6e693d9b4` |
| SC-3-Web | Buyer-web + business-preview render the same gap, no extra edit | ✓ shared package — automatic parity | `6e693d9b4` |
| SC-4 | No regression to internal spacing/meter/cluster; `marginBottom:16` + `padding:18` unchanged | ✓ test T-3 asserts both unchanged | `6e693d9b4` |

### ORCH-1359

| SC | Criterion | Status | Commit |
|----|-----------|--------|--------|
| SC-1 (b) | Named row shows name only — no `@username` line (iOS+Android) | ✓ line2 rewrite; test T-1 | `03d5595d5` |
| SC-2 (c) | Named guest with `location="Austin, Texas, United States"` shows "Austin" | ✓ `cityFor` first-segment; component T-2 + migration T-2 | `03d5595d5` / `c4ccf8c97` |
| SC-3 (c) | Null location → name only (no placeholder) | ✓ `cityFor` returns null → line2 null; contract test | `03d5595d5` |
| SC-4 (c) | Anonymous + unlinked rows receive `location=NULL` server-side | ✓ identity CASE guard; migration T-2/T-3/T-5 | `c4ccf8c97` |
| SC-5 (e) | Unlinked → "Guest" + "Not on Mingla"; anon-private → "Someone" + "Keeping it low-key" (distinct) | ✓ line2 rewrite; component T-3/T-3b | `03d5595d5` |
| SC-6 (backend) | RPC returns `location` on named rows, null elsewhere; guards + grant intact | ✓ **source-verified** (migration test 9/9); **live-fire deferred to orchestrator/tester** (RPC not applied — implementor owns no deploy) | `c4ccf8c97` |
| SC-7 (d) [gated] | Tap-name opens profile | **N/A — item (d) HELD, not implemented** (per dispatch) | — |

## 3. Files changed (14 files, +1284 / −13 vs `origin/main`)

**Product code**
- `packages/offering-rendering/OfferingMomentum.tsx` (+3) — `marginTop:16` on `momentum`.
- `packages/offering-rendering/RsvpMomentumDecision.tsx` (+3) — `marginTop:16` on `momentum` (byte-parity twin).
- `packages/offering-rendering/socialProofTypes.ts` (+7/−2) — `PeerGuestRow.location: string | null` + doc comment.
- `app-mobile/src/components/EventGuestListSheet.tsx` (+21/−11) — `cityFor` helper; `line2` + `a11yLabel` rewrite (items b/c/e).
- `supabase/migrations/20261229000000_orch_1359_peer_guest_location.sql` (new, 306 lines) — CREATE OR REPLACE `peer_list_event_guests` with identity-gated `location`.

**Tests (implementor-owned happy-path)**
- `packages/offering-rendering/__tests__/orch_1358_card_spacing.test.ts` (new, 4 tests).
- `supabase/migrations/__tests__/orch_1359_peer_guest_location.test.ts` (new, 9 tests).
- `app-mobile/src/components/__tests__/orch_1359_guest_sheet_identity.test.ts` (new, 8 tests).
- `packages/offering-rendering/__tests__/orch_1338_social_proof_types.test.ts` (+4, additive — `location` added to the two `PeerGuestRow` literals; append-only clean, 0 deletions).
- `app-mobile/src/components/__tests__/orch_1341_guest_list_sheet.test.ts` (+3/−2 — the stale `"On Mingla"` T-13 pin, a string item (b) removed, swapped for `"Not on Mingla"`; `[TEST-MOD-APPROVED ORCH-1359]`).

**CI / docs**
- `.github/workflows/meta-orch-1337-social-proof-tests.yml` (+7) — registered the 3 new deno suites (append-only per its own convention).
- `Mingla_Artifacts/investigations/…` + `specs/SPEC_ORCH-1358…` + `specs/SPEC_ORCH-1359…` (binding contracts — committed so the PR carries them).

## 4. Data-model changes applied

- **Migration authored, NOT applied.** `20261229000000_orch_1359_peer_guest_location.sql` — `CREATE OR REPLACE` of `public.peer_list_event_guests(uuid, integer, integer)` ONLY. Adds exactly one whitelisted `profiles` column — `location` — to the NAMED-ROW projection in BOTH branches (RSVP + ticketed) via the SAME identity CASE guard (`linked AND visibility_mode IN ('public','friends')`) and one payload key (`location`, positioned after `avatarUrl`, before `isMinglaUser`). Anonymous/private/unlinked/blocked rows → `location = NULL`.
- **Preserved verbatim:** all four guards + guard order, branch markers, hard row-cap `LEAST(GREATEST(…,1),100)`, both-direction block exclusion, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO authenticated` (no anon), `NOTIFY pgrst`. Function A (`pg_public_social_proof`) untouched. No table DDL, no RLS change.
- **Column whitelist widened by one:** `id, display_name, username, avatar_url, location, visibility_mode`.
- **Real-column basis:** `profiles.location` (text, nullable) — proven live in INVESTIGATION F-3 via Management API SQL (there is NO `city` column). A `CREATE OR REPLACE FUNCTION` does not abort at apply on a column reference; the orchestrator's SC-6 live-fire call confirms the column post-apply.

## 5. Edge functions touched

None. (No edge function in scope; the change is a SQL RPC + client.)

## 6. Regression tests added — fails-on-revert proof

All fails-on-revert proofs used **true line deletion** of the fix (not comment-out), re-ran → FAIL, restored via `git checkout` → PASS.

| Behavior | Test (path) | Fails-on-revert proof |
|----------|-------------|-----------------------|
| Card `marginTop` present (both twins) | `packages/offering-rendering/__tests__/orch_1358_card_spacing.test.ts` (4) | Deleted `marginTop:16` from `OfferingMomentum` → T-1+T-3b FAIL; deleted from `RsvpMomentumDecision` → T-2+T-3b FAIL. **verified at `6e693d9b4`** |
| RPC location gated to named rows | `supabase/migrations/__tests__/orch_1359_peer_guest_location.test.ts` (9) | Deleted both `named_location` CASE projections + payload keys → T-2/T-3/T-4/T-5 FAIL. **verified at `c4ccf8c97`** |
| `@username` line absent for named rows (b) | `app-mobile/src/components/__tests__/orch_1359_guest_sheet_identity.test.ts` (8) | Reverted `line2` to the pre-fix `@${username}`/"On Mingla" branch → T-1 FAIL. **verified at `03d5595d5`** |
| City rendered / wired (c) | same file | Deleted the `const city = cityFor(guest.location)` wiring line → T-2 FAIL. **verified at `03d5595d5`** |
| "Not on Mingla" for unlinked, NOT for on-Mingla-private (e) | same file | Reverted `line2` (unlinked → null) → T-3 + T-3b (distinctness) FAIL. **verified at `03d5595d5`** |

Both my happy-path suites AND the modified/extended existing suites are visible in `git diff origin/main...HEAD --name-only` (shipped in the same branch as the fix).

## 7. Old → New receipts

### OfferingMomentum.tsx / RsvpMomentumDecision.tsx
- **Before:** `momentum` style had `marginBottom:16` but no `marginTop` → card border abutted the pills (zero gap).
- **After:** `marginTop:16` added (identical in both twins) → symmetric top breathing room.
- **Why:** ORCH-1358 SC-1..SC-4. **Lines:** +3 each.

### socialProofTypes.ts
- **Before:** `PeerGuestRow` had no location field.
- **After:** `location: string | null` (frozen-contract camelCase key mirroring the RPC) + doc comment noting named-rows-only.
- **Why:** ORCH-1359 item (c) type layer. **Lines:** +7/−2.

### EventGuestListSheet.tsx
- **Before:** named `line2` = `guest.username !== null ? \`@${username}\` : "On Mingla"`; unlinked `line2` = `null`; a11y used `at-${username}, on Mingla` / bare "Guest".
- **After:** `cityFor` helper added; named `line2` = the city (or null → name only); unlinked `line2` = `"Not on Mingla"`; anon-private unchanged (`"Keeping it low-key"`); a11y appends city / `"Guest, not on Mingla"`. `line1` name source-of-truth and all actions/states untouched.
- **Why:** ORCH-1359 items (b)(c)(e). **Lines:** +21/−11.

### 20261229000000_orch_1359_peer_guest_location.sql
- **Before (in 20261225000000):** FN-B named-row projection = id/display_name/username/avatar_url only.
- **After:** + `named_location` (same CASE guard) + `'location'` payload key, both branches. Everything else byte-preserved.
- **Why:** ORCH-1359 item (c) backend. **Lines:** new file.

## 8. Cross-surface impact

| Surface | ORCH-1358 | ORCH-1359 | Parity |
|---------|-----------|-----------|--------|
| Consumer iOS | YES (gap) | YES (name/city/"Not on Mingla") | shared pkg / RN component |
| Consumer Android | YES | YES | Automatic (same RN component) |
| Buyer/anon Web | YES (gap) | NO — guest names never render on web (I-1340); RPC authed-only | 1358 automatic; 1359 by-design excluded |
| Business iOS/Android | NO (no consumer offering bodies / no guest sheet) | NO | — |
| Admin Web | NO | NO | — |
| Business Web preview | YES (gap — renders shared bodies) | NO (no guest sheet) | 1358 automatic |

Parity is **automatic** for 1358 (shared `packages/offering-rendering`). ORCH-1359 is consumer-app-only (single RN component → iOS/Android parity automatic). No manual per-surface work.

## 9. Smoke result (gates run in-worktree)

- **META-ORCH-1337 CI battery** (exact CI invocation `deno test --allow-env --allow-net --allow-read --no-check`, 18 files incl. the 3 newly registered): **187 passed, 0 failed.**
- **New ORCH-1358 suite:** 4/4 green. **New ORCH-1359 migration suite:** 9/9 green. **New ORCH-1359 component suite:** 8/8 green.
- **Append-only gate** (`node .github/scripts/test-append-only-check.js`): **5 passed, 0 failed** — the T-13 mod accepted via `[TEST-MOD-APPROVED ORCH-1359]`; the types-test change is additions-only.
- **Strict-grep gates run:** `meta-orch-0991-base-bottom-sheet-sole-consumer` PASS, `meta-orch-0827-package-isolation` PASS, `orch-1292-taxonomy-label-parity`/`-adversarial` PASS, `orch-1303-rsvp-loop-interaction-handle` PASS.
- **tsc:** `packages/offering-rendering` (`tsc --noEmit -p tsconfig.json`) — **clean**. `deno check socialProofTypes.ts` — clean. `app-mobile` (`tsc --noEmit -p tsconfig.json`) — 902 **pre-existing** errors baseline (mostly Deno test files caught in the sweep: `Cannot find name 'Deno'` etc.), **ZERO** referencing `EventGuestListSheet`, `cityFor`, `guest.location`, `PeerGuestRow`, or `socialProofTypes` → my changes add no type error. My new component test carries `@ts-nocheck` (house convention).
- **No simulator/device runtime run** (implementor scope): the visual gap (1358) and the row copy/city render (1359) are device-visual + RPC live-fire — deferred to the tester per each spec's routing (SC-1 device visual, SC-6 authed RPC live-fire, SC-7 N/A).

## 10. Known issues / deferred

- **Item (d) tap-name → profile — NOT IMPLEMENTED, intentionally.** Per dispatch, HELD pending Seth's decision (D-A shell-sink / D-B detail-local overlay / D-C defer) AND ratification of superseding the SEALED DRAFT `I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY`. No profile-open wiring exists in this branch; guest rows remain non-pressable (`line1` renders in a plain `<Text style={styles.rowName}>`). No `onOpenProfile`/`openProfileInApp`/`registerOpenProfileSink`/profile-open testID added anywhere. When ratified, SPEC §4.4 carries the exact D-B contract.
- No `[TRANSITIONAL]` code introduced.

## 11. Operator action required (orchestrator / Seth — NOT the implementor)

1. **Apply the migration** (implementor applies NOTHING). Monotonicity re-checked: `20261229000000` is strictly greater than the local + linked + sibling-worktree frontier `20261228000000`. No remote-only drift assumed by this file (pure CREATE OR REPLACE, no pre-flight guard/backfill).
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1359-[guest-sheet-polish]" && /Users/sethogieva/bin/supabase db push --linked
   ```
2. **Live-fire verify SC-6** (headless insufficient): one authed `peer_list_event_guests` call returns `location` on a public/friends named guest, `null` on a private/unlinked guest, and still RAISEs `guest_list_private` when the host gate is on. Confirm `profiles.location` exists (investigation F-3 proved it live).
3. **Edge functions to deploy:** none.
4. **OTA:** ONE consumer per-platform OTA (ios + android) carries both 1358 + 1359 client changes (shared package + app-mobile). NOTE COMMS-0052/0063: **business-app** OTA is separately blocked (native-build-only) — not relevant to this consumer OTA, but do not `eas update` the business channel.
5. **REVIEW → tester:** device visual (1358 gap; 1359 row copy/city on a seeded named guest with a real `profiles.location`), RPC live-fire, cross-surface parity. Item (d) has no SC to test this batch.
6. **At CLOSE:** registry housekeeping (investigation D-1: `I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY` / `-MESSAGE-CLOSE-BEFORE-NAVIGATE` are DRAFT-in-spec but never promoted to `INVARIANT_REGISTRY.md`). Since item (d) did NOT ship, the ACTIONS-ONLY invariant is NOT superseded this batch.

## 12. Discoveries for Orchestrator

- **D-1 (from investigation, still open):** the two 1341 DRAFT invariants were never promoted to the registry at META-ORCH-1337 CLOSE. Orchestrator may backfill; not blocking this batch (no code depends on it).
- **D-2 (append-only mechanics):** removing the now-false `"On Mingla"` pin in the existing `orch_1341_guest_list_sheet.test.ts` required `[TEST-MOD-APPROVED ORCH-1359]`. The append-only CI reads the HEAD commit body — the report commit (this file) also carries the token so the PR HEAD retains it; if the orchestrator adds further commits before the PR, ensure the branch HEAD keeps `[TEST-MOD-APPROVED ORCH-1359]` in its body.
- **D-3 (pre-existing baseline):** `app-mobile` `tsc --noEmit` reports 902 pre-existing errors (Deno test files pulled into the sweep + other legacy), unrelated to this ORCH. Flagged for visibility; out of scope to fix here.
- **COMMS acks (entry):** BLOCK rows COMMS-0006 (targets ORCH-0980) and COMMS-0052 (business-OTA deploy gate, ALL) are deploy-time/other-ORCH concerns — the implementor deploys nothing, so neither gates this code work. WARN rows COMMS-0093 (no `Linking.openURL` — honored), COMMS-0088 (BaseBottomSheet reuse — untouched), COMMS-0094 (additive migration after frontier, never `db push` — honored) were acked on entry in the investigation and factored in. Global COMMS_LEDGER not mutated from the worktree (orchestrator-owned).
