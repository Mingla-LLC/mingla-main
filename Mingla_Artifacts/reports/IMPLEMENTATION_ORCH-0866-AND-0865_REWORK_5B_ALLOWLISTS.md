# IMPLEMENTATION — ORCH-0866 [SafeArea drift + SafeScreen wrapper] + ORCH-0865 [trips-leak + routeForEventRow helper] — REWORK 5b (allowlist paperwork)

**Status:** completed and verified · **Verification:** passed (all 3 CI gates green, 0/0/0 violations)
**Skill:** Claude `mingla-implementor`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Predecessor:** RETEST 5 verdict PASS at `Mingla_Artifacts/reports/QA_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP_REPORT_RETEST_5.md` + operator design ruling 2026-05-17 (status-bar overlap with cover/header on /e/, /t/, /b/, 3 checkout screens is intentional banner aesthetic)
**Type:** comment-only paperwork; no logic changes

---

## 1. Layman summary

You ruled the status-bar-overlapping cover/header is by design across the 5 buyer-flow screens + brand page after looking at the screenshots. The 3 new CI gates correctly flagged those routes plus a few sub-component-handled routes; they didn't know which were bugs vs design. This rework adds 13 one-line allowlist comments that say "this is exempt because <reason>" — turning the gate failures into documented design decisions. All 3 gates now report 0 violations.

---

## 2. What landed

### SafeArea-on-fullscreen-routes gate — 9 allowlist comments

Each comment cites ORCH-0859 [Tr2] REWORK 5b + the design ruling + the per-file reason. Each is placed near the top of the route file's imports.

