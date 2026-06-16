# TEST — ORCH-1138 Leg 3 EXPERIENCE PARITY REWORK (pre-merge gatekeeper)

**Verdict: FAIL** — P0×1, P1×1, P2×3, P3×1, P4×2.
**Mode:** SPEC-COMPLIANCE + TARGETED + SECURITY (anon column-privilege). Pre-merge, production-gating.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[experience-page]/` · branch `ORCH-1138-experience-page` · HEAD `1e565cedd` (5 ahead / **1 behind** origin/main → rebase required before merge).
**Comms:** scanned `COMMS_LEDGER.md` — no OPEN `BLOCK` row addressed to tester/ORCH-1138/ALL. Factored WARN/ALL: COMMS-0030 (business iOS build broken team-wide), COMMS-0035 (native-module drift), COMMS-0027 (OTA cache poison), COMMS-0014/0018 (experience checkout/deck supply). No new cross-ORCH discovery requiring a ledger write (the P0 is intra-ORCH).

---

## 1. Headline

The materializer + scheduling half of this rework is REAL and proven on live prod (52 bookable dates for the open-daily fixture, both publish RPCs call the expander). The consumer app-mobile code is well-built and honest (all sections real-data-gated, no fabrication, I-MOR-0827 clean). **But the WEB / business `/exp/` public page is BROKEN for every anonymous buyer the moment this merges** — a P0 launch-blocker the prior "done" report missed because it was never rendered against a logged-out session.

**P0 (BLOCKS MERGE):** `publicExperienceService.fetchPublicExperienceBySlug` added `theme_color, theme_font, theme_animation` to a raw `supabase.from("brands").select(...)`. The `anon` Postgres role has **no column-level SELECT** on those three columns → the request returns `42501 permission denied for table brands` (HTTP 401) → the entire anon-tolerant `/exp/{brandSlug}/{experienceSlug}` page renders **"Couldn't load experience"**. Proven live, twice, with the production anon key. The page works on prod TODAY only because prod still runs the OLD service (which never selected theme columns). This violates the SPEC's own COMMS-0009 contract ("theme via `business_public_events_view`, never client `.from('brands')`").

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1 | materializer applied; open-daily fixture ~52 event_dates | **PASS (live)** | prod SQL: `pg_expand_experience_recurrence` + `_pg_weekday_to_dow` exist; QA fixture `44444444-…138` = **52 event_dates, all future**, 4 stops, intents `[adventurous,first-date]`, USD. |
| SC-2 | publish + live-edit RPCs call expander | **PASS (live)** | `pg_get_functiondef` LIKE `%pg_expand_experience_recurrence%` = **true** for BOTH `biz_publish_experience` and `biz_update_live_experience`; `schema_migrations` has `20261005000000`. |
| SC-3-Consumer | vibe chips ≥2 | **PASS (code+data)** / defer-live | Screen L664-882 maps `seed.experienceIntents`→labels, sparkle icon, gated `>0`. Live deck RPC already returns `experience_intents[]`. Renders-all-sections test 12/12. |
| SC-4-Consumer | count-aware per-stop galleries | **PASS (code+data)** | `stopGalleryItems` L194-212 + `<CountAwareGallery>` L1050-1059 (NOT single Image). Fixture stops carry 3/2/4/2 images. |
| SC-5-Consumer | "Where you'll start" map | **PASS (code+data)** | `startStop` first-with-coords L689-700, `buildStaticMapUrl`, title exact "Where you'll start" L1075, gated. |
| SC-6-Consumer | meta row City+dates+seats+start-time | **PASS (code)** / city/seats defer | Independently gated chips L811-860. City + per-stop start_time on the consumer seed require the **un-applied** `20261007000000` deck-supply widening to be live. |
| SC-7-Consumer | START HERE/THEN/END WITH + time pill | **PASS (code)** | L1002-1031 uses `stop.stopLabel` (not "Stop N"); time pill gated on `startTime`. |
| SC-8-Consumer | every section themed, no `#FF6B35` content | **PASS (code)** | `ACCENT` used ONLY as spinner tint (L637, SPEC-permitted); `seedTheme` synchronous fallback L316-327. Live theme defers to `20261007000000`. |
| SC-9-Consumer | sold-out / ended banner | **PASS (code)** | `resolveOfferingCta` unavailable→banner L885-904 (one-owner). |
| SC-10-Consumer | open-daily Reserve date→time→party→cart | **PASS (code)** / runtime defers | `beginBooking` L407-438 branches to `ExperienceReservePicker` (open-daily) / `ExperienceOccurrencePicker` (slots) / auto / no-date. Party→quantity threaded. Live deck path returns 12 occurrences for the fixture. |
| SC-11 | checkout byte-identical (eventDateId+quantity only) | **PASS** | strict-grep gate `orch-1138-experience-checkout-byte-identical.mjs` PASS; fails-on-revert verified by implementor; web route `goToCart` L325-342 pushes only `{eventDateId, quantity}`. |
| SC-12-Web | eyebrow/labels/map-title/seats+start chips/City-once | **FAIL** | The 6 fixes ARE in `ExperiencePreview.tsx` FOUNDATION (N-stop L322/399/581; `labelForIndex` START/THEN/END L642; "Where you'll start" L498; seats L326-338; start-time L342-356; City as one meta chip L418). **BUT the page never renders for anon (P0-1) → the fixes are unreachable on the shipping surface.** Code-correct, runtime-broken. |
| SC-13 | no LEGACY/EBES regression | **PASS** | `orch-1138-ebes-deleted.mjs` PASS; LEGACY branch byte-stable (still "STOP N" L742, unchanged); deck/venue open `ConsumerExperienceDetailScreen`. |
| SC-14 | mockup match (visual, both surfaces) | **FAIL (web) / DEFER (consumer)** | Web: render blocked by P0-1 (screenshots show "Couldn't load experience"). Consumer themed screenshot defers to `20261007000000` + edge deploy (post-merge) + OAuth/onboarding nav — not pre-merge automatable. |
| SC-15 | no GBP | **PASS** | Fixture USD; supply-migration structural test asserts no GBP; deck-supply test 15/15. |

