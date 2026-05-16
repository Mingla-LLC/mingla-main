# QA REPORT — ORCH-0848 [Tickets-section toggle parity with Active accordion]

**Verdict:** CONDITIONAL PASS (pending operator live-fire sim confirmation)
**Severity counts:** P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 2
**Mode:** TARGETED (RETEST not needed — first pass)
**Branch:** `Seth` at `/Users/sethogieva/Desktop/mingla-main`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0848_TICKETS_TOGGLE_PARITY.md`
**Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0848_TICKETS_TOGGLE_PARITY.md`

## Summary (layman terms)

The Tickets header in the Likes → Calendar tab now matches Active and Archive — tappable, chevron, count, defaults expanded, hidden when empty. The implementation is a textbook mirror of an already-production-proven pattern. Both the implementor's structural test (7/7) and my adversarial behavioural test (14/14) pass on the fix and fail on revert. The CONDITIONAL is purely procedural: per Phase 0.A live-fire-sim gate, a UI/runtime change requires `proven`-level repro on iOS sim + Android emulator. Seeding a real paid business-event order to populate `businessOrders` in a sim session is non-trivial test data (Stripe-backed order), so I'm asking Seth to run the smoke test on a real account that already has a ticket — three tap-and-look steps, ~30 seconds.

## Phase 0.A — Live-fire sim gate evidence

| Platform | Surface ships? | Status | Notes |
|---|---|---|---|
| iOS Simulator | YES (Mingla mobile) | **probable — blocked: test data** | Sim `17091E60-C3B6-4167-980D-60C348E177F6` (iPhone 17 Pro, iOS 26.4) BOOTED. `com.mingla.app.v2` installed. Toggling requires `businessOrders.length > 0` — i.e., a logged-in user with at least one paid Stripe-backed ticket. No fixture path exists in the codebase to seed this; live-fire deferred to Seth (Case-B steps below). |
| Android Emulator | YES (Mingla mobile) | **probable — blocked: test data** | `emulator-5554` attached. Same blocker as iOS. |
| Web Preview | NO | exempt | Mingla mobile (consumer app) ships React Native only — no web bundle. `react-native-maps` blocks expo web. |

Confidence ladder: **probable** (sim attempt made, blocker named). Source-only ceiling would be `suspected`; this is one level above because the sim is up and the binary is installed — only the data state blocks the repro.

## Five-truth-layer cross-check

