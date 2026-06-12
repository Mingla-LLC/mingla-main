# TEST — ORCH-1121 [Business brand-profile redesign: cover/avatar/about hero + wire Recent Events to real data]

- **Verdict:** **CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 2 · P4: 2.
- **Condition (single, on-device):** Seth must sign into the Business app and open a brand that HAS published events + a real cover, and confirm (a) no false-empty "Create your first event" flash on cold load, (b) the un-cropped 16:9 hero, (c) a Recent-Events row tap opens that event's dashboard. Auth is a Seth-only blocker (Apple/Google OAuth + email magic-link); the app reached the sign-in screen cleanly but no further headless path exists.
- **Tester:** mingla-tester+claude. **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1121-[brand-profile-redesign]/` on branch `ORCH-1121-brand-profile-redesign` (HEAD `dd06e552e` after the tester adversarial commit; product code unchanged at `6167c9b0a`).
- **Comms ledger:** read on entry. COMMS-0024 (WARN, ALL) — ORCH-1121 legitimately keeps its number (no renumber); factored, acked, no code action. No BLOCK+OPEN entry addressed to tester / ORCH-1121 / ALL.
- **Confidence:** `probable` (live-fire attempted; bundle compiled + ran on iOS sim to the auth wall; the authed brand-profile screen is gated behind Seth-only credentials). Source + executable-logic evidence is strong; the final on-device render of the populated screen is the deferred condition.

---

## 1. What was tested

Two defects fixed in one screen (`mingla-business`, owner's OWN `/brand/{id}`):
- **A — cropped cover hero** → full-bleed 16:9 `EventCoverMedia` banner + 96px ring avatar + centered identity + About read-more + centered chips; 3-state media→hue fallback preserved.
- **B — lying Recent Events (Constitution #9)** → SECTION E was a hardcoded unconditional empty card; now derived from `useBusinessEventsForBrand(brand.id)` with a truthful loading/error/populated/settled-empty ladder.

Product scope verified to be EXACTLY the 3 allowlisted files (no scope creep):
`BrandProfileView.tsx`, `offeringCardModels.ts` (+`liveEventToOfferingModel`), `app/brand/[id]/index.tsx`.

---

## 2. SC-by-SC matrix

Evidence level: `src` = source/contract proof; `exec` = executable logic test (jest); `rt-boot` = bundle compiled+ran on iOS sim; `DEFER` = needs the on-device condition.

| SC | Criterion | Status | Evidence |
|---|---|---|---|
| SC-1-iOS | Hero un-cropped 16:9 (clamp 176–240), avatar half-overlaps seam | CONDITIONAL | `src`: `COVER_H = min(240,max(176,round(coverWidth*9/16)))` (L556); `heroAvatarRing` 96px `marginTop:-48` (L1062-1071); old `height:140` gone. `rt-boot` clean. Render `DEFER`. |
| SC-1-Android | same on Android | CONDITIONAL | shared RN source; same as iOS. `DEFER` (Samsung reachable but business app not installed there + auth-gated). |
| SC-2 | Hero composition order; no placeholder when data absent | PASS(src) | Name→tagline(guarded L645)→location(guarded `brand.address` L651)→divider→About(or dashed empty-bio CTA)→centered chips (chips IIFE returns null when all empty, L743). |
| SC-3 | 3-state fallback preserved; video animates (motion-gated) | PASS(src) | `coverMediaUrl` coercion + `coverMediaFailed` flip + URL-reset effect intact (L286-292); `onMediaError={()=>setCoverMediaFailed(true)}` (L613) — `onMediaError` confirmed real on `@mingla/event-rendering` EventCoverMedia (L56); hue `LinearGradient` fallback; `autoplay/playbackActive={!reduceMotion}`. |
| SC-4 | Events populate ≤5 most-recent; past→ENDED | CONDITIONAL | `exec` (adversarial matrix): rows render whenever data present; `slice(0,5)`; sort date DESC nulls-last (L323-336); `deriveCardStatus` (canonical ORCH-0850 helper, cancelled→past) → `OfferingListCard` ENDED pill. Visual `DEFER`. |
| SC-5 | Empty card only at settled zero; CTA→/event/create | PASS(exec) | `eventsSettledEmpty=!eventsLoading&&!eventsError&&brandEvents.length===0` (L563); adversarial matrix proves empty appears in EXACTLY 1 of 12 states. CTA `handleCreateEvent`→`onCreateEvent`→`router.push("/event/create")` (route L146). |
| SC-6 | Loading ≠ empty | PASS(exec) | Ladder order error→rows→settled-empty→skeleton; adversarial test: `loading=true,data=[]`→skeleton, never empty. |
| SC-7 | Error surfaced (retry), never silent/lie | PASS(exec+src) | `eventsError`→"Couldn't load your events"+"Tap to retry"→`refetchEvents()` (L871-890); adversarial: error→error branch, never empty. |
| SC-8 | Row tap → detail via routeForEventRowDefensive | PASS(src) | `onOpen=()=>onOpenEvent(event.id,event.event_type,event.status)` (L898) → route file `routeForEventRowDefensive({id,eventType,status})` → `router.push` (L156-167). `LiveEventStatus` ∈ helper's `EventStatusForRouting`; published (non-draft) → `/event/{id}`. No dead tap in source; runtime fire `DEFER`. |
| SC-9 | "See all" only when >5 → Hub events | PASS(src) | `totalEventCount>5 ? <Pressable onPress={onSeeAllEvents}>` (L854); route `/(tabs)/hub/events` (L171). |
| SC-10 | No 3-dot on rows | PASS(src) | `onManageOpen` omitted; `OfferingListCard` hides trigger when undefined (L165). Adversarial source-grep `not.toContain("onManageOpen=")`. |
| SC-11 | No regression to B/C/D/F (incl. COMMS-0021) | PASS(src) | "Payments & Bank" + `isBrandPayoutReady(brand)` + `getBrandProfileStripeOperationsSub` byte-preserved (L419-421); stats/banner intact. |
| SC-12-Android | Opaque glass + clip + no shadow under rounded fill | CONDITIONAL | `src`: skeleton uses `Platform.select` opaque `rgba(20,22,26,0.92)`+`overflow:'hidden'`, no elevation (L1342-1347); reused `OfferingListCard`/`GlassCard` already opaque-Android. Device `DEFER`. |
| SC-13 | a11y: chip/See-all/Read-more hitSlop; reading order; no fabricated badge | PASS(src) | Chips `hitSlop{6,6,6,6}`; See-all/Read-more `hitSlop={8}`; verified badge OMITTED (`Brand` has no `verified`); reading order = visual order. |

---

## 3. Findings

### P3-1 — Latent false-empty-flash if a non-null brand is ever rendered with auth-not-ready (defense-in-depth gap, NOT a live bug)
- **Evidence:** `useBusinessEventsForBrand` gates `enabled = isAuthReady && brandId !== null`. Empirically verified (RQ v5 QueryObserver probe): a **disabled** query reports `isLoading=false, isError=false, data=[]` — which satisfies `eventsSettledEmpty=true` → the empty card renders. The skeleton branch only protects the **enabled-and-fetching** state (`isLoading=true`). So if `BrandProfileView` is ever handed a non-null `brand` while `isAuthReady` is still false, a brand that HAS events would flash "Create your first event".
- **Why it is NOT live today:** in the wired path (`app/brand/[id]/index.tsx`), `useBrand` returns null until auth+RLS resolve, and `isBrandRouteResolving` keeps the route in the spinner early-return until `isAuthReady` — so the populated branch is never reached with auth-not-ready. Query persistence (`@tanstack/query-async-storage-persister`) is **installed but UNUSED** (`src/config/queryClient.ts:20`), so no warm-cache rehydration can produce a non-null brand pre-auth. The flash window is closed by the route gate, not by SECTION E itself.
- **Impact:** none in production wiring; a fragility if a future caller renders `BrandProfileView` with an externally-supplied brand (e.g. a preview/storybook host) before auth warms.
- **Required fix (optional hardening, follow-on ORCH):** treat a **disabled** events query as "loading-not-settled" — e.g. fold `fetchStatus`/`isPending` into `eventsSettledEmpty` so the empty card requires a query that actually ran. Not blocking.
- **Retest:** the adversarial matrix already encodes the disabled-query state as the trap; extend with a `queryDisabled` flag if hardened.

### P3-2 — `OfferingListCard` title crash only if `event.name` were null (typed-out, not reachable)
- **Evidence:** `liveEventToOfferingModel` sets `title: event.name`; `OfferingListCard` calls `model.title.trim()` (L76). If `title` were null → TypeError.
- **Why not reachable:** `LiveEvent.name: string` (non-null, `liveEventStore.ts:177`) and `OfferingListCardModel.title: string`. No null path from typed data.
- **Impact:** none under the type contract; noted for completeness (a malformed view row would crash rather than show "Untitled").
- **Retest:** n/a unless the view's nullability changes.

### P4-1 (praise) — RQ-v5-aware ladder ordering is correct
The error→rows→settled-empty→skeleton ladder, combined with `eventsSettledEmpty` gating on `!isLoading && !isError`, correctly exploits RQ v5's `isLoading = isPending && isFetching` semantics so the initial fetch (`isLoading=true`) always lands on skeleton, never the empty card. The exact bug class this ORCH targets is structurally closed in the wired path.

### P4-2 (praise) — routing + status discipline
Row tap routes through `routeForEventRowDefensive` (zero new strict-grep violations); `LiveEventStatus` is a clean subset of the helper's status union; trips already excluded by the hook; experiences route to `/experience/{id}`. No hardcoded `/event/${id}`.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- **Checked out / ran at:** product HEAD `6167c9b0a` (committed state).
- **Method:** true line-deletion — replaced SECTION E's full `eventsError ? … : recentEvents.length>0 ? … : eventsSettledEmpty ? … : skeleton` ladder with the original unconditional `<GlassCard>…No events yet…Create your first event</GlassCard>`, then ran `BrandProfileView.orch_1121.test.tsx`.
- **Result on revert:** `Tests: 5 failed, 17 passed, 22 total`. The failing assertions: *POPULATED branch maps 3 events → 3 rows*, *the lying empty card is GONE*, *LOADING is not EMPTY*, *ERROR is surfaced*, *row tap navigates via onOpenEvent*.
- **Discrepancy vs implementor's report (6 failed):** the implementor reported 6; I observe **5**. The sixth ("See all gated on totalEventCount>5") still passes on revert because the section header (which contains the See-all gate) sits ABOVE the reverted block and was not deleted. This is a benign over-count in the implementation report, not a test weakness — the 5 load-bearing Constitution-#9 assertions FAIL on revert exactly as required.
- **Result on restore** (`cp` of pre-edit backup, `git diff --quiet` clean): `Tests: 22 passed, 22 total`. Fails-on-revert contract HOLDS.

---

## 5. Adversarial test added (tester, different angle)

- **Path:** `mingla-business/src/components/brand/__tests__/BrandProfileView.recentEventsFlash.adversarial.orch_1121.test.ts`
- **Commit:** `dd06e552e` (on-branch; appears in `git diff origin/main...HEAD --name-only`). Append-only (new file; no existing test touched).
- **Angle (DIFFERENT from implementor's source-structure tests):** models the exact SECTION E render ladder as a pure function and drives it across the FULL React Query v5 cold-load / refetch / error state matrix — including the empirically-verified **disabled-query trap** (`isLoading=false,data=[]`). Asserts the empty card renders in EXACTLY ONE of 12 state cells (settled+zero+no-error) and a brand-with-events NEVER reaches the empty branch.
- **Result:** 10/10 PASS. Full ORCH-1121 suite (3 files): **37/37 PASS**. tsc-clean on the new file.
- **Fails-on-revert (built in):** the test embeds `revertedUnconditionalEmpty = () => "empty"` and asserts the fixed ladder DIVERGES from it precisely on the false-empty-flash state (`loading=true` → fixed=skeleton vs reverted=empty) and on the error state. Reverting the product ladder to unconditional-empty makes the divergence assertions describe the live bug.
- **RQ-v5 ground truth** (recorded; QueryObserver probe, throwaway): disabled→`{isLoading:false,isError:false,status:pending,fetchStatus:idle,data:[]}`; enabled-initial→`{isLoading:true,fetchStatus:fetching}`.

Both the implementor's happy-path test (`fails-on-revert verified at 6167c9b0a`) and the tester adversarial test are present and in-diff. Regression gate satisfied.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS(src) | Create CTA→onCreateEvent (live route /event/create); row→onOpenEvent→helper push; See-all→/(tabs)/hub/events; chips→Linking.openURL. Runtime fire DEFER (condition). |
| 2 | One owner per truth | PASS | Events sourced solely from `useBusinessEventsForBrand`; status via canonical `deriveCardStatus`. |
| 3 | No silent failures | PASS(exec) | `eventsError`→inline retry; adversarial proves error never collapses to empty/blank. |
| 4 | One query key per entity | PASS | `businessEventKeys.list(brandId)` factory reused; no inline keys. |
| 5 | Server state server-side | PASS | No Zustand for events; RQ owns the list. |
| 6 | Logout clears everything | N/A | No new persisted client state (only `aboutExpanded` ephemeral). |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional code added. |
| 8 | Subtract before adding | PASS | Removed raw ExpoImage/RNImage + ORCH-0805-WEB hotfix + stale comments; ECM owns the element. |
| 9 | No fabricated/lying data | PASS(exec) | Empty card gated on settled-zero (adversarial matrix); no fake metric/revenue (all null, rendered as absent); no invented verified badge. |
| 10 | Currency-aware | N/A | No money rendered on Recent-Events rows (metric/revenue null by design). |
| 11 | One auth instance | PASS | View imports no auth; route uses the single `useAuth`. |
| 12 | Validate at right time | PASS | `deriveCardStatus` routes through ORCH-0850 UTC-midnight-correct `computeMasterStartAtUtc` — same-day US-Eastern events bucket correctly (no re-implementation). |
| 13 | Exclusion consistency | PASS | Trips excluded by the hook; drafts intentionally not merged. |
| 14 | Persisted-state startup | N/A | No `_hasHydrated`-gated store added; query persistence unused. |

No violations → no automatic P0.

---

## 7. Device / parity matrix

| Surface | Result | Note |
|---|---|---|
| Consumer iOS | N/A | Different app (app-mobile). Not touched. |
| Consumer Android | N/A | Different app. |
| Buyer/anon Web | N/A | `/b/{slug}` = `PublicBrandPage` (package), explicitly out of scope + byte-identical to origin/main. |
| **Business iOS** | **CONDITIONAL (rt-boot PASS)** | Bundle compiled + ran on iPhone 17 Pro sim (UDID 17091E60…) via Metro 8087 from the worktree — 1444 modules bundled, NO crash/red-screen, app reached the Business sign-in screen (evidence `01_launch_state.png`). The ORCH-1121 code is in the live bundle (a broken import would red-screen at module load). Authed brand-profile render is the DEFER condition (no credentials). |
| **Business Android** | **DEFER** | Physical Samsung R58R54YV7JT is ADB-reachable but only the CONSUMER app (`com.mingla.app.v2`) is installed — the business app (`com.sethogieva.minglabusiness`) is not present, and is auth-gated regardless. |
| Admin Web | N/A | Unaffected. |
| Business Web preview | PASS(src) | No `.web.tsx` fork; single RN source. `EventCoverMedia` (`@mingla/event-rendering`) has an explicit `Platform.OS==='web'` element path (L325) already shipping app-wide; raw-image web hotfix fully removed from `BrandProfileView.tsx` (grep empty). No web crash expected; an authed live web render is part of the DEFER condition. |

**Physical iPhone HITL:** not performed this run — the iOS leg ran on the simulator. The single DEFER condition (authed brand-with-events) can be satisfied on Seth's sim login or physical device; see condition at top.

**Live deploy state:** N/A — no edge function, no migration, no RLS. Pure client change.

---

## 8. Baseline-red verification (§12 of the implementation report)

Verified the implementor's claim that 13 unrelated suites + the route-by-event-type strict-grep gate are pre-existing red, NOT introduced by ORCH-1121:
- Ran `OfferingParity.test.ts` → 1 failed (expects `<OfferingManageSheet>` in `app/(tabs)/hub/trips.tsx`). That assertion-target file is **byte-identical to origin/main** (`git diff --quiet origin/main...HEAD` clean), as are `hub/experiences.tsx` and `packages/brand-rendering/src/PublicBrandPage.tsx`. The failing tests target files ORCH-1121 never touches.
- Ran the `i-proposed-tr2-route-by-event-type.mjs` gate → 6 violations, ALL in `hub/trips.tsx`, `accept-scanner-invitation.tsx`, `ScannerHome.tsx` (each identical to origin/main). ORCH-1121's `app/brand/[id]/index.tsx` routes through `routeForEventRowDefensive` and adds **zero** new violations.
- ORCH-1121's only product changes are the 3 allowlisted files; the 3 ORCH-1121 jest suites are 37/37 green.

Conclusion: the baseline-red claim is **accurate**. These reds are inherited stale-anchor drift; do not attribute them to ORCH-1121 or block the close on them. Orchestrator should sequence the closing PR after origin/main advances past those parallel ORCHs for a clean CI green (implementor discovery D-A).

---

## 9. Discoveries for Orchestrator

- **D-T1:** The false-empty-flash protection is the route's `isResolving` spinner gate + the unused query-persister, NOT SECTION E itself (P3-1). If `BrandProfileView` ever gains a caller that supplies a non-null brand pre-auth (preview host, future deep-link), the empty card could flash. Optional hardening = fold disabled/`isPending` into `eventsSettledEmpty`. Track as a possible follow-on; not blocking 1121.
- **D-T2:** Implementation report §6 over-counts the revert failures (says 6, actual 5 — the See-all assertion survives because it sits above the reverted block). Cosmetic; the contract holds.
- **D-T3 (pre-existing, from implementor D-A):** 13 baseline-red suites + the route gate on this branch's base are stale-anchor drift (parallel-session `OfferingManageSheet`/`taglineCentered` expectations + 6 route sites). Merge-sequence the PR after origin/main advances for green CI.

---

## 10. Accepted conditions (CONDITIONAL PASS)

The verdict is CONDITIONAL — there is ONE outstanding on-device condition, NOT a P1/P2 accepted-deferral. It is the inherent UI/runtime live-fire requirement that auth (a Seth-only credential blocker) prevents headlessly:

**Condition C-1 (single, outstanding):** On the Business app (iOS sim after Seth's login, and/or Android once the business build is installed), sign in and open a brand that HAS ≥1 published event and a real landscape cover. Confirm:
1. No "Create your first event" empty card flashes on cold load before the list settles (the core bug).
2. The cover renders as an un-cropped ~16:9 banner (not a ≤140px strip), with the 96px ring avatar half-overlapping the seam.
3. Tapping a Recent-Events row opens that event's dashboard (`/event/{id}`); "See all" appears only with >5 events; past events show the faded ENDED pill; no 3-dot on rows.

If all three hold, this flips to PASS. The headless evidence (executable state-matrix + source/contract + RQ-v5 probe + clean sim boot to the auth wall) makes a regression here unlikely, but per the live-fire gate a UI verdict above `probable` requires this render.

---

## Routing

CONDITIONAL PASS with one outstanding (non-accepted) condition → **STOP and surface to Seth** for the on-device C-1 confirmation. Do NOT route to CLOSE until C-1 is satisfied (then PASS → CLOSE, flip `I-PROPOSED-1121-RECENT-EVENTS-LIVE-QUERY` to ACTIVE). No REWORK required — zero P0, zero P1.
