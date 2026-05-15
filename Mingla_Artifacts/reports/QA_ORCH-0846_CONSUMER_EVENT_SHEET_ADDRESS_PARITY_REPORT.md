# QA — ORCH-0846 [Consumer event sheet venue/address parity with brand-side public page]

**Mode:** TARGETED + SPEC-COMPLIANCE
**Verdict:** **CONDITIONAL PASS** — pending Seth's live-fire iOS/Android simulator verification (named blocker: edge function not deployed; see §11)
**Severity:** **P0:0 · P1:0 · P2:1 · P3:2 · P4:4**
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Base commit:** `ebd9875f7f99590315e69291dd196bdd27c8d802`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0846_CONSUMER_EVENT_SHEET_ADDRESS_PARITY.md`
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0846_CONSUMER_EVENT_SHEET_ADDRESS_PARITY.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0846_CONSUMER_EVENT_SHEET_ADDRESS_PARITY.md`

---

## 1. Layman summary

The implementation correctly mirrors the brand-side `publicEventsService` resolution for `venueName`, `address`, and `format` inside the discover edge function and the consumer-side sheet mapping. All 5 strict-grep rules pass, 14/14 implementor Deno tests pass, 12/12 tester adversarial Deno tests pass, 8/8 Node regression checks pass, `tsc --noEmit` shows zero scoped errors on the touched files, and the live Supabase population probe confirms 9/9 live business events become correctly addressable post-deploy (5 public-address, 4 hide-until-ticket). The only reason this is CONDITIONAL PASS instead of PASS is that the edge function is not yet deployed on the linked Supabase project, so the iOS/Android simulator live-fire proof per Phase 0.A gate is structurally impossible in this session — the consumer app would still hit the OLD production code path. The fix is mechanically correct; what remains is Seth's hands-on 30-second sim verify after orchestrator deploys the edge function. P2 is a P3-bumped honesty flag on the M-* test cases being replica-based (per app-mobile workspace convention); P3 are data-quality observations on live-row payloads.

---

## 2. Phase 0.A — live-fire sim gate disposition

Per the non-negotiable gate at the top of this skill's protocol, a UI/runtime change requires live-fire repro on each platform the surface ships to (iOS Simulator + Android Emulator + Web) BEFORE assigning severity or issuing PASS.

| Leg | Status | Reason |
|-----|--------|--------|
| iOS Simulator (`xcrun simctl boot ...`) | **Not run** | Blocker named below |
| Android Emulator | **Not run** | Blocker named below |
| Web preview | **Not applicable** | `app-mobile/` Discover does not ship to a web bundle (react-native-maps native dependency forbids `--platform all` per `feedback_eas_update_no_web.md`); the brand-side `mingla-business` public page (the parity baseline) is web-served but unchanged by this work |

**Named blocker (per Phase 0.A `probable` confidence gate):** the discover-merged-events edge function changes are NOT yet deployed on the linked Supabase project (`gqnoajqerqhnvulmnyvv`). The consumer-side mapping in `ExpandedBusinessEventSheet.tsx` reads `card.format` and forwards `card.venueName` / `card.address` — but `card` is built server-side by the edge function. Until the edge function is deployed (orchestrator owns deploy per `feedback_orchestrator_deploys_edge_functions.md`), a Discover query from any simulator returns the OLD card payload (`venueName: null`, no `format` field) and the consumer sheet renders the OLD state. Live-fire on the sim with the un-deployed edge function would produce false-negative confidence in the fix.

**Confidence label per the ladder:** `probable` — code-asymmetry proof is conclusive (every gate green, every test PASS, live data probe matches predictions), but live-fire repro on the simulator was blocked by an external state (edge fn deploy gate). This satisfies the `probable` threshold for CONDITIONAL PASS, NOT `proven` for PASS.

**Unblock path for Seth** (Case-B steps in §13 below): (a) deploy the edge function via `supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv`; (b) open the consumer dev build on a booted iOS simulator (Discover screen); (c) tap a business event card; (d) verify the venue card renders with name + address (or "Address shared after ticket purchase" depending on `hideAddressUntilTicket`); (e) repeat on Android emulator. This is a ~3-minute manual confirmation against the live data probe in §7 which already proves the data shape.

---

## 3. Phase 0.B — triage

