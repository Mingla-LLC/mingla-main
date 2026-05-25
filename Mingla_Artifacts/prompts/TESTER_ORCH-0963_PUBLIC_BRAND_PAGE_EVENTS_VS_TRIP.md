# TESTER DISPATCH — ORCH-0963 [Public brand page business-case optimization (events vs. trip brands)]

**Dispatched:** 2026-05-25 by Claude `mingla-orchestrator`
**Skill:** Claude `mingla-tester`
**Sub-mode:** TARGETED (full 10-step protocol) + Step 0.5 adversarial gate
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0963-[public-brand-page-events-vs-trip]/`
**Branch:** `ORCH-0963-public-brand-page-events-vs-trip` (parented off `main`)
**Implementation commit:** `4d437b94c`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md`
**INVESTIGATION:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md`
**SPEC REVIEW:** `Mingla_Artifacts/reports/REVIEW_ORCH-0963_SPEC.md`
**IMPLEMENTATION REVIEW:** `Mingla_Artifacts/reports/REVIEW_ORCH-0963_IMPLEMENTATION.md`
**Severity:** S2-medium

---

## Goal

Independently verify the kind-branched public brand page works end-to-end on the live buyer-web preview, against real production data, with the migration already applied to remote. Operator (Seth) ran `supabase db push --linked` 2026-05-25; orchestrator confirmed the RPC `pg_public_trips_by_brand` is live on Supabase remote (verified via `pg_proc` + `has_function_privilege` + equivalent-SQL replay returning correct rows for `travelbrand` — 2 trips, spots_left=21 + 200). Your job: prove this works in a real browser, against the rendered DOM, with the actual JS bundle the buyer hits.

This is NOT a code-grep audit only (implementor already shipped 14 source-grep tests + 4 Jest tests). This IS a live-fire verification + an adversarial regression test written by YOU attacking a DIFFERENT angle than implementor's adversarial tests (T-05/T-06/T-07/T-08/T-09).

---

## Phase 0 — Mandatory triage

- **What you're testing:** ORCH-0963 implementation against SPEC §4 success criteria (SC-1..SC-15) + Step 0.5 regression-test gate adversarial layer.
- **Layers touched:** DB (new RPC) + service (new fetcher + dispatch) + hook (return-shape extension) + component (page redesign + 2 new primitives) + CI (new strict-grep gate + ORCH-0863 allowlist).
- **Deployment target:** buyer-web (Vercel-built `mingla-business/`). No mobile bundle.
- **Sub-mode:** TARGETED with full 10-step protocol from `.claude/skills/mingla-tester/references/targeted-protocol.md`.

---

## Inputs to ingest (Phase 0 mandatory)

1. SPEC (binding contract): the path above. Focus on §4 (15 SC criteria) + §6 (10 tests — 5 of which are happy-path you verify ran green; the other 5 are adversarial — you write a SECOND adversarial test attacking a different angle).
2. INVESTIGATION report: F-1..F-7 + D-1..D-5. D-1 closed as headless-probe artifact (Cloudflare bot heuristic on prod) — operator confirmed real users see the pages fine; **headless Playwright/dump-dom against prod will hit the same 401 + you must use a local Metro dev build instead**, per memory rule [[sim-load-latest-bundle-before-test]].
3. Implementation report + REVIEW_IMPLEMENTATION: file paths above. Validate implementor's SC coverage table (SC-1..SC-15) — every claim must be reproducible.
4. COMMS-LEDGER active entries — read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. COMMS-0002/0003/0004/0005 apply (most as N/A for testing role; COMMS-0005 confirms ORCH-0964 turf is honored — verify by source-grep that `<Head>` block was NOT touched and theme tokens are NOT in the diff).
5. Memory rules in play: [[sim-load-latest-bundle-before-test]] (load latest bundle before asking operator to test), [[always-simulator-repro-described-behaviour]] (live-fire ceiling rules), [[sim-test-drivers-maestro-default]] (Maestro is default sim driver; never osascript).

---

## TARGETED 10-step protocol (execute every step)

### Step 1 — Blast radius mapping
Walk every changed file's dependents. The change touches: `PublicBrandPage.tsx` (consumed only by `app/b/[brandSlug]/index.tsx`), `publicEventsService.ts` (consumed by `usePublicEvents.ts` + tests + organiser-side calls). The new RPC is anon-only (live RPC + GRANTs verified by orchestrator). The new strict-grep gate runs on every PR.

### Step 2 — Implementation report audit
Read every claim in §3 (Old → New Receipts) + §3 (SC verification matrix). Mark each claim for live-fire verification.

### Step 3 — Forensic code reading
Read the actual diff at `git show 4d437b94c -- mingla-business/src/components/brand/PublicBrandPage.tsx` + the service file + the RPC SQL. Verify each layer matches its spec contract. Layer-specific checklists per `.claude/skills/mingla-tester/references/targeted-protocol.md`.

### Step 4 — Constitution enforcement
Re-check all 14 principles against the diff. Implementor claimed all 14 ✓ in report §8 — verify independently.

### Step 5 — Behavioral contract verification
- Trip-planner brand surfaces ONLY trip cards (no event cards leak in).
- Event brand surfaces ONLY event cards (no trip cards leak in).
- NextEventTeaser renders ONLY for `!isTripBrand && upcomingEvents.length > 0`.
- TripMiniCard NEVER renders "null" or "undefined" for any field state.
- Sticky CTA pill appears on EXACTLY 3 cards (first 3 upcoming events).
- Stats card is GONE for both kinds.

### Step 6 — Independent test writing — YOUR adversarial regression test (Step 0.5 gate)
Write a test at `mingla-business/src/components/brand/__tests__/PublicBrandPage.adversarial.test.ts` (or `supabase/migrations/__tests__/pg_public_trips_by_brand.bypass.adversarial.test.ts` if you choose the DB angle) that attacks a DIFFERENT angle than implementor's 4 adversarial tests (T-05 null spots-left, T-06 bookings-closed precedence, T-07 RPC anti-leak, T-08 pin-CTA count, T-09 past-cap).

**Candidate adversarial angles (pick ONE that's strongest):**

- (A) **Verified-venue trip-planner cross-kind impossibility** — confirm a brand can't be both verified-venue (always `kind='physical'`) AND trip-planner. If a future migration corrupts this assumption, the `<PublicVenueDetail>` block AND the trip-card body could both try to render. Pin: `claimedVenueRowToBrand` always returns `kind='physical'` + `getPublicBrandBySlug` verified-venue branch always returns `trips: []`.
- (B) **Currency injection / minprice rounding** — the implementor's T-02b only checks null. Adversarial: feed a trip with `min_price_cents=1` (£0.01) — does `formatCurrencyRound(0.01, 'EUR')` render "From €0" (rounded ugly) or "From €0.01" (honest)? Pin which behavior is correct and lock it.
- (C) **formatTripDateRange cross-year + cross-month + DST boundary** — implementor's helper covers same-day / same-month / cross-month / cross-year. Adversarial: dates spanning DST transitions in Europe/Berlin or America/New_York; verify the day-of-week label doesn't shift by one day under TZ math. Use real DST dates (2026 spring-forward: March 9 US / March 29 EU).
- (D) **Trip with status='cancelled'** — RPC includes cancelled in the WHERE clause, but the page memos filter `t.status === "scheduled" || t.status === "live"` for upcoming and `t.status === "ended"` for past. Adversarial: cancelled trips MUST NOT appear in either tab. Verify both component-level filters + that the RPC including cancelled in its result set doesn't leak any cancelled trip into the UI.
- (E) **brand.kind silent regression to "popup" mid-session** — `usePublicBrandBySlug` cache hit with stale shape. Adversarial: if a brand row's kind ever changes mid-session (per ORCH-0855 [[brand-kind-immutable-post-create]] this is forbidden, but trust-but-verify), the React Query cache could serve the wrong content. Pin that the page renders correctly even if `brand.kind` ever drifted.

Recommended pick: **(D)** — concrete attack on a real edge case the implementor's tests don't cover, and the data-side RPC explicitly includes 'cancelled' so a single comment-out of the component filter would leak cancelled trips into the UI.

Whichever angle you pick, the test MUST: have a clear `expected vs actual` assertion, FAIL when the fix is reverted (you verify locally), and live at a real path under `mingla-business/**/__tests__/**` or `supabase/migrations/__tests__/**`. Document the fails-on-revert proof in the QA report.

### Step 7 — Parity enforcement (MANDATORY)
- iOS Simulator: NOT in scope (no `app-mobile/` touch — explicit per SPEC §2 + INVESTIGATION F-7).
- Android Emulator: same.
- Web (Playwright on local Metro dev build): **MANDATORY**.
- Solo + collab modes: N/A (anon route).
- Mobile + admin + business: only buyer-web (business `mingla-business/`).

State the iOS/Android skips with the SC declaration reason.

### Step 8 — UI/UX coherence audit
Beyond "does it render," verify the trip card + next-event teaser actually look like product Mingla would ship. Reference: `.claude/skills/mingla-tester/references/ux-coherence-protocol.md`. Specifically check: typography hierarchy, spacing rhythm, badge color contrast (WCAG AA — Mingla `I-39` invariant), tap-target sizes (I-38), animation/transition smoothness.

### Step 9 — Cross-domain impact verification
- Organiser-side `/b/{slug}` self-view: would an organiser logged into mingla-business who navigates to their own brand's public page see the same kind-branched layout? (Probably yes — `PublicBrandPage` is the single render target.)
- `/e/{brandSlug}/{eventSlug}` event detail: untouched but verify the trip-rejection still works.
- `/t/{brandSlug}/{tripSlug}` trip detail: untouched but verify the trip card's tap target lands here.
- Admin web: zero impact (out of scope).

### Step 10 — Pattern compliance
Compare new primitives (`<TripMiniCard>`, `<NextEventTeaser>`) against existing sibling primitives (`<EventMiniCard>`). Naming, style refs, accessibility props, prop interface. Implementor mirrored `<EventMiniCard>` shape — verify.

---

## Live-fire scripts (mandatory — LF-1..LF-5 per SPEC §6.3)

### LF-1 — Trip-planner brand with 2 public trips
```
cd ~/Desktop/mingla-orchs/ORCH-0963-[public-brand-page-events-vs-trip]/mingla-business
npm run web -- --port 8085
# wait for "Web is waiting on http://localhost:8085"
# In a second terminal, drive Playwright with real Chrome (NON-headless if you want screenshots; --headless=new if you need DOM dump):
```

Open `localhost:8085/b/travelbrand`. **Expected outcome:**
- Brand cover + "Travel Brand" name + tabs labelled "Trips N / Past Trips N / About".
- Trips tab body shows 2 cards: "The DC Adventure" with destination "Washington DC, USA" + date "17 – 22 Aug 2026" + price "From €500" + scarcity badge **"21 spots left"**.
- Second card: "The Sone" with "Tulum, Quintana Roo, Mexico" + "19 – 22 Sep 2026" + "From €500" + **no scarcity badge** (200 spots remaining is well above the 5-scarcity threshold).
- No `<NextEventTeaser>` strip anywhere on the page.
- No "Buy tickets" pill anywhere.
- Screenshot for the QA report.

### LF-2 — Popup event brand with 11 public events
Open `localhost:8085/b/leggothis`. **Expected:**
- Brand cover + "Leggo This" name.
- **`<NextEventTeaser>` strip between the bio and the tabs** with format `NEXT · {date} · {event-name} · From £X →`.
- Tabs labelled "Upcoming N / Past N / About" (N depends on current event date math).
- First 3 upcoming-event cards show a **"Buy tickets"** pill in the bottom-right corner; cards 4+ do not.
- No trip cards anywhere.

### LF-3 — Trip-planner brand with 0 public trips
Open `localhost:8085/b/worldtravels`. **Expected:**
- Brand renders without crash.
- Tabs labelled "Trips 0 / Past Trips 0 / About".
- Trips tab body: "No upcoming trips yet" copy.
- No `<NextEventTeaser>` (not an event brand).
- No fake content, no "null", no "undefined" anywhere on the page.

### LF-4 — Tap into a trip card
On `localhost:8085/b/travelbrand`, tap (or click) "The DC Adventure" card. **Expected:** Browser navigates to `localhost:8085/t/travelbrand/the-dc-adventure` (the existing trip detail page).

### LF-5 — Web-export build parity (Vercel-equivalent)
```
cd ~/Desktop/mingla-orchs/ORCH-0963-[public-brand-page-events-vs-trip]/mingla-business
npm run web:export
# wait for build; then serve the export directory via a static server on a different port:
node playwright/meta-orch-0952-static-server.mjs web-build 43099
# (or any equivalent static server)
```

Repeat LF-1..LF-3 against `localhost:43099`. **Expected:** identical outcomes. This proves the production build artifact (what Vercel deploys) is correct, not just the dev server.

---

## Hard guards

- **DO NOT** run Playwright headless against the live production URL `https://business.usemingla.com/b/{slug}` — it gets blocked by Cloudflare bot heuristics per D-1. Use the local Metro dev server or web-export static server only.
- **DO NOT** apply database migrations. Operator already ran `supabase db push` 2026-05-25. The RPC is live on remote (orchestrator verified).
- **DO NOT** modify product code. Tester role is verify, not implement. If you find a defect, write a P0/P1 finding and dispatch back to implementor as REWORK.
- **DO NOT** modify existing test files (per `tests-append-only.yml`). Add NEW test files only for your adversarial coverage.
- **DO NOT** widen scope. If you find adjacent issues, log as Discoveries for Orchestrator.

---

## Expected output

1. `Mingla_Artifacts/reports/QA_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md` with: verdict (PASS / CONDITIONAL PASS / FAIL), SC-1..SC-15 traceability table (each marked ✓ or ✗ with live-fire evidence), severity counts (P0/P1/P2/P3/P4), LF-1..LF-5 outcomes with screenshots, the new adversarial test path + fails-on-revert proof, Step 0.5 gate satisfaction citation, Discoveries for Orchestrator (or "None").
2. New adversarial test committed on the per-ORCH branch.
3. Chat summary: verdict + severity counts + report path.

---

## Downstream routing

- **PASS / CONDITIONAL PASS** (with operator-accepted conditions) → Claude `mingla-orchestrator` runs CLOSE with `[deploy]` tag in commit subject (Vercel-built `mingla-business/` touched), pushes branch, opens PR, satisfies pre-merge gate, merges, runs Step 1.5 DIAG-reap, Step 1.7 worktree reap, flips `I-PROPOSED-PUBLIC-BRAND-KIND-BRANCHED` DRAFT → ACTIVE in `INVARIANT_REGISTRY.md`. No EAS OTA (no `app-mobile/` touch).
- **FAIL** → dispatch back to Claude `mingla-implementor` as REWORK with specific FAIL items cited by SC-ID + file:line.
- **CONDITIONAL PASS with unaccepted conditions** → STOP and surface to operator for accept/reject decision before CLOSE.

Working tree: `~/Desktop/mingla-orchs/ORCH-0963-[public-brand-page-events-vs-trip]/` on branch `ORCH-0963-public-brand-page-events-vs-trip`.