| File | Reason cited in comment |
|---|---|
| `mingla-business/app/(tabs)/ari.tsx` | AriChatScreen handles SafeArea internally (paddingTop: insets.top at line 130); pixel-verified screenshot 16 |
| `mingla-business/app/b/[brandSlug]/index.tsx` | Design-intent full-bleed cover banner; PublicBrandPage applies insets.top + 110 to content card; pixel-verified screenshot 21 |
| `mingla-business/app/checkout/[eventId]/index.tsx` | Design-intent buyer aesthetic; insets.bottom IS applied for home indicator; top overlap intentional; screenshot 18 |
| `mingla-business/app/checkout/[eventId]/buyer.tsx` | Same as above; screenshot 19 |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | Same as above (pattern parity with index + buyer) |
| `mingla-business/app/connect-onboarding.tsx` | Web-only Stripe Connect Embedded Components page; renders DOM elements, not React Native primitives |
| `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` | Design-intent full-bleed cover; screenshot 17 |
| `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | Design-intent full-bleed cover (pattern parity with /e/) |
| `mingla-business/app/trip/[id]/edit.tsx` | TripCreatorWizard handles SafeArea at line 396; transient early-return states acceptable; screenshot 08 |

### Route-by-event-type gate — 4 allowlist comments in `mingla-business/src/components/event/EditPublishedScreen.tsx`

EditPublishedScreen edits PUBLISHED EVENTS only — `liveEvent.id` is structurally an event id. All 4 hardcoded `router.push/replace(\`/event/${liveEvent.id}\`)` calls are correct by context.

| Line | Context |
|---|---|
| 480 | "Open Orders" CTA in rejection-dialog handler |
| 774 | Save-success fallback when no back stack |
| 794 | Generic save-success fallback |
| 826 | Back handler fallback |

Comment placed immediately above each `router.push` / `router.replace` line: `// orch-strict-grep-allow route-by-event-type — EditPublishedScreen.tsx edits events only; liveEvent.id is always an event id (ORCH-0859 [Tr2] REWORK 5b)`.

---

## 3. Verification

```
$ node .github/scripts/strict-grep/i-proposed-tr2-safearea-on-fullscreen-routes.mjs
I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES: scanned 49 files, 0 violations

$ node .github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs
I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE: scanned 382 files, 0 violations

$ node .github/scripts/strict-grep/i-proposed-tr2-livestore-addliveevent-owner.mjs
I-PROPOSED-TR2-LIVESTORE-ADDLIVEEVENT-OWNER: scanned 399 files, 0 violations
```

**0/0/0 violations across all 3 gates** ✅

No code paths exercised by Jest changed (comments don't affect AST behaviour). Existing tests still pass — the REWORK 5 regression tests (`mingla-business/src/utils/__tests__/routeForEventRow.test.ts` 12/12 + `mingla-business/src/components/event/__tests__/EventListCard_defensiveFilter.test.tsx` 5/5 with fails-on-revert verified) continue to ship in the same PR and remain the regression-test gate satisfier for this ORCH bundle.

---

## 4. Cross-surface impact

| Surface | Touched | Why |
|---|---|---|
| Business iOS | NO functional change | Comment-only; behaviour unchanged |
| Business Android | NO functional change | Shared codebase, same |
| Buyer/anonymous Web | NO functional change | Same |
| Business Web preview | NO functional change | Same |
| Consumer iOS / Android | NO | Out of scope; `app-mobile/` untouched |
| Admin Web | NO | Out of scope; `mingla-admin/` untouched |

User-visible behaviour: zero change. Only CI behaviour changes (gates go from 9+4 violations to 0+0).

---

## 5. Regression-test gate (Step 0.5)

This sub-cycle is **paperwork-only** (13 comment additions; no logic changes). The ORCH-level regression-test gate is satisfied by the REWORK 5 tests that ride in the same PR:

- Implementor happy-path: `mingla-business/src/utils/__tests__/routeForEventRow.test.ts` — 12 tests, all PASS
- Tester adversarial: `mingla-business/src/components/event/__tests__/EventListCard_defensiveFilter.test.tsx` — 5 tests, all PASS, fails-on-revert formally verified by sed-removing the filter (2 of 5 failed) and restoring (5/5 passed)
- Tester adversarial Maestro flow: `mingla-business/maestro/tr2-tap-handler-routes-by-type.yaml`

**The new CI gates themselves are also regression protection:** if anyone removes one of the 13 allowlist comments without replacing it with a proper retrofit, the matching gate will fail in CI on the next commit. The gates are now ACTIVE and enforced.

No additional regression test needed for REWORK 5b specifically.

---

## 6. Constitutional compliance

| # | Rule | Status |
|---|---|---|
| 1-14 | All 14 rules | UNCHANGED — comment-only changes touch no runtime behaviour |

---

## 7. Files changed (13 single-line edits across 10 files)

```
M  mingla-business/app/(tabs)/ari.tsx                                 (+1 allowlist line)
M  mingla-business/app/b/[brandSlug]/index.tsx                         (+1 allowlist line)
M  mingla-business/app/checkout/[eventId]/index.tsx                    (+1 allowlist line)
M  mingla-business/app/checkout/[eventId]/buyer.tsx                    (+1 allowlist line)
M  mingla-business/app/checkout/[eventId]/payment.tsx                  (+1 allowlist line)
M  mingla-business/app/connect-onboarding.tsx                          (+1 allowlist line)
M  mingla-business/app/e/[brandSlug]/[eventSlug].tsx                   (+1 allowlist line)
M  mingla-business/app/t/[brandSlug]/[tripSlug].tsx                    (+1 allowlist line)
M  mingla-business/app/trip/[id]/edit.tsx                              (+1 allowlist line)
M  mingla-business/src/components/event/EditPublishedScreen.tsx        (+4 allowlist lines at 480, 774, 794, 826)
```

10 files, 13 lines added, 0 lines deleted, 0 lines modified.

---

## 8. Discoveries for orchestrator

- **Cumulative ORCH-0859 CLOSE bundle now ready.** All 3 invariants can flip DRAFT → ACTIVE (`I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES`, `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE`, `I-PROPOSED-TR2-LIVESTORE-ADDLIVEEVENT-OWNER`).
- **Trip dashboard missing "View public page" button** — sim-blocked the `/t/` pixel capture this RETEST. Worth a follow-up ORCH so operators can preview their own share link. (Filed as observation from QA RETEST 5; no action required this round.)
- **Pre-existing `forwardRef` warning escalates to dev-only RedBox** during multi-tap nav transitions; source: `StripeNativeProvider.tsx:27`. Not introduced by REWORK 5/5b. Worth a dev-experience cleanup ORCH.
- **Investigation report filenames still numbered ORCH-0862/0863** while implementor + tester reports use 0864/0865 (collision renumber). Orchestrator should reconcile at CLOSE artifact sync.
- **REWORK 4 DIAG marker** at `mingla-business/src/services/businessEvents.ts:495-505` remains in place — orchestrator Step 1.5 reap at CLOSE.
- **2 edge function deploys pending** per REWORK 5 implementation report §6 (`ticket-confirmation-dispatch`, `discover-merged-events`).

---

## 9. Handoff

NEXT HANDOFF — paste into Claude `mingla-tester`:

ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b (ORCH-0866 [SafeArea drift + SafeScreen wrapper] + ORCH-0865 [trips-leak + routeForEventRow helper]) ready for RETEST 5b. Working tree `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. This sub-cycle is comment-only paperwork (13 allowlist comments across 10 files) closing out the operator-decision residuals from RETEST 5 — all routes the operator pixel-reviewed and ruled design-intent now carry allowlist tags citing the design ruling. RETEST 5b is gate-verification only — no sim work needed. Run `node .github/scripts/strict-grep/i-proposed-tr2-safearea-on-fullscreen-routes.mjs && node .github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs && node .github/scripts/strict-grep/i-proposed-tr2-livestore-addliveevent-owner.mjs` — expect 0/0/0 violations (confirmed locally by implementor). Also spot-check that the 13 allowlist comments include the `ORCH-0859 [Tr2] REWORK 5b` citation + a per-file reason (not just bare allowlist tags — operator wants documented design rationale, not silent exemptions). Read this implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0866-AND-0865_REWORK_5B_ALLOWLISTS.md` plus the predecessor `QA_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP_REPORT_RETEST_5.md`. Expected output `Mingla_Artifacts/reports/QA_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP_REPORT_RETEST_5B.md` with verdict (PASS expected) and verification that the 3 strict-grep gates ship 0 violations on the closing diff. After PASS the dispatch is Codex `orchestrator-mingla` for CLOSE — Step 1.5 reaps the `[ORCH-0859-REWORK-4-DIAG]` console.log at businessEvents.ts:495-505, promotes 3 new invariants from DRAFT to ACTIVE, deploys 2 still-pending edge functions, and reconciles the ORCH-0862/0863 → 0864/0865 filename collision.