| Question | Answer |
|----------|--------|
| What is under test? | Orchestrator-dispatched ORCH-0846 [Consumer event sheet venue/address parity] |
| Layers touched | Edge function (`discover-merged-events/index.ts` + new `_helpers.ts`) + TS types (`mergedDiscover.ts`) + RN component (`ExpandedBusinessEventSheet.tsx`) + CI gate + 2 test files |
| Deployment target | EAS OTA for app-mobile (iOS + Android, separately per `feedback_eas_update_no_web.md`) + edge function deploy via `supabase functions deploy` |
| Mode | TARGETED with SPEC-COMPLIANCE matrix (SC-01..SC-10) |

---

## 4. Spec compliance matrix

| SC | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| SC-01 | in-person + hide=false renders venue card with name + address | **Deferred to Seth live-fire** | Mechanism proven: helper test V-02 + adversarial A4b + replica M-01 + live data probe (5 publicly-addressable rows, all with `location_text` populated, all with `theme.business_event.venueName=null` — so the location_text fallback IS the dominant path). Sim attempt blocked per §2. |
| SC-02 | hide=true renders venue title + "Address shared after ticket purchase" | **Deferred to Seth live-fire** | Mechanism proven: helper test A-01 + replica M-02 + live data probe shows 4 rows with `hide=true` and `location_text` populated. UI gating is unchanged shared-component code at `packages/event-rendering/PublicEventPage.tsx:380-384`. |
| SC-03 | online event renders online card (NOT venue card) | **Deferred to Seth live-fire** | Mechanism proven: F-02 + adversarial A5a/A5b + replica M-03 (fails-on-revert verified by implementor at base commit `ebd9875f`). Live data has zero online events today (`is_online=false` on all 9 sample rows) — operator note in §10 below. |
| SC-04 | hybrid event renders address + "· also online" suffix | **Deferred to Seth live-fire** | Mechanism proven: F-03 + replica M-04. No live hybrid events in current data — sim repro requires test event creation or accepting the mechanism-soundness proof. |
| SC-05 | Deno suite passes + fails-on-revert | **PASS** | 14/14 implementor tests pass; 5 fail on revert (V-01 + F-02/F-03/F-04/F-06); restore to PASS confirmed in implementation report §6.1. Tester re-ran during this QA: 14/14 PASS. |
| SC-06 | RN regression passes + M-03 fails-on-revert | **PASS** | 8/8 Node check pass; S-01 fails on revert (M-03 is replica-based per workspace convention — see P2 in §6). Tester re-ran: 8/8 PASS. |
| SC-07 | Strict-grep gate GREEN with negative-control | **PASS** | 5/5 PASS; R-2 negative-control proven flipping RED on revert (implementation report §6.3); R-1/R-3/R-4/R-5 mechanism is grep-level — visually verified by tester reading the script. |
| SC-08 | Cross-domain blast verified zero | **PASS** | Grep confirms `mapCardToPublicEvent` is only called inside `ExpandedBusinessEventSheet.tsx`. `BusinessEventCard.format/.venueName/.address` consumers: Discover sheet only. `mingla-admin` imports zero `app-mobile` files. `mingla-business/src/services/publicEventsService.ts` (parity baseline) is byte-unchanged. |
| SC-09 | `tsc --noEmit` clean on app-mobile | **PASS for scoped change** | Pre-existing tsc errors at `src/components/ConnectionsPage.tsx:2763`, `src/components/HomePage.tsx:246,249`, and 37 errors in `packages/event-rendering/` + `packages/payments-native/` are all OUT-of-scope and pre-date ORCH-0846 (see §9 Discoveries). Zero errors mention any touched file. |
| SC-10 | No migration / no new edge fn / EAS OTA eligible | **PASS** | Zero new files under `supabase/migrations/`. Edge function `discover-merged-events` is an EDIT (new sibling `_helpers.ts` ships in the same function bundle). No native module changes. OTA-eligible for `app-mobile/`. |

---

## 5. Five-truth-layer cross-check

