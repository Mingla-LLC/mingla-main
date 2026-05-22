# QA REPORT — ORCH-0910 [Chat-mounted card expanded sheet parity — single + intent, bubble + sheet]

**Tester:** Claude `mingla-tester` (TARGETED)
**Date:** 2026-05-22
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0910_CHAT_MOUNTED_CARD_PARITY.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0910_INTENT_CARD_RENDER_BROKEN.md` (incl. §12 RESCOPE ADDENDUM)
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0910_CHAT_MOUNTED_CARD_PARITY.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**HEAD:** `1ec1c52e`

---

## Verdict

**CONDITIONAL PASS** — pending operator-driven live-fire sim parity smoke (iOS + Android, all 4 bug-matrix cells). All structural / database / code-contract evidence is green; the only gap is the mandatory Phase 0.A sim repro per [[feedback_tester_canonical_and_platform_parity]] which requires booting both iOS sim + Android emu with current dev builds and driving Maestro flows — not feasible from this session without operator participation.

| Severity | Count |
|---|---|
| P0 — CRITICAL | 0 |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 1 (DISC-0910-SEC-1 deferred to ORCH-0911 per implementor flag — out of scope here, not a blocker) |
| P3 — LOW | 0 |
| P4 — NOTE | 3 (clean implementation patterns worth noting — §7) |

Verdict gate compliance:
- **Regression-test gate (ORCH-0840 Step 0.5):** PASS. Implementor happy-path at `app-mobile/scripts/ci/orch-0910-regression-check.mjs` (8 tests T-01/T-06/T-07/T-09/T-11/T-14/T-16/T-17) PASS at HEAD, FAIL all 8 in simulated-revert mode at `1ec1c52e`. Tester adversarial at `app-mobile/scripts/ci/orch-0910-adversarial-check.mjs` (6 tests T-19/T-20/T-21/T-22/T-23/T-24) PASS at HEAD attacking different angles, 3/6 FAIL under simulated-revert proving assertions exercise the fix surface. Both scripts staged under `Seth`.
- **Phase 0.A sim gate:** NOT MET in-session. Deferred to operator smoke (§6).
- **Constitution audit:** 14/14 PASS or N/A (§4).
- **Spec compliance:** 16/16 SCs structurally verified (§3 matrix); SC-5/6/7/11/14/15 await sim visual confirmation.

---

## 1. Implementation report audit

Read every claim in `IMPLEMENTATION_ORCH-0910_*.md`:

| Implementor claim | Tester verification | Verdict |
|---|---|---|
| 5 TS files + 1 SQL + 1 strict-grep + 1 regression script all modified/created in scope | `git status --short` confirms exactly 8 ORCH-0910 paths touched; no out-of-scope mutations | ✅ verified |
| `trimCardPayload` widened with curated detection + image synth + stop trim + new drop order | Diff-read §2.1; matches spec §3.1.2 exactly; field shape matches `TrimmedCuratedStop` defined alongside | ✅ verified |
| `buildCardDataPayload` synthesizes top-level image + images for curated branch | Diff-read §2.2; matches spec §3.2 verbatim | ✅ verified |
| Adapter passes cardType + stops + tagline + totals + duration through | Diff-read §2.3; matches spec §3.3.2; header doc updated correctly | ✅ verified |
| Modal busyness reads `card.placeId ?? source.placeId` | Diff-read §2.4 L1554-1558; one-line fix as spec'd | ✅ verified |
| Modal travel-time recompute via haversine + estimateTravelMinutes from viewer GPS | Diff-read §2.4; effect deps `[visible, card, viewerLoc?.lat, viewerLoc?.lng, effectiveTravelMode]` correctly re-fires on GPS change; `setViewerDistance(null); setViewerTravelTime(null)` reset on close + on non-chat-mount + on no-GPS | ✅ verified |
| MessageBubble intent layout with first-stop photo + `→ N stops` chip | Diff-read §2.5; chip uses `arrow-forward` icon + dark translucent bg; locked-in banner preserved unchanged | ✅ verified |
| Migration uses RAISE EXCEPTION + idempotent WHERE per ORCH-0908 v2 discipline | Migration source read in full; both blocks have GET DIAGNOSTICS + RAISE EXCEPTION on precount>0&&updated=0; WHERE uses `NULLIF(...,'') IS NOT NULL` which is STRONGER than spec (handles empty-string-as-null too) | ✅ verified + improved |
| `fails-on-revert` at `1ec1c52e` for all 8 implementor tests | Re-ran `ORCH0910_SIMULATE_REVERT=1` — confirmed all 8 FAIL in revert mode at HEAD = `1ec1c52e` | ✅ verified |
| DIAG marker reap: zero in product code, 3 in investigation artifact prose | `grep -rn '\[ORCH-0910-DIAG\]'` confirms zero in `app-mobile/src/`, `supabase/functions/`, `mingla-admin/src/`, `mingla-business/src/`; 3 hits in `INVESTIGATION_ORCH-0910_INTENT_CARD_RENDER_BROKEN.md` "Verification step" cells (prose, not injected code) | ✅ verified — implementor's honesty call to leave investigation prose alone is correct per Step 1.5 rule scope |

## 2. Five-truth-layer cross-check (post-migration)

| Layer | Truth | Verdict |
|---|---|---|
| **Docs** | Spec, investigation, implementor report all agree: chat-mounted intent cards must render with first-stop image + stops chip; chat-mounted busyness must use top-level placeId; travel-time must be viewer-relative honest re-compute | ✅ aligned |
| **Schema** | `messages.card_payload jsonb`, `board_saved_cards.card_data jsonb` — verified via `mcp__supabase__execute_sql`. No schema migration needed; only data backfill | ✅ aligned |
| **Code** | All 5 TS diffs match spec; migration matches spec + slightly stronger empty-string handling | ✅ aligned |
| **Runtime** | Sim repro NOT executed this turn — deferred to operator smoke. Code paths structurally proven correct via regression-check + strict-grep + adversarial-check | ⚠️ partial — operator smoke required for PASS |
| **Data** | Live SQL probe on remote post-migration: `messages` 1/1 stops rows now have `image IS NOT NULL AND cardType='curated'`; `board_saved_cards` 4/4 stops rows now have `image IS NOT NULL AND cardType='curated'`. Implementor's NOTICE rows reported "1 updated (precount 1)" on each — consistent with 1 row having been broken on each table; the other 3 board_saved_cards rows already had image set (likely synth via the new buildCardDataPayload code path that ran on local before push, or test data — non-blocking either way) | ✅ aligned |

No layer contradictions. The expected runtime gap (no sim repro) is honest and named.

## 3. Spec compliance — SC matrix

| SC | Coverage path | Verdict |
|---|---|---|
| SC-1 trimCardPayload curated happy | Implementor T-01 PASS @ `1ec1c52e`; diff-read messagingService.ts | ✅ verified |
| SC-2 size guard 5×6 worst case | Implementor T-20 (spec adversarial) covered by tester at `orch-0910-adversarial-check.mjs:T-20` — drop-order structurally verified (stops[].address → stops[].travelTimeFromPreviousStopMin → tail drop loop never touching stops[0]) | ✅ verified structurally; T-20-live worst-case payload not seeded since contract is enforced by code; can be added later |
| SC-3 buildCardDataPayload curated image synth | Implementor T-06 PASS; diff-read | ✅ verified |
| SC-4 adapter cardType+stops pass-through | Implementor T-07 PASS; diff-read | ✅ verified |
| SC-5 bubble intent layout iOS | Implementor T-14 PASS structurally; **awaits operator sim screenshot** | ⚠️ structural ✅, visual deferred |
| SC-5-Android bubble intent layout Android | Same as SC-5; RN-shared code | ⚠️ structural ✅, visual deferred |
| SC-6 locked-in bubble unchanged + intent chip | Diff-read confirms locked-in banner unchanged; intent chip render-conditional on isIntentCard | ⚠️ structural ✅, visual deferred |
| SC-6-Android | Same as SC-6 | ⚠️ structural ✅, visual deferred |
| SC-7 curated modal branch reachable | Adapter pass-through unlocks `isCuratedCard` at ExpandedCardModal.tsx:1707; no modal-side change needed for the branch itself | ⚠️ structural ✅, visual deferred |
| SC-8 busyness placeId fix | Implementor T-09 + tester T-19 both PASS; diff-read ExpandedCardModal.tsx:1554-1558 | ✅ verified |
| SC-9 travel-time viewer-relative | Implementor T-11 + tester T-21 both PASS; diff-read confirms haversine + estimateTravelMinutes + dep array | ⚠️ structural ✅, sim visual deferred |
| SC-10 GPS-denied honest absence | Tester T-21 PASS; diff confirms `setViewerDistance(null); setViewerTravelTime(null);` in all 3 negative branches (close, non-chat-mount, no-GPS); Constitution #9 preserved | ✅ verified |
| SC-11 booking + opening hours render | No adapter regression; same fields plumbed through; visual deferred | ⚠️ structural ✅, visual deferred |
| SC-12 messages backfill | Live SQL probe: 1/1 stops rows have non-null image + cardType='curated' | ✅ verified live |
| SC-13 migration idempotent | Tester T-22 PASS — WHERE clause excludes already-fixed rows (`NULLIF(...,'') IS NOT NULL`); re-running would update 0 rows | ✅ verified |
| SC-14 single card share-in-message no regression | No diff to single-card branches in trim or bubble; tester T-23 confirms truthy-image ternary preserved | ⚠️ structural ✅, visual deferred |
| SC-15 single card locked-in no regression | No diff to locked-in banner; flat payload reads unchanged | ⚠️ structural ✅, visual deferred |
| SC-16 solo/collab parity | Shared `trimCardPayload` path; `buildCardDataPayload` covers collab lock-in only (solo doesn't lock); `sendCardMessage` covers both modes | ✅ verified |

**Summary:** 9/16 fully verified (live SQL probe + structural + adversarial). 7/16 structurally verified, awaiting operator sim visual confirmation (UI-rendering SCs only — code paths proven correct).

## 4. Constitution audit (14 rules)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No new interactive elements (chip is non-interactive; tap remains on whole bubble) |
| 2 | One owner per truth | ✅ PASS | `card_payload` / `card_data` remain canonical; no competing state introduced |
| 3 | No silent failures | ✅ IMPROVED | Bookmark-placeholder fallback replaced by honest first-stop image when available; honest absence (no travel row) when no GPS |
| 4 | One key per entity | N/A | No React Query key changes |
| 5 | Server state server-side | ✅ PASS | viewerTravelTime/viewerDistance are local-only modal state (correct — derived per-modal-open, not persisted) |
| 6 | Logout clears everything | N/A | No persisted state added |
| 7 | Label temporary | N/A | No transitional code |
| 8 | Subtract before adding | ✅ PASS | Implementor extended in place; no parallel competing code |
| 9 | No fabricated data | ✅ PASS — verified by tester T-21 + T-23 | GPS-denied → null both (no fake "0 min"); all-null-imageUrl curated → bookmark placeholder (no fake image URL); sender's travel-time still never persisted |
| 10 | Currency-aware | N/A | No currency handling |
| 11 | One auth instance | N/A | No auth changes |
| 12 | Validate at right time | ✅ PASS | viewerTravelTime computed at modal-open (right time, after GPS hook resolves) |
| 13 | Exclusion consistency | N/A | Not a discover/filter change |
| 14 | Persisted-state startup | N/A | No new persisted state |

Zero violations. Two improvements (#3, #9 strengthened).

## 5. Cross-domain impact verification

- **Mingla-business**: grep'd `mingla-business/` for imports of `CardPayload`, `cardPayloadAdapter`, `MessageBubble`, `trimCardPayload`, `buildCardDataPayload` — zero hits. No regression risk. ✅
- **Mingla-admin**: same grep — zero hits. ✅
- **app-mobile board flow**: `boardMessageService.sendCardMessage` exists as a separate share-card-to-board path (DISC-0910-3). Quick spot-check: it imports from the same `messagingService` module and downstream renders through the same MessageBubble. Auto-fixed by the trim + adapter + bubble work in scope. ✅
- **Edge functions**: zero touched, zero deploys needed. ✅
- **Other consumers of `Recommendation.cardType === 'curated'`**: 14 hits across SwipeableCards, ExpandedCardModal, SavedTab, CalendarTab, SessionViewModal, etc. None read from `CardPayload`-shaped objects; all read from full `Recommendation` shapes. No blast. ✅

## 6. Live-fire sim parity — DEFERRED

Per Phase 0.A NON-NEGOTIABLE: UI/runtime PASS requires `proven`-level live-fire sim repro on every applicable platform (iOS Simulator + Android Emulator). This was not feasible from this session in a single turn — booting both sims, installing current dev builds per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md`, authoring Maestro flows for 4 cells × 2 platforms, and capturing screenshot evidence is multi-hour operator-participatory work.

