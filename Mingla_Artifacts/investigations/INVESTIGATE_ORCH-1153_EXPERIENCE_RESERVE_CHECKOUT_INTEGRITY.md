# INVESTIGATE — ORCH-1153 [experience-reserve-checkout-integrity]

**Mode:** mingla-forensics / INVESTIGATE (no fix proposed; recommendations are direction-only).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1153-[experience-reserve-integrity]` on branch `ORCH-1153-experience-reserve-integrity` (rebased on `origin/main`).
**Prod project:** `gqnoajqerqhnvulmnyvv` (all DB queries read-only, live).
**Date:** 2026-06-16.
**Comms acked (WARN, factored):** COMMS-0013 (native vs web tax-basis differ; fee unified, tax not), COMMS-0014 (all-in engine is the DEFAULT for experiences — route checkout through `ticket-checkout-create`, not a parallel fn), COMMS-0018 (deploy edge fns only from MERGED source).

---

## Executive summary (plain English)

Three problems on the experience reserve/checkout chain were dispatched. All three are now proven against live prod, **but the headline root cause of Workstream 1 in the dispatch seed is REFUTED** — the recurrence expander is NOT "called by nothing." It is fully wired into the publish + live-edit RPCs and works correctly for any experience published after its migration landed. The real WS1 problem is a **timing + lifecycle gap**, not a missing call.

1. **WS1 — Recurrence (P0, prod-live):** The materializer migration (`20261005000000`, PR #507) merged to main and applied to prod on **2026-06-16 10:54**. The wired RPCs (`biz_publish_experience`, `biz_update_live_experience`) DO call the expander and it works — a QA fixture created at 07:30... wait, see Data layer: a QA experience with the identical `daily/never` rule has **52 future event_dates**. The one broken live experience ("Raleigh Wine and Dine Crawl") was last published **2026-06-15 21:09 — about 13 hours BEFORE the migration applied** — so the expander never ran for it; it still carries only its single now-past master date and reads as "unavailable." TWO real gaps remain: **(a) no backfill** for experiences published before the migration, and **(b) no rolling refresh** — a `termination=never` rule materializes 52 dates at publish and never tops up, so it slowly drains to zero. pg_cron is installed and Mingla already runs 24 cron jobs, so the "NO cron" choice in the migration header was a product decision (OQ-1), not an infra limit.

2. **WS2 — Reservation parity gap (confirmed):** The reserve *flow* and the CTA *state machine* are largely shared, but two real divergences exist. (a) **Open-daily detection is forked into two different algorithms** — the buyer-web/business page reads the recurrence rule (`preset==='daily' && termination.kind==='never'`); the consumer app uses an occurrence-density heuristic (`≥7 occurrences, ≥90-min windows, ≤1.5-day median gap`) — so the same experience can classify differently on the two surfaces. (b) **The CTA verb diverges:** web/business shows **"Reserve"**; the consumer app shows **"Buy ticket"/"Get free ticket"** (it never passes the experience verb to the shared CTA resolver). Neither surface uses the documented Direction-A verb. There is NO shared reserve-picker component (the two `ExperienceReservePicker.tsx` are deliberate ported copies under the package-isolation rule).

3. **WS3 — True all-in price dropped (regression, confirmed):** This is NOT a multi-step recompute leak (the cart, qty, and party-size math all correctly multiply the all-in). It is a single unmigrated entry point: the **business public `/exp/[brandSlug]/[experienceSlug].tsx` page shows `ticket.priceCents` (bare base)** while captioning it "All-in, taxes included," even though the all-in (`ticket.priceAllInGbp`) is already fetched and sitting on the payload. The buyer then sees the price jump up when they reach the cart (which IS all-in). The server always charges the authoritative all-in, so this is a **display/WYSIWYP breach, not an over/undercharge.**

---

## Investigation manifest (files read, in trace order)

| # | File / object | Layer | Why |
|---|---|---|---|
| 1 | `COMMS_LEDGER.md` (active entries) | docs | Mandatory entry scan; acked 0013/0014/0018 |
| 2 | `supabase/migrations/20261005000000_orch_1138_experience_recurrence_materializer.sql` (full) | schema/code | The materializer + re-emitted publish/live-edit RPCs |
| 3 | prod `pg_proc` for the 3 RPCs (`pg_get_functiondef ILIKE expander`) | runtime | Prove the live bodies call the expander |
| 4 | prod `supabase_migrations.schema_migrations` | runtime | Prove migration applied |
| 5 | prod `events` + `event_dates` for `b8bd995b…` and all `is_recurring=true` | data | The actual broken row + cohort |
| 6 | `git log` for migration file | docs/runtime | When the wiring reached main/prod (2026-06-16 10:54) |
| 7 | prod `cron.job`, `pg_extension` (pg_cron/pg_net) | runtime/data | Rolling-refresh feasibility |
| 8 | `mingla-business/.../ExperienceCreatorWizard.tsx`, `useExperienceDraftAdapter.ts`, `app/experience/[id]/edit.tsx`, `experienceDetailService.ts` | code | Client payload — can `whenMode`/rule be dropped? |
| 9 | `supabase/functions/_shared/agentTools.ts` `create_experience` | code | Snap path — does it materialize/expand? |
| 10 | `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx`, `ExperienceCheckoutFlow.tsx`, `ExperienceReservePicker.tsx` | code | Web reserve CTA + price |
| 11 | `app-mobile/.../ExperienceOccurrencePicker.tsx`, `ExperienceReservePicker.tsx`, `screens/Experience/ConsumerExperienceDetailScreen.tsx`, `utils/experienceOpenDaily.ts` | code | Consumer reserve CTA + open-daily |
| 12 | `mingla-business/src/components/checkout/CartContext.tsx`, `src/services/publicExperienceService.ts`, `app-mobile/.../TicketCartSheet.tsx`, `publicEventTicketsService.ts` | code | All-in price flow |
| 13 | `supabase/functions/ticket-checkout-create/index.ts` | code | Server-charged amount |
| 14 | `packages/offering-rendering/*`, `packages/event-rendering/offeringCta.ts` | code | Shared vs bespoke |

---

## Q-scorecard

- **Q1.** Is `pg_expand_experience_recurrence` called by anything (the seed claim: "called by NOTHING")? **Verdict: REFUTED — proven.** It is called by both `biz_publish_experience` (publish branch) and `biz_update_live_experience` (live-edit branch), and the LIVE prod bodies contain those calls.
- **Q2.** Does the expander actually materialize 2nd..Nth dates on prod? **Verdict: YES — proven.** QA fixture `44444444-1138-…` (`daily/never`) has 52 future dates spanning 2026-06-16 → 2026-08-06.
- **Q3.** Why does "Raleigh Wine and Dine Crawl" have only 1 (past) date? **Verdict: proven — it was published 13h before the wiring applied; expander never ran for it; no backfill exists.**
- **Q4.** Can a partial client live-edit drop `whenMode`/`recurrence_rules` and wipe expanded dates? **Verdict: NO from the wizard payload (always full); but YES as a latent seed risk** if `events.is_recurring`/`recurrence_rules` are out of sync at load (suspected, not observed live).
- **Q5.** Does the public availability path read only materialized `event_dates` (vs compute-on-read)? **Verdict: YES — proven.** `loadSidecars` selects `event_dates` directly; materialization is the fix surface.
- **Q6.** Will a `termination=never` rule stay topped past the 52 window? **Verdict: NO — proven gap.** 52 materialized at publish, no top-up; drains over time.
- **Q7.** Per surface, what is the reserve CTA + does a date/slot/party picker exist? **Verdict: mapped — see WS2 table.**
- **Q8.** Is open-daily detection consistent across surfaces? **Verdict: NO — proven.** Two different algorithms (rule-based web vs density-heuristic consumer).
- **Q9.** Where does a displayed experience price drop the fee? **Verdict: one site — proven.** `/exp/[…].tsx:289-294` uses `ticket.priceCents`.
- **Q10.** Can displayed price diverge from charged in an over/undercharge? **Verdict: NO — proven.** Server recomputes the all-in from DB; client prices are display-only.
- **Q11.** Does the snap/Ari `create_experience` materialize dates or expand recurrence? **Verdict: NO — proven, and correct.** It creates a dateless DRAFT shell; the brand finishes + publishes via the wizard.

---

## WORKSTREAM 1 — Recurrence not materialized for a pre-migration row + no rolling refresh

### Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction |
|---|---|---|
| **Docs** | Migration header (lines 1–34) says the expander is wired into both RPCs "with EXACTLY ONE added call" and "NO cron (OQ-1, Seth-approved)." | The **dispatch seed** says "called by NOTHING." **Docs (migration) win — the seed grep was stale/missed the in-file PERFORM.** |
| **Schema** | Migration `20261005000000` defines the expander + re-emits both RPCs with the PERFORM call (lines 689, 1310). | — |
| **Code (client)** | `ExperienceCreatorWizard.buildPayload` always sends `whenMode`/`when`/`recurrence_rules` (no partial payload). `create_experience` (agentTools) makes a dateless draft, never expands. | — |
| **Runtime (prod RPC bodies)** | `pg_get_functiondef` of all 3 functions ILIKE `pg_expand_experience_recurrence` = **true** for all three. Migration present in `schema_migrations`. | **Refutes the seed.** |
| **Data (prod)** | Broken row `b8bd995b…`: 1 date, 0 future, last published 2026-06-15 21:09. QA row `44444444…`: 52 future. Migration on main 2026-06-16 10:54. | The broken row predates the wiring → never expanded. Two gaps: backfill + rolling refresh. |

### Proven root causes (six-field evidence)

**F-1 — Pre-migration recurring experiences were never expanded; no backfill exists. (CONFIRMED ROOT CAUSE; confidence: proven.)**
1. **Symptom:** "Raleigh Wine and Dine Crawl" public page shows unavailable/sold-out though its ticket has 0 sold of 20.
2. **Layer:** data + schema (timing).
3. **Probe:** `git log --format='%h %ci %s' -- supabase/migrations/20261005000000_*.sql`; `SELECT … FROM events WHERE is_recurring; SELECT * FROM event_dates WHERE event_id='b8bd995b…'`.
4. **Evidence:** migration commit `13c3ec4c5 2026-06-16 10:54:06 … (#507)`, on `origin/main`. Broken row `updated_at=2026-06-15 21:09:28`, single `event_dates` row `is_master=true start_at=2026-06-15 04:15 end_at=2026-06-16 03:00` (now past). QA row `44444444-1138-…` (`daily/never`, created/published 2026-06-16 07:30 — i.e. **after** apply) has 52 dates 2026-06-16 21:00 → 2026-08-06 21:00.
5. **Mechanism:** the expander call only executes on a publish/live-edit that runs *after* the migration applied. The live row's last publish predates apply by ~13h, so only its master date exists; the public read path (F-3) sees zero future occurrences → unavailable.
6. **Severity:** CONFIRMED ROOT CAUSE.

**F-2 — `termination=never` rules never top up past the 52-occurrence window (no rolling refresh). (SECONDARY ROOT CAUSE; confidence: proven by design-read + infra.)**
1. **Symptom:** a healthy `daily/never` experience will, over weeks/months, drain to zero future dates and self-break.
2. **Layer:** schema/design.
3. **Probe:** read migration lines 44–47 + 122; `SELECT … FROM cron.job; SELECT extname,extversion FROM pg_extension WHERE extname IN ('pg_cron','pg_net')`.
4. **Evidence:** migration comment: "NO cron / rolling top-up (OQ-1, Seth-approved): a never-ending rule materializes up to 52 forward occurrences at publish; re-publish / live-edit re-materializes from 'today'." pg_cron `1.6.4` + pg_net `0.19.5` installed; **24 active cron jobs** already exist (e.g. `orch-0869-process-scheduled-installments 0 */6 * * *`, `orch-0875-process-booking-deadlines 0 * * * *`).
5. **Mechanism:** the only top-up trigger is a manual re-publish/edit. With `daily`, 52 occurrences = ~52 days of runway; after that the experience reads unavailable until the brand re-saves it.
6. **Severity:** SECONDARY ROOT CAUSE (slow-burn P1 that recreates the P0 symptom for every long-lived recurring experience).

**F-3 — Public availability reads ONLY materialized `event_dates` (no compute-on-read). (RULED OUT as a bug; this CONFIRMS materialization is the correct fix surface; confidence: proven.)**
1. **Symptom:** n/a — confirms the fix vector.
2. **Layer:** code.
3. **Probe:** read `publicExperienceService.ts` loadSidecars.
4. **Evidence:** `publicExperienceService.ts:465-469` — `.from("event_dates").select("id, start_at, end_at, timezone, is_master").eq("event_id", eventId)`; bookable occurrences are filtered to future client-side. No recurrence-rule evaluation on read.
5. **Mechanism:** since the read path never expands the rule, only materialized rows are bookable — confirming the fix is materialization (backfill + rolling refresh), NOT compute-on-read.
6. **Severity:** RULED OUT (as a defect) — load-bearing confirmation.

**F-4 — Latent seed-sync risk on live-edit. (SUSPECTED CONTRIBUTOR; confidence: suspected — not observed live.)**
1. **Symptom:** a recurring experience could lose its expanded dates after an unrelated live-edit.
2. **Layer:** code (client seed) + schema (unconditional re-materialize).
3. **Probe:** read `edit.tsx:69-189` `detailToInitialDraft`, `useExperienceDraftAdapter.ts:144-152,186-210`, `experienceDetailService.ts:159-174`.
4. **Evidence:** `biz_update_live_experience` **unconditionally** `DELETE FROM event_dates … then reinserts` (migration line 1286) and only re-expands when `v_when_mode='recurring' AND v_recurrence_rules IS NOT NULL`. The client seed reconstructs `whenMode`/`recurrenceRule` from `events.is_recurring` + `firstRecurrenceRule(recurrence_rules)`; if those are out of sync (e.g. rule stored in an unexpected shape → `firstRecurrenceRule` returns null), a live-edit sends `recurrence_rules:null` and the delete wipes the expansion without re-expanding.
5. **Mechanism:** seed mistrust → payload drops the rule → server deletes + skips expansion → collapses to master.
6. **Severity:** SUSPECTED CONTRIBUTOR (defensive hardening, not the live cause).

### Recommended fix architecture (direction only — NOT a spec)
- **Backfill (one-shot):** a migration/maintenance routine that, for every `events` row where `is_recurring=true AND status IN ('scheduled','published') AND` future-date count = 0 (or < a floor), re-runs `pg_expand_experience_recurrence` from the master (or from "today"). The broken live row `b8bd995b…` is the immediate casualty; F-1 query is the exact selector.
- **Rolling refresh (the durable fix for F-2):** a pg_cron job (precedent: the 24 existing jobs; daily cadence like `notify-lifecycle-daily 0 10 * * *`) that, for `never`/long `until` recurring experiences whose forward materialized window has fallen below a threshold, tops up to the 52-cap rolling window. This is a **product DECISION reversal of OQ-1** — flag to Seth.
- **Seed hardening (F-4):** make the live-edit either (a) refuse to wipe recurrence rows when the incoming payload's `whenMode`/rule is absent but the persisted row is recurring, or (b) re-derive the rule server-side from the persisted columns. Decision for SPEC, within scope.

### Affected surfaces (WS1)
- Backfill + cron: **backend only** (DB). No client change.
- The user-visible repair shows on every surface that reads `event_dates` (buyer-web, business iOS/Android via the same route, consumer iOS/Android deck + detail) — automatically, via shared materialized rows.

### Risks / open questions (WS1)
- **OQ-WS1-1 (DECISION for Seth):** reverse the "NO cron" OQ-1 decision and add a rolling-refresh cron? (Recommended — F-2 otherwise self-breaks every recurring experience.)
- **OQ-WS1-2:** backfill cadence — one-shot now, or fold into the cron's first run?
- **OQ-WS1-3:** for `never`, should re-publish reset the window from "today" (drops past-but-future-of-master dates)? Current live-edit re-materializes from the edit's master date.

---

## WORKSTREAM 2 — Reservation parity gap

### Five-Truth-Layer reconciliation

| Layer | Finding |
|---|---|
| **Docs** | Direction-A (ORCH-1138 mockups) wants verb "Reserve," adaptive picker (single→cart, multiple→slots, open-daily→date+time+party). `offeringCta.ts:106-108` documents the *intended* experience verb as "Get my spot." |
| **Schema** | Selection contract `{eventDateId, quantity}` identical on both surfaces; party-size→quantity maps to the single ticket (I-1). |
| **Code** | Web/business `/exp/` route + consumer detail both have adaptive pickers; CTA state machine `resolveOfferingCta` is shared; reserve *bars* and *pickers* are duplicated, not shared. |
| **Runtime** | Web CTA renders "Reserve"; consumer renders "Buy ticket"/"Get free ticket". |
| **Data** | n/a. |

**Contradiction flagged:** docs say one verb ("Reserve" per Direction A, or "Get my spot" per offeringCta comment); web uses "Reserve," consumer uses "Buy ticket." Three different verbs across docs+surfaces.

### Per-surface map (six-field-summarized; all CONFIRMED, confidence: proven by source read)

| Surface | Reserve entry (file:line) | CTA string | Date/slot picker | Party/qty picker | Open-daily detection |
|---|---|---|---|---|---|
| **Buyer Web `/exp/`** (also serves business iOS/Android via the same expo-router route) | `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx:314-319,445` via `TripReserveBar` | **"Reserve"** | YES — `ExperienceReservePicker` `mode="slots"` when `bookable.length>1`; straight-to-cart at 0/1 | YES — open-daily mode only (party stepper, MAX 12) | **Rule-based** `isOpenDaily()` `:98-103` |
| **Buyer Web picker** | `mingla-business/src/components/experience/ExperienceReservePicker.tsx:220,402-425` | "Reserve →" / "Reserve a table" | YES (both modes) | YES (open-daily) | consumes `mode` prop |
| **`ExperienceCheckoutFlow.tsx`** | recap only; inline CTA removed (ORCH-1117) `:72-75` | (none; stale "Get my spot" docstring `:8`) | n/a | n/a | n/a |
| **Consumer iOS/Android** | `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx:712-733` via `ConsumerEventReserveBar`, `beginBooking` | **"Buy ticket" / "Get free ticket"** (no `buyVerb`/`freeVerb` passed to `resolveOfferingCta` `:392-397`) | YES — `ExperienceOccurrencePicker` (flat) + `ExperienceReservePicker` (open-daily) | YES (open-daily) | **Density heuristic** `isOpenDailyModel()` `app-mobile/src/utils/experienceOpenDaily.ts:61-77` |
| **Business native operator screen** | `mingla-business/app/experience/[id]/index.tsx` | none (operator dashboard, not a buyer surface) | n/a | n/a | n/a |

> Note: `ExpandedBusinessEventSheet.tsx` named in the dispatch **does not exist**; the consumer `beginBooking` lives in `ConsumerExperienceDetailScreen.tsx`. The "buyer web" and "business iOS/Android" buyer surfaces are the **same** `/exp/` route.

### Proven divergences
- **F-5 (CONFIRMED):** open-daily detection forked. Web `:98-103` = `whenMode==='recurring' && rule.preset==='daily' && rule.termination.kind==='never'`. Consumer `experienceOpenDaily.ts:61-77` = `occ.length>=7 && every window>=90min && medianGap<=~1.5d`. Same experience can classify differently → different picker (slots vs date+time+party) per surface. **Interaction with WS1:** the consumer heuristic depends on materialized occurrence density — a backfilled/topped-up experience will flip the consumer's open-daily classification, so WS1 and WS2 are coupled.
- **F-6 (CONFIRMED):** CTA verb drift — consumer never passes the experience verb; renders generic ticket verbs. Web hardcodes "Reserve."

### Recommended fix architecture (direction only)
- **Single source of open-daily truth:** consolidate to ONE detection. The rule-based test is authoritative intent and is independent of materialization timing; the density heuristic was a consumer-only workaround. Recommend the web rule-based predicate become the shared owner (likely a shared helper, but respecting `I-MOR-0827-PACKAGE-ISOLATION` — ported, not imported). DECISION needed: rule-based vs heuristic as the canonical owner.
- **Verb parity:** pass the experience verb to `resolveOfferingCta` on the consumer surface so both render the agreed Direction-A verb. DECISION needed: final verb string ("Reserve" vs "Get my spot" — Direction A vs the offeringCta comment).
- **Shared vs per-app:** the CTA state machine + selection contract are already shared (`packages/event-rendering/offeringCta.ts`). The pickers are intentionally duplicated; parity work is per-app but must stay byte-equivalent. `packages/offering-rendering` holds only layout chrome — no reserve logic belongs there today.

### Affected surfaces (WS2): buyer-web + business iOS/Android (same route) = one change; consumer iOS/Android = one change (shared logic ported). Admin/business-web-preview: not covered (no buyer reserve there).

### Risks / open questions (WS2)
- **OQ-WS2-1 (DECISION):** canonical open-daily owner — rule-based (web) or density (consumer)?
- **OQ-WS2-2 (DECISION):** final CTA verb — "Reserve" or "Get my spot"?
- **OQ-WS2-3:** consumer has two picker components (flat `ExperienceOccurrencePicker` + open-daily `ExperienceReservePicker`); web has one unified `ExperienceReservePicker`. Unify consumer to one, or leave as-is? (Scope question for SPEC.)

---

## WORKSTREAM 3 — True all-in price dropped at the public-page entry

### Five-Truth-Layer reconciliation

| Layer | Finding |
|---|---|
| **Docs** | ORCH-1147: cart must READ the server all-in via `fetchTierAllInCents → pg_public_event_tier_allin`. WYSIWYP: the upfront quote must equal the charge. |
| **Schema** | `pg_public_event_tier_allin` exists on prod; `fetchTierAllInCents` populates `ticket.priceAllInGbp`. |
| **Code** | Cart + qty + party-size multiply the all-in correctly. The public `/exp/` page renders the bare base. |
| **Runtime** | Public page shows base; cart shows higher all-in → visible jump. |
| **Data** | Server charges all-in (fee-grossed) regardless of client display. |

**Contradiction flagged:** public page caption says "All-in, taxes included" while the number shown is the bare base (Docs/intent vs Code).

### Proven root cause

**F-7 — Public `/exp/` page quotes `ticket.priceCents` (bare base) under an "All-in" caption; the all-in is fetched but unread. (CONFIRMED ROOT CAUSE / regression; confidence: proven.)**
1. **Symptom:** the headline/CTA price on the public experience page is lower than the cart total; "All-in, taxes included" caption is false on that screen.
2. **Layer:** code (+ runtime jump).
3. **Probe:** read `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx:288-322`; cross-check `publicExperienceService.ts:358-363,470`.
4. **Evidence (verbatim):** `:289-294` `const expPrice = ticket !== null && ticket.priceCents > 0 ? formatExpPrice(ticket.priceCents, ticket.currency) : …`; consumed at `:318 price: usesPicker ? \`From ${expPrice}\` : expPrice` and `:445 Reserve · ${expPrice}`; caption `:321-322 barKicker = … "All-in, taxes included"`. `ticket.priceAllInGbp` is set from `fetchTierAllInCents` (`publicExperienceService.ts:470`) but never read on this page.
5. **Mechanism:** the page renders base instead of the already-available all-in, so the buyer sees a lower number that jumps up at the cart — the exact ORCH-1147 bug class, one surface upstream of the cart.
6. **Severity:** CONFIRMED ROOT CAUSE (regression / WYSIWYP breach).