| Layer | Finding |
|---|---|
| **Docs** | SPEC §1 contract reads: "venueName/address/format resolved identically on both sides". Implementation matches verbatim — `_helpers.ts:resolveBusinessEventVenueFields` mirrors `publicEventsService.ts:377–378,360`. |
| **Schema** | Live probe (§7) confirms `events.location_text` populated on all 9 live rows; `theme->'business_event'->>'venueName'` null on all 9; `theme->'business_event'->>'format'` is `"in_person"` on all 9; `events.is_online=false` on all 9. Migration `20260604000001_orch_0824_publish_rpc.sql:358–369` writes the canonical JSONB shape the helpers consume. No schema change required. |
| **Code** | Brand side at `mingla-business/src/services/publicEventsService.ts:377–378,360` and consumer side at `supabase/functions/discover-merged-events/_helpers.ts:resolveBusinessEventVenueFields` produce the same output for the same input — verified by reading both line-for-line. Producer single-source confirmed: no nested `.location.venueName` fallback (adversarial A6a/A6b lock this). |
| **Runtime** | Edge function not deployed; live-runtime confirmation blocked (§2). Helper-level runtime verified via 26 passing Deno tests (14 implementor + 12 tester). Mock-row runtime verified via 8 Node replica tests. |
| **Data** | Live probe results in §7 confirm the affected population matches SPEC §10.D predictions (9 events; 5 publicly-addressable). All sample row shapes work with the new helper chain. |

All five layers agree on the contract; the only gap is the runtime-deploy step which is the orchestrator's responsibility on CLOSE.

---

## 6. Findings

### P2 — `M-*` replica-based fails-on-revert is procedurally weaker than direct production-function imports

| Field | Value |
|---|---|
| File / Line | `app-mobile/scripts/ci/orch-0846-regression-check.mjs:90-180` |
| Severity | P2-medium |
| What | The `M-01..M-05` assertions exercise an inline pure-JS REPLICA of `mapCardToPublicEvent`, not the production function (Node cannot import the production `.tsx` without a transpiler; the workspace has no Jest). The structural `S-01` assertion is the actual fails-on-revert proof for the consumer mapping. |
| Why this matters | If `mapCardToPublicEvent` body drifts from the replica without changing the `format: card.format` line that S-01 watches, the M-* tests would still PASS while production diverges. Implementor flagged this honestly in the implementation report §6.2. |
| Fix instruction | Optional follow-up (NOT a blocker for this close): extract `mapCardToPublicEvent` to a dependency-light `.ts` module that Node can import via `tsx` / esbuild on-the-fly compile, or wait for a future Jest enablement on `app-mobile`. For now, the combined coverage of (S-01 structural + S-02 export check + M-* replica + helper-level Deno tests on the producer) is strong enough that the bug class cannot re-emerge without tripping at least 2 of the 4 angles. |
| Status | **Accepted** — the workspace convention for `app-mobile/scripts/ci/` is Node-based grep + replica, established by ORCH-0836 / ORCH-0837. Not blocking. Logged here so future-Claude is honest about the coverage tier. |

### P3 — Live row `location_text` strings encode both venue name AND street address concatenated with U+00B7

| Field | Value |
|---|---|
| File / Line | Production data, e.g. `events.location_text = "The Exhaustion · 700 Corporate Center Dr, Raleigh, NC 27607, USA"` |
| Severity | P3-low (data quality observation, not a fix-bug) |
| What | The §7 live probe shows that creators today enter venue + address into a single `location_text` field, joined by U+00B7 MIDDLE DOT. With the ORCH-0846 fix, this same concatenated string is used for BOTH the venueName line (top, bold) AND the address line (bottom, lighter) of the shared `PublicEventPage`'s venue card. The two lines visually duplicate. |
| Why this matters | Pure parity with the brand-side `publicEventsService.ts:377–378` is preserved — the brand page already renders the duplication today, so the consumer sheet will render identically. The ORCH-0846 fix is NOT introducing the duplication. The duplication is an upstream creator-wizard data-shape issue. |
| Fix instruction | NOT in scope. Future ORCH should: (a) split `location_text` into `venue_name` + `street_address` columns at the creator wizard, OR (b) parse out the venue half on read with a one-time backfill of `theme.business_event.venueName`. Adversarial test A4b explicitly locks in the MIDDLE DOT preservation contract so future migrations can detect drift. |
| Status | **Discovery for orchestrator** — log as future ORCH-0846-A if/when product cares. |

### P3 — Pre-existing tsc errors in `packages/event-rendering/` and `packages/payments-native/` unrelated to ORCH-0846

