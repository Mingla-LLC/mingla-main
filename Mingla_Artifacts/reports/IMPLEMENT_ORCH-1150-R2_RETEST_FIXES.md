# IMPLEMENT — ORCH-1150-R2 [RSVP wizard retest: 3 device-test defects]

- **ORCH:** ORCH-1150-R2 — RSVP wizard RETEST fixes (D-1 / D-2 / D-3)
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/orch-1150-r2-[rsvp-retest-fixes]/` on `orch-1150-r2-rsvp-retest-fixes`
- **Base:** HEAD `13c3ec4c5` (fresh off latest main, pre-rebased — NOT rebased again per dispatch).
- **Binding contract:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1150_RETEST_3DEFECTS.md` (SPEC half).
- **Scope:** RSVP-only. Ticketed EventCreatorWizard / event-create / published-edit paths byte-identical except the one inverse RSVP-redirect guard on `app/event/[id]/edit.tsx`.
- **No migration. No edge deploy. No OTA. No merge.**

## 1. Summary (plain English)

Three RSVP-wizard defects Seth hit on the dev build are fixed:
- **D-3:** Editing/resuming an RSVP draft now opens the RSVP wizard (`/rsvp/[id]/edit`), not the ticketed event wizard.
- **D-2:** A video chosen on the RSVP Cover step now persists — the promoted server draft row is typed `event_type='rsvp'`, giving the cover-video pipeline a real RSVP row to bind to.
- **D-1:** Typing the RSVP name no longer flashes a "refresh"/remount — the brief draft-null Spinner during the draft-migration swap is suppressed; the wizard stays mounted.

All ticketed-event behavior is unchanged.

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Commit |
|----|-----------|--------|--------|
| D-3-a | `routeForEventRow` has an `rsvp` branch (draft→/rsvp/{id}/edit, live→/rsvp/{id}) | ✓ | `535c57507` |
| D-3-b | `routeForEventRowDefensive` honors `isRsvp` (DraftEvent has no event_type) | ✓ | `535c57507` |
| D-3-c | Hub `handleOpenItem` + `handleManageEdit` honor the RSVP signal | ✓ | `535c57507` |
| D-3-d | Inverse guard on `app/event/[id]/edit.tsx` (isRsvp draft → /rsvp/[id]/edit) | ✓ | `535c57507` |
| D-3-e | `i-proposed-tr2-route-by-event-type` gate green for my changes; rsvp branch INSIDE the helper | ✓ | `535c57507` |
| D-2-a | `createServerDraft` inserts `event_type:'rsvp'` for RSVP drafts (else 'event') | ✓ | `4497ff6b9` |
| D-2-b | Draft fetches/updates admit rsvp rows (5 sites widened to `.in(['event','rsvp'])`) | ✓ | `4497ff6b9` |
| D-2-c | Cover-video bind works once the row is a real rsvp id (validateEventRowId non-empty check passes) | ✓ (source-verified) | `4497ff6b9` |
| D-2-d | `business_publish_rsvp_draft` accepts the promoted row (loads by id, gates status='draft') | ✓ (source-verified) | n/a (no RPC change) |
| D-1-a | RSVP route suppresses the draft-null Spinner during the d_*→server migration | ✓ | `b3f46e5dc` |
| D-1-b | Cover/name/all fields carry across the swap (replaceDraft + merge preserve them) | ✓ (source-verified) | `b3f46e5dc` |
| D-1-c | `app/event/[id]/edit.tsx` behavior unchanged (RSVP-route-only) | ✓ | `b3f46e5dc` |

## 3. Files changed

| File | ± | What |
|------|---|------|
| `mingla-business/src/utils/routeForEventRow.ts` | +~30 | rsvp branch + type + defensive isRsvp coercion |
| `mingla-business/app/(tabs)/hub/events.tsx` | +~14 | handleOpenItem isRsvp signal; handleManageEdit rsvp base |
| `mingla-business/app/event/[id]/edit.tsx` | +~14 | inverse wrong-wizard guard (isRsvp → /rsvp) |
| `mingla-business/src/services/eventDrafts.ts` | +~30 / −5 | rsvp insert-typing + DRAFT_EVENT_TYPES + 5 widened filters |
| `mingla-business/app/rsvp/[id]/edit.tsx` | +~45 | retained-draft + migrationInFlight + Spinner suppression |
| `mingla-business/src/utils/__tests__/orch_1150_r2_rsvp_route.test.ts` | +120 (new) | D-3 routing test (14 cases) |
| `mingla-business/src/services/__tests__/orch_1150_r2_rsvp_draft_type.test.ts` | +250 (new) | D-2 service test (4 cases) |
| `…/eventDraftsTaxonomyAutosave.test.ts` | +3 | additive `in:` mock method (no deletion) |
| `…/eventDraftsTaxonomyAutosaveAdversarial.test.ts` | +3 | additive `in:` mock method (no deletion) |
| `…/eventDraftsCurrency.test.ts` | +3 | additive `in:` mock method (no deletion) |