---

## 3. Findings

### P0-1 — Anon buyer cannot load the public experience page (theme columns not anon-readable)
- **Evidence (live, reproducible):**
  - `mingla-business/src/services/publicExperienceService.ts:477` selects `id, slug, name, description, cover_media_url, cover_media_type, cover_hue, theme_color, theme_font, theme_animation` from `.from("brands")`.
  - Live anon REST (prod anon key), per-column probe:
    `200` cover_hue/cover_media_type/cover_media_url/description/id/slug/name · **`401` theme_color · `401` theme_font · `401` theme_animation** (`42501 permission denied for table brands`).
  - Full rework select → **HTTP 401**; same select minus the 3 theme columns → **HTTP 200**.
  - Headless render of the export against live prod data → body text **"Couldn't load experience / permission denied for table brands"** (screenshots `Mingla_Artifacts/evidence/ORCH-1138-exp/rework_exp_{desktop,mobile}.png`).
  - Live prod `/exp/` (OLD deployed service) renders fine (`prod_exp_qa_desktop.png`) — proving the break is introduced by the rework's added columns, not pre-existing.
- **Impact:** EVERY logged-out buyer hitting `/exp/{brandSlug}/{experienceSlug}` (web + business iOS/Android, shared service) sees a dead error page instead of the experience. This is the exact surface Seth touches and the anon-buyer funnel (cf. ORCH-1115). Total functional loss of the public experience page on merge.
- **Required fix:** source the brand theme from the anon-safe `business_public_events_view` (it exposes `brand_theme_color` / `brand_theme_font` / `brand_theme_animation`, anon-readable — verified `200` live, returns `#7c3aed`/`playfair_display` for the fixture), exactly as the SPEC's COMMS-0009 invariant and OQ-3 demanded. Do NOT add the theme columns to the `.from("brands")` select. (Alternatively, and only if Seth approves a schema change: grant anon column SELECT on the 3 theme columns — but the view path matches the existing contract and needs no migration.)
- **Retest:** the tester adversarial gate below FAILs now and PASSes once the columns leave the brands select; plus re-render the page anon → page loads + 6 fixes visible.

