# Implementation Report: Chat-Mounted Card Parity (ORCH-0910)

> Date: 2026-05-22
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0910_CHAT_MOUNTED_CARD_PARITY.md`
> Status: implemented, partially verified

## 1. Layman Summary

Chat-shared intent cards now carry the same render-critical data as deck-mounted cards: a real top-level image, `cardType: curated`, trimmed stops, and total metadata. Chat bubbles render intent cards with the first stop photo plus an `N stops` chip, and the expanded sheet can reach the curated modal branch. Chat-mounted single cards now use top-level `placeId` for busyness and compute viewer-relative travel time from the opener's GPS instead of shipping sender-relative distance.

## 2. Request And Context

- **Request:** Implement ORCH-0910 per the spec and investigation, staying inside the five TS files, one migration, one strict-grep script, one regression script, and this report.
- **Source:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0910_INTENT_CARD_RENDER_BROKEN.md`, including §12 rescope addendum.
- **Affected surfaces:** Consumer iOS and Consumer Android chat bubbles + expanded card sheet.
- **Related artifacts:** `Mingla_Artifacts/specs/SPEC_ORCH-0910_CHAT_MOUNTED_CARD_PARITY.md`.

## 3. Scope

- **In scope:** `CardPayload` curated widening, trim/drop order, collab save image synthesis, adapter pass-through, modal busyness/travel recompute, bubble intent layout, data backfill migration, ORCH-0910 static gates.
- **Out of scope:** Supabase apply, edge deploys, business/admin/web changes, workflow/package registration edits, ORCH-0908/0909 unrelated dirty artifacts.
- **Assumptions:** Curated stops generally carry at least one honest `imageUrl`; when none exists, the migration sets `cardType` but does not fabricate an image.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0910_CHAT_MOUNTED_CARD_PARITY.md` | Contract | Defines 16 success criteria and exact file scope. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0910_INTENT_CARD_RENDER_BROKEN.md` | Root cause | Proves 4 root causes plus 2 contributing factors. |
| `app-mobile/src/services/messagingService.ts` | Writer | `trimCardPayload` was single-card only. |
| `app-mobile/src/components/helpers/collabSaveCard.ts` | Collab lock-in source | Curated `card_data` had stops but no top-level image/images. |
| `app-mobile/src/services/cardPayloadAdapter.ts` | Chat-to-modal adapter | Adapter intentionally stripped `cardType` and `stops`. |
| `app-mobile/src/components/ExpandedCardModal.tsx` | Modal parity | Busyness read `source.placeId`; travel stayed null for chat mounts. |
| `app-mobile/src/components/chat/MessageBubble.tsx` | Bubble parity | Card branch had no intent layout. |
| `supabase/migrations/20260630000000_orch_0908_card_payload_flatten.sql` | Migration precedent | ORCH-0908 row-count/backfill discipline. |

## 5. Blast Radius

- **Direct changes:** Five consumer mobile TS files, one SQL data migration, one strict-grep script, one regression script.
- **Cascade changes:** Direct share and collab lock-in both benefit because both route through the shared payload writers.
- **Parity surfaces:** Shared React Native path covers iOS and Android; simulator visual QA remains tester-owned.
- **Cache impact:** None. No React Query key or invalidation changes.
- **State boundaries:** New modal state is local-only (`viewerTravelTime`, `viewerDistance`) and reset on close.
- **Auth/RLS/security:** Migration updates existing jsonb data only; no policy or schema changes.
- **Deploy path:** Operator applies migration with `supabase db push --linked`; no edge function deploy.

## 6. Old To New Receipts

### `app-mobile/src/services/messagingService.ts`

- **Before:** `CardPayload` had no curated fields; `trimCardPayload` only read top-level `card.image`; size guard did not know about stops.
- **After:** Added `cardType`, `stops`, tagline/totals/duration, `TrimmedCuratedStop`, curated image synthesis from first valid stop image, stop trimming, and curated drop order.
- **Why:** Fixes RC #1 and the type contributing factor while preserving the 5KB budget.
- **Approx lines changed:** +92 / -1.

### `app-mobile/src/components/helpers/collabSaveCard.ts`

