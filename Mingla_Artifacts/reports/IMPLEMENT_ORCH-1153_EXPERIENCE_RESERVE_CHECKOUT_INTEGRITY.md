# IMPLEMENT — ORCH-1153 [experience-reserve-checkout-integrity]

**Skill:** mingla-implementor (Claude). **Date:** 2026-06-16.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1153-[experience-reserve-integrity]` on branch `ORCH-1153-experience-reserve-integrity` (rebased on `origin/main` — already current).
**Contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1153_EXPERIENCE_RESERVE_CHECKOUT_INTEGRITY.md` (built in §9 order).
**Status:** implemented and verified (source + gates + unit/Deno tests + fails-on-revert); migrations + edge deploy are **operator-owned** and UNVERIFIED-on-prod until applied (see §11).
**Comms acked:** COMMS-0013/0014/0018 (WARN, factored — fee unified not tax; experiences ride the unified all-in engine; deploy edge fns from MERGED main only). New discovery → **COMMS-0036 PROPOSED** (orchestrator to register; see §12).

---

## 1. Summary (plain English)

Three defects on the experience reserve/checkout chain are fixed:

1. **WS1 (P0) — drained recurring experiences.** A one-shot backfill repairs every scheduled/published recurring experience that has no future dates (the live casualty "Raleigh Wine and Dine Crawl" `b8bd995b…`). A daily pg_cron top-up keeps long-lived recurring experiences from slowly draining to zero, and a publish/edit drain guard refuses to leave a recurring experience with zero future occurrences. A seed-hardening guard stops a stale client edit from wiping the recurrence.
2. **WS3 (P0) — true all-in price.** The public `/exp/` experience page (buyer-web + business iOS/Android, one route) and the dormant checkout recap now show the SERVER all-in (taxes/fees included) instead of the bare base under the "All-in, taxes included" caption — no more price jump at the cart.
3. **WS2 (P1) — reservation parity.** The consumer experience CTA now reads "Reserve" everywhere (was "Buy ticket"/"Get free ticket"), and open-daily detection is now ONE shared rule-based owner across web + consumer (the consumer's density heuristic is retired), with the recurrence fields plumbed onto the consumer deck + venue seeds so the detector actually has data.

---

## 2. SPEC success-criteria coverage

| SC | Surface(s) | Status | Commit |
|---|---|---|---|
| SC-1 backfill repairs casualty (bookable Reserve, future dates) | web/biz-iOS/Android | Implemented; **UNVERIFIED until migration applied to prod** | `964d5e9` |
| SC-2 same experience shows future reserve occurrences | consumer iOS/Android | Implemented (auto via materialised rows + WS2 plumbing); UNVERIFIED until apply + OTA | `964d5e9`,`6df1b34` |
| SC-3 page price === cart === charged (pass-fee, non-zero fee) | web/biz-iOS/Android | Implemented + unit-proven; runtime UNVERIFIED until fixture created | `4f11d1c` |
| SC-4 absorb-fee unchanged (no 100×/wrong-field) | live brands | Implemented + unit-proven | `4f11d1c` |
| SC-5 cron exists, idempotent, respects count/until/never + 52 | data | Implemented; UNVERIFIED until apply | `964d5e9` |
| SC-6 recurring publish can't land zero-future (drain guard) | biz iOS/Android | Implemented; UNVERIFIED until apply (RPC needs auth session) | `964d5e9` |
| SC-7 title-only live-edit preserves future occurrences (seed hardening) | biz iOS/Android | Implemented (server re-derive + client warn); UNVERIFIED until apply | `964d5e9`,`fb68a42` |
| SC-8-iOS/Android Reserve verb (paid+free) | consumer | Implemented + gate; UNVERIFIED on-device until OTA | `6df1b34` |
| SC-9 same experience classifies open-daily identically across surfaces | web + consumer | Implemented + Deno test; UNVERIFIED on-device until OTA | `2ff8eaf`,`6df1b34` |

---

## 3. OQ resolutions (load-bearing code-reads)

**OQ-1 (the price unit — a wrong assumption ships a 100× price): RESOLVED.**
`ticket.priceAllInGbp` is **MAJOR units** (dollars). Proven at `mingla-business/src/services/publicExperienceService.ts:358-363`: `priceAllInGbp = … ? allInCents / 100 : null`. The display formatters divide by 100 (expect cents): `formatExpPrice` (`[experienceSlug].tsx:543` → `priceCents / 100`) and `formatPriceMajor` (`ExperienceCheckoutFlow.tsx:48` → `priceCents / 100`). Therefore the fix multiplies the all-in back to cents: `Math.round(ticket.priceAllInGbp * 100)` before passing to the formatter. Base fallback (`ticket.priceCents`) when the all-in is absent/0 → an absorb-fee brand (all-in === base) renders identically to today. No 100× error.

**OQ-3 (every BusinessEventCard seed mapper that must carry the new recurrence fields): RESOLVED by grep/code-read.** There are **TWO seed-mapper chains** to the consumer experience detail seed:
- **Deck chain (3 hops):** `supabase/functions/discover-cards/index.ts` (RPC row → `ExperienceDeckCard`) → `app-mobile/src/services/deckService.ts` `experienceCardToRecommendation` (card → `Recommendation`) → `app-mobile/src/components/SwipeableCards.tsx` `experienceRecToBusinessEventCard` (Recommendation → `BusinessEventCard` seed).
- **Venue chain (1 hop):** `app-mobile/src/utils/venueExperienceMapping.ts` `experienceToBusinessEventCard` (from `pg_brand_experiences_for_place` via `useVenueExperiences`).

All four sites now pass `isRecurring` + `recurrenceRule` through. (`ExpandedCardModal.tsx` only references the mapper in comments — not a separate copy.) Both deck-supply RPCs are widened (deck + brand). Missing any one would have left the detector reading `undefined` on that entry path → silent open-daily regression.

**OQ-2 (detector home): RESOLVED — packages route.** `isOpenDailyExperience` lives in `packages/event-rendering/experienceOpenDaily.ts`, exported from the package index, consumed by both apps via the existing `@mingla/event-rendering` import path (the same path `offeringCta.ts` uses) — satisfies I-MOR-0827 (one shared package, never a cross-app import).

---

## 4. Migration files created (final version numbers)

Monotonic check: max prefix across `origin/main` + all sibling worktrees = `20261008000003`. ORCH-1153 uses the `20261009*` band.

| File | Purpose |
|---|---|
| `supabase/migrations/20261009000000_orch_1153_recurrence_topup_and_guard.sql` | `pg_recurrence_is_terminated` helper; `pg_topup_recurring_experiences(p_floor)`; re-emit `biz_publish_experience` + `biz_update_live_experience` **from the LIVE PROD body** + drain guard + seed-rule-preservation guard |
| `supabase/migrations/20261009000001_orch_1153_recurrence_backfill.sql` | one-shot DML backfill (re-anchor master forward + clear non-master + re-expand; idempotent; skips healthy) |
| `supabase/migrations/20261009000002_orch_1153_recurrence_topup_cron.sql` | pg_cron `orch-1153-topup-recurring-experiences` `0 9 * * *` (idempotent registration) |
| `supabase/migrations/20261009000003_orch_1153_consumer_deck_supply_recurrence_fields.sql` | DROP+CREATE both deck-supply RPCs (from the **GIT-1138** body) + `is_recurring` + `recurrence_rules` columns |

**RPC re-emission provenance:** the two `…000000` RPCs were extracted **verbatim from the live prod `pg_get_functiondef`** (base64-decoded; char-length matched prod: publish 23630, update 22786) and only the ORCH-1153 guards were inserted. The two `…000003` RPCs were re-emitted from the **git-1138 body** (NOT live prod) — see §12 COMMS-0036 for why (1138-rework is committed but not yet applied to prod).

`$function$;`-before-GRANT and DROP-before-widening-RETURNS-TABLE rules observed. All four migrations pass a structural lint (balanced dollar-quotes, parens, CREATE/DROP counts).

---

## 5. Edge functions touched

- `supabase/functions/discover-cards/index.ts` — maps the two new RPC columns (`is_recurring`, `recurrence_rules`) onto the deck card. `verify_jwt`: **unchanged** (preserve whatever the deployed config is — discover-cards is service-role-internal). **Deploy from MERGED main only (COMMS-0018) — orchestrator/operator owned; left committed, undeployed.** `deno check` passes.

---

## 6. Regression tests added (both required — CLOSE Step 0.5)

| Test | Path | Run | Fails-on-revert |
|---|---|---|---|
| WS3 all-in display (pass-fee displayed===charged + absorb-fee no-regression + source contract) | `mingla-business/__tests__/orch1153ExperienceAllInDisplay.test.ts` | `npx jest` → **5 passed** | **VERIFIED at `4f11d1c1b`** — true deletion of the `priceAllInGbp * 100` branch (revert to `formatExpPrice(ticket.priceCents…)`) → the source-contract case FAILED (`1 failed, 4 passed`); restored → 5 passed. |
| WS2 shared open-daily detector (daily/never true; weekly/count/null/non-recurring false) | `packages/event-rendering/__tests__/orch1153OpenDailyExperience.test.ts` | `deno test` → **5 passed** | **VERIFIED at `2ff8eaf43`** — true deletion of the daily/never predicate (revert to `return input.isRecurring === true`) → 3 cases FAILED; restored → 5 passed. |
| WS1 backfill/topup/drain SQL probe (T-2/3/7/8/9) | `supabase/migrations/__tests__/orch_1153_recurrence_topup_backfill.test.sql` | hand-run post-apply (DB write-safe, all cases ROLLBACK) | fails-on-revert documented inline (remove forward-only filter → T-7 fails; remove drain guard → T-9). **UNVERIFIED until migrations applied** (no local PG/psql in this session; Docker present but a full local supabase stack was not spun up to avoid port/Metro collisions with sibling worktrees). |

Both code tests are in the closing diff (`git diff origin/main...HEAD --name-only`).

---

## 7. Old → New receipts (per changed surface)

### `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx`
- **Before:** `expPrice = formatExpPrice(ticket.priceCents, …)` (bare base) under "All-in, taxes included"; inline `isOpenDaily` read the rule directly.
- **Now:** `expDisplayCents = priceAllInGbp>0 ? round(priceAllInGbp*100) : priceCents` → `formatExpPrice(expDisplayCents,…)` (server all-in); `isOpenDaily` delegates to the shared `isOpenDailyExperience`.
- **Why:** F-7 (WYSIWYP breach) + WS2 one-owner. **~22 lines.**

### `mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx`
- **Before:** recap `formatPriceMajor(ticket.priceCents,…)`; docstring "buyer just taps 'Get my spot'".
- **Now:** recap renders the all-in (`priceAllInGbp*100` fallback base); docstring → "Reserve".
- **Why:** F-8 dormant leak + DISC-1153-B doc-rot. **~10 lines.**

### `packages/event-rendering/experienceOpenDaily.ts` (NEW) + `index.ts`
- **Now:** `isOpenDailyExperience({isRecurring, recurrenceRule})` — the canonical rule-based detector, exported from the package. **~55 + 7 lines.**

### `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx`
- **Before:** `resolveOfferingCta` omitted verbs → "Buy ticket"/"Get free ticket"; `openDaily = isOpenDailyModel(bookableOccurrences)` (density heuristic).
- **Now:** passes `buyVerb:"Reserve"`+`freeVerb:"Reserve"`; `openDaily = isOpenDailyExperience({isRecurring: seed?.isRecurring, recurrenceRule: seed?.recurrenceRule})`.
- **Why:** F-6 verb drift + F-5 forked detector. **~20 lines.**

### Seed mappers (deck 3-hop + venue) + types
- `discover-cards/index.ts`, `deckService.ts`, `SwipeableCards.tsx`, `venueExperienceMapping.ts` — pass `isRecurring`/`recurrenceRule` through; `mergedDiscover.ts` + `useVenueExperiences.ts` types extended. **~12 lines each.**

### `app-mobile/src/utils/experienceOpenDaily.ts`
- `isOpenDailyModel` marked `@deprecated` (retired as the owner; kept for its Deno test). **~10 lines.**

### `mingla-business/app/experience/[id]/edit.tsx`
- Adds a `console.warn` (no silent failure) when a recurring experience loads with a null parsed rule — the server re-derive guard is the recovery. **~13 lines.**

---

## 8. Cross-surface impact

| Surface | WS1 backfill/cron | WS3 price | WS2 verb | WS2 open-daily | Parity |
|---|---|---|---|---|---|
| Consumer iOS | auto (materialised rows) | n/a (already all-in) | **Covered** | **Covered** | manual (consumer code) |
| Consumer Android | same | same | **Covered** | **Covered** | manual |
| Buyer Web (`/exp/`) | auto | **Covered (F-7)** | already Reserve | now shared detector (identical) | manual (web) |
| Business iOS (`/exp/` route) | auto | **Covered** | already Reserve | shared | auto with web |
| Business Android (`/exp/` route) | auto | **Covered** | already Reserve | shared | auto with web |
| Admin Web | not affected (no buyer reserve) | — | — | — | n/a |
| Business Web preview | not affected | — | — | — | n/a |

---

## 9. Self-verify / gates run (real output)

- **TypeScript (mingla-business):** branch `tsc --noEmit` = **334 errors == origin/main baseline (334)** → **zero new errors**; the only error in a touched file (`useExperienceDraftAdapter.ts:71`) is PRE-EXISTING (ORCH-1150 rsvp DraftEvent shape; I did not edit that file).
- **TypeScript (app-mobile):** branch = **416 == baseline 416** → zero new errors; **NONE** in any of my touched app-mobile files.
- **`deno check supabase/functions/discover-cards/index.ts`** → passes.
- **New strict-grep gates** (self-test + real): `orch-1153-no-bare-base-under-allin`, `orch-1153-reserve-verb`, `orch-1153-opendaily-one-owner` → all **passed**.
- **Adjacent existing gates** (no regression): ORCH-1147 cart-total/allin-single-owner/r2-selection/web-charge → all passed; ORCH-1138 ebes-deleted/mor-isolation/event-deck-off-ebes → all passed.
- **Jest WS3 test** → 5 passed. **Deno WS2 detector test** → 5 passed. **Existing ORCH-1138 open-daily Deno test** → 6 passed (deprecation JSDoc didn't break it).

---

## 10. Known issues / deferred / transitional

- **No local DB apply.** No psql/local PG in this session; the four migrations + the SQL probe are **source-verified only** (verbatim prod RPC bodies, structural lint, monotonic prefix). They need prod apply to confirm runtime (AC-WS1-BACKFILL-1/2, AC-WS1-CRON-1/2/3, AC-WS1-GUARD-1). Guard/backfill read-only probes were run against prod (casualty + cohort + cron + helper-existence) and are documented in §11.
- **`useExperienceDraftAdapter.ts` not edited.** The spec allowlisted it for the F-4 client guard, but the server re-derive guard (`…000000`) + the `edit.tsx` warn fully cover F-4 without it; narrower scope, not wider. (No scope expansion.)
- **`[TRANSITIONAL]`:** none introduced.

---

## 11. Operator action required (orchestrator/operator owned — NOT done by implementor)

### A. Apply migrations (in order) — via `supabase db push` OR Management API (NOT MCP)
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1153-[experience-reserve-integrity]" && /Users/sethogieva/bin/supabase db push --linked
```
Apply order is the timestamp order: `…000000` → `…000001` → `…000002` → `…000003`.
**CRITICAL ordering note (COMMS-0036):** `20261007000000_orch_1138_rework_deck_supply.sql` is committed to main but **NOT applied to prod** (the 1148 migrations 20261008000000-3 ARE; 1138-rework was skipped). When the pipeline applies pending migrations, `20261007000000` will apply BEFORE my `…000003` — installing the 1138-rework deck/brand RPC shape (brand_theme/city/upcoming_occurrences). My `…000003` is written to extend THAT shape (git-1138 body), so the order is correct. If for any reason 1138-rework is intentionally NOT to be applied, `…000003` must be re-based on the live-prod (ORCH-1072) body instead — flag before applying.

**Read-only prod probes already run (results):**
- Casualty `b8bd995b…`: scheduled, daily/never, 1 total date, 0 future, 1 master → backfill target (confirmed).
- QA fixture `44444444…`: 52 total, 51 future → healthy, selector skips it (confirmed).
- Draft `59df3bc4…`: 0 dates, draft → not selected (status gate, confirmed).
- `cron.job`: no existing `orch-1153-*` job; `0 9 * * *` is shared by birthday/holiday reminders (distinct jobs — fine).
- `public._pg_weekday_to_dow` + `pg_expand_experience_recurrence` exist on prod (backfill/topup depend on them).

After apply, run the CLOSE-gating checks:
```sql
SELECT count(*) FROM event_dates WHERE event_id='b8bd995b-fde9-452f-a7f9-0dffec359259' AND start_at > now(); -- MUST be > 1
SELECT count(*) FROM event_dates WHERE event_id='44444444-1138-4e44-dddd-444444444138' AND start_at > now(); -- MUST stay 51 (unchanged)
SELECT jobname, schedule FROM cron.job WHERE jobname='orch-1153-topup-recurring-experiences'; -- one row, 0 9 * * *
```
Then run the hand-run probe `supabase/migrations/__tests__/orch_1153_recurrence_topup_backfill.test.sql`.

### B. Deploy edge function from MERGED main
- `discover-cards` (preserve its current `verify_jwt`). **From merged main, never the worktree.**

### C. OTA per-platform (after merge) — isolated TMPDIR + `--clear-cache`, never `--platform all`
- consumer app (app-mobile, runtime 1.1.0) — verb + open-daily.
- business app (mingla-business, runtime 1.0.0) — WS3 price (web auto-deploys via Vercel).

### D. Create the §8 pass-fee fixture (TEST mode) for the tester
- `Mingla_Artifacts/fixtures/ORCH-1153_PASS_FEE_FIXTURE.sql` — run in TEST mode against the sandbox account; set the brand's Stripe readiness so `pg_brand_can_charge` passes. Record the printed brand/event/slug for QA + teardown.

---

## 12. Discoveries for Orchestrator

- **DISC-1153-D (→ COMMS-0036, PROPOSED — orchestrator to register):** `20261007000000_orch_1138_rework_deck_supply.sql` is on origin/main but **NOT applied to prod** (`supabase_migrations.schema_migrations` has 20261005000000, 20261006000001, 20261008000000-3 but **not 20261007000000**). The discover-cards edge fn + venueExperienceMapping on main already READ the 1138-rework columns (`brand_theme`, `city`, `upcoming_occurrences`), which the LIVE prod RPCs do NOT return — a latent pre-existing breakage in the consumer deck/venue experience supply, independent of ORCH-1153. ORCH-1153's `…000003` is written against the git-1138 body so the eventual apply order is correct, but the orchestrator should (a) confirm 1138-rework gets applied (it will, ahead of `…000003`), and (b) register a follow-up to verify the consumer deck/venue experience cards actually render post-apply.
  **Proposed ledger row:** `| COMMS-0036 | 2026-06-16 | mingla-implementor+claude (ORCH-1153) | ALL | ORCH-1138,ORCH-1153 | WARN | 20261007000000_orch_1138_rework_deck_supply.sql is on origin/main but NOT applied to prod (1148's 20261008* ARE) — live deck/venue experience-supply RPCs return the OLD ORCH-1072 shape while the edge fn already reads the rework columns (brand_theme/city/upcoming_occurrences). ORCH-1153's 20261009000003 re-emits FROM THE GIT-1138 body (intended-latest) so apply order (1138-rework then 1153) is safe; do NOT re-base 1153's deck-supply migration on the stale live-prod body. | <body as above> | OPEN | mingla-implementor+claude (ORCH-1153) | | 2026-06-30 |`
- **DISC-1153-B (already in spec):** the stale "Get my spot" docstring in `ExperienceCheckoutFlow.tsx` was cleaned to "Reserve" as part of WS3.
- **Spec gaps hit:** none material. The spec's "client seed guard in `useExperienceDraftAdapter.ts`" was satisfiable more cleanly via the server re-derive guard + the `edit.tsx` warn; I did not edit the adapter (narrower, not wider). No file outside the §12 allowlist was touched.

---

## 13. Commits (hash + scope)

| Hash | Scope |
|---|---|
| `964d5e999` | WS1 migrations `…000000/…000001/…000002` + SQL probe |
| `4f11d1c1b` | WS3 price display (`/exp/` page + recap) + jest test |
| `2ff8eaf43` | WS2a shared detector (`packages/event-rendering`) + buyer-web swap + Deno test |
| `6df1b34bc` | WS2b migration `…000003` + discover-cards + consumer chain (verb + detector + plumbing) |
| `fb68a423c` | client seed guard (`edit.tsx`) + 3 strict-grep gates + workflow + fixture SQL |
| `1e8362472` | binding SPEC + INVESTIGATE artifacts on-branch |

**Next:** orchestrator REVIEW → apply migrations (order in §11) → deploy discover-cards from merged main → tester (drive web + business iOS/Android + consumer iOS/Android; build the §8 fixture; verify displayed===charged with a non-zero fee + the backfill casualty repair + the open-daily parity + the drain guard).
