# IMPLEMENTATION — META-ORCH-1059 Wizard: intent picker + per-stop description + premature-validation fix

**Skill:** mingla-implementor (Claude parity mirror)
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/` on branch `meta-orch-1059-experiences-business-parity`
**Date:** 2026-06-02
**Status:** implemented and verified (source + tsc + jest + deno; live `db push` is the orchestrator's step)

---

## Self-spec (the three operator-requested changes)

### CHANGE 1 (BUG) — premature "Every stop needs a name." on Step-2 entry

**Operator symptom:** finish Step 1, press Continue, land on Step 2, and immediately see the
"every stop needs a name" error before any interaction.

**Root cause (CONFIRMED, differs from the dispatch hypothesis):** the inline component-level
gating in `ExperienceStopsStep.tsx` / `ExperiencePricingStep.tsx` was ALREADY correct (every
inline error is gated on `showErrors`). The premature error was a **server-side toast**:

- The wizard uses a draft-first lifecycle (Sub-B). On leaving Step 1, `goNext` calls
  `ensureDraft()` → `biz_create_experience(..., p_publish:=false)`.
- Both `biz_create_experience` AND `biz_publish_experience` validated the per-stop shape —
  including `stop_name_required` — **unconditionally** (the loop ran for draft and publish
  alike). The two empty seed stops have empty `place_name`, so the draft create raised
  `stop_name_required`, which the wizard maps to the toast **"Every stop needs a name."** — and
  it fired the instant the user landed on Step 2.

**Fix:** gate the per-stop `stop_name_required` (and the new `stop_description_required`) on
`p_publish` in BOTH RPCs. A draft may carry empty/half-built stops; names + descriptions are
required ONLY at publish. The image-cap (`stop_too_many_images`) and non-negative-price shape
checks stay universal (real invariants even for a draft). Because the Sub-A/B migrations are
already applied to remote (immutable), this ships as a forward `CREATE OR REPLACE` migration.

### CHANGE 2 (FEATURE) — curated-intent picker on Step 1

A REQUIRED "best vibe for this experience" picker on Step 1 (Identity), using the SAME curated
taxonomy as the consumer app. Source of truth: `app-mobile/src/types/onboarding.ts`
`ONBOARDING_INTENTS` (ids + labels + descriptions), which feed
`app-mobile/src/types/curatedExperience.ts` `CuratedExperienceCard.experienceType`. The 6 ids:
`adventurous · first-date · romantic · group-fun · picnic-dates · take-a-stroll`.

**Persistence:** new real column `events.experience_intent text` + a CHECK on the exact 6 ids
(chosen over `theme.experience_meta.intent` for queryability — it will drive the deck card's
category later). NULL on non-experience rows + experience drafts; REQUIRED at publish.

### CHANGE 3 (FEATURE) — compulsory per-stop description

A REQUIRED short description (1–280 chars) per stop, persisted to the existing
`experience_stops.ai_description` column (defaults `''`, maps to `CuratedStop.aiDescription` —
the per-stop blurb on the deck card + public page). Required at publish; gated per CHANGE 1
(error only after Continue).

---

## Files changed (Old → New receipts)

### NEW `supabase/migrations/20260827000000_meta_orch_1059_wizard_intent_desc_validation.sql`
**Before:** n/a.
**Now:** forward migration that (a) `ALTER TABLE events ADD COLUMN experience_intent text` +
`events_experience_intent_chk` CHECK on the 6 ids (NOT VALID → VALIDATE); (b) `CREATE OR
REPLACE biz_create_experience` and `biz_publish_experience` with: per-stop `stop_name_required`
+ `stop_description_required` gated on `p_publish`; `experience_intent` persisted (INSERT on
create, `SET experience_intent = v_intent` on publish) with publish-time `experience_intent_required`
+ out-of-set `experience_intent_invalid`; per-stop `ai_description` written from the payload
(trimmed) instead of a hardcoded `''`.
**Why:** CHANGE 1 root cause + CHANGE 2 column/persistence + CHANGE 3 persistence. Sub-A/B
migrations are immutable (already applied to remote), so this is a clean forward step.

### NEW `mingla-business/src/constants/experienceIntents.ts`
**Now:** `ExperienceIntentId` union + `EXPERIENCE_INTENTS` (id/label/description/icon, labels +
descriptions mirrored VERBATIM from the consumer `ONBOARDING_INTENTS`) + `EXPERIENCE_INTENT_IDS`
+ `asExperienceIntent()` narrower. Icons mapped to the mingla-business `IconName` union (closest
glyph; the consumer uses Ionicons the business app doesn't have).
**Why:** single source of the intent taxonomy for the picker + service round-trip; mirrors the
consumer ids exactly so brand experiences align with the deck.

### `mingla-business/src/components/experience/experienceWizardTypes.ts`
**Before:** `ExperienceStopDraft` had no description; `emptyStop()` seeded none.
**Now:** adds `description: string` to `ExperienceStopDraft`, `MAX_STOP_DESCRIPTION = 280`,
`emptyStop().description = ""`, and `stopHasValidDescription()` (1..280 trimmed).
**Why:** CHANGE 3 client model + validation helper.

### `mingla-business/src/components/experience/ExperienceStopsStep.tsx`
**Before:** stop card = name + address + photos + start time + (per-stop) price.
**Now:** adds a multiline **Description** field bound to `stop.description` (≤280, live counter),
with a `descError` that is gated on `showErrors` (CHANGE 1 spine) and a red-border error state.
**Why:** CHANGE 3 UI; CHANGE 1 gating preserved for the new field.

### `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx`
**Before:** Step 1 = title + description; `canContinue` step-1 = title+desc; `buildPayload` sent
`ai_description: ""`; publish gate checked stops/pricing/when only.
**Now:** adds `intent` state + a required curated-intent chip grid on Step 1 (renders
`EXPERIENCE_INTENTS`, radiogroup a11y, gated inline error); `canContinue` step-1 now also requires
`intent !== null`; `stopsValid` now requires `stopHasValidDescription` per stop; `buildPayload`
sends `experience_intent: intent` and `ai_description: s.description.trim()`; the publish gate now
blocks when `intent === null` with a clear toast. Seeds `intent` from `initialDraft` (edit-mode).
Added RPC error copy for `stop_description_required`, `experience_intent_required`,
`experience_intent_invalid`.
**Why:** CHANGE 2 picker + CHANGE 3 wiring; all new gates honor the showStepErrors discipline.

### `mingla-business/src/services/experienceDetailService.ts`
**Before:** loaded the events row + stops without intent/description.
**Now:** selects `experience_intent` (events) + `ai_description` (stops); adds
`experienceIntent: ExperienceIntentId | null` to `ExperienceDetail` and `description: string` to
`ExperienceStopRow`; maps them through (`asExperienceIntent` narrows the column).
**Why:** edit-mode round-trip for CHANGE 2 + 3.

### `mingla-business/app/experience/[id]/edit.tsx`
**Before:** `detailToInitialDraft` had no intent/description.
**Now:** seeds `intent: exp.experienceIntent` + per-stop `description: s.description`.
**Why:** edit-mode pre-fills the picker + descriptions so a re-save/publish keeps them.

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
**Before:** `META_ORCH_1059_BACKEND_ALLOWLIST` listed the Sub-A/B migrations + tests.
**Now:** also lists the new migration + the new Deno test (C7 no-new-backend-files). Per COMMS-0002.
**Why:** the new backend files would otherwise fail the globally-applied ORCH-0863 C7 gate.

### NEW tests
- `supabase/functions/__tests__/biz_experience_wizard_changes.test.ts` (Deno, source-level SQL).
- `mingla-business/src/components/experience/__tests__/metaOrch1059WizardChanges.test.ts` (Jest).

---

## Spec traceability

| Criterion | Implemented | Evidence |
|---|---|---|
| CHANGE 1 — no error on step entry; only after Continue | Yes | Inline gating already on `showErrors`; server draft no longer raises `stop_name_required` (gated on `p_publish`). Deno C1-01/02; Jest CHANGE-1 suite. |
| CHANGE 1 — audit Pricing/When for same | Yes | Pricing errors gated on `showErrors` (verified + Jest); When uses `whenAdapter.showErrors`. |
| CHANGE 2 — required intent picker, consumer taxonomy | Yes | `experienceIntents.ts` mirrors the 6 ids/labels; picker on Step 1; step-1 + publish gates require it. Jest CHANGE-2 suite. |
| CHANGE 2 — persist on create + publish payload, real column + CHECK + allowlist | Yes | `events.experience_intent` + CHECK; both RPCs persist; C7 allowlist same commit. Deno C2-01/02/03. |
| CHANGE 3 — required per-stop description, persist to ai_description | Yes | `description` field + `stopHasValidDescription`; `ai_description: s.description.trim()`; publish-time `stop_description_required`. Deno C3-01/02/03; Jest CHANGE-3 suite. |
| Gate ALL errors on showErrors/touched | Yes | No inline error renders without a `showErrors &&` predicate. |
| ONE-TICKET invariant intact (Sub-A/B) | Yes | Deno I-1 (exactly one `INSERT INTO ticket_types` per RPC); existing Sub-A/B Deno tests still pass. |
| No parallel money fn (COMMS-0014/0016) | Yes | Checkout untouched; RPCs still write the single sellable ticket. |
| tsc clean on touched files | Yes | `tsc --noEmit` → no errors in any touched file (pre-existing errors in account.tsx + packages/* are unrelated). |

---

## Test results

**Jest** (`mingla-business`): `metaOrch1059WizardChanges.test.ts` — 12/12 pass. Full experience
suite (`metaOrch1059SubAFixes` + `metaOrch1059WizardChanges` + `experiencesService`) — 23/23 pass.

**Deno** (source-level SQL): `biz_experience_wizard_changes.test.ts` — 9/9 pass. Existing
experience Deno tests (`biz_create_experience.happy`, `.one_ticket_invariant`,
`biz_publish_experience.draft_lifecycle`) — 22/22 pass (unchanged migrations).

**tsc:** no errors in any touched file.

### Fails-on-revert (verified at HEAD `719d1dc332f1f459d61d3146351d376d96155a54`)
- Deno C1-01/C1-02: reverting the `p_publish` gate on `stop_name_required` → both FAIL. Restored → pass.
- Deno C2-01: removing the `ADD COLUMN experience_intent` → FAIL. Restored → pass.
- Jest CHANGE-3: reverting client `ai_description: s.description.trim()` → `ai_description: ""` → FAIL. Restored → pass.

---

## Migration to apply (orchestrator owns `db push`)

One new migration, monotonic above all sources (sibling max `20260826000000` ORCH-1058b; remote
head `20260825000000`; origin/main max `20260823000000`):

`supabase/migrations/20260827000000_meta_orch_1059_wizard_intent_desc_validation.sql`

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]" && /Users/sethogieva/bin/supabase db push --linked
```