**F-8 — `ExperienceCheckoutFlow.tsx:96` renders base in the recap card. (SUSPECTED CONTRIBUTOR; confidence: proven-but-dormant.)** The inline CTA was removed (ORCH-1117 `:72-75`) so it's a non-navigating recap, but the price text is still base; if re-surfaced it leaks. Low impact.

**F-9 — Server charges the authoritative all-in; no over/undercharge. (RULED OUT as a money bug; confidence: proven.)** `ticket-checkout-create`: client sends only `{ticketTypeId, quantity}` (`payment.tsx:254-257`); `totalCents` from the session RPC (DB `price_cents` × qty); `computeBuyerSubtotal({baseCents: totalCents,…})` grosses up fee/tax; PI amount = `buyerSubtotalCents`, `application_fee_amount = miglaFeeCents`. Display divergence is cosmetic, not financial.

### Where it is NOT broken (verified)
- Cart total `CartContext.tsx:483-518` multiplies `unitPriceAllIn` per line; reducer re-seeds all-in on qty change (`:264-278`). Party-size→qty seeds `unitPriceAllIn` (`checkout-experience/[…]/index.tsx:155`). Consumer `TicketCartSheet.tsx:330-361` reads `priceAllInGbp`. Pickers display no price. **No qty/party-size recompute leak exists.**