### P1-1 — Stale pre-existing test will go red on merge: `app/exp/__tests__/public-experience-page.test.ts` A-EXP-4
- **Evidence:** test asserts `publicRouteSource` matches `/<ExperienceCheckoutFlow/`; the rework deliberately replaced the in-page `<ExperienceCheckoutFlow>` mount with route-based checkout (`router.push(experienceCheckoutPath(...))`, `[experienceSlug].tsx:334`). 7/8 pass; A-EXP-4 fails. This test is on origin/main (NOT in the branch diff) → it turns red the moment the branch merges.
- **Impact:** CI red on main post-merge; not a functional defect (the route DOES wire checkout correctly — verified L325-364, byte-identical eventDateId+quantity).
- **Required fix:** update A-EXP-4 (with a `[TEST-MOD-APPROVED ORCH-1138]` token) to assert the new route-based checkout (`experienceCheckoutPath` / `goToCart`) instead of the deleted `<ExperienceCheckoutFlow>` mount.
- **Retest:** `npx jest app/exp/__tests__/public-experience-page.test.ts` → 8/8.

### P2-1 — `BaseBottomSheet.test.mjs` fails (pre-existing L103, but branch modified this file)
- **Evidence:** L103 assertion "T-C primitive must NOT pass `animationConfigs`" fails because `BaseBottomSheet.tsx:717` passes `animationConfigs={sheetAnimationConfigs}`. **This failure is PRE-EXISTING on origin/main** (main's source already has L717; main's test already asserts the negative) — NOT introduced by ORCH-1138. However, the branch DID modify this test (+20/-16, repointing deleted-EBES references to `ConsumerEventDetailScreen`, carrying `[TEST-MOD-APPROVED ORCH-1138]` tokens) — a legitimate repoint (the old refs would ENOENT on the deleted file).
- **Impact:** the test stays red after merge (it was red before too). The branch's repoint is correct; the L103 contradiction belongs to a different ORCH's scope (META-ORCH-0991 Wave A vs the current source).
- **Required fix (not this ORCH):** flag to orchestrator — either restore stock gorhom motion in `BaseBottomSheet.tsx` or update the L103 assertion. ORCH-1138 should NOT widen scope into it; just don't claim this gate green.

### P2-2 — Open-daily detection is a fragile heuristic that can misroute discrete multi-date experiences
- **Evidence:** `ConsumerExperienceDetailScreen.tsx` L117-129 `isOpenDailyModel` = `>1 occurrence && every window ≥90 min`. A legitimately discrete multi-date experience (e.g. 3 fixed-start 3-hour evenings) satisfies this and wrongly opens the open-daily date→time-within-window picker, offering a fabricated 30-min-step time grid for a fixed-start event.
- **Impact:** UX-honesty bug (offers arbitrary times for a fixed-start experience). NO money/data-integrity impact (checkout stays eventDateId+quantity). Low blast radius today (few multi-date experiences). Acknowledged by the implementor §10 + SPEC OQ-2.
- **Required fix (recommend, can defer with Seth's nod):** carry the authored `when_mode`/recurrence flag to the client and branch on it, rather than inferring open-daily from window length.
- **Retest:** seed a discrete multi-date experience with ≥90-min windows; confirm Reserve opens the slot list, not the open-daily picker.

### P2-3 — Venue→detail path has no synchronous theme fallback (parity gap vs deck path)
- **Evidence:** `venueExperienceMapping.ts:170` sets `brandTheme: null` (documented: `events.theme` ≠ `resolveTheme` shape). SPEC §4.C.4 listed `brandTheme: row.theme` for this mapper.
- **Impact:** the venue ("experiences here") path can flash the default palette before `useEventTheme` settles; the deck path gets the synchronous fallback, the venue path does not. Cosmetic, not data loss.
- **Required fix:** either map the venue row's theme into the `resolveTheme` shape, or accept the brief flash (Seth's call).

