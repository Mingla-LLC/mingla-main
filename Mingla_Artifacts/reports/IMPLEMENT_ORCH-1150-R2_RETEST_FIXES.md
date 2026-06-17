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

---

# D-4 — Tailored RSVP host detail/dashboard page (`app/rsvp/[id]/index.tsx`)

- **Binding contract:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1150_RSVP_DETAIL_PAGE.md` (PART 2 SPEC, §5 KEEP/DROP + §8 build order + finding F-2).
- **Dispatch:** retest fix for the white-screen 404 when tapping a LIVE RSVP event. Root cause (proven): `routeForEventRow` correctly routes a non-draft RSVP row to `/rsvp/{id}`, but `app/rsvp/[id]/index.tsx` did not exist → expo-router rendered the branded `+not-found.tsx` (enlarged-logo white screen). The ONLY fix is to create the missing screen.
- **No migration. No edge deploy. No service/RPC/hook change. No OTA. No merge.**

## D-4.1 Summary (plain English)

Tapping a live (or scheduled) RSVP event in the business Hub now opens a real RSVP host dashboard instead of a white screen with an oversized logo. The page shows the cover, status pill, title, date·venue, an "N going" headcount, and tiles for Guests (approve/deny/remove console), Edit, Public page, Share, and Brand page. It deliberately shows NO tickets, revenue, scanners, orders, door sales, reconciliation, blasts, group-chat, activity feed, or cancel/manage menu — RSVP has no money and no tickets.

## D-4.2 SPEC coverage

| SC | Criterion | Status | Commit |
|----|-----------|--------|--------|
| F-1 | `/rsvp/{id}` resolves to a real screen (no +not-found) | ✓ NEW file created | (this commit) |
| KEEP-hero | cover + status pill + title + date·venue | ✓ | (this commit) |
| KEEP-going | "N going" via `formatRsvpGoingLabel`; "No one's responded yet"/"0 going" empty state | ✓ | (this commit) |
| KEEP-guests | Guests tile → `/rsvp/{id}/guests`; manual-mode "Approve / deny" sub | ✓ | (this commit) |
| KEEP-edit | Edit tile → `/rsvp/{id}/edit` | ✓ | (this commit) |
| KEEP-share | Share IconChrome + ShareModal w/ `eventPublicUrl` `/e/{brandSlug}/{eventSlug}` | ✓ | (this commit) |
| F-2 data hook | going-count from `useBusinessEventsForBrand(brandId).find(byId).rsvpGoingCount`, NOT `fetchBusinessEventById` | ✓ | (this commit) |
| DROP-money | NO revenue card / moneySummary / ticket types / scan / orders / door / recon / blasts / group-chat / activity / cancel / manage menu | ✓ (test-enforced) | (this commit) |
| States | loading (page shell + "Loading RSVP…", NOT white screen), not-found (EmptyState + Back), populated, empty going-count | ✓ | (this commit) |
| Gate | `i-proposed-tr2-route-by-event-type` adds ZERO new violations (only `/rsvp/`,`/e/`,`/brand/`,`/(tabs)/` literals) | ✓ | (this commit) |

## D-4.3 Files created (2)

- `mingla-business/app/rsvp/[id]/index.tsx` (NEW, ~440 lines) — `RsvpDetailScreen` default export.
- `mingla-business/app/rsvp/[id]/__tests__/index.test.tsx` (NEW, ~140 lines) — structural happy-path + subtractive regression test (12 cases).

DO-NOT-TOUCH list untouched: `app/event/[id]/index.tsx`, all `EventDetail*` components, `routeForEventRow.ts`, the strict-grep gate, every service/hook/RPC/migration/edge-fn — all unchanged (verified: `git status` shows only the 2 new files).

## D-4.4 KEEP / DROP realized

**KEEP (cloned + adapted from `event/[id]/index.tsx`):** TopBar back (title "RSVP"); Share IconChrome → ShareModal (url via `eventPublicUrl`); hero `EventCoverMedia` + `EventDetailHeroStatusPill` + title + date·venue subline (status via `deriveScreenStatus`, verbatim); "N going" headcount in a `GlassCard` (replaces the revenue KPI card); Guests `ActionTile` → `/rsvp/{id}/guests` (manual-mode shows "Approve / deny", else the going label); Edit `ActionTile` → `/rsvp/{id}/edit`; Public-page `ActionTile` → `/e/{brandSlug}/{eventSlug}`; Brand-page `ActionTile`; Toast wrap; not-found EmptyState (illustration "users", "RSVP event not found"); loading shell (header + "Loading RSVP…", never a blank screen).

**DROP (not cloned):** `EventDetailKpiCard` revenue card · `moneySummary`/`summarizeEventMoney` + all revenue/payout/covered/door derivations · currency-mismatch card · TICKET TYPES + `EventDetailTicketTypeRow` + `soldCountByTier` · Scan/Scanners tiles · Orders tile + `useEventOrders` + `totalSoldCount` · Door Sales tile + `useDoorSalesStore` + `doorSoldCount` · `ReconciliationCtaTile` · Blasts tile · Group-chat tile · recent-activity feed (`EventDetailActivityRow` + the 8-stream merge) · End-sales sheet + cancel flow · `EventManageMenu` mount · guest-comp store. Per SPEC OQ-1/OQ-2: cancel omitted from v1; manual-mode pending count lives inside the console (tile shows static "Approve / deny").

## D-4.5 Data-hook used (finding F-2)

`useManagedEventRoute(id)` → `{ event, brand, isLoading }` for cover/title/status/date/venue/slugs/`rsvpCapacity`/`rsvpApprovalMode` (its `rsvpGoingCount` is NOT trusted — `fetchBusinessEventById` zeroes it). The headcount is read from the Hub LIST query `useBusinessEventsForBrand(brand?.id ?? null)`, found-by-id (`e.id === id || e.serverEventId === id`) — the same cache the Hub card reads, so the count matches what the host just saw. Fallback to `event.rsvpGoingCount ?? 0` until the list resolves (non-blocking, self-correcting). No service touched.

## D-4.6 Regression test + fails-on-revert proof

- **Test:** `mingla-business/app/rsvp/[id]/__tests__/index.test.tsx` — 12 structural cases (file-exists + KEEP-element presence + DROP-element absence + F-2 data-hook + route-literal safety). Structural source test follows the sibling precedent (`app/event/[id]/__tests__/cancel-no-navigation.test.tsx`): the screen's dependency graph (Expo Router + useManagedEventRoute + Zustand) is too heavyweight for Node-env jest, and `@testing-library/react-native` is absent from devDeps (baseline). The `readFileSync` of `index.tsx` THROWS when the file is absent — the missing-route white-screen condition.
- **Passing run:** `12 passed, 12 total`.
- **Fails-on-revert (TRUE LINE DELETION, not comment-out):** deleted `app/rsvp/[id]/index.tsx` → suite FAILED (`1 failed, 0 tests run` — readFileSync threw, exactly the +not-found fallback condition); restored the file → `12 passed`. **fails-on-revert verified.**

## D-4.7 Gate + tsc results

- **`npx tsc --noEmit -p tsconfig.json` (mingla-business):** ZERO errors in `app/rsvp/[id]/*` (grep on `app/rsvp/` → empty). 333 errors total, ALL pre-existing on the branch baseline (checkout buyer `any` params, marketing ComposerV2, search adapters rsvp-type, `@testing-library/react-native`/`@mingla/payments-native` missing modules, stale DraftEvent `category` in test fixtures) — none in my new files (proven: only the 2 new files are added; `git status` = clean except them).
- **`node .github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs`:** 6 violations, ALL PRE-EXISTING (home.tsx:414, hub/trips.tsx:379/388/397, accept-scanner-invitation.tsx:94, ScannerHome.tsx:119). Proven identical count WITH my files (789 files, 6) and WITHOUT (788 files, 6) — **my change adds ZERO new violations**; my new file is NOT flagged (uses only `/rsvp/`,`/e/`,`/brand/`,`/(tabs)/` literals, the gate bans only `/event/` and `/trip/`). Carries forward DISC-1150R2-A (gate is RED on main for unrelated scanner routes — gate-cleanup ORCH).
- **New jest test:** `12 passed`.

## D-4.8 Cross-surface impact

| Surface | Affected | Note |
|---------|----------|------|
| Consumer iOS / Android | No | RSVP host detail is host-only |
| Buyer/anon Web | No | buyers use the public page `/e/{slug}/{slug}` (separate, working) |
| Business iOS | **Yes** | tap live RSVP → host dashboard (no white screen) — `app/rsvp/[id]/index.tsx` (NEW) |
| Business Android | **Yes** | same NEW file, parity automatic (shared RN) |
| Admin Web | No | not an admin surface |
| Business Web preview | Incidental | same RN route compiles to web; renders the same dashboard if reached |

## D-4.9 Smoke result

Source-built + gates run; NOT driven on sim/device this turn (no dev build exercised). Verified by tsc (zero new errors), the 12-case jest suite (pass + fails-on-revert), and the route gate (zero new violations). REQUIRES device proof at TEST: tap a live RSVP event in the Hub → lands on the RSVP dashboard (no +not-found); the "N going" matches the Hub card; Guests/Edit/Public-page/Share all route correctly.

## D-4.10 Known issues / deferred (D-4)

- No render-level test (RN testing-library absent at baseline) — structural test + device proof at TEST cover it.
- OQ-1 (cancel/unpublish RSVP) and OQ-2 (live pending-approval badge) deferred per SPEC recommendation — non-blocking.
- No `[TRANSITIONAL]` code introduced.

## D-4.11 Operator action required (D-4)

- None for backend (no migration, no edge deploy).
- **For TEST/retest:** after review, OTA the business dev channel from MERGED main, then on device tap a LIVE RSVP event in the Hub and confirm: (1) RSVP dashboard renders (no white-screen/enlarged-logo); (2) "N going" headcount; (3) Guests → console; (4) Edit → RSVP edit screen; (5) Public page + Share work.

---

# D-5 — RSVP in-app preview route (`app/rsvp/[id]/preview.tsx`)

- **Binding contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1150_RSVP_PREVIEW_ROUTE.md` (follows `INVESTIGATE_ORCH-1150_RSVP_RENDER_SWEEP.md`).
- **Base:** HEAD `fc285b92f` (D-4). NOT rebased (continue-the-batch dispatch).
- **No migration. No edge deploy. No OTA. No merge.**

## D-5.1 Summary (plain English)

The RSVP wizard's "Preview public page" button pushed `/rsvp/{id}/preview`, but that screen file did not exist → expo-router fell through to the branded 404 (`+not-found.tsx`), the white-screen / enlarged-logo crash Seth hit at retest. Same class as the D-4 missing `/rsvp/[id]/index.tsx`. The fix is a single additive route file `app/rsvp/[id]/preview.tsx` — a subtractive clone of the ticketed `app/event/[id]/preview.tsx` that resolves the RSVP draft identically (d_*→server migration + stale/missing recovery) but renders the money-free `RsvpPublicBody` (Going / Not-going) instead of the ticket-assuming `PreviewEventView`. The preview's Going/Not-going CTA is a NO-OP: it shows a "This is a preview" toast and never calls `submitPublicRsvp` / the edge function (a draft has no public guest list).

## D-5.2 SPEC success-criteria coverage

| SC | Met | How (commit) |
|----|-----|--------------|
| SC-1-iOS/Android/Web | ✓ | `app/rsvp/[id]/preview.tsx` created → `/rsvp/{id}/preview` resolves (no 404); renders cover+title+date·venue+Going/Not-going via `RsvpPublicBody` |
| SC-2 (no tickets) | ✓ | Mounts `RsvpPublicBody` (never `PreviewEventView`/`FoundationEventPreview`); mapper sets `tickets:[]`, no checkout/price |
| SC-3 (submit no-op) | ✓ | `handlePreviewSubmit` shows "This is a preview. Publish to let guests RSVP." toast; NO `submitPublicRsvp` import/call |
| SC-4 (back) | ✓ | `handleBack` = `router.canGoBack()` ? `router.back()` : `/(tabs)/hub/events` — no dead end |
| SC-5 (d_* draft) | ✓ | d_*→server migration `useEffect` copied verbatim, `/event` swapped to `/rsvp` — no crash on un-promoted draft |
| SC-6 (wrong-wizard) | ✓ | `draft.isRsvp === false` → `router.replace('/event/${draft.id}/preview')` (strict-grep allowlisted) |
| SC-7 (no-regression) | ✓ | `git status` shows ONLY 2 new files; `event/[id]/preview.tsx`, `PreviewEventView.tsx`, `PublicEventPage.tsx`, `RsvpPublicBody.tsx` byte-unchanged |

## D-5.3 Files changed

- `mingla-business/app/rsvp/[id]/preview.tsx` — **NEW** (~340 lines): RSVP preview route.
- `mingla-business/app/rsvp/[id]/__tests__/preview.test.tsx` — **NEW** (~95 lines): happy-path regression test.

No shared-component edits. `mapDraftToPublicEvent` + `mapBrandToPublicBrand` are inlined local helpers (NOT exported from `PublicEventPage`, per the DO-NOT-TOUCH guard).

## D-5.4 Old → New receipt

### `app/rsvp/[id]/preview.tsx` (NEW)
- **Before:** file did not exist → `/rsvp/{id}/preview` fell through to `+not-found.tsx` (white-screen crash).
- **Now:** resolves the RSVP draft (useDraftById + useServerDraftById, d_*→server migration, stale/missing recovery — copied from `event/[id]/preview.tsx` with `/event`→`/rsvp` targets), maps the draft into `PublicEventProps` (tickets:[], slugs ""), renders `RsvpPublicBody` with a preview-mode no-op `onSubmit` and a toast `onShare`. Wrong-wizard guard redirects an `isRsvp===false` draft to the ticketed preview.
- **Why:** SC-1..SC-6 — close the one render crash the sweep found.

## D-5.5 Regression test (fails-on-revert)

- **Path:** `mingla-business/app/rsvp/[id]/__tests__/preview.test.tsx` — 8 tests, all PASS (structural source test; mirrors the D-4 sibling — the RsvpPublicBody→ParallaxCoverShell→expo-haptics render graph is too heavyweight for the default node/ts-jest config; the tester owns the RTL render-proof).
- **fails-on-revert verified at `fc285b92f`** (pre-commit): TRUE FILE DELETION of `app/rsvp/[id]/preview.tsx` → `readFileSync` throws → suite fails (`1 failed, 0 tests`). Restored → `8 passed`. (Not a comment-out — the file was `mv`'d out and back.)

## D-5.6 Gate results

- **`npx tsc --noEmit -p tsconfig.json` (mingla-business):** ZERO errors in `app/rsvp/[id]/preview*` (grep on `rsvp/[id]/preview` → empty). The repo-wide pre-existing errors (checkout `any` params, RTL/`@mingla/payments-native` missing modules, stale DraftEvent `category` test fixtures, marketing ComposerV2) are unchanged baseline — none in my 2 new files (proven: only 2 files added, both clean).
- **`node .github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs`:** 6 violations, ALL PRE-EXISTING (home.tsx:414, hub/trips.tsx:379/388/397, accept-scanner-invitation.tsx:94, ScannerHome.tsx:119). Proven identical count WITH my files (790 files, 6) and WITHOUT (789 files, 6) — **my change adds ZERO new violations**; my new file's one `/event/${draft.id}/preview` literal carries the `// orch-strict-grep-allow route-by-event-type` comment and is NOT flagged. Carries forward DISC-1150R2-A (gate is RED on the branch for unrelated scanner/trip routes — gate-cleanup ORCH).
- **New jest test:** `8 passed`.

## D-5.7 Cross-surface impact

| Surface | Affected | Note |
|---------|----------|------|
| Consumer iOS / Android | No | RSVP preview is a business authoring surface |
| Buyer/anon Web | No | the PUBLIC `/e/{slug}/{slug}` RSVP page already renders (sweep F-2); preview is host-only |
| Business iOS | **Yes** | tap "Preview public page" in the RSVP wizard → RSVP preview (no 404) — `app/rsvp/[id]/preview.tsx` (NEW) |
| Business Android | **Yes** | same NEW file, parity automatic (shared RN) |
| Admin Web | No | no RSVP wizard |
| Business Web preview | Incidental | same RN route via Metro web |

## D-5.8 Smoke result

Source-built + gates run; NOT driven on sim/device this turn. Verified by tsc (zero new errors), the 8-case jest suite (pass + fails-on-revert proven by true file deletion), and the route gate (zero new violations). REQUIRES device proof at TEST: in the RSVP wizard Preview step, tap "Preview public page" → RSVP public preview renders (cover + title + date·venue + Going/Not-going), no ticket UI, no 404; tapping Going shows the preview toast and writes nothing; back returns to the wizard.

## D-5.9 Known issues / deferred (D-5)

- No RTL render-level test (RN testing-library absent at the default-config baseline) — structural test + device proof at TEST cover it. The tester may add a `jest.orch1150.render.cjs` mount.
- OQ-1 (preview brandSlug/eventSlug "" placeholders) and OQ-2 (`isLoggedIn=true` default — contact form hidden) resolved per SPEC defaults; non-blocking, flip-able.
- No `[TRANSITIONAL]` code introduced.

## D-5.10 Operator action required (D-5)

- None for backend (no migration, no edge deploy).
- **For TEST/retest:** after review, OTA the business dev channel from MERGED main, then on the dev build open the RSVP wizard → Preview step → tap "Preview public page" and confirm the RSVP preview renders (no white-screen/enlarged-logo), shows Going/Not-going (no ticket tiers/price/checkout), the Going tap shows "This is a preview" + writes nothing, and back returns to the wizard. Also smoke the d_* (fresh draft) and a hand-typed `/rsvp/{ticketed-id}/preview` (redirects to event preview).

## D-5.11 Discoveries for orchestrator (D-5)

- **DISC-1150R2-A (carried forward, NOT introduced here):** `i-proposed-tr2-route-by-event-type.mjs` is RED on the branch baseline with 6 violations in DO-NOT-TOUCH files (home.tsx, hub/trips.tsx, accept-scanner-invitation.tsx, ScannerHome.tsx) — unrelated scanner/trip routes lacking the helper/allowlist. My change is gate-clean (zero new violations). Recommend a dedicated gate-cleanup ORCH; out of scope here.

---

# D-8 + D-9 (mingla-implementor, 2026-06-17)

Implemented per the binding SPEC `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1150_RETEST_D6_D9.md` §D-8/§D-9. D-6/D-7 were OUT of this dispatch's scope (parallel workstream); `RsvpPublicBody.tsx`, `ParallaxCoverShell.tsx`, and the public-page CTA were NOT touched.

## Commits
- D-9: `0636b3e06`
- D-8: `b8ee98baa`

## D-9 — published-RSVP edit no longer bounces to the events list

### Files
- `mingla-business/app/rsvp/[id]/edit.tsx` (guard hardened, ~12 lines incl. comment)
- `mingla-business/app/rsvp/[id]/__tests__/editPublishedExitGuard.test.ts` (NEW, 5 tests)

### Old → New
- **Before:** the edit-published safe-exit fired on `resolvedLiveEvent === null && !businessEventQuery.isLoading`. A DISABLED React-Query query (`enabled = isAuthReady && eventId`) reports `isLoading=false`; during the `isAuthReady` flicker (fresh push, empty `useLiveEventStore`) the exit bounced a published RSVP to `/(tabs)/hub/events` before the fetch ran.
- **Now:** gated on `isAuthReady && resolvedLiveEvent === null && !businessEventQuery.isLoading && !businessEventQuery.isFetching` — bounces ONLY when the lookup is genuinely exhausted. Strictly more conservative; can never bounce earlier than before. All four terms were already in the effect dep array.
- **Why:** SPEC §D-9 / SC-5. RSVP-route-only; ticketed `app/event/[id]/edit.tsx` untouched (DO-NOT-TOUCH honored).

### Test + fails-on-revert
- 4 pure-logic predicate tests (auth-flicker, in-flight fetch, event-found, exhausted) + 1 source-binding assertion that the shipped guard carries `isAuthReady` + `!isFetching`.
- **fails-on-revert verified at `0636b3e06`** by TRUE LINE DELETION of the `isAuthReady &&` + `!businessEventQuery.isFetching` terms → the source assertion FAILS; restored → 5/5 PASS.

## D-8 — RSVP detail keeps Blasts + Group-chat (comms, not money)

### Files
- `mingla-business/app/rsvp/[id]/index.tsx` (2 handlers + 2 ActionTiles, ~28 lines)
- `mingla-business/src/services/marketing/marketingAudienceService.ts` (`resolveRsvpGuests`, ~95 lines)
- `mingla-business/src/hooks/marketing/useEventBuyers.ts` (optional `eventType` arg + event_type probe + RSVP routing, ~55 lines)
- `mingla-business/src/services/marketing/__tests__/marketingAudienceService.test.ts` (+5 tests, additions only)
- `mingla-business/src/hooks/marketing/__tests__/useEventBuyers.rsvpAudience.test.ts` (NEW, 5 tests)
- `mingla-business/app/rsvp/[id]/__tests__/index.test.tsx` (D-4 DROP assertion narrowed + D-8 block; file is net-ADDED vs origin/main → append-only clean)

### Old → New
- **Group chat tile:** routes `/event/{id}/group-chat` (REUSE-SAFE — event-scoped, event_type-agnostic; the RSVP already has a `conversations` row). Allowlist comment present.
- **Blasts tile:** routes `/event/{id}/blasts`. `resolveEventBuyers` reads `orders` → an RSVP has zero orders → empty audience forever. NEW `resolveRsvpGuests(eventId)` reads `event_rsvps` `rsvp_status='going'` + `approval_status='approved'` (`guest_name/guest_email/guest_phone`), maps them onto the same aggregate/mask/consent path, and returns the IDENTICAL `{ rows, reach }` shape so the shared Blasts UI + `BuyerRow` render unchanged. `useEventBuyers` gained an optional `eventType` arg; when omitted (the DO-NOT-TOUCH `app/event/[id]/blasts` screen passes none) the hook probes `events.event_type` once and routes RSVP events to `resolveRsvpGuests`. The two existing callers (`blasts/index.tsx`, `useResolveAudience.ts`) are unaffected (optional arg, auto-probe).
- Tiles reuse the shared `ActionTile` (icons `send`/`chat`, matching the ticketed event detail) so the Android opaque-glass policy is inherited automatically — no new glass surface authored.

### RLS confirmation (the FLAG in SPEC §10 / Open Q-3)
DB probe (read-only, project `gqnoajqerqhnvulmnyvv`): `event_rsvps` carries `event_rsvps_host_read` (cmd `r`/SELECT) with USING `EXISTS (SELECT 1 FROM events e WHERE e.id = event_rsvps.event_id AND biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank('event_manager'))`. The Blasts host is a logged-in business user managing the brand, so the going+approved guest read is covered. **No migration / RPC / RLS widening needed — client query only.** (Same policy the existing ORCH-1150 going-count probe in `businessEvents.ts:596` already reads under.)

### Tests + fails-on-revert
- `marketingAudienceService.test.ts`: `resolveRsvpGuests` reads `event_rsvps` (NOT `orders`), maps going-guests, empty/error/UUID-guard paths (+5).
- `useEventBuyers.rsvpAudience.test.ts`: imports `resolveRsvpGuests`, routes by `event_type`, optional-arg + probe, type-gated `audienceEnabled`, type-keyed cache (5).
- `index.test.tsx` D-8 block: Group-chat + Blasts tiles present, route to the event-scoped screens, and carry ≥2 route-by-event-type allowlist comments.
- **fails-on-revert verified at `b8ee98baa`**: TRUE LINE DELETION of the `resolvedType === "rsvp" ? resolveRsvpGuests : resolveEventBuyers` hook branch → hook test FAILS; deletion of the two tiles → detail test FAILS (2 D-8 tests). Restored → 50/50 PASS across the 4 D-8/D-9 suites; 207/207 across the full marketing suite (no regression).

## Gate / tsc / test results (D-8 + D-9)
- `npx tsc --noEmit -p tsconfig.json` (mingla-business): 333 errors WITH my changes, 333 WITHOUT (stash compare) → ZERO new errors; none in any touched file (`edit.tsx`/`index.tsx`/`marketingAudienceService.ts`/`useEventBuyers.ts`/tests). The 333 are pre-existing repo-wide (checkout buyer.tsx implicit-any, RTL render-test module resolution, richEditor, search adapters, payments native modules, DraftEvent.category fixtures).
- `node .github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs`: the RSVP screen produces ZERO violations (both `/event/...` pushes allowlisted). The gate still exits non-zero on **6 PRE-EXISTING** violations in DO-NOT-TOUCH files (home.tsx:414, hub/trips.tsx:379/388/397, accept-scanner-invitation.tsx:94, ScannerHome.tsx:119) — identical with my changes stashed, files untouched vs origin/main. See DISC-1150R2-A. My change is gate-clean.
- `node .github/scripts/test-append-only-check.js`: 10 passed, 0 failed (my `marketingAudienceService.test.ts` = additions-only; `index.test.tsx` = net-ADDED vs origin/main).
- jest (D-8/D-9 suites): 50/50 PASS. Marketing regression: 207/207 PASS.

## DO-NOT-TOUCH compliance (D-8 + D-9)
- NOT touched: `app/event/[id]/**` (only ROUTED to), `RsvpPublicBody.tsx`, `ParallaxCoverShell.tsx`, `GroupChatPanel.tsx`, `EditPublishedScreen` ticketed behavior, `blasts/index.tsx` UI, any migration/RPC. The Blasts audience is a pure client query under existing RLS. D-6/D-7 files (public-page CTA, parallax shell) left for the parallel workstream.

## Operator action required (D-8 + D-9)
- None for backend: no migration, no edge deploy, no RPC. `event_rsvps` read runs under the existing `event_rsvps_host_read` policy.
- For TEST (clean build bound to THIS worktree, per SPEC §11): (1) tap Edit on a PUBLISHED (scheduled/live) RSVP from the Hub → must open the RSVP-aware EditPublishedScreen, not the events list; also cold deep-link `/rsvp/{uuid}/edit?mode=edit-published`. (2) Open an RSVP detail → tap Group chat (existing conversation loads, host can post) and Blasts (audience = going `event_rsvps` guests, NOT "no buyers"). (3) Regression: a published TICKETED event Edit + Blasts behave identically to before.

## Verdict
D-8 + D-9 implemented and verified at the source/unit/gate layer; live-fire (device) deferred to TEST per SPEC (the reproducer-bound items were capped at probable upstream due to the shared-Metro blocker).

---

# D-10 — Going / Maybe / Can't-go CTA + new 'maybe' RSVP status  (commit f2d4237d9)

## Summary
Added a third RSVP status `'maybe'`: an OPTIONAL attendee — auto-approved, CAP-NEUTRAL, on the notify list, never occupying a seat. Mirrors `not_going`'s cap-neutrality but stays on the guest list. The public CTA is now THREE equal-width buttons (Going · Maybe · Can't go) with lucide icons. 6 additive layers, no behavior change to capacity/drain/headcount.

## Migration (written, NOT applied — orchestrator applies)
- **File:** `supabase/migrations/20261012000000_orch_1150_rsvp_maybe.sql` (prefix strictly > head `20261011000001`; checked anchor + sibling worktrees). Atomic `BEGIN/COMMIT`, idempotent, `NOTIFY pgrst` at end.
- **DDL summary:**
  - (a) **CHECK widen** — `DROP CONSTRAINT IF EXISTS event_rsvps_rsvp_status_check` + `ADD … CHECK (rsvp_status IN ('going','not_going','waitlisted','maybe'))`.
  - (b) **RLS widen** — re-create `event_rsvps_guest_update_own` `WITH CHECK (user_id = auth.uid() AND rsvp_status IN ('going','not_going','maybe'))`.
  - (c) **`submit_event_rsvp`** (full `CREATE OR REPLACE`) — validation now allows `'maybe'` (else `rsvp_status_invalid`); a `'maybe'` branch BEFORE the capacity math sets `v_status='maybe'; v_approval='approved'` (auto-approved, no cap consumption, `waitlisted_at` stays NULL). The confirmed-headcount SUM WHERE stays `going AND approved` UNCHANGED. GRANT after `$$;`.
  - (d) **`host_list_rsvp_guests`** (`DROP` + `CREATE`, RETURNS TABLE) — order CASE gets a `WHEN r.rsvp_status='maybe' THEN 3` bucket (else→4). GRANT after `$$;`.
  - NOT touched: `fn_rsvp_drain_on_capacity_freed`, `business_public_events_view.rsvp_going_count`, `host_bulk_approve_rsvps` (verify-only — they already exclude maybe).

## Edge function
- `supabase/functions/public-submit-rsvp/index.ts` — request type + validation accept `'maybe'`; A4-NEW anon contact gate is status-agnostic and still requires name+email+phone for a Maybe link guest (not relaxed). `verify_jwt=false` (unchanged, config.toml untouched). `deno check` PASS.

## Service / shared types
- `mingla-business/src/services/rsvpEvents.ts` — `SubmitPublicRsvpInput.rsvpStatus` + `SubmitPublicRsvpResult.status` +`'maybe'`.
- `mingla-business/src/services/rsvpApprovals.ts` — `RsvpStatusValue` +`'maybe'`.
- `packages/event-rendering/offeringCta.ts` — `RsvpCtaState` + `ResolveRsvpCtaInput.guestStatus` +`'maybe'`; `resolveRsvpCta` adds `if (guestStatus === "maybe") return { state: "maybe" }` after not_going (pending still outranks).

## Component CTA (RsvpPublicBody.tsx)
- 3 equal-size buttons, each `flex:1` via the new shared `ctaBtn` style — **Going · Maybe · Can't go**.
- **Icons:** per-icon NAMED `import { Check, HelpCircle, X } from "lucide-react-native"` (NOT a barrel) → Going=`Check`, Maybe=`HelpCircle`, Can't-go=`X` (size 19). All three already in the ORCH-1137 web-shim used-set → lucide gate PASS, no shim edit.
- Going = filled accent; Maybe = `accentWash` + accent border (secondary); Can't-go = outlined (tertiary). `overflow:'hidden'` clips opaque-Android fill (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
- Contact gate extended: Going AND Maybe both require `contactReady`; not_going ungated.
- Maybe is NON-TERMINAL: a resolved Maybe shows "You're marked as Maybe — we'll keep you posted. Switch to Going anytime." + a Switch-to-Going button + a Can't-go decline (no dead end). Contact form + plus-row hide when `maybeResolved`.
- `PublicEventPage.tsx` `rsvpSubmit` callback types widened (`'maybe'`) — necessary type cascade of the widened service/component; NOT in the ticketed DO-NOT-TOUCH branch (`:594-721`), no behavior change.

## Console (RsvpGuestConsole.tsx)
- New memoized `maybe = guests.filter(g.rsvpStatus==='maybe')`; read-only **"Maybe (N)"** section after Going, before Waitlist. Rows = name + `+plusCount`, no approve/deny. Trailing `Icon name="users"` (in-house Icon has no help glyph; reused an existing glyph to avoid widening Icon.tsx). Going count unchanged.

# D-7 — parallax content-layering safety-net  (commit 3296edb6b)

## Summary
No source defect in current `RsvpPublicBody`: it already passes a bare `<View>` of children into the SHARED `@mingla/offering-rendering` `ParallaxCoverShell` (ORCH-1138 cover<content<chrome fix), with NO competing `zIndex`/`position`/`marginTop`/`backgroundColor` on that wrapper — byte-identical to the proven ticketed `FoundationEventPreview` body. Seth's inversion = most likely a stale build. Belt-and-suspenders only: a fails-on-revert source-structure test. `ParallaxCoverShell.tsx` NOT touched (shared, test-guarded; its `ParallaxCoverShell_native_stacking.test.ts` stays green 7/7). If a fresh build still inverts → new on-device shell dispatch.

# Tests + gates
- `resolveRsvpCta.maybe.orch1150r2.test.ts` (3) — maybe state resolution.
- `rsvpMaybeMigration.orch1150r2.test.ts` (7) — migration-source CHECK/RLS/RPC widen + I-PROPOSED-1150-MAYBE-NOT-IN-CAP (cap SUM still going+approved only).
- `RsvpPublicBody.maybeCta.orch1150r2.test.ts` (6) — 3-button CTA, per-icon lucide imports, maybe submit path, contact gate covers Maybe, response copy.
- `RsvpPublicBody.parallaxLayering.orch1150r2.test.ts` (3) — D-7 layering (bare View child of shared shell, no competing stacking style).
- `supabase/migrations/__tests__/orch_1150_maybe.test.sql` — live T1 (accept), T2 (cap-neutral), T3 (next-going-after-maybe fits), T4 (invalid rejected); orchestrator runs post-apply.
- **fails-on-revert verified at 3296edb6b** (HEAD): deleting the migration maybe-resolve branch + the RsvpPublicBody lucide import + the offeringCta maybe branch → 4 test failures across the 3 source suites; restored → 26/26 green.
- **Gates:** `npx tsc --noEmit` (mingla-business) introduces ZERO new errors (333 baseline = 333 after, all pre-existing testing-library/cross-package noise). `deno check public-submit-rsvp` PASS. `i-proposed-tr2-route-by-event-type.mjs` — 6 violations, ALL pre-existing in files I did not touch (ScannerHome/home/hub-trips/accept-scanner-invitation). `i-proposed-1137-biz-web-lucide-real.mjs` PASS (INV-1..4). `ParallaxCoverShell_native_stacking.test.ts` 7/7 green.

# DO-NOT-TOUCH compliance
Did NOT edit `ParallaxCoverShell.tsx`, `FoundationEventPreview.tsx`, the ticketed `PublicEventPage` branch (`:594-721`), the capacity/drain/headcount SQL, or the parallel workstream's files (`app/rsvp/[id]/edit.tsx`, `app/rsvp/[id]/index.tsx`, `marketingAudienceService.ts`). `PublicEventPage.tsx` edit was a minimal RSVP-submit type cascade outside the ticketed branch (flagged above).

# Operator action required
1. **APPLY the migration** (orchestrator, via MCP/Management API — dev history drift-corrupted): `supabase/migrations/20261012000000_orch_1150_rsvp_maybe.sql`.
2. After apply, run `supabase/migrations/__tests__/orch_1150_maybe.test.sql` (T1–T4) against the linked remote.
3. **Deploy edge fn** from MERGED main: `public-submit-rsvp` (keep `verify_jwt=false`).
4. **Re-OTA** business per the EAS gotchas runbook (the D-7 fix is build-freshness; the CTA is JS-only).
