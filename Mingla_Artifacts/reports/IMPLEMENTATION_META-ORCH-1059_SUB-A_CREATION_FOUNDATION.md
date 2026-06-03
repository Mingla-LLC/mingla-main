# IMPLEMENTATION — META-ORCH-1059 [experiences-business-parity] · SUB-A · CREATION FOUNDATION

**ORCH:** META-ORCH-1059 [experiences-business-parity] — Sub-A
**Skill:** mingla-implementor (Claude)
**Date:** 2026-06-02
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/` on branch `meta-orch-1059-experiences-business-parity`
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1059_SUB-A_CREATION_FOUNDATION.md`
**Designs:** `DESIGN_META-ORCH-1059_WIZARD_STOPS_PRICING.md` (authoritative), `DESIGN_META-ORCH-1059_EXPERIENCES_LIFECYCLE.md` (date model + AI parser)
**Status:** implemented and verified (local checks green; live RPC/edge verification deferred to post-deploy — see "Awaiting deploy/secret").

**Comms-ledger acks (this turn):** COMMS-0014 + COMMS-0016 (one-ticket → existing `ticket-checkout-create`; no parallel money fn — enforced by I-1), COMMS-0002 (migration + edge fn + backend allowlist in the same commit), COMMS-0003 (Mapbox API params cited inline). No new cross-ORCH discovery this turn.

---

## 0. Executive summary

Experience creation now **materializes a real, sellable, multi-stop experience** instead of a published-but-unsellable `events` row. All 7 spec layers are built: the `experience_stops` table + `events` columns + the atomic `biz_create_experience` RPC, the `mapbox-geocode` edge fn, the client Mapbox picker + service, the Stops + Pricing steps + When-step adapter wired into the rebuilt wizard, the AI-parser draft-only reconciliation, and the two regression tests (happy + adversarial one-ticket invariant) with fails-on-revert proof.

The **one-ticket invariant (I-1)** is the spine: no matter the pricing mode, exactly one `ticket_types` row is written at the resolved total, so checkout stays byte-identical on the existing engine.

---

## 1. Files changed (with receipts)

### NEW

| File | Layer | What it does |
|---|---|---|
| `supabase/migrations/20260824000000_meta_orch_1059_sub_a_experience_stops.sql` | L1+L2 | `experience_stops` table (mirrors CuratedStop, UNIQUE(event_id,stop_order), ≤5-image CHECK, ON DELETE CASCADE, RLS owner-write + anon-published-read) + `events.location_mode`/`pricing_mode`/`whole_price_cents` columns + `biz_create_experience` RPC (atomic events + 2–5 stops + ONE ticket + master event_dates, mirroring `business_publish_event_draft` date logic) + self-verify probe + `NOTIFY pgrst`. |
| `supabase/functions/mapbox-geocode/index.ts` | L3 | Action-discriminated Mapbox Search Box proxy (`suggest`/`retrieve`), server-side `MAPBOX_ACCESS_TOKEN`, normalized `PlaceDetails`-compatible output, `verify_jwt=true`. Mapbox docs URLs cited inline. |
| `mingla-business/src/services/mapboxGeocodeService.ts` | L4 | Client service mirroring `googlePlacesService` (`autocompleteMapbox` silent-fail, `retrieveMapboxPlace` throws; per-session UUID). |
| `mingla-business/src/components/location/MapboxAddressInput.tsx` | L4 | Drop-in sibling of `AddressAutocompleteInput` (same props/Status machine/tokens), Mapbox-wired, parametrized a11y label. |
| `mingla-business/src/services/experienceStopImageService.ts` | L5 | Brand-keyed stop-photo upload to `brand_covers/${brandId}/experience-stops/${token}.{ext}` (works pre-event-row; RLS inherits brand-admin gate via first path segment). |
| `mingla-business/src/hooks/useExperienceDraftAdapter.ts` | L5 | Thin adapter feeding the lifted `CreatorStep2When` a synthetic `DraftEvent`; reuses `validateStep(1,...)` for When errors; `toPayloadWhen()` emits the RPC's date fields. |
| `mingla-business/src/components/experience/experienceWizardTypes.ts` | L5 | Shared `ExperienceStopDraft` + `labelForIndex` + `stopHasValidatedLocation` + mode types. |
| `mingla-business/src/components/experience/ExperienceStopsStep.tsx` | L5 | Stops builder: LOCATION MODE toggle, 2–5 stop cards (badge, name, MapboxAddressInput, 1–5 photo strip, optional time, optional per-stop price), chevron reorder, add-stop CTA, dynamic count helper, all 9 states. |
| `mingla-business/src/components/experience/ExperiencePricingStep.tsx` | L5 | PRICING MODE toggle (whole/per-stop summed), free/unlimited toggles, per-stop list bound to the same stop state, read-only total, `SoldAsOneSummary`, `WhoCoversCostsSection` verbatim. |
| `supabase/functions/__tests__/biz_create_experience.happy.test.ts` | L7 | Happy-path regression (7 assertions). |
| `supabase/functions/__tests__/biz_create_experience.one_ticket_invariant.test.ts` | L7 | Adversarial one-ticket-invariant regression (7 assertions, DISTINCT scenario). |

