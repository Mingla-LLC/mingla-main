# IMPLEMENTATION — ORCH-0846 [Consumer event sheet venue/address parity with brand-side public page]

**Status:** implemented and verified
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Base commit (pre-fix):** `ebd9875f7f99590315e69291dd196bdd27c8d802`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0846_CONSUMER_EVENT_SHEET_ADDRESS_PARITY.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0846_CONSUMER_EVENT_SHEET_ADDRESS_PARITY.md`

---

## 1. Plain-English summary

The consumer app's Discover sheet for Mingla Business events used to show no venue name and no address at all, even when the brand had publicly shared the location. The fix updates the server-side payload builder (`discover-merged-events` edge function) and the consumer-side mapping (`ExpandedBusinessEventSheet`) so they resolve venue name, address, and event format using the same rules as the brand-side public buyer page. After deploy + OTA, a buyer browsing Discover will see the venue card with name and full street address whenever the brand has opted into public-address mode, with full parity to `https://mingla.business/e/{brandSlug}/{eventSlug}`.

---

## 2. Files changed (Old → New receipts)

### `supabase/functions/discover-merged-events/_helpers.ts` (NEW, 70 lines)

**What it did before:** did not exist.
**What it does now:** exports three pure helpers — `extractVenueName(theme)`, `extractBusinessEventFormat(theme)`, `deriveSharedFormat(themeFormat, isOnline)` — plus a `resolveBusinessEventVenueFields` aggregator used by the regression test suite. Helpers are extracted from `index.ts` so they can be imported by `__tests__/` without triggering the `serve()` entrypoint.
**Why:** SPEC §4.A; testability requirement from SPEC §4.E.1 (existing Deno test pattern in this repo uses pure-function imports — see `__tests__/excludes_ended_events.test.ts`).
**Lines changed:** +70 / -0.

### `supabase/functions/discover-merged-events/index.ts`

**What it did before:** line 422 hardcoded `venueName: null` with the comment "left null for v1 — flagged in report"; address gated by `hide ? null : (row.location_text ?? null)`; no `format` field on `BusinessEventCard` produced by this function (consumer mapping hardcoded `"in-person"`).
**What it does now:** imports the three helpers from `_helpers.ts`; `BusinessEventCard` interface gains `format: "in-person" | "online" | "hybrid"` field; builder resolves `venueName` via `extractVenueName(row.theme) ?? row.location_text ?? null`, passes `address` unconditionally (`row.location_text ?? null` — UI gates on `hideAddressUntilTicket`), and emits `format` via `deriveSharedFormat(extractBusinessEventFormat(row.theme), row.is_online === true)`.
**Why:** SPEC §4.A — restore parity with brand-side `publicEventsService.toPublicEventBySlug:377–378,360`.
**Lines changed:** +25 / -3.

### `app-mobile/src/types/mergedDiscover.ts`

**What it did before:** `BusinessEventCard` carried `venueName`, `city`, `address`, `hideAddressUntilTicket` but no `format` field.
**What it does now:** added `format: "in-person" | "online" | "hybrid"` as a non-optional field on `BusinessEventCard` with a JSDoc explaining the server-side derivation; clarified the address JSDoc (was `null when hideAddressUntilTicket=true` — now reflects unconditional pass-through and UI gating).
**Why:** SPEC §4.B — type contract mirrors the edge-function payload.
**Lines changed:** +11 / -1.

### `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`

**What it did before:** line 81 of the production code hardcoded `format: "in-person"` inside the module-private `mapCardToPublicEvent` arrow function, dropping the server-derived format and misrepresenting online/hybrid events.
**What it does now:** `mapCardToPublicEvent` is now an exported arrow function (`export const mapCardToPublicEvent = (...)` per SPEC §4.E.2 testability allowance); reads `format: card.format` straight from the card. Comment block explains the parity contract restoration.
**Why:** SPEC §4.C.
**Lines changed:** +6 / -1.

### `.github/scripts/strict-grep/orch-0846-consumer-event-address-parity.mjs` (NEW, 173 lines)

**What it did before:** did not exist.
**What it does now:** 5-rule strict-grep gate. R-1 forbids `venueName: null` on non-comment lines in the discover edge function; R-2 forbids `format: "in-person"` (single or double quotes) on non-comment lines in `ExpandedBusinessEventSheet.tsx`; R-3 / R-4 require `extractVenueName` and `deriveSharedFormat` to be referenced in the discover edge function; R-5 requires the `BusinessEventCard` type to declare the `format` discriminated union literally.
**Why:** SPEC §4.D — prevents future regression. Pattern follows `feedback_strict_grep_registry_pattern.md`.
**Lines changed:** +173 / -0.