- **Before:** Curated collab `card_data` carried stops but left `image`/`images` undefined.
- **After:** Curated branch derives top-level `image` and up to six `images` from stop image URLs.
- **Why:** Fixes RC #2 for lock-in generated chat messages.
- **Approx lines changed:** +7.

### `app-mobile/src/services/cardPayloadAdapter.ts`

- **Before:** Header documented `cardType` stripped; return object omitted curated fields.
- **After:** Header and return object pass `cardType`, `stops`, tagline, totals, and duration through.
- **Why:** Fixes RC #3 so chat-mounted intent cards reach `isCuratedCard`.
- **Approx lines changed:** +14 / -2.

### `app-mobile/src/components/ExpandedCardModal.tsx`

- **Before:** Busyness used only `source.placeId`; chat travel/distance rendered null.
- **After:** Busyness reads `card.placeId ?? source.placeId`; modal computes viewer-relative haversine travel/distance when chat-mounted and prefers those values in card info, busyness, and timelines.
- **Why:** Fixes RC #4 and the travel-time contributing factor without persisting recipient-relative data.
- **Approx lines changed:** +62 / -11.

### `app-mobile/src/components/chat/MessageBubble.tsx`

- **Before:** Bubble rendered `cp.image` or bookmark placeholder only.
- **After:** Bubble detects curated payloads, uses first stop image, and overlays an `N stops` chip while preserving the locked-in banner.
- **Why:** Fixes the intent-card bubble contributing factor.
- **Approx lines changed:** +58 / -17.

### `supabase/migrations/20260722000000_orch_0910_chat_intent_card_backfill.sql`

- **Before:** Legacy rows with stops could lack top-level `image` and/or `cardType`.
- **After:** Idempotent backfill updates `messages.card_payload` and `board_saved_cards.card_data`, sets first valid stop image when needed, sets `cardType: curated`, asserts row counts, and notifies PostgREST reload.
- **Why:** Covers historical rows after writer fixes.
- **Approx lines changed:** new file, 116 lines.

### `.github/scripts/strict-grep/orch-0910-chat-payload-curated-aware.mjs`

- **Before:** No invariant gate for curated-aware chat payloads.
- **After:** Static gate enforces writer, adapter, modal, bubble, and migration anchors.
- **Why:** Locks the proposed curated-aware chat payload invariant.
- **Approx lines changed:** new file, 156 lines.

### `app-mobile/scripts/ci/orch-0910-regression-check.mjs`

- **Before:** No ORCH-0910 happy-path regression gate.
- **After:** Repo-running checks cover T-01 / T-06 / T-07 / T-09 / T-11 / T-14 / T-16 / T-17 with simulated revert mode.
- **Why:** Satisfies ORCH-0840 Step 0.5 for implementor-owned tests.
- **Approx lines changed:** new file, 190 lines.

## 7. Implementation Details

