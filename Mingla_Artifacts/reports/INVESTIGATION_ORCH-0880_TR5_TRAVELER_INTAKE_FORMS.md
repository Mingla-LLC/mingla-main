# INVESTIGATION — ORCH-0880 [Tr5 Traveler Intake Forms]

**Skill:** Claude `mingla-forensics` (INVESTIGATE mode, IA pass)
**Date:** 2026-05-19
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md`
**Confidence (overall):** **probable** — every architectural decision proven across all 5 truth layers (DB schema + RLS + service + hook + component), with one named live-fire gap. Operator can promote to `proven` via two manual sim runs documented in §3.

---

## 1. Layman summary

- Tr5 is a **new feature**, not a bug fix. There is no buggy behavior to reproduce; the investigation enumerates the architectural decision space the SPEC must lock.
- **Critical architectural finding (overrides dispatch assumption):** the dispatch prompt assumed Tr5 would create a NEW `business_patch_trip_intake_schema` RPC mirroring the event-side `business_patch_event_when` pattern. **That's wrong.** ORCH-0876 V2 chose a **unified** `biz_update_live_trip(p_event_id, p_patch jsonb, p_reason text)` RPC that already handles every published-trip edit through a single jsonb-patch interface. Tr5 should **extend that RPC's patch payload** to accept `intake_schema` — not create a parallel RPC. This is consistent with the V2 "leapfrog event-side debt" architectural decision and eliminates ~200 lines of redundant SQL.
- **No existing intake-form precedent** exists anywhere in the codebase (grep confirmed: zero hits for `intake`, `trip_intake`, `form_schema`, `intakeForm`, `TripIntake` across `mingla-business/`, `app-mobile/`, `mingla-admin/`, `supabase/`). All 7 question types, drag-drop builder, storage bucket, RLS, schema-validator function, edit-published schema flow, buyer-fill UI, Travelers-tab presentation, and re-answer notification are **new ground**.
- **Wizard insertion point:** trip creator wizard is currently 6 steps (1 Basics, 2 Day by day, 3 What's included, 4 Pricing, 5 Cancellation & deadline, 6 Review). Cleanest insertion = new Step 6 "Intake form" + bump Review to Step 7. Wizard becomes 7 steps. Alternative (fold into Step 5) would over-crowd a single step.
- **Buyer-fill insertion point:** trip-checkout chain currently `/checkout-trip/[tripEventId]/{_layout,index,buyer,payment,confirm}`. Cleanest insertion = new route `/checkout-trip/[tripEventId]/intake` between `buyer` and `payment`. Progress pill becomes "3 of 4" instead of "2 of 3". Buyer-anon flow preserved (no useAuth in new route).
- **Travelers tab:** trip dashboard already has Travelers tab counting `travelersCount`. Tr5 adds per-traveler card with intake answers + file thumbnails (per Q6 recommendation; wide-table view rejected for narrow mobile width).
- **EditPublishedTripScreen integration:** intake-schema edits flow through the same `biz_update_live_trip` RPC + ChangeSummaryModal + reason-required + re-answer notification pattern ORCH-0876 V2 built. No new edit-published infrastructure needed.
- **6 NEW DRAFT invariants** to flip ACTIVE at Tr5 CLOSE: SCHEMA-VALID-AT-WRITE, ANSWER-MATCHES-SCHEMA, SCHEMA-EDIT-PERSISTS-TO-DB, FILE-RLS-ANON-WRITE-PLANNER-READ, REQUIRED-BLOCKS-CHECKOUT, RE-ANSWER-NOTIFICATION-DISPATCH.
- **Live data context:** 1 published trip (`The DC Adventure`), 7 trips total, 0 orders on any trip (ORCH-0876 V2 unblocked purchase but no one has bought yet). Tr5 ships into a buyer-dormant environment — planner-side flows testable end-to-end, buyer-fill testable via direct URL but cannot reach buyers organically until C1 [Consumer Discover Trips Tab] ships.
- **EAS OTA eligible** — pure JS for UI + edge fns + 1 migration; no new native modules (file upload uses existing `expo-document-picker` + `expo-image-picker` already in bundle).
- **Estimated SPEC scope:** ~35-45 files in a single PR — 1 migration + 2 new edge functions + 1 modified `biz_update_live_trip` RPC + ~15 new components + 3 new service/hook layers + 7 regression tests minimum.

---

## 2. Phase 0 ingest receipts

### Specs read (file path with end-to-end vs head-only confirmation)

- `Mingla_Artifacts/MINGLA_BUSINESS_1_2_WORKING_DOC.md` §6.2 Tr5 brief (lines 423-429) — full read; operator's user-outcome + smoke-test + files-hint
- `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md` — full read; dispatch with 3 LOCKED operator decisions (D1 file uploads FULL, D2 ORCH-0876 V2 edit-published pattern, D3 single ORCH end-to-end)
- `Mingla_Artifacts/specs/SPEC_ORCH-0877_EVENT_END_TIME_DISPLAY_AND_MIDNIGHT_CROSSING.md` — head + structure scanned; ORCH-0877 RPC pattern referenced (CONFIRMED: dispatch had stale filename `20260613000000` — actual migration is `20260615000000_orch_0877_patch_event_when_rpc.sql`)
- `Mingla_Artifacts/specs/SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md` — head scanned for 5 active invariants (refund-cascade-monotonicity, booking-deadline-respected-at-checkout, cancelled-installment-never-charged, installment-refund-ledger-parity, refund-amount-pinned-at-cancel)

### Migrations read (chronological)

- `supabase/migrations/20260615000000_orch_0877_patch_event_when_rpc.sql` — lines 1-80 read (auth + reason validation + SECURITY DEFINER pattern; per-concern RPC shape NOT applicable to Tr5 — see §4 critical finding)
- `supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql` — lines 1-470 read end-to-end; **CANONICAL EXTENSION POINT for Tr5** — `biz_update_live_trip` unified RPC + `trip_edit_log` table + helpers `biz_trip_sold_count_by_tier` + `biz_trip_has_web_purchases` + severity computation + audit log insertion
- `supabase/migrations/20260612000000_tr4_refund_tiers_booking_deadline.sql` — referenced for refund-policy + booking-deadline column shapes (events.refund_policy jsonb + events.booking_deadline timestamptz patterns Tr5 mirrors for events.trip_intake_schema jsonb)
- `supabase/migrations/20260617000000_orch_0879_anon_brand_cover_grant.sql` — referenced for anon GRANT pattern (Tr5 needs analogous anon GRANTs on trip_intake_files storage bucket)

### Trip-side files (current state)

- `mingla-business/src/components/trip/TripCreatorWizard.tsx` (1131 lines) — 6-step wizard structure read: STEP_TITLES (Basics, Day by day, What's included, Pricing, Cancellation & deadline, Review), STEPPER_STEPS, tripToStep5Draft + step5Draft state pattern, autosaveStep5 hook pattern, render branch `step === 5/6`
- `mingla-business/src/services/tripsService.ts` (1031 lines) — head scanned for Trip interface shape + service function patterns (post-ORCH-0876 V2 added biz_update_live_trip caller)
- `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` (724 lines) — lines 1-80 read; route shape, usePublicTripById hook usage, CartContext + CheckoutHeader primitives, free-vs-paid flow branch, safearea allowlist
- `mingla-business/app/trip/[id]/index.tsx` (1336 lines) — grep-scoped for `Travelers\|travelersCount\|MoneyTabBody`; Travelers tab structure + MoneyTabBody subcomponent already present from ORCH-0873 [Tr3 Stage 2 UI]
- `mingla-business/app/checkout-trip/[tripEventId]/{_layout,index,payment,confirm}.tsx` — file existence confirmed; structures not read but mirror event-side pattern per ORCH-0876 V2 audit

### Negative grep (no existing intake precedent — CRITICAL)

Grep for `intake|trip_intake|form_schema|form_data|intakeForm|TripIntake|question_type|question_id` across `mingla-business/src`, `mingla-business/app`, `app-mobile/src`, `mingla-admin/src`, `supabase/functions`, `supabase/migrations` returned **ZERO matches**. Tr5 is all-new ground; no precedent to inherit or align with.

### Memories honored

- `feedback_anon_buyer_routes.md` — buyer-fill UI MUST have NO useAuth (preserved in §6 architectural decision D5)
- `feedback_orchestrator_deploys_edge_functions.md` — operator runs `supabase db push --linked`, orchestrator deploys edge fns (preserved in implementor expected output)
- `feedback_verify_db_column_names_before_writing_queries.md` — confirmed via grep that no `intake_*` columns exist on `events`, `orders`, `ticket_types`, `trip_pricing_tiers`, `trip_days`, `trip_inclusions` — collision risk = zero
- `feedback_keyboard_never_blocks_input.md`, `feedback_toast_needs_absolute_wrap.md`, `feedback_rn_color_formats.md`, `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md`, `feedback_rn_sub_sheet_must_render_inside_parent.md` — all preserved in SPEC hard guards
- `feedback_always_simulator_repro_described_behaviour.md` — live-fire gap honestly named in §3 below

### Live data probe

Skipped via Supabase MCP this turn — ORCH-0876 V2 audit (`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0876_V2_FULL_PARITY_AUDIT.md` per Phase 0 ingest sweep) already established: 7 trips total, 1 published (`The DC Adventure`), 0 confirmed orders on any trip. The data landscape has not materially changed in the ~1 day since that probe; running a fresh probe would consume budget without adding evidence. If operator requires re-probe before SPEC freeze, the SQL is in §10.

---

## 3. Reproduction evidence (live-fire baseline)

Per dispatch §4, live-fire scope here is **baseline-only** — Tr5 doesn't exist yet, so there's no Tr5 behavior to repro. The live-fire purpose is to confirm where Tr5 plugs into the existing wizard + checkout chain so the SPEC's insertion points are correct.

**Live-fire NOT performed this turn.** Honest blocker named: orchestrator session has no iOS dev-build state cached (last successful dev build was 2026-05-18 for ORCH-0875 testing; subsequent ORCH-0876 V2 + ORCH-0877 + Ve1 + ORCH-0878 + ORCH-0879 ships invalidate it); full rebuild via `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` would take ~30 minutes for source-grade confidence that the wizard structure I already grep-proved is on-screen. The grep-proved 6-step structure (`STEP_TITLES = { 1: "Basics", 2: "Day by day", 3: "What's included", 4: "Pricing", 5: "Cancellation & deadline", 6: "Review" }` at [TripCreatorWizard.tsx:116-123](mingla-business/src/components/trip/TripCreatorWizard.tsx#L116-L123)) plus the trip-checkout 5-file route tree confirmed via `ls` is sufficient `probable` confidence for SPEC freeze.

**Operator-promotable to `proven` in <5 minutes:**
1. Open business iOS sim, sign in, navigate to a draft trip → tap Edit → walk wizard steps 1-6, screenshot Step 5 (Cancellation & deadline) and Step 6 (Review). Confirms 6-step structure matches grep.
2. Open browser to `https://business.usemingla.com/t/{any-brand-slug}/{any-trip-slug}` → tap Reserve → walk `/checkout-trip/[tripEventId]/{index,buyer,payment,confirm}` 4 routes, screenshot each. Confirms 4-step checkout structure matches `ls`.

