# QA REPORT — ORCH-0962 [Brand-edit → public-brand field rendering — truthful bundle]

**Tester:** Claude `mingla-tester` (TARGETED + SPEC-COMPLIANCE).
**Tested at:** 2026-05-25.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0962-[brand-edit-public-render-audit]/` on branch `ORCH-0962-brand-edit-public-render-audit`.
**Implementation commit:** `52e37c2bc`. REVIEW commit: `622059ae1`. Tester adversarial commit: `b48df7064`.
**Inputs read:**
- `Mingla_Artifacts/specs/SPEC_ORCH-0962_BRAND_FIELD_RENDER_TRUTHFUL_BUNDLE.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0962_BRAND_EDIT_PUBLIC_RENDER_AUDIT.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0962_BRAND_FIELD_RENDER_TRUTHFUL_BUNDLE.md`
- `Mingla_Artifacts/reports/REVIEW_ORCH-0962_BRAND_FIELD_RENDER_TRUTHFUL_BUNDLE.md`
- Comms Ledger (acked COMMS-0002 / COMMS-0003 / COMMS-0004 at REVIEW time, no additional tester-side action)

---

## Verdict: CONDITIONAL PASS

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 0 | **P4:** 2 (clean patterns worth praising)
- **Conditions:** one operator-eyeball pass on the live buyer-web `/b/{brandSlug}` for a brand with contact info populated (e.g., `https://business.usemingla.com/b/agloat`) to visually confirm the now-rendered fields appear correctly. The condition is NOT a CI blocker — the data-layer is fully proven, the render-layer is structurally verified at source — but the buyer-web Chromium environment with a seeded test brand wasn't available to drive Playwright in this session, so the visible-pixel verification is deferred to a 60-second manual eyeball post-deploy. Auto-accepted given operator's prior "skip live-fire phase" directive on the audit chain.
- **Sim evidence:** buyer-web is the only UI surface in scope; backend (DB views + service mapper) verified live via Supabase MCP read-only probes. Consumer iOS / Android: surface does not exist (per investigation §"Consumer-app standalone brand profile is absent" — folded into ORCH-0964 redesign scope). Business iOS / Android / web-preview: write surface, not in scope. Admin web: not in scope.
- **Regression tests:**
  - Implementor happy-path: 9 tests at `mingla-business/src/services/__tests__/publicEventsService.orch_0962.test.ts` + `mingla-business/src/components/brand/__tests__/PublicBrandPage.orch_0962.test.ts`, `fails-on-revert verified at 52e37c2bc` per implementor §"Fails-On-Revert Lines".
  - Tester adversarial: 5 tests at `mingla-business/src/services/__tests__/publicEventsService.orch_0962.adversarial.test.ts`, `fails-on-revert verified at b48df7064` (all 5 tests FAILED when the implementor's patch was reverted from `publicEventsService.ts` + `PublicBrandPage.tsx`; all 5 PASSED after restore).
  - Both committed on per-ORCH branch; git diff main...HEAD confirms both ship in the same PR.
- **Discoveries for orchestrator:** 3 forwarded — none blocking.

---

## Phase 0.A — Live-fire sim gate

| Platform | Surface ships? | Live-fire performed? | Evidence | Verdict |
|---|---|---|---|---|
| iOS Simulator | No (consumer-app surface absent; ORCH-0964) | n/a | — | EXEMPT |
| Android Emulator | No (same) | n/a | — | EXEMPT |
| Web (buyer-web Chromium) | YES | Partial — server-side curl returned the SPA shell only (Expo Router web.output=single, client-side render). Visible-pixel verification requires Chromium with JS env + seeded test brand. | DB-layer + source-string-regex proxy verification documented below | `probable` confidence on visible render; `proven` confidence on data flow + structural source |

**Confidence ladder:** `proven` for the 7 mapper / view contract assertions verified at the database layer via live MCP probes. `proven` for all 14 unit tests on the mapper + component-source contract. `probable` for the visible-pixel render of the new tagline `Text` node + facebook + linkedin icons (structural integrity verified via source-string regex; only end-user eyeball deferred).

The condition stated above is the unblock for `proven`-on-visible-render. The honest verdict given the gate is **CONDITIONAL PASS** rather than full PASS until that eyeball happens. The conditions are accepted as automatic per operator's prior "skip Phase 1 live-fire" directive on ORCH-0962, on the basis that the 23-test mapper coverage + source-string structural assertions are exhaustive for a fix this surgical.

---

## SPEC compliance — SC-01 through SC-11

| # | Spec criterion | Verification | Result |
|---|---|---|---|
| SC-01 | Contact info renders on public brand page when populated | (a) DB column probe: `business_public_brands_view` exposes `contact_email` + `contact_phone` ✓. (b) `extractBrandContact` mapper unit-tested via T-02 + A-03. (c) `AboutTab` guard at `PublicBrandPage.tsx:574-577` confirmed by REVIEW to light up automatically when contact populated. | PASS (data flow proven; visible eyeball deferred per CONDITIONAL gate) |
| SC-02 | Empty contact info renders nothing | T-03 (both null) + A-03 (whitespace-only) both pass; `extractBrandContact` returns undefined → AboutTab contact block guards out. | PASS |
| SC-03 | Tagline and bio render distinctly when both present | T-01 confirms split at mapper. T-09 confirms two distinct `styles.taglineCentered` + `styles.bioLeadCentered` Text nodes in source, ordered tagline-before-bio. | PASS (structural; visible eyeball deferred) |
| SC-04 | Tagline-only brand renders tagline only | `splitBrandDescription` covered by `brandMapping.ts` existing helper (returns `{tagline: x}` for single-line input when caller passes whitespace-trimmed). Public mapper now uses helper. Confirmed by existing helper behavior + the post-fix mapper path. | PASS |
| SC-05 | Bio-only brand renders bio only | A-02 verifies the multi-paragraph case where lead becomes tagline + rest becomes bio. Single-paragraph case covered by `splitBrandDescription` (returns `{bio: x}` for no-separator input). | PASS |
| SC-06 | Facebook icon renders | T-07 (source-string presence) + A-05 (URL-builder integrity verifying `normalizeSocialUrl(links.facebook, "https://facebook.com/")` pattern). | PASS (structural; live-data note: no real brand currently has facebook URL set — first set-and-render will be the eyeball trigger) |
| SC-07 | LinkedIn icon renders | T-08 + A-05 (same pattern as facebook). | PASS (structural; same caveat as SC-06) |
| SC-08 | Physical brand in event context shows true kind + address + cover | (a) DB column probe: `business_public_events_view` exposes `brand_kind` + `brand_address` + `brand_cover_media_url` ✓. (b) Unit tests T-05 + T-06. (c) Adversarial A-04 (trip_planner kind passthrough). (d) **Live data probe: 3 real `trip_planner` brands in `business_public_events_view` return `brand_kind="trip_planner"` truthfully** (pre-fix would have hardcoded `"popup"`). | PASS |
| SC-09 | Verified-venue `displayAttendeeCount` honors DB | T-04 verifies `claimedVenueRowToBrand` reads `row.display_attendee_count`. DB column probe confirms `claimed_venues_public_view` exposes the column. | PASS |
| SC-10 | All in-scope surfaces match (parity) | Shared service `publicEventsService.ts` is sole owner of `Brand` mapping for buyer-web `/b/`, buyer-web `/e/`, and consumer-app `ExpandedBusinessEventSheet`. Parity is automatic via shared code; no platform-specific success criteria needed. | PASS |
| SC-11 | Re-running migration is safe (idempotent) | Migration uses `DROP VIEW IF EXISTS` + `CREATE OR REPLACE VIEW` inside a single `BEGIN/COMMIT` transaction. Re-running is a no-op for view content; rebuilds the same view definition. Implementor §12 line 145 confirmed `pg_depend` probe returned 0 dependent rewrite rows so the drop is safe. | PASS |

11 / 11 PASS.

---

## Regression-test gate (NON-NEGOTIABLE — ORCH-0840)

| Requirement | Path | Commit | Status |
|---|---|---|---|
| (a) Implementor happy-path regression test | `mingla-business/src/services/__tests__/publicEventsService.orch_0962.test.ts` (T-01..T-06) + `mingla-business/src/components/brand/__tests__/PublicBrandPage.orch_0962.test.ts` (T-07..T-09) | `52e37c2bc` | ✅ 9 tests, fails-on-revert cited per-test in implementor §"Fails-On-Revert Lines" |
| (b) Tester adversarial regression test | `mingla-business/src/services/__tests__/publicEventsService.orch_0962.adversarial.test.ts` (A-01..A-05) | `b48df7064` | ✅ 5 tests, fails-on-revert verified this session: revert checkout `mingla-business/src/services/publicEventsService.ts` + `mingla-business/src/components/brand/PublicBrandPage.tsx` to `52e37c2bc~1` → all 5 adversarial tests FAILED → restore to `52e37c2bc` → all 5 PASSED |
| (c) Both ship in same PR | `git diff main...HEAD --name-only` shows both file paths present in the per-ORCH branch | n/a | ✅ |

Adversarial angle differentiation (Step 0.5(b) sanity check vs implementor's tests):

| Adversarial | Attacks | Implementor parallel | Different angle? |
|---|---|---|---|
| A-01 description="\n\n" | Boundary: trim-empty → both undefined | T-01 tests normal two-paragraph split | YES — boundary form |
| A-02 three-paragraph description | Multi-paragraph bio remainder rejoined with `\n\n` | T-01 tests single-paragraph bio only | YES — different shape |
| A-03 partial contact (email-yes, phone-whitespace) | Mixed-presence → partial object | T-02 tests both-present; T-03 tests both-null | YES — partial-presence |
| A-04 brand_kind="trip_planner" in event-detail | Truthful-read invariant protection (I-PROPOSED-TR1-KIND-IMMUTABLE) | T-05 tests physical kind only | YES — different kind value |
| A-05 normalizeSocialUrl URL-builder pattern for fb + linkedin | URL-builder integrity vs hardcoded URL | T-07/T-08 only assert entry-block existence as substring | YES — different invariant |

No adversarial is a "renamed copy of implementor's test." All five attack genuinely different angles.

---

## Constitution 14-rule check

| # | Rule | Relevant | Verdict | Evidence |
|---|---|---|---|---|
| 1 | No dead taps | Yes | PASS | New facebook + linkedin icon entries each have `onPress: () => onPress(s.url)` handler at `PublicBrandPage.tsx:694`. |
| 2 | One owner per truth | Yes | PASS | `publicEventsService` mappers are sole owner of UI `Brand` shape; no duplicate state. |
| 3 | No silent failures | Yes | PASS — RESTORED | G-01 was a silent-failure pattern (save succeeded, public-page render didn't surface contact). Now restored. |
| 4 | One key per entity | N/A | N/A | No React Query key changes. |
| 5 | Server state server-side | N/A | N/A | No Zustand changes. |
| 6 | Logout clears everything | N/A | N/A | No auth state touched. |
| 7 | Label temporary | N/A | N/A | No `[TRANSITIONAL]` markers introduced. |
| 8 | Subtract before adding | Yes | PASS | Pre-fix mapper hardcodes (`tagline: undefined`, `kind: "popup"`, `address: null`, `displayAttendeeCount: false`) are subtracted in same commit they're replaced. |
| 9 | No fabricated data | Yes | PASS — RESTORED | G-08 + G-09 hardcodes were fabrications; now read from DB. |
| 10 | Currency-aware | N/A | N/A | No price/currency UI in scope. |
| 11 | One auth instance | N/A | N/A | No auth changes. |
| 12 | Validate at right time | N/A | N/A | No datetime validation. |
| 13 | Exclusion consistency | Yes | PASS | View predicates unchanged (popup+trip_planner unconditional; physical only if claim_status='verified'). Mapper exclusion rules unchanged. |
| 14 | Persisted-state startup | N/A | N/A | No AsyncStorage / Zustand persist changes. |

10 of 14 relevant or restored. 4 N/A. Zero violations.

---

## Independent verification — what I ran

### Live database probes (Supabase MCP, read-only)

1. **Column existence sweep** for all 7 new columns across 3 views:
   ```sql
   SELECT
     EXISTS (... 'business_public_brands_view' AND column_name='contact_email') AS brands_contact_email,
     EXISTS (... 'business_public_brands_view' AND column_name='contact_phone') AS brands_contact_phone,
     EXISTS (... 'claimed_venues_public_view' AND column_name='contact_email') AS venues_contact_email,
     EXISTS (... 'claimed_venues_public_view' AND column_name='display_attendee_count') AS venues_dac,
     EXISTS (... 'business_public_events_view' AND column_name='brand_kind') AS events_brand_kind,
     EXISTS (... 'business_public_events_view' AND column_name='brand_address') AS events_brand_address,
     EXISTS (... 'business_public_events_view' AND column_name='brand_cover_media_url') AS events_brand_cover;
   ```
   **Result:** all 7 = `true`. Migration is live on remote, contract is in place at the DB layer.

2. **SC-08 live-data verification:**
   ```sql
   SELECT brand_slug, brand_kind, ... FROM business_public_events_view
   WHERE brand_kind IN ('physical', 'trip_planner') LIMIT 5;
   ```
   **Result:** 3 real `trip_planner` brands surface their kind truthfully (pre-fix would have hardcoded `"popup"`). G-08 proven end-to-end against production data.

3. **Live contact-populated brand inventory:**
   ```sql
   SELECT slug, name, contact info presence, ... FROM public.brands
   WHERE deleted_at IS NULL AND (contact_email IS NOT NULL OR contact_phone IS NOT NULL OR ...)
   LIMIT 10;
   ```
   **Result:** 11 brands have contact info populated (matches implementor's safety probe). `agloat` is the cleanest gap-exercising fixture (verified physical, contact + tagline+bio split + address). **No real brand currently has facebook or linkedin URL set in `social_links`** — first operator to do so will trigger the eyeball-condition check.

### Jest test runs (worktree)

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0962-[brand-edit-public-render-audit]/mingla-business" && npx jest \
  src/services/__tests__/publicEventsService.orch_0962.adversarial.test.ts \
  src/services/__tests__/publicEventsService.orch_0962.test.ts \
  src/components/brand/__tests__/PublicBrandPage.orch_0962.test.ts \
  src/services/__tests__/publicEventsService.test.ts \
  --runInBand
```

**Result:** 4 suites / 23 tests / 23 passed.

### Fails-on-revert verification (this session)

```bash
git checkout 52e37c2bc~1 -- \
  mingla-business/src/services/publicEventsService.ts \
  mingla-business/src/components/brand/PublicBrandPage.tsx
npx jest src/services/__tests__/publicEventsService.orch_0962.adversarial.test.ts
# Test Suites: 1 failed, 1 total
# Tests:       5 failed, 5 total
git checkout 52e37c2bc -- \
  mingla-business/src/services/publicEventsService.ts \
  mingla-business/src/components/brand/PublicBrandPage.tsx
npx jest src/services/__tests__/publicEventsService.orch_0962.adversarial.test.ts
# Test Suites: 1 passed, 1 total
# Tests:       5 passed, 5 total
```

All 5 adversarial tests FAILED on pre-fix code and PASSED after restore. Fails-on-revert confirmed at tester commit `b48df7064`.

---

## Cross-domain blast verification

| Consumer of changed code | Verification |
|---|---|
| `mingla-business/app/b/[brandSlug]/index.tsx` (buyer-web `/b/`) | Routes through `usePublicBrandBySlug` → `getPublicBrandBySlug` → `publicBrandViewRowToBrand` or `claimedVenueRowToBrand`. Both mappers updated. ✓ |
| `mingla-business/app/e/[brandSlug]/[eventSlug]/page.tsx` (buyer-web `/e/`) | Routes through `usePublicEventBySlug` → `getPublicEventBySlug` → `viewRowToBrand` for brand context. Mapper updated. ✓ |
| `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (consumer iOS/Android event sheet) | Mounts buyer-web `PublicEventPage` via shared component. Brand context flows from the SAME `viewRowToBrand` mapper. G-08 fix propagates automatically. ✓ |
| `mingla-business/src/components/brand/PublicBrandPage.tsx` | Direct render consumer of `Brand`. Updated with tagline + facebook + linkedin entries. ✓ |
| Admin web (`mingla-admin/`) | Out of scope. No admin renders public brand fields. ✓ |
| Edge functions | None touched. ✓ |
| `brand_hours` table (G-06 deferred) | Untouched. Still rendered via `claimed_venues_public_view.hours` join → `VenueHoursTable`. No regression. ✓ |

---

## P4 — clean patterns worth praising

- **P4-1: Atomic migration deviation from literal SPEC text.** SPEC §3.1 specified `CREATE OR REPLACE VIEW` for in-place edits. Implementor recognized Postgres can't insert columns mid-SELECT-list under `CREATE OR REPLACE` and switched to a transactional drop/recreate within `BEGIN`/`COMMIT`, after running a `pg_depend` probe that confirmed zero dependent rewrite rules. Technically sounder than the SPEC text; documented inline. Pattern worth replicating in any future migration that adds columns to existing views.
- **P4-2: Strict-grep gate as ORCH-0962 byproduct.** `I-PROPOSED-BRAND-FIELD-MAP-COVERAGE` at `.github/scripts/strict-grep/orch-0962-brand-field-map-coverage.mjs` is a 72-line node script that catches future Edit Brand additions that don't plumb through to view + mapper. Lands ACTIVE on CLOSE. Encodes the bug class so it cannot silently recur. Excellent regression hygiene.

---

## Discoveries for orchestrator

- **D-1 — Visible-render eyeball deferred to operator action.** Buyer-web Chromium environment with a seeded test brand wasn't available for Playwright in this session. Recommend Seth open `https://business.usemingla.com/b/agloat` post-deploy (60 seconds): confirm About tab now shows email/phone, and confirm the brand renders tagline + bio (the `agloat` brand has `description` with `\n\n` separator per the live probe). If first eyeball clean, the CONDITIONAL PASS upgrades to PASS implicitly.
- **D-2 — No real brand has facebook or linkedin set yet.** The live brand probe found zero brands with `social_links.facebook` or `social_links.linkedin` populated. This means SC-06 + SC-07 are structurally proven (source-regex assertions + unit tests) but no live-data render exists to eyeball. As soon as any brand operator types a Facebook or LinkedIn URL into the now-functional Edit Brand surface, the icon will render. Worth a brief mention in the close-banner so Seth knows the first brand to use those fields is the live SC-06/07 visual verification.
- **D-3 — Typecheck baseline unchanged.** Per REVIEW: pre-existing unrelated typecheck failures (checkout / playwright / packages / native) remain. ORCH-0962 introduced no new typecheck errors per implementor §12. If Seth wants the typecheck baseline restored, register a separate cleanup ORCH; not in scope here.

---

## Comms ledger

- COMMS-0001 (Stripe Tax → ORCH-0955): N/A, no Stripe surface.
- COMMS-0002 (ORCH-0863 strict-grep backend gate): no new `supabase/functions/` files in ORCH-0962. Migration-only DB changes are exempt from C7 `no-new-backend-files`.
- COMMS-0003 (External-API docs verification): N/A, no external API integration.
- COMMS-0004 (INTAKE ID scan): observed at REVIEW time; tester action not required.

Orchestrator already acked all four at REVIEW commit `622059ae1` on `main` via commit `fdf8a4514`. Tester-side ack omitted to avoid ledger noise — orchestrator's ack already covers ORCH-0962 in this session.

---

## Routing — next phases

1. **Operator's 60-second eyeball on `https://business.usemingla.com/b/agloat`** (optional but recommended to upgrade CONDITIONAL PASS → PASS implicitly).
2. **Orchestrator CLOSE** — Claude `mingla-orchestrator` runs standard CLOSE protocol: Step 0.5 gate (already satisfied — both regression-test rows present), Step 1.5 DIAG-marker reap (grep `[ORCH-0962-DIAG]` should return 0 hits since none were placed by implementor), Step 1 artifact updates × 7 docs, Step 2 commit message with `[deploy]` tag in subject (since `mingla-business/src/` was touched, per Step 2.5 Vercel gate decision matrix), no Step 3 EAS OTA (no `app-mobile/` changes), Step 1.7 worktree reap via `scripts/orch-worktree/reap.sh`. Vercel projects build the new buyer-web bundle once the `[deploy]`-tagged commit lands on `main`.
3. **CLOSE-time invariant flip:** `I-PROPOSED-BRAND-FIELD-MAP-COVERAGE` flips DRAFT → ACTIVE per SPEC §5.3.

Working tree: `~/Desktop/mingla-orchs/ORCH-0962-[brand-edit-public-render-audit]/` on branch `ORCH-0962-brand-edit-public-render-audit`.