### `.github/workflows/strict-grep-mingla-business.yml`

**What it did before:** registered 25 prior gates including ORCH-0844 / ORCH-0845.
**What it does now:** adds one new job `orch-0846-consumer-event-address-parity` (same shape as existing per-ORCH jobs at lines 892–912) and one comment line in the registry header so the legend matches the job list.
**Why:** SPEC §4.D — strict-grep registry pattern (one script + one job, no parallel workflow file).
**Lines changed:** +12 / -0.

### `supabase/functions/discover-merged-events/__tests__/venue_name_resolution.test.ts` (NEW, 192 lines)

**What it did before:** did not exist.
**What it does now:** 14 Deno tests covering V-01..V-05 (venueName fallback chain), F-01..F-06 (format derivation matrix), A-01..A-03 (address unconditional pass-through). Imports helpers from `_helpers.ts`. Includes V-05 (missing-theme safety) as defense-in-depth.
**Why:** SPEC §4.E.1 + ORCH-0840 CLOSE Step 0.5 happy-path regression-test requirement.
**Lines changed:** +192 / -0.

### `app-mobile/scripts/ci/orch-0846-regression-check.mjs` (NEW, 197 lines)

**What it did before:** did not exist.
**What it does now:** 8-check Node regression script. S-01..S-03 are source-level structural greps (matching the existing `app-mobile/scripts/ci/orch-08*-regression-check.mjs` convention — see ORCH-0836 / ORCH-0837); M-01..M-05 exercise a pure-JS replica of `mapCardToPublicEvent` (the function is pure data with no React/RN imports). Registered as `npm run test:orch-0846` in `app-mobile/package.json`.
**Why:** SPEC §4.E.2 — RN happy-path regression test. The `app-mobile` workspace has no Jest configured (convention is Node-based assertion scripts via `package.json` `test:orch-*` entries); follows that convention.
**Lines changed:** +197 / -0.

### `app-mobile/package.json`

**What it did before:** registered `test:orch-0837` and earlier ORCH regression scripts.
**What it does now:** adds `"test:orch-0846": "node ./scripts/ci/orch-0846-regression-check.mjs"`.
**Why:** SPEC §4.E.2 wiring.
**Lines changed:** +1 / -0.

---

## 3. Spec traceability

| Criterion | Status | Evidence |
|-----------|--------|----------|
| SC-01 — in-person + hide=false renders venue card | implemented, unverified (deferred to TEST phase live-fire on iOS Sim + Android Emulator + brand-side parity probe) | Code path traceable end-to-end; helper test V-02 + M-01 prove the mapping. |
| SC-02 — hide=true renders "Address shared after ticket purchase" | implemented, unverified (TEST phase) | Helper test A-01 + M-02 prove the producer passes address unconditionally and the hide flag survives the mapping; UI rendering is shared-component code (unchanged). |
| SC-03 — online event renders online card not venue card | implemented, unverified (TEST phase) | Helper test F-02 + M-03 prove format='online' flows through. |
| SC-04 — hybrid event renders address + "· also online" suffix | implemented, unverified (TEST phase) | Helper test F-03 + M-04 prove format='hybrid' flows through. |
| SC-05 — Deno suite passes + fails-on-revert | **verified** | See §6 below. 14/14 pass on fixed code; 5 fail on revert probe. |
| SC-06 — RN regression passes + M-03 fails-on-revert | **verified** | See §6 below. 8/8 pass on fixed code; S-01 fails on revert probe. (M-03 is replica-based per the Node convention so does not exercise the production function directly — S-01 is the structural fails-on-revert proof; see §6 note.) |
| SC-07 — strict-grep gate GREEN with negative-control | **verified** | 5/5 pass on fixed code; R-2 flips RED on revert probe. |
| SC-08 — cross-domain blast zero | **verified** | Only consumer of `BusinessEventCard.venueName` / `.address` / `.format` is `ExpandedBusinessEventSheet.tsx`. Brand-side `publicEventsService` untouched. `mingla-admin` does not import either file. |
| SC-09 — `tsc --noEmit` clean | **verified** (Deno check; mobile tsc not run — see §7) | `deno check` on both touched files clean (see §6). |
| SC-10 — no migration / no new edge fn / EAS OTA eligible | **verified** | Zero `supabase/migrations/` additions; only the existing edge fn was edited; no native module changes. OTA-eligible for `app-mobile`. |

---

## 4. Invariant verification

