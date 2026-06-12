# TEST — ORCH-1123 [Hub multi-select draft delete]

**Mode:** mingla-tester (BRUTAL, assume-broken-until-proven; trust nothing, write own adversarial tests)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1123-[hub-multiselect-draft-delete]` (branch `ORCH-1123-hub-multiselect-draft-delete`)
**Tested commit:** `96a989a3f` (impl `040abb870` renumbered/bumped) + tester test `567eaa8af`
**Date:** 2026-06-12
**Remote DB:** `gqnoajqerqhnvulmnyvv` (Stripe/DB TEST mode), migration `20260928000002` recorded.
**COMMS_LEDGER:** read on entry. COMMS-0024 (WARN, ID-collision renumber) factored — this session correctly carries ORCH-1123. No new cross-ORCH discovery requiring a write.

---

## VERDICT: **CONDITIONAL PASS**

**Condition:** the long-press dead-tap RUNTIME flow (SPEC item #5, constitutional no-dead-tap) is **DEVICE-PENDING — requires Seth.** No mingla-business app session/build was available (the connected Android `R58R54YV7JT` has only the CONSUMER app `com.mingla.app.v2`; the booted iOS sim has no business app; obtaining a business-logged-in session with draft offerings needs Seth's credentials + a build). Per the constitution + my dispatch, source wiring caps at "suspected" — I do NOT claim PASS on the runtime long-press.

**One P2 caught (test brittleness, not a product defect):** ORCH-1123 introduced exactly **one** net-new jest failure — a too-rigid regex in a pre-existing adversarial test broke on a spec-mandated, behavior-strengthening change. Details in §7. Needs `[TEST-MOD-APPROVED]` to update; not a code fix.

**Counts:** P0 = 0 · P1 = 0 · P2 = 1 (test-regex brittleness) · device-pending = 1 (runtime long-press).

Everything that COULD be live-fire-proven WAS, including the full adversarial authz/drafts-only matrix under real per-user JWT impersonation. The deployed RPC is correct and safe.

---

## 1. RPC authz + behavior — LIVE-FIRE (the implementor did NOT cover this)

The deployed RPC requires `auth.uid()` not-null; MCP/superuser has `auth.uid()=NULL`, so true per-user rank testing needs a real auth context. I obtained it WITHOUT a magic-link by impersonating users inside a single transaction via `set_config('request.jwt.claims', json{sub,role}, true)` after seeding throwaway `auth.users` + `creator_accounts` + `brands` + `brand_team_members` + `events`, then **rolled the whole transaction back** (sentinel `RAISE EXCEPTION`). This is stronger than curl: it exercises the exact `auth.uid()` path inside the deployed `SECURITY DEFINER` function.

### Live-fire results (every row under a specific impersonated user)

| Scenario | Caller | Input row | Outcome | Verdict |
|---|---|---|---|---|
| S1 | brand-A owner | A draft (event) | `deleted` | ✓ |
| S1 | brand-A owner | A **LIVE** row (`status='live'`) | `skipped_not_draft` | ✓ drafts-only invariant — **never deleted** |
| S1 | brand-A owner | non-existent id | `skipped_not_found` | ✓ |
| S1 | brand-A owner | **brand-B** draft (cross-brand) | `forbidden` | ✓ owner of A cannot touch B |
| S2 | brand-A **scanner** (rank 10 < event_manager 40) | A draft (trip) | `forbidden` | ✓ sub-`event_manager` blocked |
| S3 | brand-B owner | brand-A draft (cross-brand) | `forbidden` | ✓ |
| S4 | brand-A owner | re-run on already-deleted draft1 | `skipped_not_found` | ✓ idempotent, no double-effect |
| S4 | brand-A owner | a pre-deleted draft | `skipped_not_found` | ✓ |
| S5 | **no JWT** (`auth.uid()=NULL`) | any | RAISE `not_authenticated` | ✓ |

**Ground truth after the batch (read back before rollback):** `draft1_del=true`, `draft2_del=false` (was only attacked by forbidden callers), `live_del=false` + `status=live` (**the live offering was NOT touched**), `brandB_del=false`. The drafts-only + cross-brand invariants hold at the DATA layer, not just the return code.

### anon EXECUTE revoke — proven WITHOUT a user JWT
`has_function_privilege('anon', 'public.business_discard_offering_drafts(uuid[])', 'EXECUTE')` → **false**.
`has_function_privilege('authenticated', …)` → **true**. Live grants: `service_role`, `authenticated`, `postgres` only; **anon absent**. REVOKE holds.

### Deployed body == migration file
`pg_get_functiondef` of the live RPC is byte-identical to `supabase/migrations/20260928000002_orch_1123_batch_discard_offering_drafts.sql` (per-row auth → `status<>'draft'` skip → `biz_brand_effective_rank < biz_role_rank('event_manager')` forbidden → brand-exists → `FOR UPDATE` lock → idempotent soft-delete). `SECURITY DEFINER`, `SET search_path TO 'public','pg_temp'`, `RETURNS TABLE(event_id uuid, outcome text)`. `$function$;` precedes GRANT.

### SAFETY — test data created/removed (full disclosure)
All seed rows (3 `auth.users` `zz_o1123_*@test.invalid`, 3 `creator_accounts`, 2 brands `ZZ_O1123_A/B`, 1 `brand_team_members`, 5 `events`) were created **inside one transaction that was rolled back** via an intentional sentinel exception. Post-run verification: `0 leftover brands`, `0 leftover events`. **No real production draft was ever deleted; no test data persisted.**

---

## 2. Drafts-only UI guard (source + static) — PASS

- **EventListCard / TripListCard / OfferingListCard:** body `Pressable` has `onLongPress={selectable ? onLongPress : () => holdRing.playNullShake()}` + `delayLongPress={350}`. `dimmedInert = selectionMode && !selectable`; when true the host `Animated.View` gets `pointerEvents="none"` + `accessibilityElementsHidden` → a non-draft row is **fully inert** during selection (can't tap, toggle, or long-press). `showCheckbox = selectionMode && selectable` → checkbox only on drafts. Manage 3-dot hidden via `!selectionMode`. Row `accessibilityRole` flips to `checkbox` only when `isCheckboxRow`.
- **events.tsx:** `selectable={isDraftRow}` where `isDraftRow = item.kind === "draft"`; `onLongPress` only when `isDraftRow`; `onOpen` routes to `toggle` only when `selectionMode && isDraftRow`.
- **trips.tsx:** `isDraftRow = trip.status === "draft"`; same gating. Bulk handler re-filters `status === "draft" && selected` at delete time (defense-in-depth).
- **experiences.tsx (Q2):** selection mounted ONLY inside `ExperienceGenerationSurface` (restaurant/play). `isDraftRow = exp.status === "draft"`; bulk re-filters to `status==="draft"`. **NO new filter pills, NO All/Upcoming/Past pills, NO tab redesign.** `creative_and_arts` + default shells (lines 539/559) show ONLY a "Create experience" CTA — no list, no selection, untouched.

My adversarial source test (§6) adds the **negative** guard the implementor omitted: no tab may set `selectable={true}` (a literal-true would let a non-draft row into selection mode).

## 3. Events Zustand consistency — PASS (source-traced + executable)
`events.tsx handleBulkDeleteConfirm` partitions `selected` against `isLocalOnlyDraft` (`id.startsWith("d_") || serverSlug === null`): `localOnly → localOnlyDraftIds`, rest → `serverEventIds`. `useDiscardOfferingDrafts.onSuccess` (kind=`event`): deletes BOTH every `localOnlyDraftIds` AND every server-`deleted` id from Zustand `deleteDraft`, prunes the RQ list cache, `removeQueries(detail)` per deleted, invalidates the list + `brandKeys.offeringCounts`. A `d_*` id is **never** sent to the RPC (would 404). My §6 test proves the service short-circuits `[]` without a network call, and the implementor's partition unit covers the split. Relaunch persistence is the Zustand store's own contract (unchanged) — no source path resurrects a deleted id.

## 4. Partial-failure no-silent-failure — PASS
All 3 tabs compute `deleted = rows(outcome==="deleted") (+localDeletedCount for events)` and `failed = rows(outcome!=="deleted")`, then `bulkToastMessage`: `failed===0` → "Deleted N drafts."; `deleted>0` → "Deleted N, M couldn't be deleted."; else → "Couldn't delete M drafts. You may not have permission." The `catch` path sets `bulkError` on the still-open dialog (no swallow). My §6 test proves a stale-UI LIVE row (`skipped_not_draft`) is counted as **failed**, never deleted, and surfaces "couldn't be deleted" — and every non-`deleted` outcome increments failed.

## 5. Dead-tap RUNTIME proof — **DEVICE-PENDING (requires Seth)**
Source wiring is correct and strong (real `onLongPress`+`delayLongPress={350}` on the body Pressable → real `enterWith` + `HapticFeedback.selectionEnter()`; non-draft rows `pointerEvents="none"`; manage hidden during selection). **But** per the constitution (Interactive-elements-must-fire, runtime-proof-not-source-wiring) this caps at "suspected" until proven on a device. **No mingla-business session/build was available** (Android has only the consumer app; sim has no business app; a business login with draft offerings needs Seth's creds + a build). I did NOT and will not fake it. Seth must drive: long-press a draft → mode enters + haptic; tap rows → checkboxes toggle + bar count updates; Delete → confirm → rows vanish; Cancel → clean exit; long-press a non-draft under "All" → null-shake no-op.

## 6. Step 0.5 — tester adversarial test (NEW, different angle) — GREEN + fails-on-revert
**Path:** `mingla-business/src/services/__tests__/orch_1123_discard_adversarial.test.ts` (committed `567eaa8af`, append-only new file). **14 tests, all green.**

Genuinely different from the implementor's happy-path source-grep: it imports and exercises the **REAL shipped `discardOfferingDrafts` service** (supabase mocked) instead of re-implementing a copy, and attacks behavior under hostile input:
- **A.** empty batch must NEVER call the RPC (a local-only-only events delete); RPC error must PROPAGATE (no silent swallow); null data → `[]`; outcome mapping faithful + RPC param name `p_event_ids` exact.
- **B.** a stale batch `[draft=deleted, LIVE=skipped_not_draft]` → 1 deleted / 1 FAILED (a live offering can never read as deleted; asserts NOT "Deleted 2").
- **C.** every non-`deleted` outcome (`skipped_not_draft`/`skipped_not_found`/`forbidden`) counts failed; events local-only deletions count deleted.
- **D.** negative source guards across all 3 tabs: `selectable` derived from a draft predicate, **never `selectable={true}`**; long-press entry gated on `isDraftRow`.

### fails-on-revert (true line deletion, reproducible)
Applied 2 reverts to the REAL source, ran the suite, restored:
1. Removed `if (eventIds.length === 0) return [];` from `offeringDrafts.ts` → test **`A. empty batch short-circuits — the RPC is NEVER called` FAILED**.
2. Changed `trips.tsx` `selectable={isDraftRow}` → `selectable={true}` → test **`D. trips tab: selectable … never a literal true` FAILED**.
Result with both reverts: `2 failed, 12 passed`. Restored both → `14 passed`. (Both reverts done on disk, not committed; working tree restored clean.)

## 7. Existing suites + gates — results

| Suite | Result |
|---|---|
| `useDraftMultiSelect.test.ts` (impl) | **11/11 PASS** |
| `orch_1123_batch_rpc_source.test.ts` (impl) | **6/6 PASS** |
| `orch_1123_discard_adversarial.test.ts` (tester) | **14/14 PASS** |
| SQL behavioral probe `orch_1123_batch_discard.test.sql` | superseded by my live-fire §1 (broader, adversarial, real per-user JWT) |
| my new test file `tsc --noEmit` | clean |

### Pre-existing test rot — confirmed NOT caused by ORCH-1123
I ran `serverDraftLifecycleGuards` + `OfferingParity` + `TripVisualParity` against (a) **origin/main source** of the 7 touched files and (b) ORCH-1123 source. **origin/main baseline = 16 failures; ORCH-1123 = 17.** The shared 16 are pre-existing: `serverDraftLifecycleGuards` reads the moved `app/(tabs)/events.tsx` path; `OfferingParity`/`TripVisualParity` assert META-ORCH-1002-superseded `glass.tint.profileBase` backgrounds, the now-`LazyOfferingManageSheet` lazy import, and `Share.share` patterns. The META-ORCH-1002 glass git-diff harness (`metaOrch1002SubDBusinessGlass.adversarial`) also fails identically on baseline (it expects a >150-block diff vs META-ORCH-1002 that doesn't exist on a current branch). All confirmed by checking out origin/main file versions and re-running. **Not ORCH-1123's fault.**

### The ONE net-new failure (P2 — test brittleness, NOT a product defect)
`TripVisualParity_adversarial.test.ts › "manage icon only renders when onManageOpen prop is provided"`.
Its regex `/onManageOpen !== undefined \?[\s\S]*?<Pressable…/` requires the `?` immediately after `onManageOpen !== undefined`. ORCH-1123 changed `TripListCard` to `onManageOpen !== undefined && !selectionMode ?` — the **spec-mandated** hide-manage-during-selection guard (SPEC §3.7.1). The behavior is STRICTER and correct (manage 3-dot hidden while selecting); the test's intent ("manage icon only renders when onManageOpen provided") is still satisfied. The regex is simply too rigid about the `?` placement. **Fix = update the test under `[TEST-MOD-APPROVED]` (orchestrator), not a code change.** Flagged, not fixed (append-only).

---

## 8. Migration / deploy state
RPC `20260928000002` is LIVE on the remote (verified: exists, `SECURITY DEFINER`, correct TABLE return, anon REVOKED). No further DB apply needed. Pure-JS/RN otherwise → OTA-eligible per-platform after merge (`eas update --platform ios` then `--platform android`). No edge functions.

---

## Summary
The DB layer is **proven correct under live adversarial fire** (rank gate, cross-brand block, drafts-only-never-deletes-live, idempotent, anon-revoked, not_authenticated) with zero production impact (transaction rollback). Client source faithfully implements the spec (drafts-only selectability with inert non-draft rows, events local/server partition, no-silent-failure toast tally, one-owner cache hook). My tester-authored adversarial suite (14 tests, `567eaa8af`) attacks the real service + drafts-only-bypass and proves fails-on-revert. The only outstanding items are the **constitutionally-required runtime long-press dead-tap proof (device-pending — needs Seth + a business build/session)** and one **P2 brittle pre-existing test** that ORCH-1123's intended behavior change tripped.

**Verdict: CONDITIONAL PASS** — ship-ready pending Seth's on-device long-press confirmation; update the brittle TripVisualParity regex under `[TEST-MOD-APPROVED]`.

**Artifact:** `Mingla_Artifacts/reports/TEST_ORCH-1123_HUB_MULTISELECT_DRAFT_DELETE.md`
**Adversarial test:** `mingla-business/src/services/__tests__/orch_1123_discard_adversarial.test.ts` (commit `567eaa8af`)