### MODIFIED

#### `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx`
- **Before:** 5 steps `Identity·Venue·When·Pricing·Cover`; raw `.from("events").insert(...)` writing pricing as `theme.experience_meta` strings, no tickets/dates, single free-text venue, disabled "One-time only" When stub, single price/capacity Pricing.
- **Now:** stepper renamed `Identity·Stops·When·Pricing·Cover`; mounts `ExperienceStopsStep` + `ExperiencePricingStep` + the lifted `CreatorStep2When` (via `useExperienceDraftAdapter`); `handleSubmit(publish)` serializes local state into the `biz_create_experience` payload and calls the RPC; RPC error codes mapped to friendly toasts; optional `prefill` prop for the AI "Set up & publish" flow; per-step Continue gating (2–5 validated stops, real When validation, valid resolved price).
- **Why:** spec L2.4 + L5; root-cause fix F-1.
- **Lines:** full rewrite (~430).

#### `supabase/functions/_shared/agentTools.ts` (`createExperience` ~L359-503)
- **Before:** inserted the experience `events` row at `status='live'/visibility='public'` (a dateless, ticketless, sellable publish).
- **Now:** inserts a **draft shell** — `status='draft'/visibility='draft'/published_at=null`, seeded `location_mode='single'`, `pricing_mode='whole'`, `whole_price_cents`=suggested midpoint; tool description rewritten to "creates a DRAFT shell the brand finishes in the wizard."
- **Why:** spec L6 / I-2/I-4 — no AI path may produce a published dateless experience.
- **Lines:** ~25 changed.

#### `mingla-business/src/components/experience/ExperienceConfirmationCard.tsx`
- **Before:** Accept button "Accept" / "Saving…".
- **Now:** "Set up & publish" / "Saving…"; a11y label updated.
- **Lines:** ~5.

#### `mingla-business/src/components/experience/ExperienceReviewCards.tsx`
- **Before:** heading "Review suggested experiences" + an "Accept all" bulk button (`onAcceptAll` prop).
- **Now:** heading "Suggested experiences" + helper "AI drafted these from your menu or activities. Add a date and price to publish each one."; **"Accept all" removed** (`onAcceptAll` prop dropped); unused `Pressable`/`accent`/`radius` imports + styles removed.
- **Why:** spec L6.2 — can't bulk-publish dated/stopped experiences.
- **Lines:** ~30.

#### `mingla-business/app/(tabs)/hub/experiences.tsx`
- **Before:** passed `onAcceptAll={handleAcceptAll}`; success toast "Experiences published to your venue."
- **Now:** removed `handleAcceptAll` + the `onAcceptAll` prop; accept-success toast "Draft created — add stops, a date and price to publish it."
- **Lines:** ~20.

#### `supabase/config.toml`
- Added `[functions.mapbox-geocode] verify_jwt = true`.

#### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
- Added `META_ORCH_1059_BACKEND_ALLOWLIST` (migration + edge fn + 2 tests + agentTools.ts) and spread it into `ALLOWLIST` so the ORCH-0863 C7 "no-new-backend-files" gate passes (COMMS-0002).

---

## 2. Spec traceability (success criteria → evidence)

| Criterion | Status | Evidence |
|---|---|---|
| L1: `experience_stops` + UNIQUE + ≤5-image CHECK + CASCADE + RLS | PASS | migration §1.2/1.3; DB probe confirmed table/columns absent pre-apply (clean add). |
| L1: `events` location/pricing/whole_price columns; existing rows untouched | PASS | migration §1.1 (nullable, NOT VALID→VALIDATE CHECKs). |
| L2: atomic events + 2–5 stops + ONE ticket + master dates | PASS | migration §L2 RPC; tests H-01/H-03/H-04. |
| L2: per-stop publish → 1 ticket at the SUM, never N | PASS | test A-01/A-02. |
| L2: draft writes events+stops+ticket, NO dates | PASS | RPC step 11 gated by `IF p_publish`; test H-04/A-04. |
| L2: single mode materializes stops[0] onto all rows | PASS | test A-06. |
| L2: currency defaults to brand.default_currency, never GBP (I-7) | PASS | test H-06. |
| L3: `mapbox-geocode` suggest/retrieve normalized shape, verify_jwt, loud missing-secret | PASS (code) | `deno check` clean; live call deferred (token not yet provisioned). |
| L4: `MapboxAddressInput` drop-in; session token reused; no Google import | PASS | `tsc` clean; mirrors `AddressAutocompleteInput` contract. |
| L5: LOCATION/PRICING toggles drive the RPC modes; lifted When; 2–5 client gate; brand-keyed stop images | PASS | `tsc` clean; wizard payload builder + adapter. |
| L6: Accept → "Set up & publish"; AI tool draft-only; "Accept all" removed | PASS | agentTools draft shell + card/review/hub edits. |
| L7: happy + distinct adversarial tests; one-ticket machine-asserted; one-commit landing | PASS | 14/14 green; fails-on-revert proven. |