- No `--include-all` needed (in-order; remote head is `20260825000000`, this is `20260827000000`).
- **Remote data probe (rule 9b):** `experience_intent` column does not exist yet; the `VALIDATE
  CONSTRAINT` runs against a freshly-added nullable column (all-NULL on the 2 existing experiences
  `b8bd995b…` + `8f5e5821…`) — NULL is allowed by the CHECK, so VALIDATE cannot abort. The two
  pre-existing published experiences keep `experience_intent = NULL` and empty stop
  `ai_description` until re-edited; the publish-time requirement fires only on the next wizard
  publish. No backfill required.
- The migration only `CREATE OR REPLACE`s functions + `ADD COLUMN IF NOT EXISTS` + idempotent
  CHECK — safe to re-run.

**No edge-function deploy** — this ORCH touches only SQL functions (RPCs) + client; no
`supabase/functions/*/index.ts` changed. No new external API.

---

## Cross-surface impact

- **Business iOS / Business Android:** affected — the experience wizard (create + edit) gains the
  intent picker + stop description; same shared component path (parity automatic). Live test:
  Metro on 8090 → physical Android, all changes hot-reload-safe (RN component + StyleSheet only).
- **Buyer/anon Web + Consumer iOS/Android:** not directly affected this turn — they READ
  `experience_intent` / `aiDescription` later (deck card category + per-stop blurb). The column +
  field now exist for that downstream consumer work.