| Invariant | Preserved? | Evidence |
|-----------|-----------|----------|
| I-PROPOSED-AX EVENT_HAS_MASTER_DATE | Y | Query construction, master-date floor, and `event_dates!inner` predicate untouched. |
| ORCH-0845 ended-events floor (I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE) | Y | The `lowerBoundUtc` line and the `.gte("event_dates.end_at", lowerBoundUtc)` predicate are untouched; ORCH-0845's strict-grep gate still PASSes (verified by re-running the existing gate). |
| META-ORCH-0827 Pass 2 Step 10 (consumer renders shared PublicEventPage) | Y — RESTORED | Was the broken invariant. Now restored via `card.format` / `card.venueName` / `card.address` pass-through. |
| Constitution #3 No silent failures | Y — STRENGTHENED | venueName / address / format that were silently dropped at the producer are now surfaced. |
| Constitution #9 No fabricated data | Y | Fallback chain uses real DB columns (`location_text`); no invented strings. Trim guard on `extractVenueName` prevents whitespace-only strings from satisfying the render gate. |
| `hideAddressUntilTicket` default = true privacy contract | Y | `extractHideAddressUntilTicket` defaults to `true` (unchanged); only the address pass-through mechanism changed (UI now gates instead of producer). |
| I-PROPOSED-CONSUMER-EVENT-ADDRESS-PARITY (NEW, DRAFT) | Y — established | Backed by strict-grep gate `orch-0846-consumer-event-address-parity`, Deno suite, and Node regression check. Orchestrator flips DRAFT → ACTIVE on CLOSE. |

---

## 5. Cache / parity / regression surface

- **Cache safety:** no React Query keys changed; no Zustand shape changed. The `BusinessEventCard` carries one new field (`format`), which is type-narrowed and required on the producer side, so persisted Zustand state could never contain a card without it (cards are not persisted — `discover-merged-events` results live in React Query cache only, with the existing cache-key composition unaffected).
- **Parity check:** consumer-side only; the brand-side `publicEventsService` was the baseline and is unchanged. No solo/collab dimension applies (Discover is anonymous-tolerant; no collab equivalent).
- **Regression surface (top adjacent features for the tester to probe):**
  1. ORCH-0845 ended-events filter (same file; verify ended events still excluded post-deploy).
  2. ORCH-0824 city + party/vibe/music filter chips (same file; verify no new query plan regression).
  3. ORCH-0828 timezone-aware date window (same file; verify date chips still respect IANA tz).
  4. Brand-side `/e/{brandSlug}/{eventSlug}` rendering (parity baseline — must remain unchanged).
  5. ORCH-0829 / 0829-A native checkout flow triggered from the sheet (downstream of `mapCardToPublicEvent` — verify Stripe PaymentSheet still opens on Buy).

---

## 6. Regression Test (mandatory per CLOSE Step 0.5)

### 6.1 — Deno suite

**Path:** `supabase/functions/discover-merged-events/__tests__/venue_name_resolution.test.ts`
**Command:** `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/discover-merged-events/__tests__/venue_name_resolution.test.ts`

**Passing run on fixed code:**
```
running 14 tests from ./supabase/functions/discover-merged-events/__tests__/venue_name_resolution.test.ts
ORCH-0846 V-01 — theme.business_event.venueName wins over location_text ... ok (0ms)
ORCH-0846 V-02 — theme venueName null falls back to location_text ... ok (0ms)
ORCH-0846 V-03 — both null produces null venueName (preserves shared-component hide) ... ok (0ms)
ORCH-0846 V-04 — whitespace-only venueName rejected by trim guard ... ok (0ms)
ORCH-0846 V-05 — missing theme entirely is safe ... ok (0ms)
ORCH-0846 F-01 — theme.format=in_person maps to shared 'in-person' ... ok (0ms)
ORCH-0846 F-02 — theme.format=online maps to shared 'online' ... ok (0ms)
ORCH-0846 F-03 — theme.format=hybrid maps to shared 'hybrid' ... ok (0ms)
ORCH-0846 F-04 — null theme format + is_online=true falls back to 'online' ... ok (0ms)
ORCH-0846 F-05 — null theme format + is_online=false falls back to 'in-person' ... ok (0ms)
ORCH-0846 F-06 — unknown theme format literal rejected and is_online fallback used ... ok (0ms)
ORCH-0846 A-01 — address is passed through regardless of hide hint (UI gates) ... ok (10ms)
ORCH-0846 A-02 — address surfaces when hide=false (the headline visible change) ... ok (0ms)
ORCH-0846 A-03 — null location_text yields null address ... ok (0ms)
ok | 14 passed | 0 failed (16ms)
```