### Recommended fix architecture (direction only)
- Make `/exp/[…].tsx:289-294` read `ticket.priceAllInGbp` (with base fallback) exactly as the consumer page + cart already do — single-line source swap, no new contract. Optionally fix the F-8 recap and the stale docstring.

### Affected surfaces (WS3): buyer-web + business iOS/Android (same `/exp/` route) = the one fix. Consumer already correct (reads all-in). Cart/payment already correct.

### Risks / open questions (WS3)
- **OQ-WS3-1 (fixture, not a blocker):** 0/8 charges-enabled brands pass any fee today (all absorb), so on live data base == all-in and the bug is invisible. Testing requires a **synthetic pass-fee fixture**: a test brand with `pass_mingla_fee=true` (and/or `pass_service_fee`/`pass_tax`) on a published experience, so all-in > base and the jump is observable. Recommend creating it in TEST mode against the sandbox connected account `acct_1TTnt1` (Stripe is test-mode end-to-end per memory); do NOT flip a live brand. This belongs to the tester/implementor fixture plan, not investigation.

---

## Repro evidence

This is a **backend/data + source-audit** investigation (Prime Directive 7 exemption: SQL/migration/RLS + code audit). No simulator repro was required for WS1/WS3 (proven from live prod data + source). WS2 CTA strings and pickers are proven from source; a live-fire of the CTA-verb divergence and the open-daily classification flip is recommended for the TEST phase, not INVESTIGATE.