### P3-1 — Implementor fails-on-revert for `orch_1138_consumer_experience_supply.test.ts` not independently reproduced
- **Evidence:** I forced `experienceIntents: []` in the venue mapper and the test still passed 2/2 — I could not reproduce the implementor's claimed fails-on-revert with a quick mutation (their claim was deleting the whole §4.C.4 block). The test reads other fields; my single-field mutation didn't trip it.
- **Impact:** the regression gate may be weaker than the report claims (it may not catch every narrowing). The renders-all-sections + foundation tests still pass (16 assertions) and the supply test passes on real fixture input — so coverage exists, just not proven minimal-revert-sensitive on the intents field.
- **Required fix:** implementor demonstrates the exact line-deletion that flips this test, or strengthens it to assert per-field non-emptiness.

### P4-1 (praise) — Honest rule-9 gating throughout the consumer screen
Every absent-data path hides cleanly (vibe chips, galleries, map, meta chips, banner, time pills, stop labels); `buildStaticMapUrl` returns null rather than a placeholder tile. Zero fabricated data found. Good work.

### P4-2 (praise) — Materializer is genuinely real
The central failure of the prior pass (scheduling was a UI shell over absent data) is closed and proven on live prod (52 dates). The DB half of this rework is solid.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- Checked out HEAD `1e565cedd` in the worktree.
- Re-ran `app-mobile/src/utils/__tests__/orch_1138_consumer_experience_supply.test.ts` via `deno test --no-check --sloppy-imports` → **2 passed / 0 failed** (matches report).
- Attempted revert (forced `experienceIntents: []` in `venueExperienceMapping.ts`) → test **still 2/2 passed** → could NOT independently reproduce the claimed fails-on-revert with that mutation (see P3-1). The implementor's claim (delete the whole §4.C.4 block → 1 fail) was not re-verified; recorded as a gate-strength concern, not the blocker.
- `orch-1138-experience-checkout-byte-identical.mjs` re-run → **PASS**; this gate's fails-on-revert is structurally sound (injecting a tax/address field would trip it).

## 5. Adversarial test added (different angle — anon column privilege)

