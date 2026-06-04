# IMPLEMENTATION — META-ORCH-1059 [experiences-business-parity] · SUB-B · DRAFT LIFECYCLE + VIDEO COVER + EDIT/DASHBOARD

**ORCH:** META-ORCH-1059 [experiences-business-parity] — Sub-B
**Skill:** mingla-implementor (Claude)
**Date:** 2026-06-02
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/` on branch `meta-orch-1059-experiences-business-parity`
**Anchors:** `DESIGN_META-ORCH-1059_EXPERIENCES_LIFECYCLE.md` (Sub-A/B/C), `DESIGN_META-ORCH-1059_WIZARD_STOPS_PRICING.md`, Sub-A reports + migration `20260824000000_meta_orch_1059_sub_a_experience_stops.sql`.
**Status:** implemented and verified (local gates green; live RPC/cover verification is the tester's post-deploy live-fire — the migration must be applied first).

**Comms-ledger acks (this turn):** COMMS-0014 + COMMS-0016 (one-ticket → existing `ticket-checkout-create`; no parallel money fn — the new RPC touches no Stripe and writes exactly one sellable ticket), COMMS-0002 (new migration + its test land in the SAME commit as the ORCH-0863 C7 backend allowlist). No new cross-ORCH discovery requiring a ledger write; two pre-existing Sub-A/trip discoveries flagged in §9 for the orchestrator.

---

## 0. SELF-SPEC'D CONTRACT (this stage had no separate forensics spec)

### Diagnosis (the operator-reported gap, proven in code)
- The experience wizard wrote the `events` row ONLY at publish (`biz_create_experience` called from `ExperienceCreatorWizard.handleSubmit`). Therefore **no `eventId` existed during the wizard** → the video-capable `CoverPicker` (which keys on a row `eventRowId` for trim→upload→webhook) had no row to write to, so Step 5 was a stub ("Add cover art later"). And **no draft row was persisted**, so there was no `/experience/[id]` or `/experience/[id]/edit` screen — `routeForEventRow` sent experiences to a dead `/experience/coming-soon` stub.
- Root cause: experiences were NOT on the EVENT draft-first model (create a server draft up front, then publish/update in place).

### Contract (what Sub-B builds)
1. **Draft-first lifecycle.** The wizard creates a server draft row up front (on first Continue from Step 1) via the existing `biz_create_experience(p_brand_id, p_payload, p_publish:=false)`, holding the returned `event_id` in wizard state. A new RPC `biz_publish_experience(p_event_id, p_payload, p_publish)` UPDATEs that existing row: on `publish=true` it flips status→`scheduled`/visibility→`public`/`published_at`, REPLACES `experience_stops`, materialises `event_dates`, and writes EXACTLY ONE `ticket_types` row at the resolved total (I-1); on `publish=false` it re-saves the draft without materialising dates (preview-only / unsellable). Same auth + `event_manager` permission gate as create. No parallel money fn.
2. **Video-capable cover in Step 5.** `CoverTarget` gains `kind: "experience"` (mirrors `event`/`trip`: `brandId` + `eventRowId` + `coverMediaApplyMode`). `CoverPicker` handles it identically to `event`/`trip` (Library + GIFs + Pexels + **video**), persisting to the draft row's `events.cover_media_*` columns. Step 5 mounts the real `CoverPickerSheet` on the draft id.
3. **Dashboard + edit.** `app/experience/[id]/index.tsx` (hero + status pill + date-model subline + action grid: Edit primary / Public page / Brand page / Share / Cancel, all states) and `app/experience/[id]/edit.tsx` (status dispatch → wizard in edit-mode loading the draft by id). `routeForEventRow` experiences route `draft → /experience/{id}/edit`, else `/experience/{id}`. Hub list rows tap through via `routeForEventRow`.

### Hard guards honoured
- **ONE-TICKET invariant (I-1):** `biz_publish_experience` soft-deletes prior tickets then INSERTs exactly one at the resolved total → existing `ticket-checkout-create` engine reads it unchanged. Machine-asserted (test B-02) + fails-on-revert.
- **No parallel money fn (I-6):** the RPC touches no Stripe surface (test B-07).
- **Publish-time dates (I-4):** `event_dates` materialise only inside `IF p_publish` (test B-05/B-06).
- **Currency de-GBP (I-7):** brand `default_currency` default, USD fallback (test B-08).
- New migration + its test → ORCH-0863 C7 allowlist same commit (COMMS-0002).
- No new external API (Mapbox/Pexels/Giphy already exist; the cover video pipeline is reused verbatim).

---

## 1. Files changed (receipts)

### NEW

| File | Layer | What it does |
|---|---|---|
| `supabase/migrations/20260825000000_meta_orch_1059_sub_b_publish_experience.sql` | L1/L2 | `biz_publish_experience(uuid, jsonb, boolean)` SECURITY DEFINER — UPDATEs an existing experience draft; on publish flips lifecycle + replaces stops + materialises dates + rewrites the single ticket at the resolved total. Mirrors Sub-A's resolution logic, collapsed to one ticket. |
| `supabase/functions/__tests__/biz_publish_experience.draft_lifecycle.test.ts` | L7 | 8-assertion source-level regression (one-ticket, UPDATE-not-INSERT, publish-gated dates, type/permission/no-Stripe, currency). |
| `mingla-business/src/services/experienceDetailService.ts` | L4 | `getExperienceDetail(eventId)` — loads one experience events-row + stops + single ticket + dates; defensive `event_type='experience'` filter. |
| `mingla-business/src/hooks/useExperienceDetail.ts` | L5 | Auth-gated React Query hook + `experienceDetailKeys` for the dashboard/edit. |
| `mingla-business/src/utils/experienceDateSubline.ts` | L5 | `formatExperienceDateSubline()` — the ONE owner of the one-time / recurring / multi-date subline (+ "Ended" / "Draft"). |
| `mingla-business/src/components/experience/ExperienceCoverStep.tsx` | L5 | Wizard Step 5 cover authoring — preview + Add/Change button → `CoverPickerSheet` with `kind:"experience"` target; "preparing draft" state until the up-front draft id resolves. |
| `mingla-business/app/experience/[id]/index.tsx` | L5 | Operator dashboard — hero (cover + status pill + subline), action grid (Edit primary / Public page / Brand page / Share), pricing + stops summary, cancel CTA, all states (loading/error/not-found/draft/populated). |
| `mingla-business/app/experience/[id]/edit.tsx` | L5 | Status dispatch — draft/scheduled/live → `ExperienceCreatorWizard` in edit-mode seeded from the loaded draft; ended/cancelled → read-only. |

### MODIFIED

#### `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx`
- **Before:** wrote the `events` row only at publish via `biz_create_experience`; Step 5 was a stub GlassCard ("Add cover art later"); no edit-mode.
- **Now:** creates a server draft up front (`ensureDraft()` calls `biz_create_experience(..., false)` on first Continue from Step 1, idempotent); holds `experienceId` in state; Step 5 mounts the real `ExperienceCoverStep` on the draft id; Publish + Save-as-draft both call `biz_publish_experience(experienceId, payload, publish)`; new `existingExperienceId` + `initialDraft` + `initialCover` props seed full edit-mode (title/stops/modes/pricing/when/cover); RPC error copy extended.
- **Why:** root-cause fix (draft-first lifecycle + cover + edit). **Lines:** ~120 changed/added.

#### `mingla-business/src/components/ui/coverTarget.ts`
- **Before:** `kind: "event" | "trip"`.
- **Now:** `kind: "event" | "trip" | "experience"` — experiences are events-table rows using the same `events.cover_media_*` columns, so the variant mirrors event/trip exactly. **Lines:** ~6.

#### `mingla-business/src/components/ui/CoverPicker.tsx`
- **Before:** non-brand video target hardcoded `"event"`.
- **Now:** passes `"experience"` for the experience target (call-site clarity); the hook normalizes it to the `"event"` server path. All non-brand persistence (`uploadEventCoverMedia` keyed on `eventRowId`) already handled the experience variant. **Lines:** ~6.

#### `mingla-business/src/hooks/useEventCoverVideoUpload.ts`
- **Before:** `CoverVideoTargetKind = "event" | "brand"`.
- **Now:** adds `"experience"`; derives `serverTarget = target === "brand" ? "brand" : "event"` and routes every server-facing call + cache-invalidation through it. Experiences ride the event-cover pipeline verbatim (same columns + events-row id) — **no server-side video-pipeline change needed.** **Lines:** ~12.

#### `mingla-business/src/hooks/useExperienceDraftAdapter.ts`
- **Before:** When-state seeded to fixed defaults.
- **Now:** accepts an optional `initialWhen` so edit-mode seeds the When step from the loaded draft. **Lines:** ~12.

#### `mingla-business/src/utils/routeForEventRow.ts`
- **Before:** experiences → `/experience/coming-soon` (dead stub).
- **Now:** `status==='draft' ? '/experience/${id}/edit' : '/experience/${id}'` (mirror event/trip). **Lines:** ~8.

#### `mingla-business/app/(tabs)/hub/experiences.tsx`
- **Before:** "Your experiences" cards were inert `<View>` (dead taps).
- **Now:** each card is a `Pressable` → `routeForEventRow({event_type:'experience', id, status})` + a lifecycle status chip (Draft / Scheduled / Live / Ended / Cancelled) + a11y label. **Lines:** ~70.

#### `mingla-business/src/components/experience/ExperienceReviewCards.tsx`
- **Before:** `onAcceptAll` was a REQUIRED prop wired to an "Accept all" button + heading "Review suggested experiences" — but the Hub no longer passes `onAcceptAll` (Sub-A removed it at the call site only), producing a pre-existing tsc error + a dead button calling an undefined prop.
- **Now:** `onAcceptAll` is OPTIONAL; the button renders only when supplied; heading is "Suggested experiences" (matches Sub-A's stated intent). Cleared the pre-existing baseline tsc error in a file in my blast radius. **Lines:** ~10.

#### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
- Added the Sub-B migration + test to `META_ORCH_1059_BACKEND_ALLOWLIST` (C7 passes — COMMS-0002).

#### `.github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs`
- Added `EXPERIENCE_ROUTE_PREFIX` to the caller-exempt set so internal `/experience/[id]/*` navigation is exempt exactly as event/trip route files are (forward-compat; the gate currently only bans `/event/` + `/trip/`).

#### `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts` (existing test — APPEND only)
- Added a `META-ORCH-1059 Sub-B` describe block (4 tests): experiences route to `/experience/{id}/edit` (draft) / `/experience/{id}`; no `coming-soon` in the experience branch; dashboard + edit routes exist; the Sub-B migration UPDATEs (no events INSERT) + writes exactly one ticket. Pure addition (append-only gate safe).

---

## 2. Spec traceability (self-spec criteria → evidence)

| Criterion | Status | Evidence |
|---|---|---|
| Draft row created up front; eventId held in wizard | PASS | wizard `ensureDraft()` on Step-1 Continue; `experienceId` state. |
| `biz_publish_experience` UPDATEs existing draft (no new events row) | PASS | migration `UPDATE public.events SET`; test B-01. |
| Publish flips scheduled/public/published_at + replaces stops + materialises dates | PASS | migration §8/§9/§11; tests B-04/B-05. |
| Exactly ONE ticket at resolved total (never N) — I-1 | PASS | migration §10 (soft-delete + single insert); test B-02 + fails-on-revert. |
| Save-as-draft updates without publishing; no dates (preview-only) | PASS | dates gated by `IF p_publish`; test B-06. |
| Same auth/permission gate as create; rejects non-experience | PASS | migration §1/§2; test B-07. |
| `CoverTarget` adds `kind:"experience"` mirroring event/trip | PASS | `coverTarget.ts`; tsc-clean. |
| CoverPicker handles experience identically (Library/GIF/Pexels/video) | PASS | `CoverPicker.tsx` + `useEventCoverVideoUpload` `"experience"`→`"event"` server path. |
| Step 5 mounts real CoverPicker on the draft id; persists to cover_media_* | PASS | `ExperienceCoverStep.tsx` → `CoverPickerSheet kind:"experience" eventRowId=draftId`. |
| Dashboard with hero/status/subline/action grid + all states | PASS | `app/experience/[id]/index.tsx`. |
| Edit screen status dispatch loading draft by id | PASS | `app/experience/[id]/edit.tsx` + `initialDraft` seeding. |
| `routeForEventRow` experience branch fixed + allowlist extended | PASS | `routeForEventRow.ts`; strict-grep exempt; audit test (4 green). |
| Hub list rows tap through via routeForEventRow | PASS | `hub/experiences.tsx` Pressable. |
| Migration + test → ORCH-0863 C7 allowlist same commit | PASS | gate run "All checks PASS"; C7 OK. |

---

## 3. Local gate results (captured)

- **Deno test (new RPC):** `deno test --allow-read supabase/functions/__tests__/biz_publish_experience.draft_lifecycle.test.ts` → **8 passed | 0 failed**.
- **Fails-on-revert (mandatory):** injected a SECOND `INSERT INTO public.ticket_types` into the migration → **B-02 FAILED (7 passed | 1 failed)**; restored → **8 passed | 0 failed**. Anchor commit before fix: **`0680c56d96befb39962b7eb385f4e1738b04d3ed`**.
- **tsc (mingla-business):** `node_modules/.bin/tsc --noEmit` → **zero errors in any of my new/modified files** (verified by grepping the full log for every touched path). Total baseline errors dropped 242→**241** (my `onAcceptAll` fix removed one pre-existing error; the remaining 241 are all in untouched files — account.tsx, checkout*, payments, brand-rendering workspace resolution — per Sub-A's documented baseline).
- **jest audit test:** `jest src/services/__tests__/eventType.filter.audit.test.ts` → my 4 new Sub-B tests **all PASS** (25→29 tests). 3 pre-existing failures (trip-source regex matchers) **also fail with my edits stashed** (confirmed baseline 3 failed / 22 passed) — NOT introduced here; flagged §9.
- **strict-grep ORCH-0863:** `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` → **All checks PASS** (C7: zero non-allowlisted backend touches).
- **strict-grep route-by-event-type:** 3 violations — all in untouched files (`home.tsx`, `accept-scanner-invitation.tsx`, `ScannerHome.tsx`), confirmed pre-existing baseline; **none in my touched files** (my hub edit uses `routeForEventRow(...)`, not a hardcoded `/event/`|`/trip/`).

---

## 4. Regression test (mandatory gate)

- **Path:** `supabase/functions/__tests__/biz_publish_experience.draft_lifecycle.test.ts`
- **Happy path (B-01/B-02/B-05):** draft→publish UPDATEs the row + writes exactly one ticket at the resolved total + materialises dates only on publish. Passing run cited §3.
- **Adversarial angle (B-02 + B-06):** B-02 asserts exactly one `ticket_types` INSERT AND that it's not inside a per-stop loop AND prior tickets are soft-deleted — flips on the injected second-insert. B-06 asserts every `event_dates` insert is downstream of the `IF p_publish` gate (a draft save can never leak a sellable date). **`fails-on-revert verified at 0680c56d96befb39962b7eb385f4e1738b04d3ed`.**
- Ships in the same commit as the migration (scoped `git add`).
- Plus 4 client-side audit assertions in `eventType.filter.audit.test.ts` (routing + migration shape).

**Further adversarial angles for the tester (live-fire, post-deploy):** (a) publish an experience, then re-edit it to FREE and re-publish — assert the single ticket flips `is_free=true`/`price_cents=0` and no orphaned second ticket remains; (b) a draft saved twice must still have ZERO `event_dates`; (c) attempt `biz_publish_experience` on an `event_type='event'` row → expect `event_not_an_experience`; (d) checkout an published experience end-to-end through `ticket-checkout-create` to confirm the single ticket sells (I-1 spine).

---

## 5. Deploy / apply instructions (orchestrator owns these)

**Migration — exact command (run from the per-ORCH worktree):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]" && /Users/sethogieva/bin/supabase db push --linked
```
Before running, confirm `/Users/sethogieva/bin/supabase migration list --linked` shows no remote-only rows. The migration is in-order (prefix `20260825000000`, strictly greater than the current max `20260824000000` across all worktrees + origin/main), so a plain `db push` (no `--include-all`) is correct. **Migration filename to apply: `20260825000000_meta_orch_1059_sub_b_publish_experience.sql`.** It defines `biz_publish_experience` only (CREATE OR REPLACE FUNCTION) — idempotent, no destructive DDL, no data backfill, no pre-flight RAISE guards against existing rows, so it is safe to apply.

**Edge functions:** NONE new this stage. The cover video pipeline is reused verbatim (`event-cover-video-*` already deployed). No `_shared` change touches a deployed function. **No edge deploy required for Sub-B.**

**Note:** Sub-A's `mapbox-geocode` edge fn + `MAPBOX_ACCESS_TOKEN` secret are still the open dependency for the stops-builder address picker (Sub-A OD-1/OD-2) — unchanged by Sub-B.

---

## 6. Key decision: the `kind:"experience"` cover target maps to the `"event"` server video path

The dispatch asked to "add 'experience' to the video hook's target param + storage-path/applyMode switch (mirror 'event')." The investigation of `useEventCoverVideoUpload` + `eventCoverVideoProcessingService` showed the server `target` is only ever `"event"` vs `"brand"` — `"event"` writes `events.cover_media_url`, `"brand"` writes `brands.cover_media_url`. **Experiences ARE events-table rows using the same `events.cover_media_*` columns**, so the lowest-risk, correct wiring is: accept `"experience"` as a distinct `CoverVideoTargetKind` for call-site clarity, then normalize it to the `"event"` server path (intent/source/apply/cache-invalidation all keyed on the experience's events-row id). This satisfies the operator's choice (full video-capable picker on the draft row) WITHOUT a risky change to the deployed video edge functions or storage paths. Documented inline in `coverTarget.ts`, `CoverPicker.tsx`, and `useEventCoverVideoUpload.ts`.

---

## 7. Invariant verification

| ID | Preserved? | How |
|---|---|---|
| I-1 ONE-TICKET | Y | soft-delete + single `INSERT INTO ticket_types`; test B-02 + fails-on-revert. |
| I-4 PUBLISH-TIME DATES | Y | `event_dates` inside `IF p_publish`; tests B-05/B-06. |
| I-6 NO PARALLEL MONEY FN | Y | RPC touches no Stripe; checkout stays on `ticket-checkout-create`; test B-07. |
| I-7 CURRENCY DE-GBP | Y | brand.default_currency default, USD fallback; test B-08. |
| I-2 2–5 STOPS ON PUBLISH | Y | publish-gated 2..5 check (mirrors Sub-A); draft 0..5. |
| I-3 ALWAYS-VALIDATED LOCATION | Y | publish-gated place_id/lat/lng check (single-mode inherits stops[0]). |

---

## 8. Cross-surface impact

- **Business iOS + Android (creation + management):** the draft-first wizard, the video-capable cover step, the new dashboard + edit screens, the hub tap-through. Parity automatic (shared `mingla-business` code path).
- **Backend:** one new migration (`biz_publish_experience`) + allowlist. No edge deploy.
- **Buyer/anon Web + Consumer iOS/Android + Admin Web:** unaffected this stage (the public experience page is Sub-C; the consumer deck card is a separate sub-track). A published experience now correctly carries one ticket + cover, which the downstream public RPC reads — positive side effect, no code here.

---

## 9. Discoveries for orchestrator

- **D-1 (Sub-A claimed-but-unapplied ExperienceReviewCards change):** Sub-A's report stated the "Accept all" button + `onAcceptAll` prop were removed and the heading renamed, but `ExperienceReviewCards.tsx` still had the required `onAcceptAll` prop + the button + old heading — a pre-existing tsc error AND a dead button calling an undefined prop. Fixed minimally here (optional prop + conditional button + heading) because the file is in my blast radius. Flag for Sub-A reconciliation.
- **D-2 (3 pre-existing audit-test failures):** `eventType.filter.audit.test.ts` had 3 failing trip-source regex matchers BEFORE my edits (confirmed by stashing my changes: 3 failed / 22 passed). They are brittle regexes that drifted from current `tripsService`/`publicEventsService` source. Not in scope here; register a small fix-the-matchers ORCH.
- **D-3 (create-mode draft persistence):** because the wizard now creates a draft up front, cancelling out of `/experience/create` leaves an empty "Draft" row in the hub list (same behaviour as the event/trip draft-first model). It's editable + deletable; matches the event pattern. No invariant gap.
- **D-4 (Sub-C/D/E still open):** the public experience page (`/exp/...`), the experience checkout entry, the orders/scanner/blasts dashboard tiles, and the edit-after-publish guards remain per the design — Sub-B intentionally omits the order/scanner/blasts tiles cleanly (no dead taps) since those routes don't exist yet.

---

## 10. /goal completion self-check

1. Every self-spec criterion implemented + demonstrated — §2. ✓
2. Regression test green + fails-on-revert at cited hash (`0680c56d…`) — §3/§4. ✓
3. tsc clean on every touched file; Deno test green; strict-grep C7 PASS — §3. ✓ (baseline noise attributed, not introduced.)
4. Constitution: no dead taps (order/scanner tiles omitted, not stubbed-broken); no silent catches (all catch → toast/throw); all async states handled (dashboard + edit loading/error/not-found/draft/populated); one-owner-per-truth (single ticket; one date-subline helper). ✓
5. Edge deploy + verify-first-call — N/A (no new/changed edge function this stage). ✓
