# SPEC — ORCH-1153 [experience-reserve-checkout-integrity]

**Mode:** mingla-forensics / SPEC (build contract; no product code written here).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1153-[experience-reserve-integrity]` on branch `ORCH-1153-experience-reserve-integrity` (rebased on `origin/main`).
**Source investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1153_EXPERIENCE_RESERVE_CHECKOUT_INTEGRITY.md` (all six-field evidence + file:line lives there).
**Prod project:** `gqnoajqerqhnvulmnyvv`.
**Date:** 2026-06-16.
**Comms acked (WARN, factored):** COMMS-0013 (native vs web tax-basis differ; fee unified, tax not), COMMS-0014 (experiences ride the unified all-in engine — no parallel price/checkout path), COMMS-0018 (deploy edge fns only from MERGED main, never a worktree).

**Decisions baked in (resolved by Seth/orchestrator — DO NOT re-open):**
- **OQ-WS1-1 → YES:** add a pg_cron rolling-refresh job that tops up every published/scheduled recurring experience beyond the 52-occurrence window. Idempotent: never duplicate occurrences, only add forward, respect termination `count`/`until`.
- **OQ-WS2-1 → RULE-BASED is canonical:** the web/business rule-based open-daily detector (`is_recurring && rule.preset==='daily' && rule.termination.kind==='never'`) is the single owner. The consumer density heuristic is REPLACED. The detector lives where every surface can consume it.
- **OQ-WS2-2 → "Reserve" everywhere:** every surface's experience CTA verb is "Reserve" (free and paid).

---

## 1. Executive summary

Three defects on the experience reserve/checkout chain, fixed in priority order:

1. **(P0) WS1 backfill** — the one live recurring experience published before the 2026-06-16 materializer migration ("Raleigh Wine and Dine Crawl", `b8bd995b-fde9-452f-a7f9-0dffec359259`) has 1 (now-past) date and 0 future, so it reads sold-out/unavailable on every surface though it has 0/20 sold. A one-shot backfill re-anchors + re-expands every scheduled/published recurring experience with no future dates.
2. **(P0) WS3 all-in display** — the public `/exp/[brandSlug]/[experienceSlug].tsx` page quotes the bare base price under an "All-in, taxes included" caption while the all-in is already fetched and sitting on the payload; the buyer sees the price jump up at the cart. Single-line source swap to route the displayed price through the already-present all-in field.
3. **(P1) WS1 rolling-refresh cron + publish-time guard** — a `daily/never` rule materializes 52 days of runway at publish and never tops up, so every long-lived recurring experience slowly drains to zero and self-breaks. A pg_cron job tops them up; a publish/edit-time guard refuses to leave a recurring experience with zero future occurrences.
4. **(P2) WS1 seed/create hardening** — defend the live-edit path against a stale client seed wiping recurrence rows (F-4), and assert the snap/Ari draft path stays dateless.
5. **(P1) WS2 reservation parity** — standardize the CTA verb to "Reserve" on the consumer surface (web/business already say "Reserve"), and replace the consumer's density-heuristic open-daily detector with the canonical rule-based one, which requires plumbing the recurrence rule fields onto the consumer deck-supply payload.

The server always charges the authoritative all-in (WS3 is display/WYSIWYP only — no over/undercharge). I-1 (one ticket, event-level capacity), I-4 (publish-time materialization), and I-MOR-0827-PACKAGE-ISOLATION are all touched; see §6.

---

## 2. Scope & non-goals

### In scope
- WS1: one-shot backfill of pre-migration recurring experiences (DB migration).
- WS1: pg_cron rolling-refresh job + a SQL top-up function (DB migration).
- WS1: publish/edit-time "must not drain to zero future" guard inside the recurring branch (DB migration re-emitting the two RPCs).
- WS1: seed-hardening so a live-edit cannot silently wipe recurrence rows when the persisted row is recurring but the incoming payload omits the rule (DB + client guard).
- WS3: route the displayed price on `/exp/[…].tsx` (and the dormant `ExperienceCheckoutFlow.tsx` recap) through the already-fetched all-in.
- WS2: CTA verb → "Reserve" on the consumer surface; canonical rule-based open-daily detection shared across surfaces; plumb the recurrence rule fields onto the consumer deck-supply payload so the rule-based detector can run on the consumer.
- Test fixtures: a synthetic pass-fee brand+experience so a tester can PROVE displayed===charged with a non-zero fee.

### Non-goals (explicitly OUT)
- Compute-on-read availability (F-3 ruled materialization the correct surface; do NOT add rule evaluation to the public read path).
- Changing the 52-occurrence HARD_CAP, the expander's preset math, or the checkout `eventDateId` contract (all correct).
- Any change to `ticket-checkout-create` charge math (F-9: server already charges the all-in correctly).
- Unifying the consumer's two picker components into one (OQ-WS2-3) — deferred; parity is achieved by fixing the verb + detector, not by restructuring pickers.
- Tax-basis unification (COMMS-0013 — out of scope; fee is unified, tax stays venue-sourced server-side).
- Touching `packages/offering-rendering` reserve logic (it holds layout chrome only; no reserve logic belongs there).
- Flipping any LIVE brand's fee toggles to test WS3 (TEST-mode synthetic fixture only).