| Layer | Finding | Status |
|---|---|---|
| Docs (spec) | Dispatch at `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0848_TICKETS_TOGGLE_PARITY.md` enumerates 6 success criteria | Verified |
| Schema | No DB change. `orders` + `tickets` tables and `useBusinessEventOrders` hook untouched | Verified clean |
| Code | `app-mobile/src/components/activity/CalendarTab.tsx` — read [lines 118-120](app-mobile/src/components/activity/CalendarTab.tsx#L118-L120) (state init), [lines 1767-1796](app-mobile/src/components/activity/CalendarTab.tsx#L1767-L1796) (new Tickets accordion), [lines 1798-1825](app-mobile/src/components/activity/CalendarTab.tsx#L1798-L1825) (Active reference). Tickets header is a verbatim mirror except for the i18n literal (hardcoded `"Tickets"` vs `t('activity:calendarTab.active')`) — dispatch explicitly carved out i18n | Verified |
| Runtime | Live-fire deferred per Phase 0.A. Behavioural reducer extracted and exercised in adversarial test (B-01..B-09) — proves state machine is correct under all toggle sequences including double-press, triple-press, cross-section independence, and inversion resistance | Verified via simulation |
| Data | No data writes/reads changed — pure presentation | N/A |

No contradictions across layers.

## Constitution compliance (14 rules)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | New header has functional onPress + activeOpacity 0.7 |
| 2 | One owner per truth | PASS | `expandedAccordionItems` is sole owner of accordion expansion state (shared with Active + Archive) |
| 3 | No silent failures | PASS | No try/catch added or modified |
| 4 | One key per entity | N/A | No React Query keys changed |
| 5 | Server state server-side | PASS | `expandedAccordionItems` is local UI state — appropriate Zustand-style local hook |
| 6 | Logout clears everything | N/A | Component unmounts on logout; state is local |
| 7 | Label temporary | N/A | No `[TRANSITIONAL]` markers |
| 8 | Subtract before adding | PASS | Dead `businessEventSection` + `businessEventHeader` styles removed |
| 9 | No fabricated data | PASS | Count rendered from `businessOrders.length` |
| 10 | Currency-aware | N/A | No currency display |
| 11 | One auth instance | N/A | No auth touch |
| 12 | Validate at right time | N/A | No datetime |
| 13 | Exclusion consistency | N/A | No filter logic changed |
| 14 | Persisted-state startup | N/A | Local state, no AsyncStorage |

All 14 rules verified or genuinely N/A.

## Regression test verification

| Test | Path | Result on fix | fails-on-revert |
|---|---|---|---|
| Implementor (structural grep) | `app-mobile/scripts/ci/orch-0848-regression-check.mjs` | 7/7 PASS | Implementor cited fails-on-revert at commit `4a0b4b5c`; **I independently re-verified** by `git stash` at HEAD (`8500d399`): 1/7 PASS, 6/7 FAIL. Restored to 7/7 after `git stash pop`. |
| Tester (adversarial) | `app-mobile/scripts/ci/orch-0848-adversarial-check.mjs` | 14/14 PASS | Verified by `git stash` at HEAD (`8500d399`): 10/14 PASS, 4/14 FAIL on revert (P-01 visual-parity style refs, P-02 chevron size/color drift, P-03 activeOpacity drift, G-01 dead-styles re-emergence). The behavioural B-01..B-09 still pass on revert because they exercise the extracted reducer logic which is identical to Active/Archive — that's intentional: behaviour B-* tests state-machine correctness, while P-* / G-* test production source. The combination distinguishes 14/14 vs 10/14. |

**Adversarial different-angle proof:** the implementor test is pure source-grep ("does the file contain these literals?"). My test attacks **runtime behaviour** by extracting the toggle reducer as a pure function and exercising it across single-press, double-press, triple-press, three cross-section independence checks, and an inversion-resistance check. It also tightens visual-parity from "uses `styles.accordionHeader`" to "uses all 4 canonical accordion style refs + identical chevron props + identical activeOpacity" — catching bugs like a partial revert that leaves `styles.accordionHeader` in place but reverts the chevron props.

Both tests appear in `git diff origin/main...HEAD --name-only` once the closing PR is opened.

Registered as `npm run test:orch-0848` and `npm run test:orch-0848-adv` in `app-mobile/package.json`.

## Spec traceability

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Tickets header tappable + chevron + defaults expanded | PASS | S-01, S-02, S-05, B-01, B-09 |
| 2 | Tapping Tickets toggles only its own rows; Active/Archive unaffected | PASS (simulated) | B-05, B-06, B-07. Live-fire deferred. |
| 3 | When `businessOrders.length === 0` no Tickets header appears | PASS (source-verified) | S-06, G-02. Cannot test runtime without test data — deferred. |
| 4 | Visual diff vs Active header: identical styles/chevron/count format | PASS | P-01 (4 style refs), P-02 (size + color), P-03 (activeOpacity). Source diff confirms only difference vs Active is hardcoded `"Tickets"` literal vs `t('activity:calendarTab.active')` — i18n explicitly out of scope per dispatch |
| 5 | TypeScript clean | PASS | `npx tsc --noEmit` shows zero new errors at CalendarTab.tsx (pre-existing errors in ConnectionsPage.tsx, HomePage.tsx, packages/event-rendering unrelated and present on origin/main) |
| 6 | Regression test with fails-on-revert | PASS | Both tests + tester-independent fails-on-revert verification, cited above |

All 6 criteria satisfied at source level. Criterion 2 and 3 carry the deferred-live-fire CONDITIONAL.

## Cross-section parity check (the dispatch's key risk)

Per the dispatch's "regression surface" call-out: confirmed by source read at [lines 1798-1849](app-mobile/src/components/activity/CalendarTab.tsx#L1798-L1849) (Active) and [1851-1903](app-mobile/src/components/activity/CalendarTab.tsx#L1851-L1903) (Archive):

- Active onPress logic identical except for `"active"` key
- Archive onPress logic identical except for `"archive"` key
- All three sections share the same `expandedAccordionItems` state setter
- Adversarial B-05/B-06/B-07 prove the three reducer instances are independent (toggling one cannot mutate the other two's keys)

## Findings

### P3-01 — i18n drift between Tickets and Active/Archive headers

`Tickets` is a hardcoded literal at `app-mobile/src/components/activity/CalendarTab.tsx:1769`, while Active and Archive headers use `t('activity:calendarTab.active')` and `t('activity:calendarTab.archives')`. Dispatch explicitly carves out i18n ("no translation key changes — i18n is a separate concern flagged in ORCH-0842's investigation"), so this is intentional. **Not a fix-it for this ORCH — flagging for the eventual i18n sweep ORCH.**

### P4-01 — Praise: clean subtract-before-adding

Implementor removed the dead `businessEventSection` + `businessEventHeader` style definitions in the same change rather than leaving them as orphaned dead code. Matches constitutional rule #8 and is the kind of housekeeping that prevents future grepping for these styles from misleading investigators.

### P4-02 — Praise: state initializer comment updated

Comment at [line 120](app-mobile/src/components/activity/CalendarTab.tsx#L120) was updated from `// Start with Active expanded` to `// Start with Tickets + Active expanded`. Small but the right reflex.

## Cache safety

No React Query keys touched, no mutations modified, no Zustand store keys changed. No AsyncStorage shape change. Safe.

## Regression surface — adjacent features

I read the surrounding code to confirm no implicit assumptions broken:
1. Active accordion onPress at [:1799-1808](app-mobile/src/components/activity/CalendarTab.tsx#L1799-L1808) — unchanged, still toggles `"active"` only
2. Archive accordion onPress at [:1852-1861](app-mobile/src/components/activity/CalendarTab.tsx#L1852-L1861) — unchanged
3. `BusinessEventCalendarRow` import + usage at [:1788-1791](app-mobile/src/components/activity/CalendarTab.tsx#L1788-L1791) — only the wrapping `<View>` changed; row component itself untouched
4. `CardFilterBar` above the Tickets section — unaffected, still applies to Active/Archive entries
5. `getCardAnimation` system — only operates on `filteredActiveEntries`, never the Tickets list (intentional — tickets don't animate); unchanged

## Working-branch discipline

- All reads + test runs + report writes happened in shared checkout at `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
- Independent fails-on-revert verification used `git stash` (non-destructive) and restored cleanly via `git stash pop`.
- No edits to global indexes (DECISION_LOG, INVARIANT_REGISTRY, etc.) — orchestrator-owned.

## Discoveries for orchestrator

- ORCH-0842 [Tickets-into-Active + PDF sheet] investigation proposes merging tickets INTO the Active accordion. ORCH-0848 builds a clean toggle scaffold the merger could reuse OR replace — either way 0848 does not block 0842.
- i18n key for `"Tickets"` literal eventually needs to live in `activity:calendarTab.tickets`. Not in scope for 0848 but worth a tiny follow-up ORCH if the i18n sweep doesn't already cover Likes → Calendar.

No P0/P1 findings. No constitutional violations. No security implications (pure presentation).

## Verdict gate

- **PASS condition:** proven live-fire on iOS sim + Android emu.
- **Actual:** probable live-fire (sims booted, build installed, blocked on test data only) + 14/14 adversarial PASS + independent fails-on-revert verification.
- **Verdict:** CONDITIONAL PASS — clear to CLOSE once Seth runs the 3-step smoke test on his account (Case-B below) and confirms toggle behaviour matches expectations. Given the change is a verbatim mirror of an already-production-proven pattern, the residual risk is low; the gate is procedural, not substantive.