**Operator smoke list (mandatory before PASS promotion — perform on both iOS sim + Android emu with latest bundle loaded per [[feedback_sim_load_latest_bundle_before_test]]):**

1. **Cell C iOS — intent card shared in message.** Open consumer app → any conversation → share an intent card from the deck. Expected: bubble shows first stop's photo full-width with `→ N stops` chip top-right. NOT empty grey + bookmark.
2. **Cell C Android** — same as 1 on Android emu.
3. **Cell D iOS — intent card locked-in.** Open "Testing stuff" collab → lock in any intent card. Expected: orange "Locked in" banner above, intent bubble below (same layout as cell C). The pre-existing broken row should also now render correctly (data backfilled on remote at 2026-05-22).
4. **Cell D Android** — same as 3.
5. **Intent card expanded sheet iOS** — tap the intent bubble. Expected: full curated modal branch fires — stops list with addresses + per-stop photos + total price range + total duration. NOT "No images available."
6. **Intent card expanded sheet Android** — same as 5.
7. **Cell A iOS — single card shared in message.** Share Pineapple Sol-style single card. Tap to expand. Expected: NO regression on bubble. Expanded sheet now shows busyness section + viewer-relative travel-time row (e.g., "12 min · 8.3 km").
8. **Cell A Android** — same as 7.
9. **Cell B iOS — single card locked-in.** Lock in a single card. Tap to expand. Expected: NO regression on bubble; busyness + travel-time row visible.
10. **Cell B Android** — same as 9. **This was the parity-audit cell B that lacked a fresh screenshot in INVESTIGATE §10 — please capture one this round.**
11. **GPS-denied iOS** — disable Location services for Mingla in iOS Settings; open any chat-mounted card. Expected: NO travel-time row renders (Constitution #9 honest absence — no fake "0 min").
12. **GPS-denied Android** — same as 11.

After steps 1-12 PASS, the verdict promotes from CONDITIONAL PASS to PASS and CLOSE proceeds. If any step FAILS, reply with the failing step number + screenshot and the verdict goes back to FAIL → REWORK.

## 7. P4 — patterns worth replicating

- **Adversarial test attack vector clarity** — implementor's regression-check uses simulated-revert via in-memory `.replace()` patterns rather than git checkout — keeps the check single-file + reproducible. Tester's adversarial check mirrors this idiom but with different replace patterns proving different anchors. Good model for future ORCH gates.
- **Empty-string-as-null defense in migration** — implementor used `NULLIF(...,'') IS NOT NULL` instead of bare `IS NOT NULL`. Catches the easy bug where a row has `image: ""` and would otherwise be skipped by the backfill. Stronger than spec.
- **Adapter narrows cardType to literal** — `cardType = (raw.cardType ?? legacy.cardType) === 'curated' ? 'curated' : undefined`. Defends against malformed payloads that might carry `cardType: 'foo'` and prevents the modal's strict-equality branch from misfiring.

## 8. Discoveries for orchestrator

- **DISC-0910-SEC-1 (reaffirmed, OUT OF SCOPE)** — Supabase advisory: RLS disabled on `_backup_*`, `used_trial_phones`, `seed_map_presence`, `_archive_*`, `spatial_ref_sys`. Implementor's deferral to a separate ORCH-0911 is correct — enabling RLS without policies risks breaking access. Orchestrator should file ORCH-0911 [RLS audit on backup/archive/spatial tables] post-CLOSE.
- **DISC-0910-2 (low, OUT OF SCOPE)** — `mcp__supabase__execute_sql` returned a phantom-migration repair was needed during operator's `supabase db push` (timestamp `20260704000000` — likely from a parallel session). Operator handled it correctly via `supabase migration repair --status reverted 20260704000000`. Not an ORCH-0910 defect; surfaced for awareness.
- **DISC-0910-4 (closed)** — Cell B fresh sim screenshot ask from INVESTIGATE §10 is now part of operator smoke step 10 above.

## 9. Files produced this turn

- `Mingla_Artifacts/reports/QA_ORCH-0910_CHAT_MOUNTED_CARD_PARITY_REPORT.md` (this file)
- `app-mobile/scripts/ci/orch-0910-adversarial-check.mjs` (6 tests T-19/T-20/T-21/T-22/T-23/T-24; PASS at HEAD, FAIL-on-revert on 3/6 angles)

## 10. Next dispatch

After operator completes the 12-step sim smoke (§6), verdict promotes to PASS → Claude `mingla-orchestrator` for CLOSE. If any sim step fails, verdict drops to FAIL → Claude `mingla-implementor` for scoped rework with the failing step cited.

---

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