- **Admin Web:** not affected (doesn't render the wizard).

---

## Invariant preservation

- I-1 ONE-TICKET — preserved (Deno I-1 asserts exactly one ticket insert per RPC).
- I-2 2–5 STOPS ON PUBLISH / I-3 ALWAYS-VALIDATED LOC / I-4 PUBLISH-TIME DATES — unchanged.
- I-6 NO PARALLEL MONEY FN (COMMS-0014/0016) — preserved; checkout untouched.
- I-7 CURRENCY DE-GBP — unchanged (currency resolution copied verbatim).
- Draft lifecycle (Sub-A/B) — preserved and HARDENED: draft create no longer rejects empty stops.

---

## Discoveries for orchestrator

- The dispatch hypothesis for CHANGE 1 ("StopsStep renders error text unconditionally") was not
  the cause — the inline gating was already correct. The real cause was the unconditional
  server-side per-stop validation in both Sub-A/B RPCs. Documented above; fix is the forward
  migration.
- Two already-published experiences (`b8bd995b…` Raleigh Wine and Dine Crawl, `8f5e5821…` ORCH1059
  Proof Night Out) will carry `experience_intent = NULL` + empty stop descriptions until
  re-edited in the wizard. If the deck-category work (downstream) needs them populated, that's a
  small operator backfill / re-edit, not a migration.
- COMMS-0002 (ORCH-0863 C7 backend allowlist) was acknowledged and satisfied in the same commit.