### Assumptions
- `events` has NO `when_mode` column; recurrence is keyed off `events.is_recurring` (boolean) + `events.recurrence_rules` (jsonb OBJECT, shape `{preset, byDay?, byMonthDay?, bySetPos?, termination:{kind, count?, until?}}`). Verified on prod.
- pg_cron 1.6.4 + pg_net 0.19.5 are installed; 24 cron jobs already run. Verified on prod.
- The expander `public.pg_expand_experience_recurrence(uuid, timestamptz, timestamptz, jsonb, text)` exists on prod and inserts only the 2nd..Nth occurrences (is_master=false), from `p_master_start` forward, never touching the master.
- The consumer experience detail screen only books with a `seed` (from the deck-supply RPC); the cold deep-link path (`seed===null`) is capped to "Open from the app" and never books — so the canonical detector only needs to run on the seed path.

---

## 3. Cross-Surface Impact Declaration (HARD GATE)

| # | Surface | WS1 backfill | WS1 cron/guard | WS3 price | WS2 verb | WS2 open-daily | Files touched there | Parity |
|---|---|---|---|---|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile/`) | Covered — auto via materialized rows | Covered — auto | Not covered (already all-in) | **Covered** | **Covered** | `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx`, `app-mobile/src/utils/experienceOpenDaily.ts`, `app-mobile/src/types/mergedDiscover.ts`, consumer seed mappers | Manual (consumer code) |
| 2 | **Consumer Android** | same as iOS | same | same | **Covered** | **Covered** | same as #1 | Manual |
| 3 | **Buyer Web** (`mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` etc.) | Covered — auto | Covered — auto | **Covered — F-7 fix here** | Already "Reserve" (no change) | Already rule-based (no change) | `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx`, `mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx` | Manual (web) |
| 4 | **Business iOS** (same `/exp/` expo-router route) | Covered — auto | Covered — auto | **Covered — same fix as #3** | Already "Reserve" | Already rule-based | same as #3 | Auto with #3 (same route) |
| 5 | **Business Android** (same `/exp/` route) | same as #4 | same | **Covered** | Already "Reserve" | Already rule-based | same as #3 | Auto with #3 |
| 6 | **Admin Web** (`mingla-admin/`) | Not covered — no buyer reserve surface | Not covered | Not covered | Not covered | Not covered | none | n/a |
| 7 | **Business Web preview** | Not covered — no buyer reserve there | Not covered | Not covered | Not covered | Not covered | none | n/a |

**Parity callout (non-negotiable):**
- WS3 price fix is ONE code change on the shared `/exp/` expo-router page that serves buyer-web + business iOS + business Android simultaneously. Consumer is already correct.
- WS2 verb + open-daily are TWO separate edits that must BOTH land: web/business already correct (no edit), consumer needs (a) verb passthrough and (b) detector swap + payload plumbing. An implementor who fixes only the consumer screen and forgets the deck-supply RPC + `mergedDiscover.ts` type + seed mappers will SHIP A BROKEN consumer detector (the rule fields will be undefined). All four pieces are required for the consumer surface.
- Backfill + cron are backend-only; the user-visible repair appears on every `event_dates`-reading surface automatically.

---

## 4. Layered specification

### Migration numbering (monotonic-prefix rule)

Latest migration on `origin/main` and across all active worktrees is `20261008000003`. The RSVP worktree (ORCH-1150) holds `20261008000001/2/3_remote_stub.sql` at the same prefix. To stay strictly monotonic above ALL of them, ORCH-1153 uses the **`20261009*`** band:

- `20261009000000_orch_1153_recurrence_topup_and_guard.sql` — the rolling top-up function + the publish/edit drain guard (re-emits both RPCs from the LIVE prod body) + the seed-hardening server guard.
- `20261009000001_orch_1153_recurrence_backfill.sql` — the one-shot backfill (DML, runs after the top-up function exists so it can reuse it).
- `20261009000002_orch_1153_recurrence_topup_cron.sql` — the pg_cron schedule registration.
- `20261009000003_orch_1153_consumer_deck_supply_recurrence_fields.sql` — widen the consumer deck-supply RPC RETURNS TABLE to carry `is_recurring` + `recurrence_rules` (DROP-then-CREATE per migrations-baseline; re-emit from LIVE prod body).

> ⚠️ Apply ALL via `supabase db push --linked` OR the Management API per `feedback_edge_deploy_and_migration_apply_hazards` — NOT MCP. The RPC re-emissions must start from the LIVE prod body (`pg_get_functiondef`), not a git-stale body, to avoid clobbering any later in-flight RPC change (COMMS-0029 pattern). Reconcile before applying.

---

### WS1 — Backfill (P0)

**File (new):** `supabase/migrations/20261009000001_orch_1153_recurrence_backfill.sql`

**Behavior:** for every `events` row where `is_recurring = true AND status IN ('scheduled','published') AND recurrence_rules IS NOT NULL AND (count of event_dates with start_at > now()) = 0`, repair it idempotently:

1. Resolve the master row: `SELECT … FROM event_dates WHERE event_id = e.id AND is_master = true LIMIT 1`. If no master row exists, skip + RAISE NOTICE (data anomaly; do not fabricate).
2. **Re-anchor the master forward** when the master `start_at <= now()`: compute the next future occurrence at the master's local wall-clock time using the rule (for `daily`, that is the next day; for other presets, the next preset match ≥ today). Update the master row's `start_at`/`end_at` to that future window (preserve duration + timezone). Re-anchoring is required because the expander only emits dates FROM the master forward — a far-past master with a sparse preset would otherwise produce all-past occurrences. For `daily/never` re-anchoring is still correct (cleanest behavior; OQ-WS1-3 resolved = re-anchor from today).
   - Rationale tie to data: `b8bd995b…` master is `2026-06-15 04:15` (past); re-anchor to the next future daily slot, then expand.
3. **Purge stale non-master rows** for that event with `start_at < now()` to avoid duplicates and clutter (`DELETE FROM event_dates WHERE event_id = e.id AND is_master = false AND start_at < now()`).
4. **Re-expand:** call `public.pg_expand_experience_recurrence(e.id, <new master start>, <new master end>, e.recurrence_rules, <master timezone>)`. The expander is idempotent ONLY against itself across runs if duplicates are first cleared — so before re-expanding, also clear future non-master rows that the expander would re-create: `DELETE FROM event_dates WHERE event_id = e.id AND is_master = false`. (Net: keep the master, drop all non-master, re-expand.)
5. Wrap the whole per-row repair in the loop; RAISE NOTICE the event id + occurrences emitted for the apply log.

**Idempotency contract:** running the backfill twice produces the same final state (clear-then-expand makes it deterministic). It only touches rows with 0 future dates, so a healthy experience (e.g. the QA fixture with 51 future) is never re-anchored.

**Acceptance (runtime-observable):**
- **AC-WS1-BACKFILL-1 (data):** after apply, `SELECT count(*) FROM event_dates WHERE event_id='b8bd995b-fde9-452f-a7f9-0dffec359259' AND start_at > now()` returns `> 1` (a `daily/never` rule yields up to 51 future from the re-anchored master).
- **AC-WS1-BACKFILL-2 (data):** the QA fixture `44444444-1138-4e44-dddd-444444444138` is UNCHANGED (still 51 future; not re-anchored — it had future dates so the selector skips it).
- **AC-WS1-BACKFILL-3 (buyer-web / business iOS / business Android):** open `/exp/<brandSlug>/raleigh-wine-and-dine-crawl` (the slug for `b8bd995b…`) — the page shows a bookable Reserve CTA with future selectable dates in the picker, NOT "Sold out"/"Booking unavailable".
- **AC-WS1-BACKFILL-4 (consumer iOS / Android):** the same experience, when surfaced on the Discover deck, shows real future occurrences in the Reserve flow (after WS2 deck-supply plumbing lands; before that it shows the occurrences via the existing `upcomingOccurrences` path).

---

### WS3 — All-in display fix (P0)

**The single-owner contract (do not bypass):** every displayed experience price MUST resolve to the server all-in via the `fetchTierAllInCents → pg_public_event_tier_allin` chain, surfaced on the payload as `ticket.priceAllInGbp`. No surface may show `ticket.priceCents` (bare base) under an "all-in" caption.

**File:** `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx`

- **Edit at `:289-294`** — `expPrice` currently formats `ticket.priceCents`. Change the source to the all-in with a base fallback:
  - displayed value = `ticket.priceAllInGbp` when present and `> 0`, else fall back to `ticket.priceCents` (so a brand that absorbs all fees, where all-in === base, is unaffected; and a payload that somehow lacks the all-in still renders rather than blanking).
  - Preserve the existing "Free" / "" branches and the existing `formatExpPrice(value, ticket.currency)` formatter. NOTE: `priceAllInGbp` is a major-units number (per `offeringCta.ts:117` it is consumed as `price`), whereas `priceCents` is minor units — the implementor MUST confirm the unit of `ticket.priceAllInGbp` from `publicExperienceService.ts:470` and apply the correct ×100/÷100 so the formatter (which divides by 100, `:543`) receives cents. **This is the load-bearing detail:** if `priceAllInGbp` is already major-units, multiply by 100 before passing to `formatExpPrice`, or use the same formatting the cart uses. Do not ship a 100× error.
- The caption `barKicker` ("All-in, taxes included", `:321-322`) stays — it becomes TRUE once the displayed number is the all-in.
- The CTA labels at `:314/:317` already read "Reserve" (WS2 web already correct) — no verb change here.

**File:** `mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx`

- **Edit `:96`** — the recap card renders base; change to the all-in (same source as above) so the dormant F-8 leak can never resurface. Also fix the stale docstring `:8` ("the buyer just taps 'Get my spot'") to reflect the "Reserve" verb (DISC-1153-B doc-rot).

**Acceptance (runtime-observable, REQUIRES the §8 synthetic pass-fee fixture):**
- **AC-WS3-1 (buyer-web):** with the pass-fee fixture experience, the price shown on `/exp/…` (headline + Reserve CTA: `Reserve · {price}` / `From {price}`) equals the cart "Total" to the cent. No upward jump when navigating page → cart.
- **AC-WS3-1-iOS / AC-WS3-1-Android (business app, same `/exp/` route):** same equality, verified on each platform's in-app browser/native route.
- **AC-WS3-2 (all surfaces):** the displayed all-in equals the amount the Stripe PaymentSheet/checkout charges (the `buyerSubtotalCents` from `ticket-checkout-create`) — displayed === charged with a non-zero fee.
- **AC-WS3-3 (regression, absorb-fee brand):** for any brand that absorbs all fees (the 8 live brands), base === all-in, so the displayed price is unchanged vs today (no visible diff). This protects against a 100× or wrong-field regression.
- **AC-WS3-4 (consumer):** unchanged — consumer already reads `priceAllInGbp` (`TicketCartSheet.tsx:330-361`); verify no regression.

---

### WS1 — Rolling-refresh cron + publish-time drain guard (P1)

**File (new):** `supabase/migrations/20261009000000_orch_1153_recurrence_topup_and_guard.sql`

**(a) Top-up function** `public.pg_topup_recurring_experiences(p_floor integer DEFAULT 14)` RETURNS integer (count of experiences topped up), `SECURITY DEFINER`, `SET search_path = public, pg_temp`:

- For every `events` row where `is_recurring = true AND status IN ('scheduled','published') AND recurrence_rules IS NOT NULL`:
  - Compute `future_count = count(event_dates where start_at > now())`.
  - **Termination respect:** if `recurrence_rules->'termination'->>'kind' = 'count'`, the rule has a finite total — once the materialized total (incl. past) reaches that count, do NOT add more. If `kind = 'until'`, do NOT add occurrences past the `until` date. If `kind = 'never'`, top up freely to the 52-forward window.
  - **Trigger:** only when `future_count < p_floor` (default 14 — two weeks of runway) AND the rule still permits more occurrences.
  - **Top-up mechanism (idempotent, forward-only, no duplicates):** anchor a synthetic "today master" at the rule's next future occurrence (same local wall-clock time + duration as the real master), then call `pg_expand_experience_recurrence` with a guard that SKIPS any `(event_id, start_at)` that already exists. Because the expander does a plain INSERT, the top-up function MUST either (i) add a partial unique index `event_dates(event_id, start_at)` and use `ON CONFLICT DO NOTHING` semantics, or (ii) pre-filter the cursor to dates `> max(existing start_at)`. **Choose (ii)**: expand from `max(existing future start_at) + 1 cadence` so only genuinely-new forward dates are inserted, capped so total forward stays ≤ 52. This guarantees never-duplicate + only-add-forward + respect-cap.
  - Never touch the master row; never touch past rows.
- `REVOKE ALL … FROM PUBLIC` (called only by the cron job which runs as a superuser-equivalent role; or grant to the cron-owner role per the existing 24-job convention).

**(b) Publish/edit drain guard** — re-emit `biz_publish_experience` + `biz_update_live_experience` VERBATIM from the LIVE prod body, adding inside the recurring branch (after the existing `pg_expand_experience_recurrence` call) a post-condition assertion:

- After materialization, if `is_recurring AND recurrence_rules IS NOT NULL` AND `count(future event_dates) = 0` AND the rule is NOT count-exhausted/until-expired → this means the master itself was anchored in the past with a non-productive rule. RAISE EXCEPTION `recurring_experience_has_no_future_occurrences` so a publish that would immediately read sold-out is blocked at publish time (mirrors the ORCH-1075 paid-publish guard pattern). This is the publish-time analogue Seth asked for: a recurring experience can never be published into a drained state.
- Preserve EVERY existing guard (ORCH-1075 paid-publish, ORCH-0792 master-date trigger gate, never-ends feature, audit log). Add ONLY the post-materialization assertion + (for the seed-hardening, see WS1 §below) the rule-preservation guard.

**File (new):** `supabase/migrations/20261009000002_orch_1153_recurrence_topup_cron.sql`

- Register a pg_cron job (precedent format: `notify-lifecycle-daily 0 10 * * *`, `orch-0875-process-booking-deadlines 0 * * * *`):
  - `SELECT cron.schedule('orch-1153-topup-recurring-experiences', '0 9 * * *', $$ SELECT public.pg_topup_recurring_experiences(14); $$);` (daily at 09:00 UTC — chosen to avoid the 10:00 notify-lifecycle slot).
  - Idempotent registration: guard with `cron.unschedule` of any existing same-name job first (or `WHERE NOT EXISTS` against `cron.job`), so re-apply doesn't duplicate.

**Acceptance (runtime-observable):**
- **AC-WS1-CRON-1 (data):** `SELECT * FROM cron.job WHERE jobname='orch-1153-topup-recurring-experiences'` returns exactly one active row with schedule `0 9 * * *`.
- **AC-WS1-CRON-2 (data, idempotency):** manually `SELECT public.pg_topup_recurring_experiences(14)` twice in a row — the second call inserts ZERO new rows for any experience already at/above the floor, and the QA `daily/never` fixture's future count never exceeds 52.
- **AC-WS1-CRON-3 (data, termination respect):** a `count`-terminated fixture is never topped past its count; an `until`-terminated fixture is never topped past its `until` date.
- **AC-WS1-GUARD-1 (business iOS/Android):** attempting to publish a recurring experience whose master is in the past with a non-productive rule fails with a clear error toast (not a silent drained publish). Verify the normal `daily/never` publish still succeeds.

---

### WS1 — Seed/create hardening (P2)

**Server guard** (folded into the `biz_update_live_experience` re-emission in `20261009000000`): before the unconditional `DELETE FROM event_dates … ; reinsert`, add a fail-safe — if the persisted `events.is_recurring = true AND events.recurrence_rules IS NOT NULL` but the incoming payload's recurrence rule is NULL/absent, **re-derive the rule from the persisted column** rather than wiping the expansion (F-4 fix option (b)). Net: a live-edit that omits the rule cannot collapse a recurring experience to its master.

**Client guard:**
- **File:** `mingla-business/src/hooks/useExperienceDraftAdapter.ts` (`:144-152,186-210`) and `mingla-business/app/experience/[id]/edit.tsx` (`detailToInitialDraft`, `:69-189`) — ensure that when the loaded detail has `is_recurring=true` but `firstRecurrenceRule(recurrence_rules)` returns null (shape anomaly), the adapter does NOT silently send `recurrence_rules: null`; instead it preserves the raw persisted `recurrence_rules` jsonb on the payload so the server re-derive guard has it. (Belt-and-suspenders with the server guard.)

**Snap/Ari assertion (no code change, regression test only):** `_shared/agentTools.ts` `create_experience` already creates a dateless DRAFT and never expands (F-11, correct). Add a test asserting it inserts ZERO `event_dates` rows and never calls the expander, so a future change can't accidentally make the AI path materialize.

**Acceptance:**
- **AC-WS1-SEED-1 (business iOS/Android):** edit a published recurring experience (change only the title), save — the future occurrence count is UNCHANGED (not collapsed to 1).
- **AC-WS1-SEED-2 (test):** the snap path test proves `create_experience` produces a dateless draft.

---

### WS2 — Reservation parity (P1)

#### (a) CTA verb → "Reserve" on consumer

**File:** `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx`

- **Edit `:392-397`** — the `resolveOfferingCta({ … })` call omits `buyVerb`/`freeVerb`, so it renders the generic "Buy ticket"/"Get free ticket" (`offeringCta.ts:240,260`). Add `buyVerb: "Reserve"` and `freeVerb: "Reserve"` to the input object. The shared resolver already honors these optional params — no resolver change needed.
- Verify the reserve bar/banner (`:712-733`) and any other consumer CTA text that renders the experience verb also reads from the resolved `offeringCta.label` (single owner) and not a hardcoded string.

#### (b) Canonical rule-based open-daily detection (shared)

The canonical detector is the rule-based predicate: `is_recurring === true && recurrenceRule.preset === 'daily' && recurrenceRule.termination.kind === 'never'`. It currently lives inline in `mingla-business/app/exp/[…].tsx:98-103` (`isOpenDaily`). Per I-MOR-0827-PACKAGE-ISOLATION, code is PORTED (not cross-imported) between `mingla-business` and `app-mobile`.

**Decision on detector location:** because both apps already isolate their own copies and the rule is tiny, the canonical detector is defined as a small **pure function ported byte-equivalent into each app's utils**, with a single shared NAME + signature so a strict-grep gate can assert both copies match. (Do NOT attempt to host it in `packages/offering-rendering` — that package holds layout chrome only, per scope. If a shared `packages/event-rendering` util is preferred, it may host the rule-based predicate as a pure dep-free function consumed by both apps via the existing package-import path used by `offeringCta.ts`; the implementor picks ONE of these two and documents it. The packages route is PREFERRED because `offeringCta.ts` is already imported by both apps, proving the import path works without violating isolation.)

**Preferred concrete plan (packages route):**
- **New export in `packages/event-rendering/offeringCta.ts`** (or a sibling `packages/event-rendering/experienceOpenDaily.ts`): `isOpenDailyExperience(input: { isRecurring: boolean; recurrenceRule: { preset?: string; termination?: { kind?: string } } | null }): boolean` returning the rule-based test. Pure, no RN imports (mirrors how `offeringCta.ts` is consumed by both apps).
- **`mingla-business/app/exp/[…].tsx`** — replace the inline `isOpenDaily` (`:98-103`) with the shared `isOpenDailyExperience` (same logic; net behavior identical on web — no web regression).
- **`app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx`** — replace `isOpenDailyModel(bookableOccurrences)` (`:371-374`, imported `:91`) with `isOpenDailyExperience({ isRecurring: seed.isRecurring, recurrenceRule: seed.recurrenceRule })`.
- **`app-mobile/src/utils/experienceOpenDaily.ts`** — KEEP the file (its `medianConsecutiveGapMs` may be used elsewhere) but mark `isOpenDailyModel` deprecated, OR delete it if grep shows the consumer detail screen is its only consumer. Confirm via grep before deleting. The density heuristic is no longer the open-daily owner.

**Plumb the rule fields onto the consumer payload (REQUIRED — the consumer seed has neither field today):**

- **File:** `supabase/migrations/20261009000003_orch_1153_consumer_deck_supply_recurrence_fields.sql` — DROP-then-CREATE the consumer deck-supply RPC(s) (`20261007000000_orch_1138_rework_deck_supply.sql` defines them; re-emit from LIVE prod body) to ADD two columns to each RETURNS TABLE: `is_recurring boolean` and `recurrence_rules jsonb`, selected from `events`. Per the migrations-baseline rule, widening a `RETURNS TABLE` requires DROP before CREATE. Re-emit BOTH supply functions (the deck path + the venue→experiences path) if both feed the consumer experience detail seed.
- **File:** `supabase/functions/discover-cards/index.ts` — map the two new RPC columns into the card object emitted to the client (`isRecurring`, `recurrenceRule`). Deploy from MERGED main only (COMMS-0018).
- **File:** `app-mobile/src/types/mergedDiscover.ts` — add to `BusinessEventCard`: `isRecurring?: boolean;` and `recurrenceRule?: { preset?: string; byDay?: string; byMonthDay?: number; bySetPos?: number; termination?: { kind?: string; count?: number; until?: string } } | null;`.
- **Files (seed mappers):** any function that builds a `BusinessEventCard` from the RPC rows (grep `cardToPublicEvent`, the discover/venue seed mappers, and the curated-experiences path `generate-curated-experiences`) must pass through the two new fields. An implementor who maps the RPC but forgets a second seed mapper will leave the detector reading `undefined` on that entry path.

**Coupling note (WS1↔WS2):** because the consumer detector becomes rule-based, it no longer depends on materialized occurrence density — so the WS1 backfill/cron timing no longer flips the consumer's open-daily classification. This REMOVES the F-5 coupling risk. Good. But it means the consumer MUST receive the rule fields (above) or every experience classifies as NOT open-daily (falls back to the slot list), which is a silent parity regression vs web. The payload plumbing is therefore load-bearing, not optional.

**Acceptance (runtime-observable):**
- **SC-WS2-VERB-iOS:** on the consumer experience detail screen (iOS), a paid experience's reserve CTA reads **"Reserve"** (not "Buy ticket"); a free experience reads **"Reserve"** (not "Get free ticket").
- **SC-WS2-VERB-Android:** same on Android.
- **SC-WS2-VERB-Web (regression):** the `/exp/` page CTA still reads "Reserve" / "Reserve · {price}" / "From {price}" — no change.
- **SC-WS2-OPENDAILY-1 (consumer iOS/Android):** a `daily/never` experience (e.g. the backfilled `b8bd995b…` or QA `44444444…`) opens the restaurant-style date→time-in-window→party picker on the consumer surface — matching what `/exp/` shows for the same experience.
- **SC-WS2-OPENDAILY-2 (consumer iOS/Android):** a discrete multi-date experience (recurring=false OR not daily/never) opens the flat slot list on the consumer surface — matching `/exp/`.
- **SC-WS2-OPENDAILY-3 (cross-surface parity):** for the SAME experience, web `/exp/` and consumer detail classify open-daily IDENTICALLY (no surface-specific divergence).

---

## 5. Success criteria (consolidated, per-surface)

| ID | Surface(s) | Observable behavior |
|---|---|---|
| SC-1 | web/biz-iOS/biz-Android | `/exp/raleigh-wine-and-dine-crawl` shows a bookable Reserve CTA with future dates (not Sold out) — proves backfill. |
| SC-2 | consumer iOS/Android | Same experience on the deck shows future reserve occurrences. |
| SC-3 | web/biz-iOS/biz-Android | With the pass-fee fixture, page price === cart total === charged amount (non-zero fee); no jump. |
| SC-4 | all charge-enabled live brands | Absorb-fee experiences show the same price as today (no 100×/wrong-field regression). |
| SC-5 | data | `orch-1153-topup-recurring-experiences` cron exists, runs idempotently, respects count/until/never + 52 cap. |
| SC-6 | business iOS/Android | A recurring publish cannot land in a zero-future-occurrence state (drain guard). |
| SC-7 | business iOS/Android | A title-only live-edit of a recurring experience preserves its future occurrences (seed hardening). |
| SC-8-iOS/SC-8-Android | consumer | Experience reserve CTA reads "Reserve" (paid + free). |
| SC-9 | web + consumer | Same experience classifies open-daily identically across surfaces. |

---

## 6. Invariants

### Preserved
- **I-1 (one ticket per experience; capacity event-level):** WS1 expander/top-up add NO capacity column; party-size→quantity still maps to the single ticket. Verified by the existing checkout contract test.
- **I-4 (publish-time materialization):** **AMENDED by decision OQ-WS1-1.** The cron adds a non-publish materialization path. This is a deliberate, Seth-approved reversal of the "NO cron" choice. The drain guard keeps publish-time materialization authoritative; the cron only TOPS UP forward, never changes the rule or the master. A new invariant (below) governs the cron's idempotency so I-4's intent (no duplicate/divergent occurrences) is preserved.
- **I-MOR-0827-PACKAGE-ISOLATION:** the shared open-daily detector is either ported byte-equivalent into each app OR hosted in `packages/event-rendering` (already imported by both apps) — never a cross-app import.
- **ORCH-1147 all-in contract:** WS3 routes display through `priceAllInGbp` (the `fetchTierAllInCents → pg_public_event_tier_allin` chain); no parallel price path (COMMS-0014).

### New (proposed DRAFT — orchestrator flips ACTIVE on CLOSE)

| ID | Rule | Enforcement | Regression test |
|---|---|---|---|
| **I-PROPOSED-1153-NO-DRAIN** | A `scheduled`/`published` recurring experience whose rule is not count-exhausted/until-expired must NEVER have zero future `event_dates`. | tests-append-only (SQL invariant probe) + the publish-time RAISE EXCEPTION guard | A probe migration test asserts the no-drain SQL invariant; the publish RPC test asserts the EXCEPTION fires for a past-master non-productive recurring publish. Fails-on-revert: removing the guard line makes the publish test pass a drained publish. |
| **I-PROPOSED-1153-RESERVE-VERB** | Every experience buyer CTA across all surfaces uses the verb "Reserve" (free + paid). | strict-grep | Grep gate asserts the consumer `resolveOfferingCta` call passes `buyVerb:"Reserve"`+`freeVerb:"Reserve"` and that `/exp/` CTA strings are "Reserve"; fails if reverted to omit the verbs. |
| **I-PROPOSED-1153-NO-BARE-BASE-UNDER-ALLIN** | No surface displays `priceCents`/bare base under an "all-in"/"taxes included" caption; all-in captions require the all-in number. | strict-grep + test | Grep gate forbids `formatExpPrice(ticket.priceCents` adjacent to the all-in caption on `/exp/`; a unit test with a non-zero fee asserts displayed===all-in. Fails-on-revert: restoring `priceCents` source trips both. |
| **I-PROPOSED-1153-OPENDAILY-ONE-OWNER** | Open-daily detection has exactly one canonical (rule-based) owner consumed by all surfaces; no density-heuristic owner. | strict-grep | Grep gate asserts `isOpenDailyModel` is no longer the detector in `ConsumerExperienceDetailScreen.tsx` and that both surfaces call the shared rule-based predicate. Fails-on-revert: reintroducing the heuristic call trips it. |
| **I-PROPOSED-1153-TOPUP-IDEMPOTENT** | The rolling top-up never creates duplicate `(event_id, start_at)` occurrences, only adds forward, and never exceeds the 52-forward cap or violates count/until. | tests-append-only (SQL probe) | A test runs the top-up twice and asserts zero new rows on the second run + cap/termination respect. Fails-on-revert: removing the forward-only filter trips the duplicate assertion. |

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 happy | Backfill repairs the casualty | apply `…000001` | `b8bd995b…` future_dates > 1; QA fixture unchanged | data |
| T-2 edge | Backfill idempotent | apply backfill logic twice | identical final state, no dup occurrences | data |
| T-3 edge | Backfill skips healthy | QA fixture (51 future) | untouched (not re-anchored) | data |
| T-4 happy | All-in display (pass-fee) | fixture brand pass_mingla_fee=true | `/exp/` price === cart === charged | code+runtime |
| T-5 regression | Absorb-fee unchanged | live brand (all absorb) | displayed price identical to pre-change | code |
| T-6 error | Wrong-unit guard | fixture price | no 100× error (assert formatted value within expected range) | code |
| T-7 happy | Cron registered + idempotent | run top-up twice | one job row; second run 0 new | data |
| T-8 edge | Termination respect | count=3 + until fixtures | never exceeds count/until/52 | data |
| T-9 error | Drain guard | publish recurring w/ past master, non-productive | RAISE EXCEPTION; no drained publish | code |
| T-10 happy | Drain guard pass | publish daily/never | succeeds, materializes | code |
| T-11 happy | Seed hardening | title-only live-edit of recurring | future occurrences preserved | code |
| T-12 edge | Snap stays dateless | `create_experience` | 0 event_dates inserted, no expander call | code |
| T-13 happy | Consumer verb | resolveOfferingCta call | label "Reserve" (paid + free) | code |
| T-14 happy | Open-daily parity | daily/never experience | web + consumer both → open-daily picker | code+runtime |
| T-15 edge | Open-daily negative | discrete multi-date | both surfaces → flat slot list | code+runtime |
| T-16 happy | Payload plumbing | discover-cards RPC | card carries isRecurring + recurrenceRule | edge+data |

---

## 8. TEST / FIXTURE PLAN (critical — 0/8 live brands pass fees)

**Why:** every charges-enabled live brand absorbs all fees, so on live data base === all-in and WS3 is invisible. Stripe is TEST-mode end-to-end (sandbox `acct_1TTnt1`). To PROVE displayed===charged with a non-zero fee, the tester/implementor creates a synthetic pass-fee fixture in TEST mode — NEVER flip a live brand.

**Synthetic pass-fee fixture (TEST mode, sandbox connected account):**
1. A test brand `ORCH-1153 Pass-Fee QA` with `pass_mingla_fee = true` (and optionally `pass_service_fee`/`pass_tax`) so the all-in grosses above base.
2. A published experience under that brand, paid (e.g. base 5000 cents), `is_recurring = true`, rule `daily/never` (so it also exercises the open-daily + backfill paths), connected to the sandbox account so checkout reaches PaymentSheet.
3. Document the fixture brand id + experience id + slug in the TEST report so it's reusable and identifiable for teardown.

**Backfill verification (explicit):** after applying `…000001`, run:
`SELECT count(*) FROM event_dates WHERE event_id='b8bd995b-fde9-452f-a7f9-0dffec359259' AND start_at > now();` → MUST be > 1, and the experience's `/exp/raleigh-wine-and-dine-crawl` page MUST show future bookable dates (no longer Sold out). This is a CLOSE-gating check.

**Two required regression tests (CLOSE Step 0.5):**
- **(a) Implementor happy-path with a fails-on-revert line:** a test that asserts the WS3 displayed price equals the all-in for the pass-fee fixture (or a synthetic ticket with `priceAllInGbp > priceCents`), with a comment that it MUST FAIL when the source is reverted to `priceCents`. Plus the backfill idempotency test (T-2) and the cron idempotency test (T-7).
- **(b) Tester adversarial test on a different angle:** the tester writes an independent test attacking the open-daily PARITY (T-14/T-15) and the drain guard (T-9) — e.g. construct a recurring experience with a past master and assert both that the guard blocks the publish AND that the consumer + web classify it identically post-backfill. This must be a distinct angle from the implementor's price test.

---

## 9. Implementation order

1. **`…000000`** — top-up function + drain guard + seed-hardening server guard (re-emit both RPCs from LIVE prod body). Apply.
2. **`…000001`** — one-shot backfill (DML; reuses the expander). Apply. **Verify AC-WS1-BACKFILL-1..2 immediately** (the live casualty is repaired).
3. **WS3** — `/exp/[…].tsx` + `ExperienceCheckoutFlow.tsx` price source swap (verify the unit). No deploy needed (web ships via Vercel; business via OTA).
4. **`…000002`** — pg_cron registration. Apply. Verify AC-WS1-CRON-1.
5. **`…000003`** — widen consumer deck-supply RPC RETURNS TABLE (DROP+CREATE from LIVE prod body). Apply.
6. **WS2 edge** — `discover-cards/index.ts` map new fields. Deploy from MERGED main only (COMMS-0018).
7. **WS2 shared detector** — add `isOpenDailyExperience` to `packages/event-rendering`; swap both call sites.
8. **WS2 consumer** — `mergedDiscover.ts` type + seed mappers + verb passthrough + detector swap.
9. **WS2 client seed-hardening** — adapter/edit guard.
10. **Tests + fixtures** (§7, §8), then OTA the consumer + business JS changes per-platform (`eas update`, never `--platform all`, isolated TMPDIR + `--clear-cache` per COMMS-0027/EAS gotchas). Web auto-deploys.

---

## 10. Regression prevention (fails-on-revert contract)

- **WS3:** strict-grep gate `orch-1153-no-bare-base-under-allin.mjs` forbidding `formatExpPrice(ticket.priceCents` on `/exp/[…].tsx` + a unit test asserting displayed===all-in for a non-zero-fee ticket. Protective comment: "ORCH-1147/1153: experience pages display the server all-in; never the bare base under an all-in caption."
- **WS2 verb:** strict-grep gate asserting the consumer `resolveOfferingCta` call carries `buyVerb:"Reserve"`+`freeVerb:"Reserve"`.
- **WS2 detector:** strict-grep gate asserting `isOpenDailyModel(` is not the detector in the consumer detail screen and both surfaces import the shared predicate.
- **WS1 no-drain:** SQL invariant probe (append-only test migration) + the publish-RPC EXCEPTION test (must FAIL to fire when the guard line is removed).
- **WS1 top-up idempotency:** the run-twice test (zero new rows second run).
- Each test must FAIL on revert and PASS on restore; document the revert SHA in the implementation report.

---

## 11. Open questions

- **OQ-1 (implementor, load-bearing):** the UNIT of `ticket.priceAllInGbp` on the `PublicExperience` payload — major units (like `offeringCta.ts` consumes) or cents? The WS3 fix MUST confirm this from `publicExperienceService.ts:470` and apply the correct scaling before `formatExpPrice` (which ÷100). A wrong assumption ships a 100× price. This is the only thing in WS3 that can go wrong; it is a code-read, not a decision — resolve it during IMPLEMENT, do not guess.
- **OQ-2 (implementor):** detector home — shared `packages/event-rendering` export (PREFERRED, import path proven) vs byte-equivalent ported copies. Pick one and document in the implementation report.
- **OQ-3 (implementor):** does the consumer experience detail seed arrive via ONE mapper or several (deck vs venue→experiences vs curated)? Grep all `BusinessEventCard` builders and plumb the new recurrence fields through every one; missing one = silent open-daily regression on that entry path.
- **OQ-4 (deferred, not a blocker):** OQ-WS2-3 (unify the consumer's two picker components into one) is OUT of scope this ORCH.

No open questions block IMPLEMENT; OQ-1/OQ-3 are code-reads the implementor performs in-pass.

---

## 12. Scoped allowlist + DO-NOT-TOUCH

### Allowlist (the implementor MAY change ONLY these)
- `supabase/migrations/20261009000000_orch_1153_recurrence_topup_and_guard.sql` (new)
- `supabase/migrations/20261009000001_orch_1153_recurrence_backfill.sql` (new)
- `supabase/migrations/20261009000002_orch_1153_recurrence_topup_cron.sql` (new)
- `supabase/migrations/20261009000003_orch_1153_consumer_deck_supply_recurrence_fields.sql` (new)
- `supabase/functions/discover-cards/index.ts` (map new RPC fields)
- `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` (price source + shared detector)
- `mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx` (recap price + docstring)
- `packages/event-rendering/offeringCta.ts` OR new `packages/event-rendering/experienceOpenDaily.ts` (shared detector)
- `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx` (verb + detector swap)
- `app-mobile/src/utils/experienceOpenDaily.ts` (deprecate/delete heuristic — confirm sole consumer first)
- `app-mobile/src/types/mergedDiscover.ts` (add recurrence fields to BusinessEventCard)
- consumer seed mappers that build `BusinessEventCard` (grep-located; plumb new fields)
- `mingla-business/src/hooks/useExperienceDraftAdapter.ts`, `mingla-business/app/experience/[id]/edit.tsx` (client seed guard)
- New test files + strict-grep gates per §10; the synthetic fixture (§8)

### DO-NOT-TOUCH
- `supabase/functions/ticket-checkout-create/index.ts` and ALL charge math (F-9: correct).
- `pg_public_event_tier_allin`, `fetchTierAllInCents` (the all-in contract; consume, don't change).
- `pg_expand_experience_recurrence` preset math + 52 HARD_CAP (correct; reuse).
- `supabase/functions/_shared/agentTools.ts` `create_experience` (correct dateless draft; test-only).
- The consumer `TicketCartSheet.tsx`, `CartContext.tsx`, cart/qty/party-size math (already all-in, F-9).
- `packages/offering-rendering/*` reserve/layout (no reserve logic belongs there).
- The two `ExperienceReservePicker.tsx` copies' internal layout (parity work is verb + detector, not picker restructure — OQ-4 deferred).
- Tax-basis logic (COMMS-0013, out of scope).

Touching anything outside the allowlist requires a SPEC amendment (`SPEC_AMENDMENT_ORCH-1153_*.md`) — never silently widen.

---

## 13. Downstream routing

**Next = mingla-implementor.** Working tree: `~/Desktop/mingla-orchs/ORCH-1153-[experience-reserve-integrity]/` on branch `ORCH-1153-experience-reserve-integrity` (rebase on `origin/main` first). Build §4 in the §9 order; resolve OQ-1/OQ-3 by code-read in-pass; produce the two regression tests (§8) with fails-on-revert; apply migrations via `supabase db push --linked`/Management API (NOT MCP), re-emitting RPCs from the LIVE prod body; deploy `discover-cards` from MERGED main only; OTA per-platform with isolated TMPDIR + `--clear-cache`. Output: `Mingla_Artifacts/reports/IMPLEMENT_ORCH-1153_*.md`.
**Then → mingla-tester** (build the §8 adversarial test, drive web + business iOS/Android + consumer iOS/Android, verify all SC-* incl. the pass-fee fixture displayed===charged + the backfill casualty repair).
**Then → mingla-orchestrator** CLOSE (flip the five I-PROPOSED-1153-* invariants ACTIVE, World Map sync, OTA records, COMMS-0029-style reconciliation note if any RPC re-emission coordination was needed).