- **Architecture decisions:** Kept `card_payload` as the single chat render source. No new fetch authority or persisted recipient-relative travel field was introduced.
- **Data flow:** Writers now emit curated top-level image + stops; adapter passes through; bubble and modal consume the same payload.
- **State handling:** Viewer travel values are local modal state and reset on close/no GPS/non-chat mount.
- **Error handling:** Existing weather/busyness/booking try/catch paths preserved; travel recompute falls back to null when GPS or coordinates are absent.
- **Copy/accessibility:** Existing locked-in copy unchanged; new bubble chip is short render text only.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| SC-1 / T-01 curated trim | Yes | `orch-0910-regression-check.mjs` PASS | Verified |
| SC-2 size guard | Yes | strict-grep PASS; tester adversarial T-20 remains | Partially verified |
| SC-3 / T-06 collab image synthesis | Yes | regression PASS | Verified |
| SC-4 / T-07 adapter pass-through | Yes | regression PASS | Verified |
| SC-5/6 bubble visual | Yes | structural regression PASS; sim visual tester-owned | Partially verified |
| SC-7 curated modal branch | Yes | adapter pass-through + modal existing branch; tester visual-owned | Partially verified |
| SC-8 / T-09 busyness placeId | Yes | regression PASS | Verified |
| SC-9 / T-11 viewer travel | Yes | regression PASS | Verified |
| SC-10 no GPS honest absence | Yes | code path resets null; tester T-21 remains | Partially verified |
| SC-11 booking/opening hours preserved | Yes | adapter fields unchanged; tester visual-owned | Partially verified |
| SC-12/13 / T-16/T-17 migration | Yes | migration structural + seeded JS simulation PASS | Verified locally; DB apply pending |
| SC-14/15 single-card no regression | Yes | no single payload removal; simulator tester-owned | Partially verified |
| SC-16 solo/collab parity | Yes | shared `trimCardPayload` path preserved | Partially verified |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| One owner per truth | Yes | Yes | `card_payload` / `card_data` remain canonical. |
| No silent failures | Yes | Improved | Broken placeholder path replaced when data exists; honest null remains when unavailable. |
| No fabricated data | Yes | Yes | Images are from stops; travel is viewer GPS + local formula; no sender distance is persisted. |
| 5KB CardPayload budget | Yes | Yes | Curated drop order prunes soft fields/stops. |
| ORCH-0908 backfill discipline | Yes | Yes | New migration uses precount + `GET DIAGNOSTICS` + `RAISE EXCEPTION`. |
| No edge deploy | Yes | Yes | No edge functions touched. |

## 10. Parity Check

- **Mobile:** Shared RN implementation covers iOS and Android. Visual simulator parity is next tester gate.
- **Business app:** Not touched.
- **Admin:** Not touched.
- **Public/web:** Not touched.
- **Solo/collab:** Direct share uses `trimCardPayload`; collab lock-in uses `buildCardDataPayload` plus migration/RPC spread.
- **Gaps:** No iOS/Android sim screenshots were produced by implementor; tester owns mandatory simulator QA.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** `CardPayload` adds optional curated fields; migration backfills jsonb payloads.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Existing old rows render better after migration; old app versions should ignore unknown jsonb fields.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| ORCH-0910 regression | `node app-mobile/scripts/ci/orch-0910-regression-check.mjs` | PASS | T-01/T-06/T-07/T-09/T-11/T-14/T-16/T-17 all PASS. |
| Fails-on-revert | `ORCH0910_SIMULATE_REVERT=1 node app-mobile/scripts/ci/orch-0910-regression-check.mjs; test $? -eq 1` | PASS | All 8 tests fail in simulated revert mode at HEAD `1ec1c52e`. |
| Strict grep | `node .github/scripts/strict-grep/orch-0910-chat-payload-curated-aware.mjs` | PASS | 8/8 invariant checks. |
| Scoped lint | `npx eslint src/services/messagingService.ts src/components/helpers/collabSaveCard.ts src/services/cardPayloadAdapter.ts src/components/ExpandedCardModal.tsx src/components/chat/MessageBubble.tsx` | PASS with warnings | 0 errors; existing warnings in large files remain. |
| Typecheck | `npx tsc --noEmit` from `app-mobile` | FAIL unrelated/pre-existing | Errors in unscoped files such as untracked board/session ORCH-0908 files, `BoardDiscussion.tsx`, `ConnectionsPage.tsx`, and shared packages; no ORCH-0910 file errors surfaced in the output. |
| Migration ordering | `ls -1 supabase/migrations | tail -10`; `git ls-tree origin/main supabase/migrations/ | tail -10` | PASS | New `20260722000000...` is greater than local/origin max `20260710000000...`. |
| Supabase schema read | `mcp__supabase__.list_tables({ schemas:["public"], verbose:true })` | Completed | Verified schema introspection available; no mutating DB command run. |
| Diagnostic reap | `rg -n` for the bracketed ORCH-0910 diagnostic token in `app-mobile supabase .github` | PASS | Zero implementation-code matches. Repo-wide exact search still finds the original investigation artifact's suggested debug instructions, so I did not claim/edit evidence artifact zero. |

### Fails-On-Revert Receipts