- **Path:** `mingla-business/src/services/__tests__/orch_1138_tester_anon_brand_theme_columns.test.ts` (NEW, append-only).
- **Angle:** the implementor's tests cover render-sections + seed-carriage; NONE check the WEB service's anon column-privilege. This gate asserts no `.from("brands").select(...)` requests `theme_color`/`theme_font`/`theme_animation` (the columns anon cannot read).
- **fails-on-revert verified at `1e565cedd`:** against current code → **3 failed / 1 passed** (P0 present); after simulating the fix (strip the 3 cols from the brands select) → **4 passed**. Restored service after.
- This gate WOULD HAVE CAUGHT P0-1.
- **In closing diff:** must appear in `git diff origin/main...HEAD --name-only`. (Both the implementor's happy-path tests and this adversarial test are on-branch.)

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | **FAIL** | P0-1: the entire anon `/exp/` page is a dead page (error state) — the Reserve tap is unreachable for logged-out buyers. |
| 2 | One owner per truth | PASS | `resolveOfferingCta` single CTA owner; `fetchTierAllInCents` money owner unchanged. |
| 3 | No silent failures | PASS | The 401 surfaces a visible "Couldn't load experience" (loud, not silent) — but it should not happen at all (P0-1). |
| 4 | One query key per entity | PASS | No new ad-hoc keys in the diff. |
| 5 | Server state stays server-side | PASS | No Zustand server-state introduced. |
| 6 | Logout clears everything | N/A | No auth-state change. |
| 7 | Label `[TRANSITIONAL]` + exit | N/A | No transitional code. |
| 8 | Subtract before adding | PASS | EBES deleted; LEGACY untouched; mapper widened not duplicated. |
| 9 | No fabricated data | PASS | Audited — every absent path hides; no faked ratings/prices/times. |
| 10 | Currency-aware | PASS | Fixture USD; no GBP; all-in price path unchanged. |
| 11 | One auth instance | PASS | Public route stays anon (no useAuth). |
| 12 | Validate at right time | PASS | Open-daily time-within-window is presentation-only; checkout validates server-side. |
| 13 | Exclusion consistency | N/A | — |
| 14 | Persisted-state startup | N/A | — |

Rule 1 FAIL is the P0.

## 7. Device / parity matrix

| Surface | Verdict | Evidence |
|---|---|---|
| Buyer/anon Web `/exp/` | **FAIL** | P0-1 — anon 401, page does not load. Headless-render proven (evidence dir). |
| Business iOS `/exp/` | **FAIL (shared service)** | Same `publicExperienceService` → same anon-brand-theme 401. (Not separately sim-driven; the failing layer is the shared service, proven on web.) |
| Business Android `/exp/` | **FAIL (shared service)** | Same as above. |
| Consumer iOS (app-mobile) | **DEFER (probable)** | Code audited PASS; renders-all-sections tests PASS; full live render needs `20261007000000` + edge deploy (post-merge) + OAuth/onboarding/geo nav — not pre-merge automatable. The implementor's sim build/boot recipe (fresh dev client from a `/tmp` bracket-free rsync) is plausible; not re-driven here. |
| Consumer Android | **DEFER** | Shared RN; same as iOS + Android opaque-glass (code shows Platform.select fallbacks on new picker/chips). |
| Admin Web | N/A | No experience buyer page. |
| Business Web preview (wizard Step-5 LEGACY) | PASS | Byte-stable; LEGACY branch unchanged. |

**Physical iPhone (HITL):** NOT performed — blocked at the P0 (web/business surface is broken pre-merge; no point HITL-validating a surface that 401s, and the consumer live data needs the post-merge migration+edge deploy). Re-run after P0 fix + post-merge deploy.

**Edge live-deploy state:** `discover-cards` live = version **345, verify_jwt=true**; the branch's new fields (full intents array, brandTheme, city, per-stop startTime) are NOT deployed (deploy from merged main at CLOSE). NOTE: implementor report §5 says "verify_jwt to preserve: false" but live is `true` — confirm intended config at deploy (P3-level deploy-config check for the orchestrator).

**Migrations:** `20261005000000` APPLIED + recorded (verified). `20261007000000` (supply widening) NOT applied/recorded (verified absent) — consumer themed/intents-array/city/per-stop-start_time fields defer to its apply. `brand_theme` source in `20261007000000` reads `business_public_events_view.brand_theme_*` via SECURITY DEFINER → anon-safe and correct (those view columns exist + are anon-readable, verified live). Branch is **1 commit behind origin/main** → rebase required at CLOSE.

## 8. Discoveries for Orchestrator

1. **P0-1 root pattern:** `publicExperienceService` reads `.from("brands")` directly (pre-existing) and the rework added non-anon-readable columns to it. Worth a standing strict-grep gate: NO public/anon service may select `brands.theme_*` directly (theme must come from `business_public_events_view`). My adversarial test is a starting point; consider promoting it to a CI gate.
2. **`anon` table grants on `brands` are column-scoped** — anon has SELECT on most columns but NOT `theme_color/theme_font/theme_animation`. Any future anon brand read must respect this. (Also: anon has table-level INSERT/UPDATE/DELETE grants on `brands` with RLS as the only guard — worth a separate security review, out of scope here.)
3. `business_public_events_view` exposes theme as `brand_theme_color/brand_theme_font/brand_theme_animation` (NOT `theme_color`) — the canonical anon-safe theme column names.
4. `discover-cards` live `verify_jwt=true` vs report's "false" — reconcile at deploy.
5. Pre-existing `BaseBottomSheet.test.mjs` L103 failure (animationConfigs) is a separate-ORCH debt, surfaced here.

## 9. Routing

**FAIL → REWORK (mingla-implementor).** Primary blocker P0-1 cited above (file:line + live evidence). Also fix P1-1 (stale A-EXP-4 with approval token). P2/P3 per Seth's call. After REWORK, re-render the anon `/exp/` page (must load + show the 6 fixes) and re-run the tester adversarial gate (must pass). Consumer live-data verification (SC-3/6/8 themed, open-daily Reserve runtime) remains a **post-merge-deploy** step once `20261007000000` + `discover-cards` ship from merged main.

**This run did NOT merge, deploy, or close anything.**