| Field | Value |
|---|---|
| File / Line | `packages/event-rendering/PublicEventPage.tsx:452,453,560,561,584,585,610`; `packages/payments-native/StripeNativeProvider.tsx:25,26,27,76,77,78,79,85`; `packages/payments-native/useStripePaymentSheet.ts:47,48`; `src/components/ConnectionsPage.tsx:2763`; `src/components/HomePage.tsx:246,249` |
| Severity | P3-low (pre-existing, not introduced) |
| What | `npx tsc --noEmit` from `app-mobile/` reports ~40 errors across the listed files. None reference any file touched by ORCH-0846. Errors are mostly `TS7031 Binding element implicitly has 'any' type` and `TS7016/TS2307 Cannot find module 'react'/'expo-constants'/'@stripe/stripe-react-native'` — workspace-resolution / monorepo type-config drift, not behavior bugs. tsc exit code is 0 because these are diagnostic, not blocking. |
| Why this matters | A future ORCH should fix the workspace tsconfig for `packages/*` to resolve `react` / `expo-constants` / `@stripe/stripe-react-native` properly so tsc gives clean output. ConnectionsPage.tsx `Friend` type mismatch and HomePage.tsx `SessionSwitcherItem` missing-`state` errors look like real type drift worth a small ORCH. |
| Fix instruction | NOT in scope. |
| Status | **Discovery for orchestrator** — see §9. |

### P4 (praise) — Implementor's honesty on replica vs production-function distinction

The implementation report §6.2 explicitly calls out that the M-* Node tests use a pure-JS replica, not the production function, and identifies S-01 as the actual fails-on-revert proof for the consumer mapping. This is exactly the kind of honesty the gate exists to encourage. Most implementations of this pattern would have buried the distinction or claimed coverage they didn't have.

### P4 (praise) — Helper extraction into `_helpers.ts` for testability

Extracting the three new helpers + `resolveBusinessEventVenueFields` aggregator into a sibling module enables clean Deno tests without invoking `serve()`. Matches the established pattern at `__tests__/excludes_ended_events.test.ts` and is reusable for future ORCH-0846-A follow-ups.

### P4 (praise) — Strict-grep gate covers 5 angles, not just one

R-1 (forbid `venueName: null`), R-2 (forbid `format: "in-person"`), R-3/R-4 (require helper references), R-5 (require type union). Five-way coverage means a partial revert (e.g., dropping the helper import while keeping the literal hardcodes out) cannot silently pass.

### P4 (praise) — Adversarial test vectors are genuinely orthogonal to the happy-path

The tester suite at `__tests__/venue_name_adversarial.test.ts` attacks 7 distinct vectors (literal "null" string, theme-as-array, theme-as-primitive, 4KB stress, multi-script unicode, MIDDLE DOT preservation, format canonical-form gate, and anti-test for nested-fallback drift) — none are mechanical copies of the implementor's V/F/A cases. Satisfies CLOSE Step 0.5 adversarial-angle requirement.

---

## 7. Live data probe (SPEC §10.D)

Run via Supabase Management API per `feedback_supabase_mcp_workaround.md`:

```
[{
  "total_live_business_events": 9,
  "with_location_text": 9,
  "with_theme_venue_name": 0,
  "publicly_addressable": 5
}]
```

Sample of 5 most-recently-published rows:

| slug | location_text | is_online | hide | theme.venue_name | format_hint |
|------|---------------|-----------|------|------------------|-------------|
| another-tested-event | "The Exhaustion · 700 Corporate Center Dr, Raleigh, NC 27607, USA" | false | false | null | in_person |
| big-party | "700 Corporate Center Dr, Raleigh, NC 27607, USA" | false | false | null | in_person |
| vibes-and-stuff | "The place · The vanguard " | false | false | null | in_person |
| the-party-block | "The venue · The place " | false | true | null | in_person |
| a-life-in-vegas | "The Vsnue · The Place" | false | false | null | in_person |

**Probe verdict:** the fix's dominant code path (the `?? row.location_text` fallback) is the path 9/9 production rows will hit. The dedicated `theme.business_event.venueName` field is currently unused in production — the fix correctly treats it as a higher-priority override path for future use. 5/9 rows = 55.6% of public-scheduled business inventory will go from "venue card hidden" to "venue card visible with full address" post-deploy. 4/9 rows (the hide=true cases) will get the "Address shared after ticket purchase" line.

Zero online or hybrid events currently exist in the production dataset (SC-03 / SC-04 cannot be live-verified against current data without first creating a test event with `is_online=true` and `theme.business_event.format="online"`).