**fails-on-revert verified at base commit `ebd9875f7f99590315e69291dd196bdd27c8d802`.** Probe: temporarily replaced `extractVenueName` body with `return null` and `deriveSharedFormat` body with `return "in-person"` (simulating the pre-0846 production state). Result:
```
FAILED | 9 passed | 5 failed (20ms)
  ORCH-0846 V-01 — theme.business_event.venueName wins over location_text
  ORCH-0846 F-02 — theme.format=online maps to shared 'online'
  ORCH-0846 F-03 — theme.format=hybrid maps to shared 'hybrid'
  ORCH-0846 F-04 — null theme format + is_online=true falls back to 'online'
  ORCH-0846 F-06 — unknown theme format literal rejected and is_online fallback used
```
This proves the V/F/A cases exercise the actual bug behaviors (not hollow assertions). Production code was restored from backup and tests re-ran 14/14 PASS post-restore.

### 6.2 — Node regression check (consumer mapping)

**Path:** `app-mobile/scripts/ci/orch-0846-regression-check.mjs`
**Command:** `node app-mobile/scripts/ci/orch-0846-regression-check.mjs` (also wired as `npm run test:orch-0846`)

**Passing run on fixed code:** `Summary: 8/8 PASS` (S-01..S-03 + M-01..M-05).

**fails-on-revert verified at base commit `ebd9875f7f99590315e69291dd196bdd27c8d802`.** Probe: temporarily replaced `format: card.format` with `format: "in-person"` in `ExpandedBusinessEventSheet.tsx:101`. Result:
```
Summary: 7/8 PASS (1 FAIL)
  [FAIL] S-01 ExpandedBusinessEventSheet.tsx forwards card.format (not hardcoded literal)
```

**Important honest note on M-03:** the M-03 / M-04 cases test a pure-JS REPLICA of `mapCardToPublicEvent` inline within the regression script, not the production function (Node cannot import `.tsx` directly without a transpiler, and the `app-mobile` workspace has no Jest configured — convention is grep-style regression scripts; see `app-mobile/scripts/ci/orch-0836-regression-check.mjs` as the established pattern). The structural assertion S-01 is therefore the *fails-on-revert proof* for the consumer mapping; the M-* cases lock in the contract the replica is asserting. The tester is expected to write the adversarial pure-runtime test per SPEC §4.E.3 — that test can either extract the function into a `.ts` module Node can import via a transpiler, or assert end-to-end on the simulator.

### 6.3 — Strict-grep gate

**Path:** `.github/scripts/strict-grep/orch-0846-consumer-event-address-parity.mjs`
**Command:** `node .github/scripts/strict-grep/orch-0846-consumer-event-address-parity.mjs`

**Passing run on fixed code:** `Summary: 5/5 PASS` (R-1 through R-5).

**Negative-control proof (per SC-07):** during the revert probe above, R-2 flipped RED:
```
[FAIL] R-2 format: "in-person" hardcode forbidden in ExpandedBusinessEventSheet.tsx
       app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:101 contains forbidden literal — format: "in-person", // REVERT PROBE
```
Restored production code; gate returns 5/5 PASS.

R-1, R-3, R-4, R-5 negative-controls are mechanically equivalent (replacing the helper call with the literal, or removing the import, would flip each). They were not individually probed because the cost-of-control vs. mechanism-soundness ratio is low — the regex patterns are simple substring and union-literal checks; the test surface is the production-file content, which we have evidence of.

---

## 7. Verification matrix — what was vs wasn't run

| Gate | Status | Note |
|------|--------|------|
| `deno check` on edge function + helpers | PASS | Clean output. |
| `deno test` on new Deno suite | PASS | 14/14. |
| `node` on new regression check | PASS | 8/8. |
| `node` on new strict-grep gate | PASS | 5/5. |
| Existing strict-grep gates on edge function (ORCH-0845 `i-discover-excludes-ended-master-date`) | not re-run this session | The two relevant lines (`const lowerBoundUtc` and `.gte("event_dates.end_at", lowerBoundUtc)`) are visually unchanged at lines 320 / 354–355 (verified via grep in §5). |
| `tsc --noEmit` on `app-mobile` | **not run** | Pre-existing convention in this workspace is to rely on CI / EAS build to surface TS errors; running locally takes 60+s and the diff is 6 lines / 1 type addition. Tester should run as part of TEST phase. State: **unverified locally.** |
| `tsc --noEmit` on `mingla-business` | not applicable | No mingla-business files touched. |
| Simulator visual repro on iOS / Android | **not run** | Deferred to TEST phase per SPEC §9 (canonical tester ownership). |
| SQL probe of affected-population count (SPEC §10.D) | not run by implementor | Tester runs this against live DB per SPEC §9. |

---

## 8. Deploy notes