| Test | Receipt |
|---|---|
| T-01 | fails-on-revert verified at `1ec1c52e` via simulated revert mode. |
| T-06 | fails-on-revert verified at `1ec1c52e` via simulated revert mode. |
| T-07 | fails-on-revert verified at `1ec1c52e` via simulated revert mode. |
| T-09 | fails-on-revert verified at `1ec1c52e` via simulated revert mode. |
| T-11 | fails-on-revert verified at `1ec1c52e` via simulated revert mode. |
| T-14 | fails-on-revert verified at `1ec1c52e` via simulated revert mode. |
| T-16 | fails-on-revert verified at `1ec1c52e` via simulated revert mode. |
| T-17 | fails-on-revert verified at `1ec1c52e` via simulated revert mode. |

## 13. Regression Surface

1. Chat card payload size: curated stops can pressure the 5KB budget.
2. Expanded modal async fetch: travel recompute depends on user location query resolving.
3. Legacy rows: migration apply is operator-owned and pending.
4. Bubble visual: small chip overlay needs iOS/Android simulator visual confirmation.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Migration not applied yet | Existing production rows remain partially broken until operator applies | Operator runs `supabase db push --linked` | `supabase/migrations/20260722000000_orch_0910_chat_intent_card_backfill.sql` |
| Typecheck red | Full repo typecheck is blocked by unrelated existing files | Separate owner resolves those errors | Verification only |
| Visual parity unverified | Structural checks cannot prove layout on device | Tester runs iOS + Android sim parity | QA phase |
| Supabase advisory | MCP reported RLS disabled on backup/archive/spatial tables | Operator/security review decides policy/remediation | Supabase MCP advisory |

## 15. Discoveries For Orchestrator

- Supabase MCP returned a critical advisory: RLS is disabled on several backup/archive/spatial tables (`_backup_*`, `used_trial_phones`, `seed_map_presence`, `_archive_*`, `spatial_ref_sys`). I did not remediate because ORCH-0910 scope is chat payload parity and enabling RLS without policies can break access.
- Exact repo-wide diagnostic grep cannot be truthfully reported as zero while the investigation artifact itself contains the token in suggested debug snippets. Implementation paths are clean.

## 16. Deploy Notes

- **Migrations:** Operator-owned `supabase db push --linked` required. Do not run from implementor.
- **Edge functions:** None touched; no deploy.
- **Mobile OTA/native:** JS changes are OTA-eligible after QA, no native dependency changes.
- **Business/admin web:** No deploy needed.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
mobile: restore chat-mounted card parity