## 4. Data-model changes applied

None. No migration. The `events.event_type` CHECK already admits `'rsvp'` (migration `20261004…`); the change is purely which value the client writes at draft-promotion + which values the draft reads admit.

## 5. Edge functions touched

None. The RSVP publish RPC (`business_publish_rsvp_draft`) was read-verified (loads the draft by `id`, gates on `status='draft'` with NO `event_type` filter) and accepts the promoted `event_type='rsvp'` row unchanged — no edit needed.

## 6. Regression tests added

- **D-3:** `mingla-business/src/utils/__tests__/orch_1150_r2_rsvp_route.test.ts` (14 cases) — rsvp draft/live routing + defensive isRsvp coercion + ticketed/trip/experience unchanged.
- **D-2:** `mingla-business/src/services/__tests__/orch_1150_r2_rsvp_draft_type.test.ts` (4 cases) — createServerDraft emits rsvp/event by isRsvp; fetchDraftsForBrand + fetchDraftById filter event_type IN ['event','rsvp'].
- **Fails-on-revert verified at `13c3ec4c5` (pre-commit working tree):** with the rsvp branch + isRsvp coercion deleted (routeForEventRow.ts) AND the insert type-pin reverted to `'event'` + two fetch sites reverted to `.eq("event_type","event")` (eventDrafts.ts) by TRUE LINE DELETION, the two suites reported **11 failed, 5 passed / 16 total**. Restoring the fixes → **16 passed, 16 total**.
- D-1 is verified by source reasoning + the existing route-wrapper suites (`orch_0893_*`) staying green; a render-mount assertion for the Spinner-suppression needs RTL (`@testing-library/react-native` is absent from this repo's deps — see Known Issues) → D-1 carries a device-proof requirement, NOT an automated render test.

## 7. Old → New receipts

### routeForEventRow.ts
- **Before:** `EventTypeForRouting = "event"|"experience"|"trip"`; no rsvp branch; defensive variant ignored isRsvp.
- **Now:** adds `"rsvp"`; `routeForEventRow` returns `/rsvp/{id}/edit` (draft) | `/rsvp/{id}` (live) for rsvp; `routeForEventRowDefensive` coerces `isRsvp===true` → event_type:'rsvp'.
- **Why:** D-3 — RSVP rows must resume into RsvpCreatorWizard. The rsvp branch lives inside the canonical helper (gate compliance).

### app/(tabs)/hub/events.tsx
- **Before:** `handleOpenItem` passed only event_type (defaulting RSVP drafts to 'event'); `handleManageEdit` hardcoded `/event/{id}/edit`.
- **Now:** `handleOpenItem` passes `isRsvp`; `handleManageEdit` picks an `/rsvp/{id}/edit` vs `/event/{id}/edit` base by isRsvp/event_type, preserving the `?mode=edit-published` suffix.
- **Why:** D-3 — the two drafts-list resume call sites.

### app/event/[id]/edit.tsx
- **Before:** no isRsvp guard — an RSVP draft reaching this route mounted the ticketed wizard.
- **Now:** `draft.isRsvp === true` → `router.replace('/rsvp/{id}/edit?step=…')`, mirroring the RSVP route's inverse guard.
- **Why:** D-3 belt-and-suspenders. This is the ONLY allowed change to the ticketed event path.

### src/services/eventDrafts.ts
- **Before:** `createServerDraft` hardcoded `event_type:'event'`; 5 draft reads/updates filtered `.eq("event_type","event")`.
- **Now:** inserts `event_type:'rsvp'` when `draft.isRsvp`; all 5 reads/updates use `.in("event_type", DRAFT_EVENT_TYPES=["event","rsvp"])`.
- **Why:** D-2 — give the promoted RSVP draft a real rsvp events row for the cover-video pipeline, and keep it visible/loadable/savable.

### app/rsvp/[id]/edit.tsx
- **Before:** during the d_*→server swap, `draft` briefly resolved null → the `draft===null` Spinner branch rendered → RsvpCreatorWizard remounted (the "refresh").
- **Now:** retains the last resolved draft (`lastResolvedDraftRef`), derives `migrationInFlight` from `migratingLegacyIdRef`, renders the wizard against `renderDraft` (live draft OR retained draft mid-migration), and suppresses the Spinner while migrating. Brand memo + isCreateMode fall back to the retained draft.
- **Why:** D-1 — keep the wizard mounted across the swap. RSVP-route-only.

## 8. Cross-surface impact

| Surface | Affected | Behavior | Parity |
|---------|----------|----------|--------|
| Consumer iOS | No | no authoring | — |
| Consumer Android | No | no authoring | — |
| Buyer/anon Web | No | no draft authoring | — |
| Business iOS | **Yes** | RSVP video cover persists; RSVP drafts resume into RSVP wizard; no name-typing refresh | automatic (shared RN) |
| Business Android | **Yes** | same | automatic (shared RN) |
| Admin Web | No | — | — |
| Business Web preview | Incidental | RSVP phone-web create benefits from the same `app/rsvp/*` + service fixes | automatic |

## 9. Gates / verification

- **tsc (`npx tsc --noEmit -p tsconfig.json`, mingla-business):** zero NEW errors vs origin/main baseline (diffed: AFTER 409 vs BASELINE 411 — my change net-FIXED 2 pre-existing errors in `src/lib/search/adapters.ts`, introduced 0). The 409 remaining are all pre-existing baseline tech debt (`@testing-library/react-native`, `category` on DraftEvent, `@mingla/payments-native`, etc.) — unrelated to this ORCH.
- **strict-grep `i-proposed-tr2-route-by-event-type.mjs`:** 6 violations reported, ALL PRE-EXISTING on origin/main baseline (identical count with my changes stashed). My modified file `hub/events.tsx` is CLEAN (allowlist comment accepted; the gate does not scan `/rsvp/`). The contract requirement (rsvp branch inside the helper, no hardcoded `/rsvp/` push outside it) is met. **The gate is RED on main for unrelated scanner-route violations — Discovery for orchestrator.**
- **append-only check (`test-append-only-check.js`):** clean. The 3 edits to existing test files are pure additions (3-added/0-deleted each) — no `[TEST-MOD-APPROVED]` token required.
- **Touched-area jest sweep (8 suites):** 56 passed / 56.

## 10. Known issues / deferred

- **D-1 has no automated render test:** `@testing-library/react-native` is not in this repo's devDeps (every `*.render.test.tsx` errors on the missing module at baseline). D-1's fix is verified by source reasoning + the existing `orch_0893_*` route-wrapper suites staying green. It REQUIRES device proof at TEST (type the RSVP name; confirm no Spinner flash / no remount). D-2's video-persist + D-3's resume also want device confirmation.
- No `[TRANSITIONAL]` code introduced.

## 11. Operator action required

- None for backend (no migration, no edge deploy).
- **For TEST/retest:** OTA the business dev channel from MERGED main after review, then device-fire all three (D-3 resume-into-RSVP-wizard; D-2 video cover persists across reload; D-1 no name-typing refresh).

## 12. Discoveries for Orchestrator

- **DISC-1150R2-A:** `i-proposed-tr2-route-by-event-type` is RED on origin/main with 6 pre-existing violations (`home.tsx:414` event scanner; `hub/trips.tsx:379/388/397`; `accept-scanner-invitation.tsx:94`; `ScannerHome.tsx:119`). Not introduced by this ORCH; flag for a gate-cleanup ORCH.
- **DISC-1150R2-B:** mingla-business tsc has 409 pre-existing baseline errors (missing `@testing-library/react-native` + `@mingla/payments-native` modules, stale `category` field on DraftEvent in 4 test files, several component type errors). The repo's "tsc clean" claim does not hold on main today.
- **DISC-1150R2-C (carried from forensics DISC-1150-R-A/B):** `createServerDraft` is the SHARED promotion service for event+RSVP; a SECOND d_*→server migration path exists in `useServerDraftEvents.ts` (Hub legacy loop) also calling `createServerDraft` — it now inherits the rsvp typing automatically (good), but any future offering type lazily promoting a d_* draft must set its own discriminator there.
- **DISC-1150R2-D:** the `EditPublishedScreen` RSVP edit-published path (`?mode=edit-published`) for a LIVE RSVP is reachable via `handleManageEdit` now routing to `/rsvp/{id}/edit?mode=edit-published`; the RSVP route already handles that mode (rsvpMode). Worth a device check that live-RSVP "Edit" lands on the RSVP-aware screen (in scope of TEST).
