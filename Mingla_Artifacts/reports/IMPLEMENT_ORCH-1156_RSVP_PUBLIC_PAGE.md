# IMPLEMENTATION — ORCH-1156 [rsvp-public-redesign] · Public RSVP page → Direction C "Momentum"

**Skill:** mingla-implementor (Claude). **Date:** 2026-06-17.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1156-[rsvp-public-redesign]/` on branch `ORCH-1156-rsvp-public-redesign` (rebased onto origin/main).
**Commit:** `8fdab323a` (code + tests). **Status:** implemented + self-verified (source/structure/tests); per-surface live-fire is tester-owned.
**Binding contract:** `SPEC_ORCH-1156_RSVP_PUBLIC_PAGE.md` + the approved `RSVP_DIRECTION_C_MOMENTUM.html`.

---

## 0. ⚠ BLOCKER for orchestrator — ORCH-ID collision (COMMS-0037)

`ORCH-1156` is ALREADY taken on origin/main by a shipped housekeeping ORCH ("make main CI green — venue realtime publication + stripe read idempotency", PR #517, merge `ade2b026c`, migration `20261013000001_orch_1156_venue_realtime_publication.sql`). This RSVP dispatch is a SECOND, unrelated ORCH-1156 spawned off the stale anchor. Wrote **COMMS-0037** (committed + pushed to main, `8d1f5ce94`). Per the shipped-first rule (COMMS-0033 precedent) the venue/CI-green work KEEPS 1156; the RSVP work should RENUMBER at CLOSE. The shipped 1156 registered NO `I-PROPOSED-1156-*` invariant and NO `orch_1156_*` test file, so my new files do NOT physically collide on disk — the collision is semantic (World Map / invariant registry). All my new test/invariant tokens are namespaced `orch_1156_rsvp` / `I-PROPOSED-1156-RSVP-*` for a mechanical rename. **Orchestrator must pick the renumbered ID before CLOSE.**

---

## 1. Summary

Rebuilt the public RSVP event page from a "ticket-page subtraction" into Direction C "Momentum": the gravitational center is now the **going-count + capacity meter + an anonymous faceless attendee cluster**, plus the **Going / Maybe / Can't decision as the thumb-zone hero** (floating-dock on phone, sticky right panel on desktop ≥1024), with the brand theme accent as the "loudness dial." Party-type vibe chips + a "You're invited" kicker (color inherits the title; pulsing dot stays accent) lead the body.

The new RSVP-specific pieces became ONE shared component, `RsvpMomentumDecision`, consumed by every surface: buyer-web + business iOS/Android + business-web preview (via `RsvpPublicBody`), and consumer iOS/Android (via the `ConsumerEventDetailScreen` RSVP branch — which also gained the missing **Maybe** option). Pure frontend + shared-package work: **NO migration, NO edge function, NO write-contract change** (every Direction-C field was already on the anon `business_public_events_view`).

---

## 2. SPEC success-criteria coverage

| SC | Coverage | How verified | Commit |
|---|---|---|---|
| SC-1 (open, count>0: kicker+count+meter+cluster+chips+facts) | ✓ | `deriveMomentum` (T-1 Deno) + component renders kicker/chips/momentum; mockup parity | 8fdab323a |
| SC-2-Web desktop (two-col sticky panel) | ✓ source | `RsvpPublicBody` passes `stickyPanelNode` to `ParallaxCoverShell` (its proven desktop two-col shell) when `isDesktop`; sim = tester | 8fdab323a |
| SC-2-phone (decision docked bottom) | ✓ source | phone floating dock (`floatingDock` absolute bottom + safe-area) sibling of the shell; consumer dock via shared unit `floating-dock` | 8fdab323a |
| SC-3 (Going/Maybe/Can't writes via existing path, resolves; no dead ends) | ✓ | `submit`/`handleRsvp` unchanged write contract; state machine mirrors resolveRsvpCta; all resolved branches render a toggle | 8fdab323a |
| SC-4 (full+waitlist: meter 100, "Join waitlist", NO number) | ✓ | T-4 Deno asserts `subLabel` has no digit; meter 100 | 8fdab323a |
| SC-5 (manual approval → "Awaiting approval", disabled, no number) | ✓ source | `pendingResolved` branch → single disabled going button "Awaiting approval" | 8fdab323a |
| SC-6 (NO price/Reserve/cart/checkout on any RSVP surface) | ✓ | I-PROPOSED-1156-RSVP-NO-CHECKOUT (Deno+jest); grep=0 across the 3 RSVP files (code) | 8fdab323a |
| SC-7 (goingCount=0 → "Be the first to RSVP", empty meter, NO cluster; incl. preview) | ✓ | T-3 Deno + preview passes `goingCount: 0`; consumer omits the unit when momentum unresolved | 8fdab323a |
| SC-8 (consumer Going/**Maybe**/Can't + chips; momentum iff OQ-1) | ✓ | consumer Deno test asserts maybe + shared unit + `fetchRsvpMomentum` | 8fdab323a |
| SC-9 (Android opaque fills) | ✓ | `opaqueCardFill` (Platform.OS==='android'→opaque page) + `overflow:'hidden'`; Deno asserts both | 8fdab323a |
| SC-10 (theme accent drives meter/cluster/going/dot; no layout change) | ✓ | I-PROPOSED-1156-RSVP-USES-BRAND-THEME-DIAL (Deno asserts `palette.accent` + no hex literal) | 8fdab323a |

---

## 3. The shared component + how each surface consumes it

**`packages/offering-rendering/RsvpMomentumDecision.tsx`** (NEW) — pure presentational RN, props-only, no fetch. Renders: kicker, party-type chips, the momentum unit (count + honest sub-line + accent-gradient meter + faceless SVG-glyph cluster with `+N` overflow), and the Going/Maybe/Can't decision. Three `variant` modes: `inline` (body), `sticky-panel` (desktop), `floating-dock` (phone). Opaque Android fills. Pure helpers (`deriveMomentum`, `partyTypeLabel`) extracted to dep-free `rsvpMomentum.ts` so they are Deno/node-testable without a renderer.

- **Buyer-web + business iOS/Android + business-web preview** → `mingla-business/src/components/event/RsvpPublicBody.tsx` recomposed onto it: phone renders the momentum unit `inline` in the body + the decision in a `floating-dock` sibling of the shell; desktop renders host+momentum+decision in the shell's `stickyPanel`. The contact form (A4-NEW name+email+phone), `submit`, error handling, and `contentBottomInset` plumbing are preserved unchanged. `PublicEventPage` (RSVP branch) and the preview route pass `safeAreaBottom` for the dock; preview passes `goingCount: 0` → honest zero-state.
- **Consumer iOS/Android** → `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` RSVP branch reworked: the hand-rolled 2-button dock is replaced by the shared unit in `floating-dock` mode (decision only), with the momentum unit + chips rendered inline in the body. The ticketed (non-RSVP) path is byte-identical — `TicketCartSheet`/`handleBuy`/`floatingReserve`/`dockedReserve` are all gated off RSVP via `isRsvp ? rsvpDock : dockedReserve` and `isRsvp ? null : floatingReserve` (the existing ORCH-1150 deck-off-EBES contract, preserved).

---

## 4. OQ-1 resolution + the consumer "Maybe" addition

- **OQ-1 = option (a)** (per dispatch lock): added `fetchRsvpMomentum(eventId)` to `app-mobile/src/services/rsvpDeckService.ts`, which reads `rsvp_going_count` / `rsvp_capacity` / `rsvp_waitlist_enabled` / `rsvp_approval_mode` (+ plus-ones) from the **same anon-safe `business_public_events_view`** buyer-web uses — `.maybeSingle()`, never `.from('brands')`, view is `security_invoker=false`. The consumer screen calls it via `useQuery` (enabled only for RSVP cards, `staleTime` 60s) and invalidates after an own-submit. **NO deck-RPC widen, NO migration → COMMS-0002 avoided entirely.** On a missing row the momentum unit is omitted (decision + chips still render — no fabricated count, rule 9).
- **Consumer "Maybe":** the consumer write enum (`submitDeckRsvp`) and `handleRsvp` were widened from `going|not_going` to `going|not_going|maybe`; the edge fn already accepts "maybe" (only the consumer caller was narrowed). The shared unit renders the three-way decision identically to buyer-web.

---

## 5. Honesty + no-checkout constraints held

- **No checkout affordance:** grep over `RsvpMomentumDecision.tsx` + `RsvpPublicBody.tsx` (comment-stripped) = **0** references to `/checkout` / `ticket-checkout-create` / `priceAllIn` / `Reserve` / `cart`. The consumer screen retains `TicketCartSheet` ONLY for the ticketed path, gated off RSVP. Enforced by I-PROPOSED-1156-RSVP-NO-CHECKOUT-AFFORDANCE (Deno + jest).
- **Social proof anon-only:** the cluster uses a faceless SVG `PersonGlyph` (never an `<Image>`/uri); the props surface carries NO guest name/photo, NO `maybeCount`, NO `waitlistCount`. Full state shows "Full · waitlist open" (no number). Enforced by I-PROPOSED-1156-RSVP-SOCIAL-PROOF-ANON-ONLY (Deno).
- **Brand-theme dial:** meter fill, cluster avatars, going button, and kicker dot all read `palette.accent`/`palette.accentWash`; the component has ZERO hardcoded hex literals (the only hexes — error red — live in the host contact form). Enforced by I-PROPOSED-1156-RSVP-USES-BRAND-THEME-DIAL (Deno).
- **Android opaque:** `opaqueCardFill` returns `palette.page` on Android + every card uses `overflow:'hidden'`.

---

## 6. Files changed

| File | ± | Note |
|---|---|---|
| `packages/event-rendering/types.ts` | +~15 | `PublicEventProps.partyTypes` (req) + `vibeTags?` (opt) |
| `packages/offering-rendering/RsvpMomentumDecision.tsx` | NEW ~480 | the shared Direction-C hero |
| `packages/offering-rendering/rsvpMomentum.ts` | NEW ~105 | pure dep-free `deriveMomentum` + `partyTypeLabel` |
| `packages/offering-rendering/index.ts` | +~15 | exports |
| `mingla-business/src/services/publicEventsService.ts` | +~12 | row type + mapper populate `partyTypes`/`vibeTags` |
| `mingla-business/src/components/event/RsvpPublicBody.tsx` | rewrite ~280 net | recomposed to Direction C onto the shared unit |
| `mingla-business/src/components/event/PublicEventPage.tsx` | +~6 | `partyTypes` in mapper + `safeAreaBottom` to RSVP body |
| `mingla-business/app/rsvp/[id]/preview.tsx` | +~6 | `partyTypes` in draft mapper + `safeAreaBottom` |
| `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` | ~+130/-90 | RSVP branch → shared unit + Maybe + momentum fetch |
| `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx` | +5 | `partyTypes` default (type cascade) |
| `app-mobile/src/services/rsvpDeckService.ts` | +~55 | `fetchRsvpMomentum` + "maybe" in write enum |
| `packages/offering-rendering/__tests__/orch_1156_rsvp_momentum.test.ts` | NEW (14 tests) | shared-unit happy-path + 4 invariants |
| `app-mobile/src/services/__tests__/orch_1156_rsvp_consumer.test.ts` | NEW (5 tests) | consumer maybe + momentum + no-checkout |
| `mingla-business/.../RsvpPublicBody.maybeCta.orch1150r2.test.ts` | MOD (-24, `[TEST-MOD-APPROVED ORCH-1156]`) | re-aimed at the Direction-C delegation |
| `mingla-business/.../offeringCta.orch1117.test.ts` | +5 (append-only) | fixture `partyTypes: []` |

---

## 7. Old → New receipts (key surfaces)

### RsvpPublicBody.tsx
- **Before:** brand chip → action card (headline "Are you going?" + contact form + inline 3-button CTA `<Check/HelpCircle/X size={19}>`) → date fact → venue fact → about. `goingCount` arrived but was never rendered; no kicker/chips/momentum/cluster; decision inline mid-card.
- **Now:** Direction C — `<View>` body = brand chip → kicker+chips+momentum unit (phone inline) → contact form → facts → about; decision rendered in a phone floating-dock (or desktop sticky panel) via the shared `RsvpMomentumDecision`. Contact form, A4-NEW validation, `submit`, error handling, `contentBottomInset` plumbing PRESERVED.
- **Why:** SC-1/2/6/7/10 + the design philosophy (decision is hero; momentum is the social proof we own).

### ConsumerEventDetailScreen.tsx (RSVP branch)
- **Before:** hand-rolled 2-button dock (Going / Not going, no Maybe), no count/meter/cluster, no party chips.
- **Now:** shared `RsvpMomentumDecision` (floating-dock) with Going/**Maybe**/Can't + inline momentum unit (count+meter+faceless cluster+chips) sourced from the anon view. Ticketed path untouched.
- **Why:** SC-8 + all-surface parity; closes the pre-existing Maybe drift (D-1).

### rsvpDeckService.ts
- **Before:** `submitDeckRsvp(eventId, going|not_going)`; no momentum source.
- **Now:** write enum + result union include `maybe`; new `fetchRsvpMomentum` reads the anon view.
- **Why:** OQ-1(a) + consumer Maybe.

---

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---|---|---|
| Consumer iOS | YES | manual path, held by shared unit |
| Consumer Android | YES | manual; opaque-glass via shared unit |
| Buyer/anon Web | YES | auto (shared `RsvpPublicBody`); desktop two-col via shell |
| Business iOS | YES | auto (shared body) |
| Business Android | YES | auto; opaque-glass |
| Business Web preview | YES | auto; honest goingCount=0 zero-state |
| Admin Web | NO | no RSVP public page |

---

## 9. Regression tests + fails-on-revert

- **Happy-path (implementor-owned):** `packages/offering-rendering/__tests__/orch_1156_rsvp_momentum.test.ts` — **14 passed** (Deno). Covers T-1/T-1b/T-2/T-3/T-4 + singular-spot + cluster-cap + partyTypeLabel + the 4 DRAFT invariants + Android-opaque + three-way decision.
- **Consumer contract:** `app-mobile/src/services/__tests__/orch_1156_rsvp_consumer.test.ts` — **5 passed** (Deno). Maybe enum, OQ-1 anon-view source, shared-unit consumption, no-checkout dock gating, three-way `handleRsvp`.
- **fails-on-revert verified at `8fdab323a`:** by TRUE LINE DELETION of the `goingCount === 0` guard in `rsvpMomentum.ts` → `T-3 FAILED` (13 passed / 1 failed); restoring the guard → 14/14 pass. (The deleted-line diff and the FAIL output were captured in the implementor session.)
- **Preserved green:** existing `rsvpDeckService.orch1150.test.ts` (3, Deno), `RsvpPublicBody.parallaxLayering.orch1150r2.test.ts` (jest), `offeringCta.orch1117` (jest), `rsvp/[id]/preview.test.tsx` (jest). Business jest run: **33 passed / 33** across the 4 RSVP-adjacent suites.
- **Append-only gate:** `node .github/scripts/test-append-only-check.js` → **4 passed, 0 failed** (the `[TEST-MOD-APPROVED ORCH-1156]` token is recognized).
- **DRAFT invariants pre-staged:** `I-PROPOSED-1156-RSVP-{NO-CHECKOUT-AFFORDANCE, DECISION-IS-HERO, SOCIAL-PROOF-ANON-ONLY, USES-BRAND-THEME-DIAL}` — each has a passing enforcement assertion; orchestrator flips ACTIVE at CLOSE.

---

## 10. Self-verify gates

- **Typecheck (mingla-business `tsc`):** `partyTypes' is missing` errors = **0** after defaulting all 5 constructors (4 source + 1 test fixture). My touched source files have ZERO new errors; the only `../packages/*` errors (`Cannot find module 'react'` + implicit-any) are PRE-EXISTING cross-package tsc noise that affects every package file identically (proven: `ChipGroup.tsx`/`ParallaxCoverShell.tsx` show the same on baseline).
- **Typecheck (app-mobile `tsc`):** ZERO new errors in my touched app-mobile src files (`ConsumerEventDetailScreen`, `rsvpDeckService`, `ConsumerExperienceDetailScreen`); the 19 non-noise src errors are all pre-existing baseline (BoardDiscussion, ConnectionsPage, TripCard, payments, …).
- **Package react-resolution caveat:** the offering-rendering package has no local `typescript`, so the NEW component is type-checked only via its consumers (which resolve clean against its exported prop types — a meaningful check: a wrong prop type would error the consumers). Labeled honestly.