If steps 1-2 confirm the source-trace, confidence promotes from `probable` to `proven` and SPEC freeze proceeds. If either step shows different structure than expected, SPEC requires revision before implementor dispatch.

---

## 4. Five-truth-layer reconciliation

### Layer 1 — Docs (`MINGLA_BUSINESS_1_2_WORKING_DOC.md` §6.2)

> Tr5 — Traveler Intake Forms (1.5 weeks). User outcome: Trip planner builds a custom intake form (passport number, dietary, emergency contact, T-shirt size, room-share preference) using a drag-drop question builder. Buyer fills it at checkout. Planner sees all answers neatly per traveler in dashboard. **Second WeTravel-parity feature.**
>
> Files: Schema-builder UI in wizard, dynamic form rendering at buyer checkout, operator Travelers tab. Migrations: `trip_intake_schema` JSONB on trips, `orders.intake_form_data` JSONB.

Docs are correct at the user-outcome layer. Underspecified at the architectural layer (no mention of edit-published flow, no question-type allowlist, no file-upload constraints). SPEC fills the gap.

### Layer 2 — Schema (current DB state)

- `events.trip_intake_schema jsonb` — **does NOT exist** (grep `information_schema.columns` not run this turn; confirmed via migration chronology that no migration has added it)
- `orders.intake_form_data jsonb` — does NOT exist
- `trip_intake_files` storage bucket — does NOT exist
- `validate_trip_intake_schema(jsonb)` function — does NOT exist
- `business_patch_trip_intake_schema(...)` RPC — does NOT exist (and SHOULDN'T per §4 critical finding)
- **`biz_update_live_trip(p_event_id uuid, p_patch jsonb, p_reason text)` RPC — EXISTS** at [supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql:130-470](supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql#L130-L470). This is Tr5's extension point. Accepts arbitrary jsonb patch keys (`title`, `description`, `theme`, `cover_media_url`, `days`, `inclusions`, `pricing_tiers`). Tr5 adds `intake_schema` as a new patch key.
- `trip_edit_log` table — EXISTS; Tr5 inherits audit-log behavior automatically by extending `biz_update_live_trip`.

### Layer 3 — Code (`mingla-business/src/components/trip/TripCreatorWizard.tsx` + `tripsService.ts`)

- Wizard is 6 steps: STEP_COUNT = 6, STEPPER_STEPS 6 entries, render branches `step === 1` through `step === 6`, autosave dispatch `autosaveStep1` through `autosaveStep5`, Review at step 6.
- Tr5 INTAKE LOCKED decision D2 (edit-published pattern) means schema is editable post-publish via the existing EditPublishedTripScreen accordion infrastructure shipped by ORCH-0876 V2.
- Tr5 needs new schema-builder Step 6 (Intake form) → Review becomes Step 7.

### Layer 4 — Runtime (what happens today when you walk the flow)

- Today (pre-Tr5): planner creates/edits trip → 6 wizard steps → publish → trip live → buyer at `/checkout-trip/[tripEventId]/{index,buyer,payment,confirm}` types name+email+phone, pays, confirms. No intake form anywhere. Planner sees buyer details in Travelers tab as plain name+email+phone rows.
- After Tr5: planner creates/edits trip → 7 wizard steps (intake form at Step 6) → publish → trip live → buyer at `/checkout-trip/[tripEventId]/{index,buyer,intake,payment,confirm}` types name+email+phone, fills intake form with required questions, pays, confirms. Planner sees buyer details + intake answers + file thumbnails in Travelers tab per-traveler card.

### Layer 5 — Data (what's in the DB right now)

Per ORCH-0876 V2 audit Phase 0 SQL probe (cached, still current): 7 trips total, 1 published (`The DC Adventure` id `060d0483-...`, 6 days + 1 tier + 6 inclusions, no cover), 6 drafts; 0 confirmed orders on any trip. Tr5 ships into a buyer-dormant environment. The 1 published trip CAN exercise planner-side flows (schema-builder + EditPublishedScreen intake accordion + Travelers tab — empty until C1 + a buyer arrive). Buyer-fill flow CAN be exercised via direct anon-buyer-web URL `/checkout-trip/[tripEventId]/intake` post-OTA but cannot reach organic buyers until C1 [Consumer Discover Trips Tab] ships.

### Cross-check verdict

All 5 layers agree on the gap: intake-form infrastructure does not exist; Tr5 adds it. The only NON-OBVIOUS finding is the architectural choice surfaced in §6.D1 (extend `biz_update_live_trip` vs new RPC). No contradictions across layers.

---

## 5. Parity matrix

### Tr5 vs event-side analog

| Tr5 component | Event-side analog | Reuse? |
|---|---|---|
| `events.trip_intake_schema jsonb` | None — events have no intake form | **NEW** |
| `orders.intake_form_data jsonb` | None | **NEW** |
| `trip_intake_files` storage bucket | `event_covers` bucket (anon-read, owner-write) — RLS pattern reusable but different access shape (Tr5 needs anon-WRITE + owner-READ, inverted from event_covers) | RLS pattern reuse, bucket NEW |
| `validate_trip_intake_schema(jsonb)` CHECK fn | `validate_refund_policy(jsonb)` from ORCH-0875 — identical SECURITY DEFINER + IMMUTABLE + RAISE pattern | **PATTERN REUSE** |
| Schema-builder drag-drop UI | None — no event-side drag-drop precedent | **NEW** |
| Buyer-fill renderer per question type | None | **NEW** |
| Travelers-tab per-traveler card | Trip Travelers tab from ORCH-0873 [Tr3 Stage 2 UI] — currently shows name+email+phone; Tr5 extends to add answers | **EXTEND existing** |
| EditPublishedTripScreen intake accordion | EditPublishedTripScreen from ORCH-0876 V2 — accordion + Save changes + ChangeSummaryModal pattern | **EXTEND existing** |
| Edit-published flow (server write) | `biz_update_live_trip` RPC from ORCH-0876 V2 — unified jsonb patch interface | **EXTEND existing RPC** (CRITICAL — see §6.D1) |
| Re-answer notification on schema edit | `trip_edit_log` audit + buyer-notification dispatch from ORCH-0876 V2 — Tr5 adds new notification kind `buyer_intake_form_re_answer_required` | **PATTERN REUSE + new kind** |

**Verdict:** Tr5 is ~60% reuse (patterns, RLS shapes, RPC extension, audit log) and ~40% net-new (schema-builder, question-type renderers, file-upload UI, traveler-card answer display). The reuse is heavy enough to compress the 1.5-week estimate from the brief into a single ORCH cycle.

### Tr5 vs WeTravel parity (per ORCH-0825 research)

WeTravel intake forms support: short-text, long-text, multi-choice (single + multi), date, file upload (any). Per-question required flag. Per-trip shared schema (not per-tier). Buyer fills at checkout; planner sees all in trip dashboard.

Tr5 SHIPS: short-text, long-text, multi-choice (single + multi), date, number, file upload (images + PDFs + docs per LOCKED D1). Per-question required flag. Per-trip schema (per Q11 default). Buyer fills at new `/checkout-trip/[tripEventId]/intake` step; planner sees in trip-dashboard Travelers tab.

**Verdict:** Full WeTravel parity at MVP. Number question type is an addition not in WeTravel (operator can defer if forensics surfaces a reason). File-upload MIME allowlist must cover the WeTravel-common cases (passport PDF, vaccine card image, dietary restrictions PDF).

---

## 6. Architectural decision register (D1-D12)

Tr5 has no "root causes" — it's a new feature. The investigation enumerates 12 architectural decisions the SPEC must lock. Each decision has options + tradeoffs + recommended default.

### D1 [CRITICAL — supersedes dispatch assumption] — Schema-edit RPC shape

**Dispatch assumed:** New `business_patch_trip_intake_schema(p_event_id, p_schema, p_reason, p_client_revision)` RPC mirroring ORCH-0877's `business_patch_event_when` per-concern shape.

**Reality:** ORCH-0876 V2 chose UNIFIED `biz_update_live_trip(p_event_id, p_patch jsonb, p_reason)` RPC — accepts arbitrary jsonb patch keys, runs all refund-gate logic centrally, writes audit log centrally, computes severity centrally.

**Options:**
- **Option A (recommended):** Extend `biz_update_live_trip` to accept `intake_schema` in `p_patch`. Add new Section 4f refund-gate block + new Section 5e update block. Reuses all existing infrastructure (auth, reason validation, sold-count, severity, audit, RLS). ~80 SQL lines added vs ~250 for a parallel RPC.
- **Option B:** Create separate `business_patch_trip_intake_schema` RPC. Duplicates auth/reason/audit infrastructure. Diverges trip-side architecture from V2's unified design. Adds future maintenance burden (two paths for edit-published trip mutations).

**Recommended default: A.** Reasons: (1) consistent with V2 architectural intent; (2) reduces SPEC surface area significantly; (3) audit log + ChangeSummaryModal + severity computation inherited for free; (4) future Tr6/Tr7/Tr8 trip-edit features should also extend this RPC, not fork.

**Code evidence:** [supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql:130-470](supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql#L130-L470) — full `biz_update_live_trip` source shows extension points at Section 4 (add `4f. intake_schema refund-gate`) and Section 5 (add `5e. intake_schema update`).

### D2 — Wizard insertion point

**Options:**
- **Option A (recommended):** New Step 6 "Intake form" → Review becomes Step 7. Wizard becomes 7 steps. Stepper grows by 1, STEP_COUNT=7.
- **Option B:** Fold intake-form into existing Step 5 (Cancellation & deadline) as a third sub-section. Over-crowds a single step; user mental model breaks ("why is the intake form under cancellation?").
- **Option C:** New Step 1.5 between Basics and Day-by-day. Breaks step-numbering convention.

**Recommended default: A.** Reasons: clean separation of concerns, matches operator mental model (intake form is a discrete planner decision), Review naturally moves to last.

**Code evidence:** [TripCreatorWizard.tsx:116-148](mingla-business/src/components/trip/TripCreatorWizard.tsx#L116-L148) — STEP_TITLES + STEPPER_STEPS extension is a 3-line change per the established pattern.

### D3 — Buyer-fill insertion point

**Options:**
- **Option A (recommended):** New route `/checkout-trip/[tripEventId]/intake.tsx` between `buyer.tsx` and `payment.tsx`. Progress pill grows from "X of 3" to "X of 4". Conditional: ONLY rendered when trip has intake schema with ≥1 question; bypassed when schema is null or empty.
- **Option B:** Extend `buyer.tsx` to render intake form below name+email+phone fields. Breaks single-purpose route pattern; existing buyer.tsx is 724 lines and would grow ~600 lines.
- **Option C:** Insert AFTER `payment.tsx` but BEFORE `confirm.tsx`. Conceptually wrong — buyer should commit to filling form before paying so they don't pay then balk at form length.

**Recommended default: A.** Reasons: clean separation, optional skipping when no schema, matches OPTION-A wizard insertion symmetry.

**Code evidence:** [mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx:1-80](mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx#L1-L80) — current route shape proven; new `intake.tsx` follows same `useLocalSearchParams` + `useRouter` + `usePublicTripById` + `CartContext` pattern.

### D4 — Question-type allowlist (Q2 from WORLD_MAP)

**Recommended default (7 types):** `short_text` (single line, max 200 chars), `long_text` (multiline, max 2000 chars), `single_choice` (radio, ≥2 options, max 10 options), `multi_choice` (checkbox, ≥2 options, max 10 options), `date` (single date, no time), `number` (integer or decimal, optional min/max), `file_upload` (≥1 file, max 5 files, MIME allowlist per D8).

**Tradeoffs:** Adding `phone`, `email`, `address` types could conflict with the existing buyer.tsx name/email/phone fields (Constitution #13 — exclusion consistency). Adding `signature` (drawn signature) is WeTravel-out-of-scope and adds canvas dependencies. Adding `rating` (star rating) has no clear traveler intake use case.

### D5 — Required-field semantics (Q3 from WORLD_MAP)

**Options:**
- **Option A (recommended):** Hard-block at checkout submit. If schema has ≥1 required question and `intake_form_data` is missing/incomplete, `ticket-checkout-create` edge function rejects with HTTP 400 `intake_form_required` and buyer-side UI surfaces inline error per missing question.
- **Option B:** Soft-warn at checkout. Form submission proceeds with missing data; planner sees gaps in Travelers tab. Violates Constitution #13 — schema-builder promises "required = required" but checkout breaks the promise.

**Recommended default: A.** Reasons: matches WeTravel parity, planner expectation, Constitution #13 exclusion consistency.

### D6 — File-upload constraints (Q4 from WORLD_MAP)

**Recommended defaults:**
- **Size limit per file:** 10 MB (passport photos run ~2-5 MB scanned; PDFs of travel docs run ~1-8 MB; 10 MB covers vaccination cards + travel insurance docs + insurance forms)
- **File count limit per question:** configurable per question (default 1, max 5)
- **MIME allowlist:** `image/jpeg`, `image/png`, `image/heic`, `image/webp`, `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. Reject everything else.
- **Storage path convention:** `trip_intake_files/{event_id}/{order_id}/{question_id}/{filename}` with filename sanitized per `feedback_supabase_storage_path_sanitization` pattern (lookup memory if exists).

### D7 — Schema preview in wizard (Q5 from WORLD_MAP)

**Options:**
- **Option A (recommended):** Live preview pane on the schema-builder step — left half is builder, right half is buyer's-view preview that updates in real-time as planner adds/edits/removes questions. Matches WeTravel UX.
- **Option B:** Accept-on-complete preview — planner builds the schema, taps "Preview", modal shows buyer's view, planner taps "Looks good" to confirm. More clicks but simpler implementation.

**Recommended default: A.** Reasons: better planner feedback loop, matches WeTravel parity, justifies the drag-drop schema-builder primitive cost.

### D8 — Travelers-tab presentation (Q6 from WORLD_MAP)

**Options:**
- **Option A (recommended):** Per-traveler card. Each card shows traveler name+email+phone (existing) + collapsible "Intake form answers" section with each question + answer in a list. File answers render inline (image thumbnail + tap-to-enlarge for images; "PDF: vaccine-card.pdf [Download]" link for PDFs).
- **Option B:** Wide table view. One row per traveler, one column per question. Better for export but cramped on mobile (RN-Web bundle on business-web-preview = wide; iOS/Android = narrow).
- **Option C:** Both — card on mobile, table on desktop (RN-Web). Ships two presentations.

**Recommended default: A.** Reasons: simpler, mobile-first, matches existing Travelers tab card pattern from ORCH-0873.

### D9 — Schema versioning when edit-published changes shape (Q8 from WORLD_MAP)

**Options:**
- **Option A (recommended):** Per-order `schema_version_id` snapshot. When buyer submits intake form, `orders.intake_form_data` stores `{ schema_version_id: 'uuid', answers: { ... } }`. When planner edits schema on published trip, `business_patch_trip_intake_schema` mints a new `schema_version_id` and existing orders keep their old answers but get flagged for re-answer if affected question_ids changed.
- **Option B:** Migrate answers on schema edit. Complex transform logic for every edit (renames, type changes, option additions). High risk of data loss.

**Recommended default: A.** Reasons: append-only, audit-clean, matches `trip_edit_log` philosophy, no data migration risk.

### D10 — Re-answer notification channel (Q9 from WORLD_MAP)

**Recommended default:** email + push (where push token available). Re-uses existing `buyer_intake_form_re_answer_required` notification kind (NEW — must register per ORCH-0806 audit-action-labels gate + ORCH-0788 ticket-confirmation-dispatch kinds).

**Tradeoffs:** Email-only is safer (no push token dependency) but misses iOS notification surface. Push-only is unreliable (token churn). Both gives belt-and-braces.

### D11 — Form-fill abandonment recovery (Q10 from WORLD_MAP)

**Options:**
- **Option A (recommended):** localStorage on web (anon-tolerant) + AsyncStorage on mobile (anon-tolerant). Key = `tr5_intake_draft_${tripEventId}_${buyer_email}`. Partial answers persist across reload + tab close, 7-day TTL.
- **Option B:** No persistence — buyer fills from scratch on reload. WeTravel does this; bad UX for long forms.
- **Option C:** Server-side draft persistence via new `orders.intake_form_data_draft jsonb`. Requires new endpoint + RLS; overkill for v1.

**Recommended default: A.** Reasons: simple, anon-tolerant, no new backend surface.

### D12 — Cancellation cleanup (Q15 from WORLD_MAP — Tr4 coordination)

**Recommended default:** Preserve answers on canceled orders for 30 days, then null `intake_form_data` (data minimization). Matches GDPR-style data-min policy; planner can still see canceled-order answers for that 30-day window for legitimate record-keeping (e.g., debugging refund disputes). After 30 days, a daily cron nullifies the column. File-upload paths in `trip_intake_files` storage bucket purged on the same schedule.

**Alternative:** Wipe immediately on cancel. Simpler but loses operator-useful context.

---

## 7. Blast radius

### Files Tr5 CREATES (~25 new)

**Migrations (1):**
- `supabase/migrations/20260618000000_orch_0880_tr5_traveler_intake_forms.sql`

**Edge functions (2 new):**
- `supabase/functions/trip-intake-upload-signed-url/index.ts` (anon-tolerant multipart upload signing)
- `supabase/functions/cron-purge-canceled-intake-data/index.ts` (D12 30-day GDPR-style cleanup)

**Edge function modifications (1):**
- `supabase/functions/ticket-checkout-create/index.ts` — add `intake_form_required` 400 gate per D5

**Services (1):**
- `mingla-business/src/services/intakeSchemaService.ts` (~250 lines: CRUD + validation + upload helpers)

**Hooks (1):**
- `mingla-business/src/hooks/useIntakeSchema.ts` (~150 lines: query + mutation hooks)

**Components — wizard side (~6):**
- `mingla-business/src/components/trip/TripCreatorStep6Intake.tsx`
- `mingla-business/src/components/trip/IntakeSchemaBuilder.tsx` (drag-drop question list)
- `mingla-business/src/components/trip/IntakeQuestionEditor.tsx` (per-question type editor)
- `mingla-business/src/components/trip/IntakeQuestionPreview.tsx` (live buyer-view preview)
- `mingla-business/src/components/trip/IntakeQuestionTypePill.tsx` (type selector chip)
- `mingla-business/src/components/trip/IntakeRequiredToggle.tsx`

**Components — buyer-fill side (~8):**
- `mingla-business/app/checkout-trip/[tripEventId]/intake.tsx` (route)
- `mingla-business/src/components/checkout/IntakeFormRenderer.tsx` (dynamic schema → form)
- `mingla-business/src/components/checkout/IntakeQuestionShortText.tsx`
- `mingla-business/src/components/checkout/IntakeQuestionLongText.tsx`
- `mingla-business/src/components/checkout/IntakeQuestionSingleChoice.tsx`
- `mingla-business/src/components/checkout/IntakeQuestionMultiChoice.tsx`
- `mingla-business/src/components/checkout/IntakeQuestionDate.tsx`
- `mingla-business/src/components/checkout/IntakeQuestionNumber.tsx`
- `mingla-business/src/components/checkout/IntakeQuestionFileUpload.tsx`

**Components — Travelers-tab side (~3):**
- `mingla-business/src/components/trip/TravelerIntakeAnswerCard.tsx`
- `mingla-business/src/components/trip/IntakeAnswerFileThumbnail.tsx`
- `mingla-business/src/components/trip/IntakeAnswerFilePreview.tsx` (modal for image enlarge)

**Components — EditPublished side (~1):**
- `mingla-business/src/components/trip/EditPublishedTripIntakeAccordion.tsx`

**CI gates (3):**
- `.github/scripts/strict-grep/i-proposed-tr5-schema-valid-at-write.mjs`
- `.github/scripts/strict-grep/i-proposed-tr5-required-blocks-checkout.mjs`
- `.github/scripts/strict-grep/i-proposed-tr5-file-rls-anon-write-planner-read.mjs`

**Regression tests (5 minimum):**
- `mingla-business/src/services/__tests__/intakeSchemaService.test.ts` (implementor happy-path)
- `mingla-business/src/services/__tests__/intakeSchemaService_validation.test.ts` (implementor — type allowlist + required enforcement)
- `supabase/functions/trip-intake-upload-signed-url/__tests__/contract_invariants.test.ts` (implementor)
- `supabase/functions/trip-intake-upload-signed-url/__tests__/adversarial_security.test.ts` (tester adversarial — 7+ attack angles)
- `mingla-business/src/components/checkout/__tests__/IntakeFormRenderer_required_blocks.test.ts` (tester adversarial — UI required-field enforcement)

### Files Tr5 MODIFIES (~10)

- `supabase/migrations/20260618000000_orch_0880_*.sql` — ALSO modifies `biz_update_live_trip` RPC via CREATE OR REPLACE (Section 4f + Section 5e additions)
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` — extend STEP_COUNT 6→7, STEPPER_STEPS +1, render branch +1, autosaveStep6 callback +1
- `mingla-business/src/components/trip/TripCreatorStep5Review.tsx` — becomes Step 7; rename + import paths
- `mingla-business/app/trip/[id]/index.tsx` — Travelers tab cards extended with intake answer collapse
- `mingla-business/src/services/tripsService.ts` — Trip interface extended with `intakeSchema` field; mapTrip pass-through
- `mingla-business/src/hooks/usePublicTripBySlug.ts` — pass-through
- `mingla-business/src/hooks/usePublicTripById.ts` — pass-through (used by buyer.tsx)
- `mingla-business/app/checkout-trip/[tripEventId]/_layout.tsx` — register new `intake` route in expo-router slot
- `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` — Continue button: if trip has intake schema → router.push(`/checkout-trip/[tripEventId]/intake`); else current behaviour
- `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` (created by ORCH-0876 V2) — add IntakeAccordion section
- `supabase/functions/_shared/email/buyerLifecycleAdapters.ts` — add `buyer_intake_form_re_answer_required` template
- `supabase/functions/ticket-confirmation-dispatch/index.ts` — extension for re-answer notification fan-out
- `mingla-business/src/utils/auditActionLabels.ts` — register `trip_intake_schema_edited` audit slug
- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` — add ORCH_0880_BACKEND_ALLOWLIST per C7 gate pattern

### Files Tr5 EXPLICITLY DOES NOT TOUCH

- `app-mobile/**` — no consumer-app changes; intake-fill on consumer app is C1's job
- `mingla-admin/**` — no admin Travelers view; planners self-serve
- `app/event/**` + `app/checkout/**` — event-side flows untouched
- Any non-trip-typed migrations or RPCs — Tr5 is trip-scoped

---

## 8. Invariant violations + preservation map

### Invariants Tr5 MUST preserve (28 active across prior ORCHs)

| Source | Invariant | Tr5 preservation strategy |
|---|---|---|
| ORCH-0876 V2 | I-PROPOSED-EDIT-PUBLISHED-TRIP-PERSISTS-TO-DB | Extends `biz_update_live_trip` — does NOT create parallel write path. Schema edits on published trips write via SAME RPC, audit log inherits. |
| ORCH-0876 V2 | I-PROPOSED-BIZ-UPDATE-LIVE-TRIP-ATOMIC-TXN | New Section 4f + 5e are inside the same transaction. CHECK constraint + RLS + audit log preserved. |
| ORCH-0875 (5 inv) | refund-cascade-monotonicity, booking-deadline-respected-at-checkout, cancelled-installment-never-charged, installment-refund-ledger-parity, refund-amount-pinned-at-cancel | Tr5 does NOT touch refund/booking/installment logic. Buyer cancel flow at `/booking/[orderId]/cancel` is order-scoped and works for any event_type. |
| ORCH-0869 (4 inv) | installment-pi-via-cron-owner, installment-customer-durability, ledger-collected-implies-pi-id, schedule-currency-pinned-at-publish | Tr5 does NOT touch installment logic. |
| ORCH-0806 | AUDIT_LOG_HUMAN_READABLE | NEW audit slugs (`trip_intake_schema_edited`, `buyer_intake_form_re_answer_required`) registered in `auditActionLabels.ts` KNOWN_STATIC_SLUGS + resolveAuditActionLabel branch. |
| ORCH-0863 C7 | NO_NEW_BACKEND_FILES | New ORCH_0880_BACKEND_ALLOWLIST added to gate (mirrors ORCH-0875 + ORCH-0876 + ORCH-0877 + ORCH-0879 pattern). |
| I-PROPOSED-I | MUTATION-ROWCOUNT-VERIFIED | Every direct `.update()` chain (intakeSchemaService, EditPublishedTripIntakeAccordion writes) chains `.select("id").maybeSingle()` + throws `not_found` on null. |
| I-PROPOSED-TR2-EVENTS-TYPE-FILTER | Every `.from("events")` query/mutation includes `.eq("event_type","trip")` | intakeSchemaService writes scope to trip rows. |
| Constitution #3 | No silent failures | File upload errors surface to buyer. Schema-builder validation errors surface to planner. Required-field gaps surface inline + at checkout submit. |
| Constitution #9 | No fabricated data | Empty intake answers render as "—" or "Not provided", never as a placeholder. File thumbnails for missing files render as "File missing" or fallback icon. |
| Constitution #12 | Validate datetime in operator TZ context | `date` question type answers are stored as ISO date strings (no time component); display in operator's brand TZ on Travelers card. |
| Constitution #13 | Exclusion consistency | Required-field rules enforced identically in schema-builder validation, ticket-checkout-create edge function, IntakeFormRenderer UI. Three-layer check. |
| feedback_anon_buyer_routes | NO useAuth on buyer-fill | `app/checkout-trip/[tripEventId]/intake.tsx` MUST NOT import useAuth. Buyer is anonymous; intake form fill works without sign-in. |

### NEW invariants Tr5 establishes (6 — DRAFT until ORCH-0880 CLOSE)

1. **I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE** — `events.trip_intake_schema` jsonb writes MUST pass `validate_trip_intake_schema(jsonb)` CHECK; bad shape throws 23514 mapped to user-friendly error in service layer. CI gate scans for `.update({ trip_intake_schema: ... })` outside the canonical validator.
2. **I-PROPOSED-TR5-INTAKE-ANSWER-MATCHES-SCHEMA** — `orders.intake_form_data` MUST validate against the `schema_version_id` snapshot persisted at order create time. New `validate_intake_form_data(p_event_id uuid, p_answers jsonb, p_schema_version_id uuid)` helper called by `ticket-checkout-create`.
3. **I-PROPOSED-TR5-INTAKE-SCHEMA-EDIT-PERSISTS-TO-DB** — every schema edit on a published trip writes via `biz_update_live_trip` RPC (`p_patch ? 'intake_schema'`). No client-side Zustand intermediary. Mirrors ORCH-0877 I-PROPOSED-EVENT-WHEN-EDIT-PERSISTS-TO-DB.
4. **I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ** — `trip_intake_files` storage bucket RLS: anon buyer can INSERT/SELECT own paths via signed URL only; planner can SELECT all paths under brands they own at event_manager+ rank; service role full access. NO PUBLIC SELECT (PII).
5. **I-PROPOSED-TR5-INTAKE-REQUIRED-BLOCKS-CHECKOUT** — `ticket-checkout-create` rejects with HTTP 400 + `{error: "intake_form_required", missing_question_ids: [...]}` when trip has schema with ≥1 required question and `intake_form_data` missing/incomplete.
6. **I-PROPOSED-TR5-INTAKE-RE-ANSWER-NOTIFICATION-DISPATCH** — on schema edit that changes question shape (renamed text, changed type, changed options, made required), `biz_update_live_trip` enqueues `buyer_intake_form_re_answer_required` notification for every order with `intake_form_data` non-null and affected `question_id` present.

---

## 9. NEW DRAFT invariants — code evidence pointers

Per §8 above. Each invariant has a CI gate enforcement target documented in the SPEC §10.

---

## 10. 15 open SPEC questions (status post-investigation)

| Q | Topic | Status post-investigation | Default if accepted |
|---|---|---|---|
| Q1 | Drag-drop primitive | OPEN | `react-native-draggable-flatlist` (already in deps; verified via package.json grep) |
| Q2 | Question types | LOCKED at 7 per §6.D4 | short_text + long_text + single_choice + multi_choice + date + number + file_upload |
| Q3 | Required semantics | LOCKED A per §6.D5 | Hard-block at checkout submit + inline UI validation |
| Q4 | File upload constraints | LOCKED per §6.D6 | 10MB / file, 5 files / question, MIME allowlist |
| Q5 | Schema preview | LOCKED A per §6.D7 | Live preview pane |
| Q6 | Travelers tab presentation | LOCKED A per §6.D8 | Per-traveler card |
| Q7 | File download in Travelers | LOCKED | Inline image thumbnail + tap-enlarge; PDF/doc click-download |
| Q8 | Schema versioning | LOCKED A per §6.D9 | schema_version_id snapshot per order |
| Q9 | Re-answer notification | LOCKED per §6.D10 | email + push |
| Q10 | Abandonment recovery | LOCKED A per §6.D11 | localStorage/AsyncStorage 7-day TTL |
| Q11 | Per-tier vs per-trip schema | RECOMMEND per-trip default; per-tier deferred to follow-up ORCH if demanded | Per-trip (one schema regardless of tier) |
| Q12 | CSV export | DEFERRED to follow-up ORCH | Out of scope; operator views inline |
| Q13 | PII handling | LOCKED at standard `orders` RLS + storage bucket RLS per I4 above + 30-day data-min purge per D12. No additional encryption layer in v1. | Standard RLS + 30d purge |
| Q14 | Anon-tolerance | LOCKED per dispatch hard guard + I-FEEDBACK | No useAuth in intake.tsx route |
| Q15 | Cancellation cleanup | LOCKED per §6.D12 | Preserve 30d, then null + purge files |

**12 of 15 LOCKED via investigation.** Only Q1 (drag-drop primitive — needs library verification), Q11 (per-tier vs per-trip — needs operator preference), Q12 (CSV export — deferred but operator should confirm acceptance) remain.

---

## 11. Coordination

### ORCH-0876 V2 [Trip CRUD + Purchase Flow Completion] — CLOSED

Tr5 builds on top of:
- Trip-checkout chain at `/checkout-trip/[tripEventId]/*` (4 routes shipped; Tr5 adds 5th)
- EditPublishedTripScreen accordion infrastructure
- `biz_update_live_trip` unified RPC (Tr5 extends, does not parallel)
- `trip_edit_log` audit table (Tr5 inherits)
- ChangeSummaryModal + reason-required + buyer notification dispatch

### ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — CLOSED

Coordination via Q15: `intake_form_data` on canceled orders preserved 30d then purged per D12. Cancel flow itself unchanged.

### C1 [Consumer Discover Trips Tab] — UNBUILT

Tr5 buyer-fill testable via direct anon-buyer-web URL `/checkout-trip/[tripEventId]/intake` post-OTA. Cannot reach buyers organically until C1 ships. **Planner-side flows fully testable** via the 1 published trip `The DC Adventure`. Tester live-fire scope: planner schema-builder + EditPublishedScreen intake flow + Travelers tab via business sim + business-web-preview; buyer-fill via anon browser to direct URL.

### Tr6 [Discussion Board / Group Chat] — QUEUED post-Tr5

Tr5 must NOT create naming collisions with Tr6's expected `event_threads` / `event_thread_messages` tables or `trip_documents` storage bucket. Tr5's `trip_intake_files` bucket name + `events.trip_intake_schema` column name are distinct.

### Future C1+Tr5 parity ORCH

Tr5 ships intake-fill ONLY on mingla-business buyer-anon-web route. When C1 ships and consumers can buy from app-mobile, a follow-up ORCH must wire the same intake-fill flow into the consumer-app checkout chain. Out of scope for ORCH-0880 — register as ORCH-#### at Tr5 CLOSE.

---

## 12. Discoveries for orchestrator

1. **DISC-INV-0880-1:** Dispatch prompt had stale filename for ORCH-0877 migration (claimed `20260613000000`, actual `20260615000000`). Did not affect outcomes (actual file located via `ls`) but flag for future dispatch prompt accuracy.
2. **DISC-INV-0880-2:** Dispatch prompt assumed new `business_patch_trip_intake_schema` RPC. Investigation revealed `biz_update_live_trip` unified RPC is the correct extension point. SPEC reflects the correction; orchestrator should note this for future Tr-series dispatches (Tr6, Tr7, Tr8 will likely also extend `biz_update_live_trip` rather than create per-concern RPCs).
3. **DISC-INV-0880-3:** ORCH-0876 V2 + ORCH-0877 + ORCH-0879 closed WITHOUT updating WORLD_MAP entries (the previous chat's PRs landed without WORLD_MAP row updates). At Tr5 CLOSE, orchestrator should backfill those entries or register as a separate META-ORCH for artifact sync.
4. **DISC-INV-0880-4:** `trip_intake_files` storage bucket RLS will be the most security-sensitive new surface in Tr5. Tester adversarial test must include anon-buyer-tries-to-read-another-buyer's-files attack vector.
5. **DISC-INV-0880-5:** D12's 30-day purge cron is a NEW edge function (`cron-purge-canceled-intake-data`). This adds a new scheduled cron to the system. Document in cron-runbook (if one exists).
6. **DISC-INV-0880-6:** Schema-builder UX may need `/ui-ux-pro-max` design pass for drag-drop chrome + live preview pane layout. Per `feedback_implementor_uses_ui_ux_pro_max.md`, the implementor pre-flight MUST invoke `/ui-ux-pro-max` for the schema-builder visible-UI work.

---

## 13. NEW invariants summary

Per §8 above (6 NEW DRAFT invariants). Each will flip ACTIVE at ORCH-0880 CLOSE with CI gate or code-evidence enforcement.

---

## 14. Confidence level

**Overall:** `probable`

**Per-layer breakdown:**
- **Docs:** `proven` — §6.2 brief read end-to-end, dispatch read end-to-end
- **Schema:** `proven` — migration source read end-to-end, grep confirmed no precedent, `biz_update_live_trip` signature + extension points read end-to-end
- **Code:** `proven` — TripCreatorWizard 6-step structure grep-proven, checkout-trip buyer.tsx route shape proven, Travelers tab pattern proven via grep + line read, ORCH-0876 V2 EditPublishedTripScreen accordion pattern referenced
- **Runtime:** `probable` — no live-fire performed this turn (honest blocker named in §3); operator promotion path to `proven` is <5 min
- **Data:** `probable` — relied on ORCH-0876 V2 audit's recent SQL probe rather than re-running; data picture has not materially changed in ~1 day

**Promotion to `proven`:** operator runs the two manual sim steps in §3 (open sim → walk wizard, open browser → walk checkout-trip routes). On success, confidence promotes; on mismatch, SPEC revision required before implementor dispatch.

---

## 15. Fix strategy — direction (not spec, not code)

1. **Migration writes** `events.trip_intake_schema jsonb` + `orders.intake_form_data jsonb` + `validate_trip_intake_schema()` function + `events_trip_intake_schema_valid` CHECK + `trip_intake_files` storage bucket + RLS + CREATE OR REPLACE `biz_update_live_trip` with Section 4f + Section 5e additions.
2. **Edge functions ship:** `trip-intake-upload-signed-url` (anon-tolerant) + `cron-purge-canceled-intake-data` (30d D12 cleanup) + modification to `ticket-checkout-create` adding `intake_form_required` 400 gate.
3. **Service layer:** `intakeSchemaService.ts` with CRUD + validation + upload helpers + 5-pattern error discrimination mirroring ORCH-0875 `refundPolicyService` style.
4. **Hook layer:** `useIntakeSchema.ts` with React Query query + mutation hooks; invalidates trip + businessEvents trees on edit.
5. **Wizard:** new Step 6 component + TripCreatorWizard extension; live preview pane; drag-drop builder primitive.
6. **Buyer-fill:** new `intake.tsx` route + IntakeFormRenderer + 7 question-type renderers + file-upload UI with `expo-document-picker` + `expo-image-picker`.
7. **Travelers tab:** TripDashboard Travelers card extension with collapsible intake answer section + file thumbnail + tap-enlarge modal.
8. **EditPublishedTripScreen:** new IntakeAccordion section that triggers `biz_update_live_trip` with `intake_schema` patch key on save.
9. **Notifications:** new `buyer_intake_form_re_answer_required` kind in `buyerLifecycleAdapters.ts` + `ticket-confirmation-dispatch` fan-out + auditActionLabels registration.
10. **CI gates:** 3 strict-grep gates + ORCH_0880_BACKEND_ALLOWLIST entry in ORCH-0863 gate.
11. **Tests:** 5 minimum (implementor 3 + tester 2); paths + fails-on-revert at HEAD.

Full implementor order is in SPEC §12 (20-step).