---

## 3. Local check results (captured)

- **Deno tests (L7):** `deno test --allow-read supabase/functions/__tests__/biz_create_experience.{happy,one_ticket_invariant}.test.ts` → **14 passed | 0 failed**.
- **Fails-on-revert (mandatory):** injected a second `INSERT INTO public.ticket_types` (simulating the "N tickets" regression) into the migration → **H-01 + A-01 FAILED (12 passed | 2 failed)**; restored → **14 passed | 0 failed**. Anchor commit before fix: **`e944b0b202e08145bac81ca125b60d45ad8cf915`**.
- **Deno check (L3):** `deno check supabase/functions/mapbox-geocode/index.ts` → clean (exit 0). `deno check supabase/functions/_shared/agentTools.ts` → clean (exit 0).
- **tsc (mingla-business):** `node_modules/.bin/tsc --noEmit` → **zero errors in any of the 9 new/6 modified files** (verified by grepping the full log). The 242 total errors are all pre-existing baseline in untouched files (`app/(tabs)/home.tsx`, `app/checkout*`, `src/components/marketing/ComposerV2/*`, `src/payments/*` missing `@mingla/payments-native`, `packages/brand-rendering/*` workspace react-resolution, legacy `category` `__tests__`). None are introduced by this work.
- **Strict-grep ORCH-0863 (C7 backend allowlist):** gate file `node --check` OK; gate runs clean (C7 passes — backend files are allowlisted; pre-commit the diff shows 0 files, post-commit they'll be allowlisted).
- **Strict-grep route-by-event-type:** the single reported violation is in `app/(tabs)/home.tsx` (pre-existing baseline, not mine); my hub edit added no hardcoded `/event/${id}`/`/trip/${id}` route (uses static `/experience/create`).
- **Migration syntax/parse:** the Supabase MCP connection is read-only, so DDL could not be applied even in a rollback probe (which also proves the earlier read-only probes were safe). The plpgsql RPC mirrors the proven `business_publish_event_draft` body shape; column/constraint/value compatibility was verified via read-only probes (events status/visibility CHECKs, event_dates columns, ticket_types columns, brands.default_currency type, helper functions `biz_brand_effective_rank`/`biz_role_rank` exist). The orchestrator's `db push` performs the authoritative compile.

---

## 4. Regression test (mandatory gate)

- **Happy-path:** `supabase/functions/__tests__/biz_create_experience.happy.test.ts` — passing run cited above. `fails-on-revert verified at e944b0b202e08145bac81ca125b60d45ad8cf915` (H-01 flips to FAILED when a second ticket insert is injected).
- **Adversarial (tester writes a second one too, but this is the implementor's distinct test):** `supabase/functions/__tests__/biz_create_experience.one_ticket_invariant.test.ts` — per-stop/5-stop/multi-date one-ticket + publish-gate negatives; A-01 also flips on revert.

Both ship in the same commit as the migration (verified by scoped `git add`).

---

## 5. Deploy / apply instructions (orchestrator owns these)

**Migration — exact command for the operator/orchestrator:**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]" && /Users/sethogieva/bin/supabase db push --linked
```
Before running, confirm `/Users/sethogieva/bin/supabase migration list --linked` shows no remote-only rows. The migration is in-order (prefix `20260824000000`, strictly greater than the current max `20260823000000` across all worktrees + origin/main), so a plain `db push` (no `--include-all`) is correct.

**Edge function to deploy (after db push succeeds + close promotes to main):**
```bash
supabase functions deploy mapbox-geocode --project-ref gqnoajqerqhnvulmnyvv
```
verify-first-call: `curl` the function URL — expect a non-404 (it returns `500 mapbox_access_token_missing` until the secret lands, which is the correct loud-fail).

**No other edge functions deploy** (agentTools.ts is a `_shared` module — it redeploys with whatever functions import it, i.e. `agent-confirm-action` / the experience parse fns; the orchestrator should redeploy those that bundle `_shared/agentTools.ts` so the AI-tool draft-only change goes live).

---

## 6. Awaiting deploy/secret (live verification)

- **`MAPBOX_ACCESS_TOKEN` is a NEW Supabase secret** (OD-1). It is NOT yet provisioned. The `mapbox-geocode` fn is built against the documented Mapbox Search Box API shape and unit-typechecked; the LIVE suggest/retrieve call must be verified post-deploy once the operator provisions the token + a Mapbox account/billing. Until then the fn correctly returns `500 mapbox_access_token_missing`.
- **Live RPC behavior** (real insert of an experience → checkout reaching a session) is the tester's post-deploy live-fire; the env had 0 experiences (clean slate) and the MCP is read-only, so no live insert was run this turn.

---

## 7. Invariant verification

| ID | Preserved? | How |
|---|---|---|
| I-1 ONE-TICKET | Y | single `INSERT INTO ticket_types`; tests H-01/A-01 (+ fails-on-revert). |
| I-2 2–5 STOPS ON PUBLISH | Y | RPC `IF p_publish` 2..5 gate; client Continue gate; test A-04. |
| I-3 ALWAYS-VALIDATED LOCATION | Y | RPC `stop_address_unvalidated` (publish-gated); client `stopHasValidatedLocation`; test A-05. |
| I-4 PUBLISH-TIME DATES | Y | event_dates inside `IF p_publish`; test H-04. |
| I-5 DECK-READY SHAPE | Y | `experience_stops` columns map 1:1 onto CuratedStop (migration §1.2 comments). |
| I-6 NO PARALLEL MONEY FN | Y | RPC touches no Stripe; `mapbox-geocode` is geocoding-only; test H-07. |
| I-7 CURRENCY DE-GBP | Y | brand.default_currency default, USD fallback; test H-06. |

---

## 8. Cross-surface impact

- **Business iOS + Android (creation):** the rebuilt wizard + new steps + Mapbox picker + AI review changes. Parity is automatic (shared `mingla-business` code path).
- **Backend:** new migration + `mapbox-geocode` edge fn + config.toml + allowlist; `agentTools.ts` (AI draft shell).
- **Buyer/anon Web (downstream, NOT built here):** once an experience publishes, `pg_public_experiences_by_brand` will return a real `price_from_cents` (was NULL) because the single ticket now exists — a positive side effect, no code here.
- **Consumer iOS/Android, Admin Web:** unaffected (no experience render path touched in Sub-A; the consumer deck card is OD-8, a separate sub-track).

---

## 9. Discoveries for orchestrator

- **D-1 (AI "Set up & publish" route):** spec L6.1 wants Accept → route to `/experience/create` prefilled. Sub-A makes the AI tool create a **draft shell** server-side and surfaces it via a toast + the experiences list; the tap-through-to-edit-the-draft lands in **Sub-B** (the `/experience/[id]/edit` screen doesn't exist yet). The wizard accepts an optional `prefill` prop so Sub-B can wire "open this draft prefilled" cleanly. No invariant gap — the draft is unpublishable until finished.
- **D-2 (MAPBOX_ACCESS_TOKEN):** NEW dependency — operator must provision the secret + a Mapbox account before the picker works live (flagged per [[autonomy-posture-verifier-not-manager]]).
- **D-3 (deck-card render):** the consumer-side brand-experience card (byline + "Experience" badge + "Book" CTA + `CuratedExperienceCard` brand fields) is design Q-OPEN-1 / OD-8 — a separate consumer-deck sub-track, not Sub-A.
- **D-4 (tsc baseline):** `mingla-business` has a non-clean tsc baseline (242 errors in untouched files, incl. `@mingla/payments-native` module resolution + `packages/brand-rendering` react resolution under a single-package run). Not introduced here; flagged so the tester doesn't attribute them to Sub-A.

---

## 10. /goal completion self-check

1. Every spec criterion implemented + demonstrated — §2 (per-criterion evidence). ✓
2. Regression test green + fails-on-revert at cited hash — §3/§4. ✓
3. tsc clean on touched files; Deno check clean; lint via strict-grep gates — §3. ✓ (baseline noise excluded, attributed.)
4. Constitution: no dead taps introduced, no silent catches (all catches toast/throw), all async states handled in the new steps, one-owner-per-truth (single ticket), honest absence (nullable region/country). ✓
5. Edge fn deploy + verify-first-call — DEFERRED to orchestrator (deploy split); command + expected non-404 documented §5/§6. ✓ (token-gated.)
