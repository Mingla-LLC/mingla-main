# IMPLEMENTATION — ORCH-1342 [web-see-whos-going-funnel]

**META:** META-ORCH-1337 [social-proof-guest-list] · Leg 5 of 5 (final build leg)
**Phase:** IMPLEMENT (mingla-implementor, Claude side)
**Binding SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1342_WEB_FUNNEL.md` incl. ORCHESTRATOR AMENDMENT A-1
**Binding DESIGN:** `Mingla_Artifacts/specs/DESIGN_META-ORCH-1337_GUEST_SOCIAL_PROOF.md` §3 (+§1.5/§1.6/§4)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on `META-ORCH-1337-social-proof-guest-list`
**Base:** `bb40c4edb` → **implementation commit `1c43c9d63`** (31 files, +3271/−18)
**Date:** 2026-07-10
**Status label:** implemented, partially verified (all JS/unit/source/CI-mode criteria PASS; sim/browser runtime halves are the tester's T-9–T-12 per SPEC §11; `[NATIVE-GATED]` criteria capped per COMMS-0083)

---

## 1. Summary

A web visitor who taps "See who's going" on any of the four public pages (`/e/` RSVP, `/e/` standard, `/t/`, `/exp/`) now gets the DESIGN §3 install gate — a phone slide-up panel or a desktop QR dialog — instead of a dead affordance. The gate opens the platform-correct store client-side (page stays mounted), the QR encodes the smart-download page while the OneLink is dark, and the whole link seam is OneLink-ready: one flip of `GUEST_FUNNEL_ONELINK_URL` at Seth's AppsFlyer go-live makes CTA+QR emit the `go.usemingla.com/w36m` link whose payload lands an installing user back inside that event's guest-list sheet. App-side, the ORCH-1318 resolver gained the `deep_link_sub3='guest-list'` landing discriminator, the dispatcher rides it inside the path string (deferred replay untouched by construction), the seedless `/e/` route finally cold-renders the full event page from slugs (D6 — anon view read, no new backend), and all three consumer detail screens auto-open the ORCH-1341 sheet exactly once when `?landing=guest-list` arrives on a public, non-empty guest list. Folded in: the F-12 dead App Store URL on the post-checkout CTA is dead forever (store-links SSOT + CI drift gate).

## 2. SPEC success-criteria coverage

Label semantics per SPEC §5 (binding on the tester): `[NOW]` testable at this META's CLOSE; `[NATIVE-GATED]` capped until Seth's AppsFlyer go-live (fresh native builds + `APPSFLYER_S2S_TOKEN` — COMMS-0083; the `go.usemingla.com` domain verification is DONE per A-1/ORCH-1346).

| SC | Label | Status @ `1c43c9d63` | How verified by implementor |
|---|---|---|---|
| SC-1 phone gate on all 4 pages | [NOW] | ✓ implemented; source+unit verified; browser runtime = tester T-12 | Gate wiring source-asserts (jest 41/41); openExternal unit (window.open + assign fallback); web export builds green |
| SC-2 desktop QR dialog | [NOW] | ✓ implemented; source+unit verified; browser runtime = tester T-12 | QR value ≡ `resolveGuestFunnelTarget(...).qrUrl` (T-A7 assert); badges use SSOT; Esc/focus-trap code in place (runtime = tester) |
| SC-3 never names (D1) | [NOW] | ✓ | T-6 source-asserts: no identity token in the gate; only `avatarUrl` consumed; echo row a11y-hidden |
| SC-4 privateGuestList ⇒ unreachable gate | [NOW] | ✓ (package D2 gates pre-exist; web routes never read `?landing`) | T-A6 asserts buyer-web routes contain no `params.landing` read; runtime on the F-11 live event = tester |
| SC-5 F-12 store URL | [NOW] | ✓ | `orch_1342_download_cta_ssot` 6/6 + SSOT gate live PASS (stale literal extinct repo-wide, business-store grandfather documented) |
| SC-6 3 PostHog events | [NOW] | ✓ implemented (via `captureWeb` — see Deviations D-2); live-tail proof = tester | Source-asserts pin all 3 snake_case events + property shapes at the real interaction points |
| SC-7 resolver/dispatcher JS contract | [NOW] | ✓ PASS (runtime-grade: pure fn) | `oneLinkResolver.orch1342.test.ts` 14/14 (landing on exact token; byte-identical legacy; brand ignores sub3); T-02 pins `?landing=guest-list` at the ONE composition + `{url, ts, router:true}` shape + untouched replay |
| SC-8 D6 cold `/e/` renders | [NOW] | ✓ implemented; mapper unit-proven 8/8; sim runtime = tester T-9 | Seed service mapper exact-shape fixtures (rsvp/standard/trip-null); screen ladder source-asserts (loading sheet → full page / terminal cap) |
| SC-9 warm landing auto-open | [NOW] | ✓ implemented; contract source-pinned ×3 screens; sim runtime = tester T-10/T-11 | One-shot ref + settled-socialProof + `privateGuestList === false` + `goingCount > 0` + same-handler tokens pinned per screen (T-10..T-12) |
| SC-10 flip URL composition | [NATIVE-GATED] (composition unit-proven NOW) | ✓ composition PASS | T-4 live-mode: exact §4.2/A-1 URL on `go.usemingla.com/w36m`, `rsvp→event`, encoded slugs, CTA===QR (module-registry flip simulation); committed constant asserted null (dark) |
| SC-11 deferred install→sheet | [NATIVE-GATED] | seam complete; capped | Landing rides inside the persisted path (SC-7 chain); physical-device + AF dashboard = go-live QA |
| SC-12 warm universal link | [NATIVE-GATED] | seam complete; capped | applinks + `setOneLinkCustomDomains` pre-exist (1318); needs new native build |

## 3. Files changed (31 @ `1c43c9d63`, +3271/−18)

**mingla-business (product):**
1. `src/constants/storeLinks.ts` (NEW, 48) — SSOT + `GUEST_FUNNEL_ONELINK_URL: null` flip constant
2. `src/services/guestFunnelLink.ts` (NEW, 178) — ORCH-1319 trio verbatim + §4.2/A-1 builder + `openExternal`
3. `src/components/event/SeeWhosGoingGate.tsx` (NEW, 546) — DESIGN §3.1/§3.2 gate
4. `src/components/event/GateQr.web.tsx` (NEW, 57) — lazy `react-qr-code` (/download props parity)
5. `src/components/event/GateQr.tsx` (NEW, 23) — native null stub (platform split)
6. `src/components/checkout/DownloadMinglaCta.tsx` (F-12: 2 stale consts → SSOT import)
7. `src/components/event/PublicEventPage.tsx` (+~70: gate state/entity/handler, web-only prop on BOTH branch configs, lazy gate mount ×2 returns, analytics (a))
8. `src/components/event/FoundationEventPreview.tsx` (+1 passthrough prop → EventOfferingBody)
9. `src/components/trip/TripPreview.tsx` (+passthrough, outer + FoundationTripPreview → TripOfferingBody)
10. `src/components/experience/ExperiencePreview.tsx` (+passthrough → ExperienceOfferingBody)
11. `app/t/[brandSlug]/[tripSlug].tsx` + 12. `app/exp/[brandSlug]/[experienceSlug].tsx` (gate state + lazy mount + web-only handler + analytics (a))
13. `package.json` + 14. `package-lock.json` (`react-qr-code ^2.2.0` — +20 lockfile lines, scoped)

**app-mobile (product):**
15. `src/services/oneLinkResolver.ts` (§4.5: `landing?: 'guest-list'` on the non-brand entity variant; exact-token parse mirroring referralCode inclusion; header contract line)
16. `app/index.tsx` (`dispatchOneLinkDestination` ONLY: `?landing=guest-list` appended at the ONE composition point; replay/sink untouched)
17. `app/e/[brandSlug]/[eventSlug].tsx` (landing param + D6 header rewrite) · 18. `app/t/...` · 19. `app/exp/...` (landing param, exact-match validated)
20. `src/services/publicEventSeedService.ts` (NEW, 224) — pure mapper + lazy-supabase anon view read
21. `src/screens/Event/ConsumerEventDetailScreen.tsx` (§4.7 cold-seed query + derived seed + loading/terminal ladder; §4.8 effect; `landing` prop)
22. `src/screens/Trip/ConsumerTripDetailScreen.tsx` + 23. `src/screens/Experience/ConsumerExperienceDetailScreen.tsx` (`landing` prop + §4.8 effect)

**CI gates (NOT registered — see Deferred):**
24. `.github/scripts/strict-grep/orch-1342-store-links-ssot.mjs` (NEW; self-test 10/10)
25. `.github/scripts/strict-grep/orch-1342-landing-single-parse.mjs` (NEW; self-test 7/7)

**Tests (all NEW, 6 files):**
26. `app-mobile/src/services/__tests__/oneLinkResolver.orch1342.test.ts` (14)
27. `app-mobile/src/services/__tests__/publicEventSeedService.orch1342.test.ts` (8)
28. `app-mobile/src/screens/Event/__tests__/orch_1342_cold_seed_landing.test.ts` (11)
29. `mingla-business/src/services/__tests__/orch_1342_guest_funnel_link.test.ts` (16)
30. `mingla-business/src/components/event/__tests__/orch_1342_see_whos_going_gate.test.tsx` (19)
31. `mingla-business/src/components/checkout/__tests__/orch_1342_download_cta_ssot.test.ts` (6)

## 4. Data-model changes — NONE (client-only leg per SPEC §4.9; the D6 read uses the existing anon `business_public_events_view`, no migration/RPC/RLS).

## 5. Edge functions touched — NONE. Nothing to deploy.

## 6. Regression tests added + fails-on-revert

74 new assertions across 6 files (§3 items 26–31). Final green sweep at the commit content: **Deno 84/84** (my 3 suites + the untouched 1318 pair + 1341 pair), **jest 41/41** (my 3 business suites), both gates live-PASS + self-tests 10/10 and 7/7.

**fails-on-revert verified at `1c43c9d63`** — one TRUE LINE-DELETION per SPEC §9 family, each restored to green:

| Family | Deletion | Proof (verbatim outcome) |
|---|---|---|
| Resolver parse | the 2 sub3 lines in `oneLinkResolver.ts` | T-1 suite `error: Test failed` + gate: "no deep_link_sub3 parse — the landing discriminator must be parsed HERE and only here" |
| Dispatcher append | the 3 append lines in `index.tsx` | `T-02 ... FAILED — 10 passed, 1 failed` + gate: "dispatchOneLinkDestination no longer composes ?landing=guest-list" |
| F-12 SSOT | re-hardcoded both stale consts in `DownloadMinglaCta` | SSOT gate 2 failures ("hardcodes an apps.apple.com store literal — the F-12 class") + jest `2 failed, 4 passed` |
| QR drift | `<GateQr value="https://usemingla.com">` | `✕ the QR encodes resolveGuestFunnelTarget(...).qrUrl verbatim — 1 failed, 18 passed` |
| Auto-open privacy gate | `sp.privateGuestList === false &&` line in the event screen | `T-10 ... FAILED — 10 passed, 1 failed` |

## 7. Old → New receipts

### mingla-business/src/constants/storeLinks.ts (NEW)
**Before:** no store-links SSOT in mingla-business; components hardcoded store URLs (F-12 class). **Now:** APP_STORE/PLAY_STORE/DOWNLOAD_PAGE constants byte-matched to marketing by CI + the `GUEST_FUNNEL_ONELINK_URL: null` go-live flip constant. **Why:** SPEC §4.1; A-1 §2/§3. ~48 lines.

### mingla-business/src/components/checkout/DownloadMinglaCta.tsx
**Before:** local `APP_STORE_URL = "https://apps.apple.com/app/mingla"` — a DEAD listing link on the post-checkout confirm page. **Now:** imports the SSOT; behavior otherwise identical (universal-link fallback intact). **Why:** F-12/SC-5. ~7 lines.

### mingla-business/src/services/guestFunnelLink.ts (NEW)
**Before:** n/a. **Now:** the ONE smart target builder — verbatim ORCH-1319 detection trio; dark mode = platform store + /download QR; live mode = the exact A-1 OneLink grammar (`go.usemingla.com/w36m?deep_link_value={event|trip|experience}&deep_link_sub1&deep_link_sub2&deep_link_sub3=guest-list&pid=buyer_web&c=see_whos_going`, encoded, `rsvp→event`); `openExternal` = the ORCH-1328 byte-pattern. **Why:** SPEC §4.2. ~178 lines.

### mingla-business/src/components/event/SeeWhosGoingGate.tsx + GateQr pair (NEW)
**Before:** web tap on "See who's going" had nowhere to go (absent handler = inert cluster). **Now:** DESIGN §3 pixel contract — phone: scrim + slide-up (240ms bezier, reduced-motion fade), mini-cluster echo (avatars only), "Get the app" pill + "Not now"; desktop: 420px dialog, MINGLA kicker, solid-white 180px QR card (the ONE non-palette fill), "or" divider, SSOT badges, ✕/Esc/scrim dismiss + focus trap/return; `visible=false ⇒ null`; §4.4.3 (b)/(c) analytics. `react-qr-code` enters via `React.lazy` in the `.web.tsx` half only — natives get a null stub. **Why:** SPEC §4.3, DESIGN §3/§4. ~626 lines.

### Web wiring (PublicEventPage / 3 passthroughs / t+exp routes)
**Before:** 1339/1341 landed `socialProof` plumbing + the package `onSeeWhosGoing` seam; every WEB mount passed no handler. **Now:** each page host owns `gateVisible`, wires `onSeeWhosGoing` ONLY under `Platform.OS === 'web'` (fires event (a) then opens), and mounts ONE lazily-chunked gate (`{gateVisible ? <Suspense>...` — fetched on first open; ORCH-1083 budget stays green). Business-native mounts keep the inert cluster (DESIGN §1.5). **Why:** SPEC §4.4. ~150 lines total.

### app-mobile/src/services/oneLinkResolver.ts
**Before:** parsed `deep_link_value/sub1/sub2/af_sub1`; no landing concept. **Now:** the non-brand entity variant carries `landing?: 'guest-list'`, added ONLY on the exact lowercase token (conditional inclusion mirrors referralCode → pre-1342 payloads byte-identical; 1318 suite green UNMODIFIED). **Why:** SPEC §4.5; I-ONELINK-SINGLE-RESOLVER. ~25 lines.

### app-mobile/app/index.tsx (dispatcher only)
**Before:** composed `/e|/t|/exp` paths; nothing rode a query param. **Now:** appends `?landing=guest-list` at the single composition point so BOTH the authed push and the unauthenticated deferral `{url, ts, router:true}` carry it; the replay effect is untouched (verbatim push ⇒ the param survives install→defer→replay by construction). **Why:** SPEC §4.6. ~12 lines.

### app-mobile/src/services/publicEventSeedService.ts (NEW) + ConsumerEventDetailScreen
**Before:** `/e/` cold route rendered the OQ-6 "Open this event from the app" cap unconditionally. **Now:** the screen resolves a `BusinessEventCard` seed by slug from the anon view (explicit columns, `maybeSingle`, mapper per the §4.7 field table; trips/experiences → null; errors throw), shows the existing loading sheet while resolving, renders the FULL page (RSVP branch included) on success, and keeps the cap as the honest terminal state for unknown/private/deleted slugs. **Why:** SPEC §4.7 / D6. ~224 + ~55 lines.

### The three consumer detail screens (§4.8)
**Before:** no landing concept. **Now:** `landing?: 'guest-list'` prop + a one-shot reactive effect that fires the SAME `handleSeeWhosGoing` the card uses, only when the seed/detail is resolved AND socialProof settled with `privateGuestList === false` AND `goingCount > 0`; the ref flips on ANY terminal outcome (never re-pops on refetch); errors/zero/private → silent, page renders as today. **Why:** SPEC §4.8; T-A2..T-A5. ~40 lines/screen.

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---|---|---|
| Consumer iOS | YES — cold `/e/` renders; landing auto-open; resolver/dispatcher | shared JS (OTA-able); runtime proof per platform = tester |
| Consumer Android | YES — same code | same files |
| Buyer/anon Web | YES — the gate on 4 pages; F-12 fix; analytics | manual web-only wiring (`Platform.OS === 'web'`) — source-pinned |
| Business iOS | Partially — NO gate (deliberate, inert cluster); F-12 correctness arrives at next NATIVE build (COMMS-0052/0063 — no business OTA) | guarded manual |
| Business Android | Partially — same as iOS | same code |
| Admin Web | NOT affected (zero offering-rendering mounts) | — |
| Business Web preview | NOT affected (goingCount 0 ⇒ affordance absent) | — |
| Marketing web | READ-ONLY (drift gate reads `lib/store-links.ts` + trio/QR precedents) | CI reads only |

## 9. Verification matrix (verbatim outputs)

- **My 6 suites:** Deno `ok | 14 passed`, `ok | 8 passed`, `ok | 11 passed` (combined final sweep `ok | 84 passed | 0 failed (323ms)` incl. 1318+1341 pairs); jest `Tests: 41 passed, 41 total / Suites: 3 passed`.
- **Gates:** `ORCH-1342 store-links-ssot self-test PASS (10/10 cases).` + live `PASS`; `ORCH-1342 landing-single-parse self-test PASS (7/7 cases).` + live `PASS`.
- **Existing batteries:** 1157+1339+1340 package sweep `ok | 61 passed | 0 failed`; 1341 pair `ok | 27 passed | 0 failed`; 1338 pair `ok | 22 passed | 0 failed`; 1318 pair green (in the 84). 1163 battery: 54/55 — see Discoveries D-1 (the 1 failure is PRE-EXISTING at `bb40c4edb`, proven by identical stash-baseline run).
- **Screen-adjacent legacy suites:** baseline-vs-after failure sets byte-IDENTICAL (`diff` → `IDENTICAL FAILURE SETS`; 4 stale pre-existing failures, all expecting the retired `RsvpOfferingDecisionDock` — Discoveries D-1).
- **TypeScript:** `npx tsc --noEmit` — mingla-business 928 output lines, app-mobile 1024, in BOTH baseline (stashed at `bb40c4edb`) and final runs ⇒ **zero NEW errors** (all pre-existing: test-harness types, app.config duplicates, package loose-check).
- **Web export + budget (T-13):** `npx expo export -p web --clear` exit 0; `ORCH-1083 bundle-budget PASS — initial payload 3250794 bytes (ceiling 9405478), 147 chunk files, 0 deferred specifiers in the main entry chunk, __common within cap.` (Baseline: 3250121/145 — the gate+QR ride 2 deferred chunks; +673 eager bytes. A static import measured +31.6KB over the __common cap → the lazy-loading is budget-mandatory, now test-pinned.)
- **Invariants:** I-ONELINK-SINGLE-RESOLVER ✓ (extended in place; gate enforces single parse) · 1318 null-on-unknown parity ✓ (T-1 edge rows) · I-PROPOSED-1157 family ✓ (zero package edits; no checkout affordance; palette-only + the sanctioned QR white) · I-MOR-0827 ✓ (no `packages/` change) · D1/1340 successor ✓ (T-6) · COMMS-0009 ✓ (T-8 source assert) · ORCH-1328 pattern ✓ (T-5) · tests-append-only ✓ (zero existing test files touched — `git diff bb40c4edb..1c43c9d63 --name-only` shows only NEW test files).

## 10. Known issues / deferred

1. **Workflow registration deliberately OMITTED** (dispatch override of SPEC allowlist item 25): both `orch-1342-*.mjs` gates ship with `--self-test` but are NOT in `strict-grep-mingla-business.yml` — the dedicated CI-guard pass owns all workflow edits.
2. **OneLink flip stays dark:** `GUEST_FUNNEL_ONELINK_URL = null` committed; Seth's go-live = fresh native builds → `APPSFLYER_S2S_TOKEN` → one-line `[deploy]` flip to `'https://go.usemingla.com/w36m'` → SC-10/11/12 live-fire (SPEC §10-2; domain verification already DONE per A-1).
3. **Runtime halves owned by the tester** (SPEC §11): T-9/T-10/T-11 (consumer sim incl. RSVP decision tap), T-12 (buyer-web export at both widths incl. Esc/focus + F-11 live private event), SC-6 PostHog live-tail.
4. **Business-native F-12 arrival:** rides the next business NATIVE build (no OTA — COMMS-0052/0063); acceptable per SPEC §3.
5. No `[TRANSITIONAL]` markers introduced.

## 11. Operator action required

- **No migration** (no `db push`), **no edge deploy**, **no OTA from this leg** (orchestrator sequences ONE consumer per-platform OTA after 1341+1342 merge — SPEC §10-5; buyer-web ships via the `[deploy]` tag at SHIP).
- At CLOSE: flip `I-PROPOSED-1342-LANDING-SINGLE-PARSE` + `I-PROPOSED-1342-STORE-LINKS-SSOT` + `I-PROPOSED-1342-GATE-NEVER-NAMES-NEVER-REDIRECTS` DRAFT→ACTIVE; register the go-live checklist as the META residual.

## 12. Deviations from the SPEC (each reasoned, none silent)

- **D-1 `hideAddressUntilTicket` fallback = `true`, not the spec's literal `false`:** SPEC §4.7's controlling clause says "MIRROR the authoritative buyer-web parse (`publicEventsService.ts:1034`)" — that parse AND the deck-seed producer (`_business-query.ts` extractHideAddressUntilTicket, test-documented "fail-CLOSED to true") both use `true`. The literal `false` in the same sentence contradicts its own mirror instruction and would LEAK hidden street addresses on cold pages (1157 address-privacy family). Implemented the mirror; pinned in T-8. **Orchestrator to ratify.**
- **D-2 analytics transport = `captureWeb`, not `postHogService.capture`:** the spec's named facade is a deliberate NO-OP stub on the web export (I-PROPOSED-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS) — SC-6's "events fire, live-tail provable" is unfulfillable through it. `captureWeb` (posthog-js) is the repo's buyer-web capture path (all `web_*` events use it) and no-ops on native, where the gate never opens. Event names + §4.4.3 property shapes kept exactly.
- **D-3 gate + QR are LAZY chunks:** the spec's static mounts measured +31.6KB over the eager `__common` budget cap (baseline headroom was ~7KB). `React.lazy` + conditional render (`{gateVisible ? ...}`) defers both; budget PASS; pattern test-pinned. Spec §4.3's own T-13 ("bundle-budget gate must stay green") binds this outcome.
- **D-4 mini-cluster echo rendered inline** (30px disks, avatars-only, a11y-hidden) instead of reusing `GuestAvatarCluster`: the package component requires `goingCount`/`clusterNote`/`chipFill` that the spec's bound gate-props contract does not carry; passing fabricated values would violate Constitution #9/a11y honesty. Same disk geometry (30px, border 2 `palette.page`, −8 overlap).
- **D-5 SSOT gate grandfathers two PRE-EXISTING violator files** (see Discoveries D-2/D-3) — file+pattern-narrow exceptions, self-tested; fixing them is outside the allowlist.
- **D-6 `react-qr-code` resolved at `^2.2.0`** (marketing pins `^2.0.15` — same major, identical prop API; the gate compares URL VALUES not versions).
- **D-7 brandTheme carries `animation_override`** (the spec's §4.7 list named 5 of the type's 6 keys; the 6th is plumbed from the view column like the /exp route precedent — omitting it would silently drop a brand's animation override on cold pages).

## 13. Discoveries for Orchestrator

- **D-1 (latent main-red, pre-existing):** 5 stale source-assert tests FAIL at `bb40c4edb` (proven via stash-baseline): `orch_1163_r3_rsvp_floating_active.test.ts` §6b (expects the pre-ORCH-1188 `scrollPaddingBottom = isRsvp ? 0 : ...` shape), `orch_1157_rsvp_consumer.test.ts` T-7/T-8 + `rsvpDeckService.orch1150.test.ts` T-10b/T-10c (all expect the retired `RsvpOfferingDecisionDock`; the screen mounts `RsvpOfferingFloatingBar` since 1163-R2), and `orch_1138_consumer_event_foundation.test.ts` T5 / `orch_1138_event_reserve_float_dock.test.ts` E4 (pre-1167 radiogroup/dock-child assertions). These suites evidently don't run in CI's paths-gated jobs — the docs-only-CLOSE hazard class. Needs a `[TEST-MOD-APPROVED]` cleanup ORCH.
- **D-2 (pre-existing F-12-class debt):** `mingla-business/app/accept-brand-invitation/success.tsx:49-51` hardcodes the BUSINESS store URLs (id6768737367 / com.sethogieva.minglabusiness) — grandfathered in the SSOT gate; needs `BUSINESS_*` SSOT entries in a follow-up.
- **D-3 (known 1346 residual, now gate-visible):** `mingla-business/src/services/appsFlyerService.ts:132` still sets `go.usemingla.com` as the business branded domain — the minglabiz swap is bound to the next business native build; grandfathered narrowly.
- **D-4:** app-mobile `__tests__` are a mix of Deno-runnable and node-runnable suites with no single runner/workflow — worth a CI harness decision in the CI-guard pass.

## 14. Smoke-test result

No sim/device run this leg (tester-owned per SPEC §11); build-level smoke = the full `expo export -p web` (exit 0, budget PASS, 147 chunks) + CI-mode suites above. For Seth's own web smoke after SHIP: open any public event page at phone width → tap "See who's going" → panel slides up over the page → "Get the app" opens the store in a new tab with the event page still behind; at desktop width the same tap opens the QR dialog; the QR scans to `usemingla.com/download`.
