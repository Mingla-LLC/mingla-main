# CHARTER — META-ORCH-1186: Venue Creation → Management Unification

**Renumbered from the mis-registered ORCH-1184** (collided with the shipped "venue command-center desktop" ORCH-1184 #580; renumber per shipped-first-keeps-number).
**Date:** 2026-06-21 · **Driver:** Seth · **Conductor:** mingla-orchestrator
**Worktree:** `~/Desktop/mingla-orchs/1186-[venue-unify]` · **Branch:** `1186-venue-unify` (at origin/main `89ab7f3ff`)
**Story APPROVED by Seth 2026-06-21.** Drive all legs to creation autonomously; return for testing.

> NOTE: current origin/main already contains the venue-suite **command-center desktop redesign** (ORCH-1184 #580 — bare rail + full-width workspace). All SPEC/DESIGN/IMPLEMENT must re-verify against THIS code, not the pre-redesign tree.

---

## Locked decisions (Seth, 2026-06-21)
- **DEC-A:** 4 legs, sequence **Leg 1 → Leg 2 → Leg 4 → Leg 3**.
- **DEC-B:** Hours single owner = **creation hours (`brand_hours`) canonical**; reservation `venue_availability_config.service_periods` SEED/DERIVE from it — never a competing copy.
- **DEC-C:** Menu = **display-only menu with prices first** (builder + public menu); pay-for-food ordering cart is a deferred fast-follow, NOT in 1186.
- **DEC-D:** **Blasts already exist** — Leg 4 only SURFACES the existing marketing composer in the venue tab (venue-scoped audience entry point). No new blast system. Coordinate UI with META-ORCH-1161, do not block on it.

## Affected surfaces
Business iOS + Business Android (`mingla-business` venue suite), Buyer/anon Web (public venue page reads hours/menu), Admin Web (approval). Consumer adjacent (reads public venue page). None excluded outright.

---

## ROBUST GOAL — the META is COMPLETE only when ALL of:
1. A venue's opening hours have **exactly one owner** (`brand_hours`); the management "Service periods" no longer renders blank for a venue that set hours at creation; editing hours in Settings updates the public page AND reservation availability from that single source.
2. The **Settings tab is the single editable home** for every field captured during creation/approval (hours, pitch, photos/gallery, vibes, AI signal scores w/ re-run, website, contact, category) — no read-only-summary dead-ends.
3. The venue **Overview surface is an intelligence dashboard** (slow hours, slow days, revenue/signal effectiveness) computed from real data; zero fabricated/empty tiles; BestTime + impression capture explicitly phased/labeled as later.
4. The venue tab has a **menu builder** (categories/items/descriptions/prices) and a **public menu with prices visible online** (display-only; ordering deferred).
5. The venue tab has a **blast entry point** opening the existing composer with a venue-scoped audience.
6. Every leg: constitution-compliant, root-caused, with implementor happy-path regression test (fails-on-revert proven) + tester adversarial test, all artifacts synced, green pre-merge gate.

---

## Per-leg charter

### Leg 1 — Hours unification + editable Settings (ORCH-1186-A) — FOUNDATION, FIRST
**Goal:** `brand_hours` is the canonical opening-hours owner; `venue_availability_config.service_periods` seeds from it (migration + live bridge on hours edit). Build real Settings editors for every creation field; retire read-only summaries.
**Done when:** (a) a venue created with hours shows those hours in management Availability service-periods (seeded), not blank; (b) editing hours in Settings persists to `brand_hours` and reflects on public page + reservation baseline; (c) every creation field is editable in Settings with save + optimistic/refetch correctness; (d) no second source of truth for hours remains; (e) regression tests prove the seed + the single-owner write path.
**Hard guards:** do NOT delete `venue_availability_config` (reservation-specific config still lives there — only `service_periods` derives from hours); preserve existing reservation/turn-time/blackout config; reuse creation step components (subtract-before-adding).

### Leg 2 — Overview → Intelligence (ORCH-1186-B)
**Goal:** repurpose the venue-suite overview module into an intelligence dashboard. Surface slow hours/slow days/revenue trend/signal effectiveness from existing data (`biz_event_orders` timestamps, per-tier sales, `place_pool.ai_signal_scores`).
**Done when:** overview renders real aggregations only; empty/insufficient-data states are honest ("not enough data yet"), never fabricated; BestTime/foot-traffic + impression/attribution are stubbed/labeled "coming" not faked; the listing-recap content that used to live here is fully relocated to Settings (Leg 1) with no loss.
**Hard guards:** no fabricated metrics (Constitution #9); currency-aware (#10); validate datetimes in venue timezone (#12).

### Leg 3 — Menu builder + public menu (ORCH-1186-C) — LARGEST, LAST
**Goal:** new `menus`/`menu_items` schema + RLS; a builder module in the venue tab (categories, items, name/description/price/currency, ordering, availability toggle); public menu render with prices on the public venue page. DISPLAY-ONLY (no cart/checkout).
**Done when:** a venue can build a multi-category menu with priced items, it persists, and it renders on the public venue page with correct currency formatting; edit-after-publish works; ordering/cart is explicitly OUT (deferred fast-follow, documented).
**Hard guards:** distinct from the snap-menu→experiences parser (do not entangle); currency from brand `default_currency`; no payment surface.

### Leg 4 — Blasts in venue tab (ORCH-1186-D) — CHEAP, REUSE
**Goal:** add a blast entry point to the venue suite that opens the EXISTING marketing composer pre-scoped to that venue's audience.
**Done when:** a venue owner taps a blast action in the venue tab and lands in the existing composer with the venue-scoped audience pre-selected; no new blast/dispatch code; UI aligned with META-ORCH-1161 channel direction.
**Hard guards:** reuse only; no duplicate composer; coordinate (not block) with META-ORCH-1161.

---

## Execution model (conductor)
- ONE worktree (`1186-venue-unify`) — all legs share venue-suite files (`VenueSuiteShell`, `venueModules.ts`, Settings) so implementation is SEQUENTIAL (Leg1→2→4→3) to avoid self-conflict.
- SPEC phase parallelized (4 independent forensics contracts). DESIGN parallelized for UI legs. IMPLEMENT sequential.
- REVIEW gate after every phase. STOP for testing at the end (Seth drives device QA).
- Anchor is commit-guarded; all commits on `1186-venue-unify`; one PR at the end (or per-leg PRs if size demands), pre-merge gate enforced.

## DRAFT invariants (flip ACTIVE on close)
- `I-PROPOSED-1186-HOURS-SINGLE-OWNER` — opening hours read/write only via `brand_hours`; `service_periods` is derived, never independently authored as "venue hours".
- `I-PROPOSED-1186-SETTINGS-EDITS-ALL-CREATION-FIELDS` — every creation-captured field has a Settings editor (no read-only dead-ends).
- `I-PROPOSED-1186-INTELLIGENCE-NO-FABRICATION` — overview intelligence renders only real aggregations; honest empty states.
- `I-PROPOSED-1186-MENU-DISPLAY-ONLY` — menu has no checkout/cart surface (ordering deferred).