Resolves: ORCH-0910
Evidence: app-mobile/scripts/ci/orch-0910-regression-check.mjs; .github/scripts/strict-grep/orch-0910-chat-payload-curated-aware.mjs
Deploy: operator applies supabase/migrations/20260722000000_orch_0910_chat_intent_card_backfill.sql
```

## Ready-To-Test Checklist

1. Apply the migration with `supabase db push --linked`.
2. On iOS simulator, share an intent card directly and verify first-stop photo + stops chip, then expanded curated sheet.
3. On Android simulator, repeat the same direct-share path.
4. On iOS and Android, lock in an intent card and verify locked banner unchanged plus first-stop photo + stops chip.
5. Open chat-mounted single cards with GPS granted and verify busyness plus viewer-relative travel.
6. Open chat-mounted cards with GPS denied and verify no fabricated travel row.

## 17. RETEST 1 REWORK — TrimmedCuratedStop Field Gap

> Date: 2026-05-22
> Mode: RETEST 1 rework
> Dispatch: `Mingla_Artifacts/prompts/REWORK_ORCH-0910_TRIMMED_CURATED_STOP_FIELD_GAP.md`
> Status: implemented and verified

### 17.1 Root Cause Receipt

Operator live-fire iOS smoke failed at QA §6 step 1 with `TypeError: Cannot read property 'replace' of undefined` in `app-mobile/src/utils/curatedToTimeline.ts`. The prior implementation matched the original spec, but the spec's `TrimmedCuratedStop` dropped four fields the existing curated modal render chain reads: `stopLabel`, `placeType`, `aiDescription`, and `travelModeFromPreviousStop`.

### 17.2 Old To New Receipts

| File | Before | After |
|---|---|---|
| `app-mobile/src/services/messagingService.ts` | `TrimmedCuratedStop` carried address/travel time only as stop soft fields, so chat-mounted curated stops could enter the modal without `placeType`, `stopLabel`, `aiDescription`, or `travelModeFromPreviousStop`. | `TrimmedCuratedStop` now includes the four modal-read fields, `trimCardPayload` carries them with caps (`placeType` 80, `aiDescription` 300), and the size guard drops them in the amended order before `stops[].address`. |
| `app-mobile/src/utils/curatedToTimeline.ts` | Direct field reads could call `.replace()` on `undefined` and send an ErrorBoundary crash. | Timeline conversion accepts partial curated stops and falls back to `Stop N`, `Unknown stop`, `place`, and empty addresses when trim or legacy data omits fields. |
| `app-mobile/scripts/ci/orch-0910-regression-check.mjs` | 8 implementor checks did not pin the RETEST 1 field contract or worst-case 5-stop payload budget with the new fields. | Added T-25 for the four carried fields plus timeline null-safety, and T-26 for 5KB worst-case 5-stop payload under the amended drop order. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0910_CHAT_MOUNTED_CARD_PARITY.md` | §3.1.1 / §3.1.3 documented the incomplete trimmed stop shape and old stop drop order. | Added RETEST 1 amendment headers, the widened `TrimmedCuratedStop`, stop mapping lines, and new stop-field drop order. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0910_CHAT_MOUNTED_CARD_PARITY.md` | Report ended at §16 from the initial implementation. | Appended this §17 rework receipt and verification evidence. |

Verified no changes were made to `app-mobile/src/components/helpers/collabSaveCard.ts` or `app-mobile/src/services/cardPayloadAdapter.ts`; both already pass full stops through in the relevant paths. No modal, bubble, migration, Supabase, edge function, or LockedPlanBanner work was performed.

### 17.3 Smoke Proof

One-off Node smoke against the actual `curatedStopsToTimeline` export, transpiled from `app-mobile/src/utils/curatedToTimeline.ts`, with every relevant stop field set to `undefined`:

```json
{
  "ok": true,
  "steps": 3,
  "firstTitle": "Stop 1: Unknown stop",
  "firstAddress": "",
  "travelAddress": ""
}
```

### 17.4 Verification

| Check | Command | Result | Receipt |
|---|---|---|---|
| Implementor regression | `node app-mobile/scripts/ci/orch-0910-regression-check.mjs` | PASS | T-01/T-06/T-07/T-09/T-11/T-14/T-16/T-17/T-25/T-26 all PASS. |
| Fails on simulated revert | `ORCH0910_SIMULATE_REVERT=1 node app-mobile/scripts/ci/orch-0910-regression-check.mjs; test $? -eq 1` | PASS | All 10 implementor tests fail in simulated revert mode at HEAD `0428c2f1`. |
| Strict grep | `node .github/scripts/strict-grep/orch-0910-chat-payload-curated-aware.mjs` | PASS | 8/8 invariant checks PASS. |
| Tester adversarial, unchanged | `node app-mobile/scripts/ci/orch-0910-adversarial-check.mjs` | PASS | T-19/T-20/T-21/T-22/T-23/T-24 all PASS. |
| Tester adversarial simulated revert, unchanged | `ORCH0910_SIMULATE_REVERT=1 node app-mobile/scripts/ci/orch-0910-adversarial-check.mjs` | PASS | Script observed expected failures under simulated revert and exited 0 by design. |

### 17.5 Budget Receipt

T-26 exercises a worst-case 5-stop curated payload with max-length new stop soft fields. Under the amended drop order the modeled trimmed payload fits the 5KB ceiling with all five stops preserved after dropping `stops[].aiDescription` and `stops[].placeType`; observed size was 4672 bytes.

### 17.6 Deploy / Routing Notes

No migration change, no `supabase db push`, and no edge function deploy. Downstream remains: Claude `mingla-orchestrator` REVIEW, then operator RETEST 2 live-fire simulator smoke focused on QA §6 steps 1-6 for the intent-card bubble and expanded sheet path that crashed.
