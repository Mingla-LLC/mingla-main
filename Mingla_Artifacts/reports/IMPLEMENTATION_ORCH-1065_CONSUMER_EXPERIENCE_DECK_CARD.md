# IMPLEMENTATION — ORCH-1065 [consumer-experience-deck-card]

**Mode:** IMPLEMENT (Claude `mingla-implementor`)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1065-[consumer-experience-deck-card]/` on branch `ORCH-1065-consumer-experience-deck-card`
**Base:** `origin/main` `b9d272156`
**Implementation commit:** `6b2c97f45`
**Date:** 2026-06-03
**Inputs:** SPEC_ORCH-1065 + DESIGN_ORCH-1065 + INVESTIGATION_ORCH-1065 (all read in full)

**Comms-ledger acks (this turn):**
- COMMS-0002 (WARN, ALL) — added `ORCH_1065_BACKEND_ALLOWLIST` to `orch-0863-marketing-hub-phase-b.mjs` C7 in the SAME commit as the backend files. C7 verified green.
- COMMS-0003 (WARN, ALL) — the new migration cites Postgres/Supabase docs URLs inline for the RPC, SECURITY DEFINER, jsonb_agg, and the haversine trig functions.
- COMMS-0018 (WARN, META-ORCH-1009) — the supply seam reads `events` + `experience_stops` directly and references NONE of `place_pool`/`ai_signal_scores`/`run-signal-scorer`/`session_deck_cards` (T-09 grep-clean, fails-on-revert proven).
- COMMS-0014/0016 (re-homed to this lineage) — booking reuses `ticket-checkout-create` unchanged; NO parallel money fn (T-08 fails-on-revert proven).

---

## 1. STATUS

**implemented and verified** (code-level): all 8 spec deliverables built, 21 Deno regression tests green, 4 fails-on-revert proofs captured at `6b2c97f45`, `deno check` clean on the edge fn, `tsc --noEmit` clean on all three touched app-mobile files, C7 strict-grep green, migration predicate validated read-only against live remote data.

**UNVERIFIED (requires runtime, orchestrator/tester-owned):** the on-device deck render (SC-2 iOS+Android) and end-to-end Book→PaymentSheet (SC-9) require (a) the migration applied via `db push`, (b) the edge fn deployed, (c) a seeded published-live experience, (d) sim/device live-fire. These are the tester's live-fire step (SPEC §7) — this implementor does NOT apply migrations or deploy edge fns (Rule 9/11).

---

## 2. FILES CHANGED (Old → New receipts) — all at commit `6b2c97f45`

### `supabase/migrations/20260903000000_orch_1065_eligible_experiences_for_deck.sql` (NEW)
**Before:** no events→deck supply path existed.
**Now:** SECURITY DEFINER `STABLE` SQL function `pg_eligible_experiences_for_deck(p_lat, p_lng, p_radius_m, p_intents, p_now, p_exclude_ids, p_limit)` returning one row per deck-eligible published-live experience with brand attribution + soonest future date + all-in price + a `jsonb_agg` of stops ordered by `stop_order`. Eligibility = `event_type='experience' AND visibility='public' AND status='scheduled' AND published_at NOT NULL AND deleted_at IS NULL AND experience_intents>=1 AND future event_date AND available_online ticket AND (p_intents='{}' OR intents&&p_intents) AND ≥1 stop within p_radius_m`. `GRANT EXECUTE … TO service_role` only (no anon). Adds `experience_stops_latlng_idx`.
**Why:** SPEC §3.1.1 / §3.2 supply contract (SC-1, SC-3..SC-6).
**Lines:** ~190.

### `supabase/functions/discover-cards/index.ts` (EDIT, SOLO path only)
**Before:** SOLO deck served only place + curated cards from `place_pool`/`session_curated_cache`; experiences invisible.
**Now:** module-level `ExperienceDeckCard` envelope + `EXPERIENCE_INTENT_BY_SIGNAL` map + `resolveExperienceIntents` (permissive-on-empty) + `fetchEligibleExperiences` (one service-role RPC round-trip, maps rows → envelope, honest-null distance via `haversineKm`, rating/reviewCount=0) + `interleaveExperiencesIntoDeck` (additive round-robin, experiences never displace place cards, experiences-only when pool empty). Wired into the SOLO path: the fetch is hoisted ABOVE the zero-row branch; the zero-row branch returns a populated `path:'pipeline'` experiences-only deck when experiences exist (else `pool-empty`); the populated return serves `mergedCards`; `experienceCount` added to `sourceBreakdown`. Collab path (`handleDeterministicV2`) byte-untouched.
**Why:** SPEC §3.1 (SC-1, SC-11, INV-042/043); COMMS-0018 bypass.
**Lines:** ~230 added.

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (EDIT)
**Before:** C7 backend allowlist had no ORCH-1065 entry → my migration + edge fn + backend tests would be flagged as forbidden backend touches.
**Now:** `ORCH_1065_BACKEND_ALLOWLIST` const (migration + `discover-cards/index.ts` + the 2 backend test files) spread into `ALLOWLIST`. Same commit as the backend files (COMMS-0002).
**Why:** SPEC §3.5 / SC-12. C7 verified green (10 files in diff, zero offenders).
**Lines:** ~17.

### `app-mobile/src/services/deckService.ts` (EDIT)
**Before:** `discoverCardsPayloadToRecommendations` decoded only curated + single-place cards.
**Now:** `isExperiencePayload` (cardType==='experience') + `EXPERIENCE_INTENT_LABEL` + `experienceStopLabel` + `experienceCardToRecommendation` (carries discriminator + brand fields verbatim, maps server stops → `CuratedStop[]` with honest defaults — rating 0, null hours/open/website — and base `Recommendation` fields). Routed FIRST in the map callback (before curated, since an experience envelope also has `stops[]`).
**Why:** SPEC §3.3 (SC-1, Constitution #9). T-02 fails-on-revert.
**Lines:** ~120.

### `app-mobile/src/components/SwipeableCards.tsx` (EDIT)
**Before:** two-way renderer (curated vs place); `ExpandedCardModal` target only `nightOut`; no experience expand path.
**Now:** imports `BusinessEventCard` + `hueFromId`; module-level `experienceRecToBusinessEventCard` mapper (mirrors `tripToBusinessEventCard`, eventId=experience.id, single-ticket shape, `publicBuyerUrl` to `/e/{brandSlug}/{eventSlug}`); `expandedBrandExperience` state; 3-way renderer switch (experience → `CuratedExperienceSwipeCard` with `brandExperience` + `ctaOverride="Book"`); `handleCardExpand` experience branch BEFORE curated → `setExpandedBrandExperience`; `ExpandedCardModal` target prefers `businessEvent`; close handler clears the state.
**Why:** SPEC §3.4.1/§3.4.2 (SC-2, SC-7); COMMS-0014/0016. T-03/T-07 fails-on-revert.
**Lines:** ~95.

### `app-mobile/src/components/CuratedExperienceSwipeCard.tsx` (EDIT)
**Before:** curated multi-stop card, single neutral "See Full Plan"/"See Details" tray CTA, no brand attribution.
**Now:** two optional props `brandExperience?` + `ctaOverride?`; colocated `BrandChip` (glass lockup copying `glass.badge` tokens with Android opaque fallback + Reduce-Transparency reactive listener, 28×28 logo disc via expo-image with onError→monogram, deterministic-hue monogram with the §5.1 yellow-green band-lightness clamp, brand-name truncation); `ctaText = ctaOverride ?? (existing)`; filled `#FF6B35` Book button (ticket-outline icon, minHeight 44, activeOpacity 0.85, iOS Light haptic on press-in, `Book {title}` a11y label). Both new elements gated on the props → curated callers byte-unaffected.
**Why:** SPEC §3.4.3 + DESIGN §2/§3/§5/§7 (SC-2, SC-13, Constitution #9). T-12 fails-on-revert.
**Lines:** ~190.

### Tests (NEW, 4 files at SPEC-named real paths)
- `supabase/functions/discover-cards/__tests__/orch_1065_experience_supply.test.ts` — T-01a..e (helper/RPC/interleave/empty-pool/intent-map/predicate), T-05 (unsellable gate), T-09-guard (COMMS-0018, comment-stripped), grant/security.
- `supabase/functions/ticket-checkout-create/__tests__/orch1065_experience_checkout.test.ts` — T-08a..c (no experience special-case, no allowlist-reject, no parallel money fn).
- `app-mobile/src/services/__tests__/deckService.orch1065.test.ts` — T-02a..e (converter exists, routes first, discriminator+brand, honest defaults).
- `app-mobile/src/components/__tests__/orch1065_experience_expand.test.tsx` — T-03a..d + T-07 + T-12 (mapper, 3-way switch, expand routing, close, badge/CTA gating + tokens).

### Booking layer — UNCHANGED (reuse only)
`ExpandedBusinessEventSheet.tsx`, `nativeCheckoutFlow.ts`, `ticket-checkout-create/index.ts` — zero edits. Confirmed `ticket-checkout-create` only special-cases `event_type==='trip'`; `'experience'` falls through to the default event path (SPEC §3.6 / D8).

---

## 3. SPEC TRACEABILITY (success criteria)

| SC | Status | Evidence |
|---|---|---|
| SC-1 eligible experience surfaces | IMPLEMENTED | RPC predicate + `fetchEligibleExperiences` + interleave; T-01. Live runtime UNVERIFIED (needs seed+deploy). |
| SC-2 (iOS+Android) card render + badge + Book | IMPLEMENTED, runtime UNVERIFIED | Renderer switch + BrandChip + Book CTA; tester live-fire owns the on-device proof. |
| SC-3 draft never returned | IMPLEMENTED | eligibility predicate (visibility/status/published_at); read-only remote probe returned 0 (no live experiences yet). |
| SC-4 past-dated never returned | IMPLEMENTED | `ed.end_at > p_now`; T-01e. |
| SC-5 unsellable never returned | IMPLEMENTED | `EXISTS(ticket_types available_online=true)`; T-05 fails-on-revert. |
| SC-6 geo exclusion | IMPLEMENTED | haversine ≤ p_radius_m stop EXISTS. |
| SC-7 expand → business-event sheet | IMPLEMENTED | businessEvent target branch; T-07 fails-on-revert. |
| SC-8 experience checks out via ticket-checkout-create | IMPLEMENTED | T-08; no fn change; no allowlist rejection. |
| SC-9 (iOS+Android) E2E PaymentSheet | runtime UNVERIFIED | tester live-fire. |
| SC-10 COMMS-0018 bypass grep-clean | IMPLEMENTED | T-09 fails-on-revert (comment-stripped code). |
| SC-11 source-failure tolerance | IMPLEMENTED | best-effort try/catch → warn, never pool-empty/pipeline-error (INV-042). |
| SC-12 C7 allowlist same commit | IMPLEMENTED | gate green at `6b2c97f45`. |
| SC-13 curated byte-unaffected | IMPLEMENTED | both new elements gated on props; T-12. |
| SC-14 collab unaffected | IMPLEMENTED | `handleDeterministicV2` byte-untouched. |

---

## 4. REGRESSION TESTS

All run with `deno test --allow-read --no-check` (4 files, **21 passed / 0 failed**).

**Fails-on-revert proofs (captured at fixed commit `6b2c97f45`):**
- **T-01b** (interleave): reverting the populated return to `cards: finalCards` → `1 failed`; restored → `8 passed`.
- **T-07** (expand routing): reverting the `businessEvent` target to `nightOut` → `1 failed`; restored → `5 passed`.
- **T-08c** (no parallel money fn): adding `supabase/functions/experience-checkout-create/` → `1 failed`; restored → `3 passed`.
- **T-09-guard** (COMMS-0018): injecting `args.supabaseAdmin.from("place_pool")` into the supply code → `1 failed`; restored → `8 passed`.

The tester writes the adversarial set (T-04 past-date, T-06 geo, T-10 source-failure, T-11 empty-pool, T-13 curated-unaffected) on top of these.

---

## 5. INVARIANT VERIFICATION

| Invariant | Preserved? | How |
|---|---|---|
| INV-043 every-path-explicit-return | Y | experiences-only path is an explicit `path:'pipeline'` return. |
| INV-042 runtime-failure ≠ data-absence | Y | experience-source error swallowed (best-effort), never converted to pool-empty/pipeline-error. |
| I-1 one sellable ticket | Y | eligibility requires `available_online` ticket; booking reads that tier. |
| COMMS-0014/0016 no parallel money fn | Y | reuse `ticket-checkout-create`; T-08. |
| COMMS-0018 bypass | Y | grep-clean of place_pool/signal-scorer; T-09. |
| Constitution #9 no fabrication | Y | rating/reviewCount=0, logo null → monogram, honest-null distance. |
| i-discover-excludes-ended-master-date (semantics) | Y | `ed.end_at > p_now`. |
| collab path untouched | Y | `handleDeterministicV2` byte-identical. |

**New DRAFT invariants (→ ACTIVE on CLOSE):** I-PROPOSED-EXPERIENCE-DECK-CARD-TYPE (T-07/T-08), I-PROPOSED-EXPERIENCE-DECK-SUPPLY-BYPASSES-PLACEPOOL (T-09).

---

## 6. CROSS-SURFACE IMPACT

| Surface | Affected | Parity |
|---|---|---|
| Consumer iOS | YES — deck card + badge + Book + checkout | shared RN; auto |
| Consumer Android | YES — same shared RN code | auto code-path; visual MANUAL-verify (GlassBadge opaque fallback handled in BrandChip) |
| Buyer-anon Web / Business iOS/Android / Admin / Business-web | NO | no consumer deck on those surfaces |

Shared RN means parity is automatic at the code layer; the Android brand-badge opaque fallback + Book render still need the tester's Android live-fire (SC-2-Android / SC-9-Android).

---

## 7. DEVIATIONS FROM SPEC (2, both forced by stale base assumptions — documented, not silent)

1. **Migration filename `20260903000000` (SPEC §3.2 locked `20260901000000`).** On this worktree's actual base, `20260901000000` is already taken by ORCH-1064 (`orch_1064_venue_claim_feedback`, on main) and the remote/main migration head is `20260902000000_meta_orch_1059_sub_e_update_live_experience` — both landed AFTER the SPEC was written. The SPEC's name would both collide and be out of order. Per the monotonic-migration parity rule, the new migration is `20260903000000` (strictly greater than the max prefix; verified via `mcp__supabase__list_migrations` remote head + ls of sibling worktrees → no `20260903*` collision). Contents otherwise match §3.2 exactly.

2. **Geo mechanism = haversine SQL (SPEC §3.1.1 preferred `earthdistance`).** `mcp__supabase__list_extensions` shows `earthdistance` and `cube` are NOT installed (`installed_version: null`). The SPEC's D3 explicitly authorizes the plain-SQL haversine fallback when earthdistance is unavailable. Used the SAME `6371000.0 * 2.0 * ASIN(SQRT(...))` pattern already in `query_servable_places_by_signal` / the collab deck RPC / baseline. Predicate MEANING (≥1 stop within p_radius_m metres) is unchanged.

No scope expansion; no other deviations.

---

## 8. DEPLOY HANDOFF (orchestrator-owned — implementor does NOT apply/deploy)

**Migration apply (Seth / orchestrator):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1065-[consumer-experience-deck-card]" && /Users/sethogieva/bin/supabase db push --linked
```
Standard `--linked` (no `--include-all`): the migration is monotonic (highest prefix), and remote head is `20260902000000` with no remote-only-not-local versions. Migration is additive (CREATE FUNCTION + GRANT + CREATE INDEX IF NOT EXISTS) — no pre-flight RAISE/backfill guards, so no data-shape abort risk (read-only predicate probe confirmed it runs cleanly against live data and returns 0 rows today).

**Edge fn deploy (orchestrator, AFTER migration applied + PR merged to main per COMMS-0015):**
```bash
supabase functions deploy discover-cards --project-ref gqnoajqerqhnvulmnyvv
```
Only `discover-cards` changed. Verify-first-call: a curl to the deployed URL should return non-404 (it requires JWT, so expect 401 `auth-required`, not 404).

**Deno gate (run by this implementor — green):** `deno check supabase/functions/discover-cards/index.ts` clean; the 4 ORCH-1065 test files pass under `deno test --allow-read`.

---

## 9. DISCOVERIES FOR ORCHESTRATOR

- **No live published experiences exist in prod data yet** (read-only probe: 0 eligible). The tester MUST seed a published-live experience (business-app authoring or direct insert mirroring `biz_publish_experience` output: one `available_online` ticket + master `event_dates` + ≥1 stop with lat/lng + `experience_intents`) before the deck card can be observed live. This is a TEST setup step (SPEC A1), not a code gap.
- **`business_public_events_view` exposes `display_price_cents` but no `display_currency`** — the RPC reads `events.currency` directly for the currency (display price falls back to the raw ticket price when the view row is absent). No issue; noted for the currency-de-GBP lineage (ORCH-1034).
- Pre-existing `tsc --noEmit` noise in unrelated files (BoardDiscussion, ConnectionsPage, packages/brand-rendering, jest-typed test files) is a project baseline — none of the three ORCH-1065-touched app-mobile files report any tsc error.