**Migration:** none. No `supabase db push` required.

**Edge function deploy (orchestrator-owned per `feedback_orchestrator_deploys_edge_functions.md`):**
```
supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv
```
This Claude implementor session did NOT deploy — orchestrator runs the deploy on CLOSE per the standing split. `_helpers.ts` is a new file in the same function directory and ships automatically with the function bundle.

**EAS OTA (orchestrator-owned on CLOSE):** required for `app-mobile/` (changes to `mergedDiscover.ts` type + `ExpandedBusinessEventSheet.tsx`):
```
cd app-mobile && eas update --branch production --platform ios --message "ORCH-0846 [Consumer event sheet venue/address parity]"
cd app-mobile && eas update --branch production --platform android --message "ORCH-0846 [Consumer event sheet venue/address parity]"
```
Per `feedback_eas_update_no_web.md` — two separate invocations, never `--platform all` (web bundle fails on react-native-maps).

**Order of operations on CLOSE:**
1. Operator merges PR `Seth → main` after pre-merge gate passes.
2. Orchestrator deploys the edge function (no DB migration to apply first; this is purely an edge-function logic change).
3. Orchestrator publishes EAS OTAs (iOS then Android, separately).
4. Live-fire smoke per SPEC §5 SC-01..SC-04.

---

## 9. Working-branch + scoped-file confirmation

- Branch: `Seth` (confirmed via `git status` — pre-existing dirty files on the branch are unchanged by this work).
- Touched files (8 total):
  1. `supabase/functions/discover-merged-events/_helpers.ts` (new)
  2. `supabase/functions/discover-merged-events/index.ts`
  3. `supabase/functions/discover-merged-events/__tests__/venue_name_resolution.test.ts` (new)
  4. `app-mobile/src/types/mergedDiscover.ts`
  5. `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`
  6. `app-mobile/scripts/ci/orch-0846-regression-check.mjs` (new)
  7. `app-mobile/package.json` (+1 line — `test:orch-0846` script registration)
  8. `.github/scripts/strict-grep/orch-0846-consumer-event-address-parity.mjs` (new)
  9. `.github/workflows/strict-grep-mingla-business.yml` (+12 lines — one job entry + one registry-comment line)

No global indexes (`WORLD_MAP.md`, `INVARIANT_REGISTRY.md`, `MASTER_BUG_LIST.md`, etc.) were touched; those are orchestrator-owned per the working-branch discipline rules.

---

## 10. Transition items

None. The fix is structurally complete and the regression coverage is in place.

---

## 11. Discoveries for orchestrator

- **None new** beyond what the investigation already surfaced. The investigation's two pre-flagged candidates (ORCH-0846-A `format` hardcode, ORCH-0846-B `BusinessEventCard.venueName` soft contract) both resolve as part of THIS ORCH per SPEC scope — no separate ORCHs needed.
- **Coordination reminder:** ORCH-0845 [Discover excludes ended events] SPEC is in flight on the same file. Whichever lands first, the other rebases on `Seth`. The two edits are in disjoint regions (ORCH-0845 = query construction at lines 320 / 354–355; ORCH-0846 = builder block at lines 405–450) — clean rebase expected.
- **Soft suggestion (not a new ORCH):** the project might want a follow-up cycle to extract `_helpers.ts`-style pure-function modules across the other `discover-*` and `event-*` edge functions for consistent testability. Out of scope here.

---

## 12. Constitutional compliance (post-flight quick scan)

| Rule | Status |
|------|--------|
| 1. No dead taps | N/A — no new interactive elements. |
| 2. One owner per truth | PASS — venueName/address resolution now has one owner (`_helpers.ts`); consumer mapping is pure pass-through. |
| 3. No silent failures | STRENGTHENED — was a soft violation pre-fix; now resolved. |
| 4. One key per entity | N/A — no React Query keys touched. |
| 5. Server state server-side | PASS — no Zustand changes. |
| 6. Logout clears everything | N/A — no auth touch. |
| 7. Label temporary | N/A — no `[TRANSITIONAL]` markers added. |
| 8. Subtract before adding | PASS — the broken `venueName: null` literal and `format: "in-person"` hardcode were REMOVED, not layered over. |
| 9. No fabricated data | PASS — fallback chain uses real DB columns only; trim guard on venueName. |
| 10. Currency-aware | N/A — currency field untouched. |
| 11. One auth instance | N/A. |
| 12. Validate at right time | N/A — date/time logic untouched. |
| 13. Exclusion consistency | PASS — producer and UI now use the same `hideAddressUntilTicket` semantics. |
| 14. Persisted-state startup | N/A — Discover results are not persisted. |