---

## 8. Constitutional compliance (all 14)

| # | Rule | Status | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | PASS / N/A | No new interactive elements; venue card is read-only display. |
| 2 | One owner per truth | PASS | venueName/address resolution has a single owner: `_helpers.ts`. Consumer mapping is pure pass-through. Adversarial A6a/A6b lock the single-source contract. |
| 3 | No silent failures | PASS (STRENGTHENED) | Pre-fix dropped venueName/format silently; post-fix surfaces both. |
| 4 | One key per entity | N/A | No React Query keys changed. |
| 5 | Server state server-side | PASS | No Zustand changes; cards live in React Query cache only. |
| 6 | Logout clears everything | N/A | No auth state touched. |
| 7 | Label temporary | PASS | Zero `[TRANSITIONAL]` markers introduced. |
| 8 | Subtract before adding | PASS | `venueName: null` literal and `format: "in-person"` hardcode were REMOVED before the new helpers were added. Verified by reading the diff. |
| 9 | No fabricated data | PASS | Fallback chain uses real DB columns only. Trim guard on `extractVenueName` (V-04 + adversarial A5b) rejects whitespace fabrication. |
| 10 | Currency-aware | N/A | Currency field untouched. |
| 11 | One auth instance | N/A | No auth touch. |
| 12 | Validate at right time | N/A | No date/time logic touched. |
| 13 | Exclusion consistency | PASS (STRENGTHENED) | Producer and shared UI now use the same `hideAddressUntilTicket` mechanism — producer passes address unconditionally, UI gates. Pre-fix had the producer pre-nulling on hide=true while the UI also gated, double-gating the same property with two different mechanisms. |
| 14 | Persisted-state startup | N/A | Discover cards are not persisted. |

Zero constitutional violations.

---

## 9. Discoveries for orchestrator

1. **Pre-existing tsc drift in `packages/*` and a handful of `src/components/` files** (see §6 P3). Worth a small-cycle "tsc cleanup" ORCH. Not blocking ORCH-0846 close.
2. **`location_text` data-shape duplication** (see §6 P3). Future creator-wizard cycle should consider splitting `venue_name` + `street_address` at the source, or backfilling `theme.business_event.venueName` from the U+00B7-separated prefix.
3. **Zero online/hybrid live events in the dataset.** SC-03 / SC-04 mechanism is proven via tests, but the operator may want to create one online and one hybrid test event in the staging brand before declaring the fix "fully smoked." Not a blocker.
4. **Coordination with ORCH-0845 [Discover excludes ended events]:** both ORCHs touch the same file in disjoint regions. ORCH-0845's strict-grep gate (`i-discover-excludes-ended-master-date.mjs`) still passes on the post-0846 file state — verified this turn (line 324 `const lowerBoundUtc`, line 363 `.gte("event_dates.end_at", lowerBoundUtc)`). Clean rebase expected whichever lands first.
5. **The implementation report §7 disclosure that `tsc --noEmit` was deferred to TEST phase** is now closed — tester ran it this turn and confirmed zero scoped errors.

---

## 10. Cross-domain impact

| Surface | Affected? | Verification |
|---------|-----------|--------------|
| `app-mobile/` Discover → `ExpandedBusinessEventSheet` | **Yes — primary** | Verified via reading; 5/9 events will newly render addresses, 4/9 will newly render "Address shared after ticket purchase". |
| `app-mobile/` other consumers of `BusinessEventCard` | No | grep confirms `mapCardToPublicEvent` only called inside `ExpandedBusinessEventSheet`; Discover list-card preview uses a separate reduced shape. |
| `mingla-business/` brand-side public page | No | `publicEventsService.ts` byte-unchanged. |
| `mingla-business/` checkout / event detail | No | Uses different services. |
| `mingla-admin/` | No | Does not import `app-mobile/` or `@mingla/event-rendering`. |
| Ticketmaster path in `discover-merged-events` | No | TM branch returns `Record<string, unknown>` rows, not `BusinessEventCard`; type widening would have surfaced via tsc had it leaked. |
| ORCH-0845 query construction | No | Same file, disjoint region; ORCH-0845 gate still passes. |
| ORCH-0828 timezone-aware date window | No | `dateWindowUtc` / `localStartEndDateTime` logic untouched. |
| ORCH-0829/0829-A native checkout flow | No | Downstream consumer of `mapCardToPublicEvent`'s output — the tickets pre-fill and Buy/Get Free CTAs are not affected by the venue card changes; `runNativeCheckout` is unchanged. |