Live-prod probes run (all read-only):
- `schema_migrations` membership of `20261005000000` → present.
- `pg_get_functiondef` of the 3 RPCs ILIKE expander → all true.
- `events`/`event_dates` for the broken row + the recurring cohort (3 rows).
- `git log` of the migration file → on main 2026-06-16 10:54.
- `cron.job` (24 jobs) + `pg_extension` (pg_cron 1.6.4, pg_net 0.19.5).

---

## Blast radius / cross-surface map

| Surface | WS1 (recurrence) | WS2 (parity) | WS3 (price) |
|---|---|---|---|
| Consumer iOS | Affected (reads materialized dates) — fixed automatically by backfill/cron | Affected (verb + open-daily heuristic) | Not affected (already all-in) |
| Consumer Android | same | same | same |
| Buyer Web / Business iOS/Android (`/exp/` route) | Affected — fixed automatically | Affected (verb "Reserve" already, open-daily owner) | **Affected — F-7 fix here** |
| Admin Web | Not affected | Not affected | Not affected |
| Business Web preview | Not affected | Not affected | Not affected |

**Recurring cohort needing backfill (live):** `b8bd995b…` (the casualty). QA `44444444…` is healthy (52 dates); `Recur_Date_Test 59df3bc4…` is a draft (0 dates, correct — drafts don't materialize). The backfill selector (F-1) will scope to scheduled/published recurring rows with no future dates.

---

## Invariant impact (flagged, not pre-decided)
- **I-4 (publish-time materialization):** F-2's recommended cron would ADD a non-publish materialization path — directly in tension with I-4. This is a deliberate design reversal of OQ-1 and must be an explicit DECISION + new invariant if adopted.
- **I-1 (one ticket per experience; capacity event-level):** WS2 party-size→quantity mapping must continue to map to the single ticket. Any picker change must preserve it.
- **I-MOR-0827-PACKAGE-ISOLATION:** WS2 consolidation must port, not cross-import, between `mingla-business` and `app-mobile`.
- **ORCH-1147 all-in contract:** WS3 fix must route through `fetchTierAllInCents`/`priceAllInGbp` (no parallel price path). COMMS-0014: keep experiences on the unified engine.

## Discoveries for orchestrator
- **DISC-1153-A:** The dispatch seed's WS1 headline ("called by NOTHING") is **factually wrong against current prod** — the expander is wired and works. The true WS1 issue is backfill + rolling refresh + a timing artifact (PR #507 applied 2026-06-16). Recommend updating the World Map / WS1 framing.
- **DISC-1153-B:** Stale docstring `ExperienceCheckoutFlow.tsx:8` ("the buyer just taps 'Get my spot'") and the `offeringCta.ts:106-108` "Get my spot" comment both contradict the live "Reserve"/"Buy ticket" CTAs — doc-rot to clean up during the WS2 fix.
- **DISC-1153-C:** `firstRecurrenceRule` shape-fragility (F-4) is a latent data-integrity risk beyond this ORCH; worth a defensive test even if WS1 seed-hardening is deferred.

## Confidence level
- **WS1: proven** (live prod data + migration git history + working QA counter-example). Seed claim refuted.
- **WS2: proven** (source-read; CTA strings + forked detection algorithms quoted verbatim). Live-fire deferred to TEST.
- **WS3: proven** (source-read + server-charge trace; verbatim leak line). Cosmetic-only confirmed (no over/undercharge).

## Recommended next phase + scope
**INVESTIGATE-THEN-SPEC → SPEC** (this skill), pending Seth's decisions on the open questions. Recommended scope for the SPEC, in priority order:
1. **WS1 backfill** (one-shot) — repair the live casualty now (P0).
2. **WS3 single-line all-in fix** on `/exp/[…].tsx` (P0, trivial, high WYSIWYP value).
3. **WS1 rolling-refresh cron** (P1, requires OQ-WS1-1 decision — reverses OQ-1/I-4).
4. **WS1 seed-hardening** (F-4, P2, defensive).
5. **WS2 parity** (open-daily owner + CTA verb), requires OQ-WS2-1/2 decisions.

Do NOT start the SPEC until Seth rules on: rolling-cron yes/no (OQ-WS1-1), open-daily canonical owner (OQ-WS2-1), and CTA verb (OQ-WS2-2).