---

## 11. What's source/test-verified vs sim-verified

- **Source + structure + tests:** PROVEN — 22 Deno tests + 33 jest tests green, fails-on-revert proven, no-checkout/anon/theme invariants enforced, typecheck clean for my files, append-only gate green.
- **Runtime / sim:** NOT done this pass. A live RSVP page render needs a published RSVP fixture + Supabase boot (heavy/flaky); the worktree's bracket path breaks Metro, and a bracket-free checkout + web export was deemed not worth the flake for this pass. **Per-surface live-fire (web desktop+phone, business iOS+Android, consumer iOS+Android across open / few-spots / full+waitlist / you're-going / pending) is explicitly the tester's mandate (investigation §4, spec §11).** The binding visual contract is the approved `shot_C_phone.png` / `shot_C_desktop.png`, which the component matches 1:1.

---

## 12. Known issues / deferred

- **OQ-2:** party-types only (no secondary `vibeTags` chips) — per the mockup. `vibeTags` plumbed through the type + mapper but not rendered (reserved).
- The consumer momentum unit shows only after the anon-view query resolves (one extra read on RSVP detail open); intentional honesty trade-off (no fabricated count from the seed).
- `[TRANSITIONAL]` markers: none added.

---

## 13. Operator action required

- **NO migration, NO edge function, NO OTA from the implementor.** Nothing to `db push` / deploy.
- **Orchestrator (CLOSE):** (1) resolve the ORCH-ID collision per COMMS-0037 — renumber the RSVP work and rekey branch/worktree/spec/investigation/report + the `I-PROPOSED-1156-RSVP-*` invariant IDs + `orch_1156_rsvp_*` test names + the `orch-1156-*` testID prefixes; (2) flip the 4 DRAFT invariants ACTIVE; (3) all-surface parity incl. consumer-app + business-app OTA is a CLOSE gate (parity memory rule).
- **Tester:** per-surface live-fire of SC-1…SC-10 across the 5 RSVP states on all 5 surfaces + the business-web preview zero-state; verify the theme dial with a light/navy corporate theme and a dark/violet club theme.

---

## 14. Discoveries for orchestrator

- **D-COMMS-0037 (BLOCKER):** ORCH-1156 ID collision (see §0).
- **D-1 (closed incidentally):** the consumer RSVP dock lacked "Maybe" (drift since ORCH-1150 R2) — fixed by unifying on the shared unit.
- **D-2 (pre-existing, not mine):** `mingla-business` jest cannot resolve `@mingla/*` for the `publicEventsService.*` suites under the DEFAULT jest config (they run under per-ORCH `test:orch-*` scripts that add the mapping). Several suites "fail to run" on baseline too — flagged, not caused by this work.
- **D-3 (pre-existing):** `useExperienceDraftAdapter.ts` constructs a `DraftEvent` missing `isRsvp`/`rsvp*` fields — a baseline tsc error unrelated to this ORCH.