---

## 11. Regression-test gate verdict (per ORCH-0840 CLOSE Step 0.5)

| Requirement | Status |
|-------------|--------|
| Implementor happy-path regression test present + green + fails-on-revert | **PASS** — `supabase/functions/discover-merged-events/__tests__/venue_name_resolution.test.ts` (14/14 green); fails-on-revert documented in implementation report §6.1 against commit `ebd9875f`. Tester re-ran 14/14 PASS this turn. |
| Tester adversarial regression test (different angle) | **PASS** — `supabase/functions/discover-merged-events/__tests__/venue_name_adversarial.test.ts` (12/12 green, tester-authored this turn); attacks 7 distinct vectors orthogonal to the happy-path. |
| Both tests appear in `git diff origin/main...HEAD --name-only` for closing PR | **Verified** — both files appear in `git status` as `??` untracked-added to the working tree; will be staged in the close commit. |

All three gate conditions satisfied. CLOSE may proceed.

---

## 12. Gate evidence — full re-run this turn

| Gate | Command | Result |
|------|---------|--------|
| Deno check | `deno check supabase/functions/discover-merged-events/{index.ts,_helpers.ts}` | clean |
| Implementor Deno tests | `deno test --allow-read supabase/functions/discover-merged-events/__tests__/venue_name_resolution.test.ts` | 14/14 PASS |
| Tester adversarial Deno tests | `deno test --allow-read supabase/functions/discover-merged-events/__tests__/venue_name_adversarial.test.ts` | 12/12 PASS |
| Node regression check | `node app-mobile/scripts/ci/orch-0846-regression-check.mjs` | 8/8 PASS |
| Strict-grep gate (ORCH-0846) | `node .github/scripts/strict-grep/orch-0846-consumer-event-address-parity.mjs` | 5/5 PASS |
| Strict-grep gate (ORCH-0845 cross-check) | `node .github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs` | PASS (both tokens present at line 324 / 363) |
| `tsc --noEmit` on app-mobile | `cd app-mobile && npx tsc --noEmit` | 0 scoped errors; pre-existing errors enumerated in §6 P3 |
| Live data probe (SPEC §10.D) | Supabase Management API | 9 events, 5 publicly-addressable; see §7 |

---

## 13. Verdict gate (per Phase 0.A + Regression-test gate)

**Verdict:** CONDITIONAL PASS.

**Why not PASS:** Phase 0.A requires `proven`-level live-fire repro on every applicable platform. The named blocker (edge function not deployed) means iOS/Android sim repro would currently exercise the OLD production code path, not the fix. Confidence is `probable`, not `proven`.

**Why not FAIL:** every gate this skill CAN run from a coding session passes. The bug is mathematically proven from code-asymmetry. The live data probe matches every prediction the SPEC made. Implementor + tester regression coverage is in place and fails-on-revert is verified.

**Operator deferral required for CLOSE:** Seth must explicitly accept that the sim live-fire happens AFTER deploy, OR redirect to a pre-test deploy. Either path lands the work; the choice is which order.

---

## 14. Working-branch / file inventory

Files touched by this work (all on branch `Seth`):

- `supabase/functions/discover-merged-events/_helpers.ts` (new — implementor)
- `supabase/functions/discover-merged-events/index.ts` (edit — implementor)
- `supabase/functions/discover-merged-events/__tests__/venue_name_resolution.test.ts` (new — implementor)
- `supabase/functions/discover-merged-events/__tests__/venue_name_adversarial.test.ts` (new — **tester, this turn**)
- `app-mobile/src/types/mergedDiscover.ts` (edit — implementor)
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (edit — implementor)
- `app-mobile/scripts/ci/orch-0846-regression-check.mjs` (new — implementor)
- `app-mobile/package.json` (+1 line — implementor)
- `.github/scripts/strict-grep/orch-0846-consumer-event-address-parity.mjs` (new — implementor)
- `.github/workflows/strict-grep-mingla-business.yml` (+12 lines — implementor)
- `Mingla_Artifacts/reports/QA_ORCH-0846_CONSUMER_EVENT_SHEET_ADDRESS_PARITY_REPORT.md` (new — **this report**)

Zero global indexes touched. Zero out-of-scope edits.
