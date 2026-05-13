# QA RETEST — ORCH-0815-B Marketing Hub Composer + Email Send Pipeline

**Cycle:** Retest #1 (post P2/P3 rework)
**Trigger:** Implementation report §21 receipted 5 P2 + 1 P3 fixes from `QA_ORCH-0815_B_COMPOSER_AND_SEND_REPORT.md`
**Mode:** RETEST
**Tester:** Claude `mingla-tester` (operator-redirected from canonical forensics TEST)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Prior report:** `Mingla_Artifacts/reports/QA_ORCH-0815_B_COMPOSER_AND_SEND_REPORT.md`
**Rework report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0815_B_COMPOSER_AND_SEND.md` §21

---

## 0. Verdict

**CONDITIONAL PASS** — every rework fix verified in code at the named line, no regressions found, all four local gates re-run green. Live iOS / Android / Web parity (SC-B28 + T-B19..T-B23) **remains operator-unblocked** — same blocker as prior QA, NOT caused by the rework.

- **P0:** 0 · **P1:** 0 · **P2:** 0 (all 5 prior P2 fixes verified) · **P3:** 0 (the actionable P3-1 fixed; P3-2 + P3-3 deferred per prior QA recommendation) · **P4:** 1

**Retest cycle count:** 1 (well below the >2 "stuck in loop" threshold).

---

## 1. Layman Summary

I read every fix in the named code location, confirmed each one is actually there and actually fixes what the prior QA complained about, ran all four local gates independently, and looked for new bugs the rework might have introduced. No regressions, no new P0/P1/P2 issues. Same live-device unblock from last time still applies — that has nothing to do with the rework, it's just that this Claude Code shell can't run iOS Simulator / Android Emulator / expo web.

---

## 2. Fix Verification Matrix

| Finding | File | Expected fix | Verified |
|---|---|---|---|
| **P2-1** | `mingla-business/src/components/marketing/MarketingSubNav.tsx:63` | `if (pathname.includes("/campaigns/compose")) return null;` immediately after `usePathname()` | ✓ present at line 63 with comment citing SPEC §4.2 + Phase A TODO |
| **P2-2** | `mingla-business/src/components/marketing/CampaignCard.tsx:212` | `color: semantic.warning` (solid hex, no `??` fallback) | ✓ verified — `color: semantic.warning` at line 212 with comment explaining why the tint was wrong |
| **P2-3** | `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx:339` | `if (!isDirty) return;` (drop the `&& campaignId === null` clause) | ✓ verified at line 339 with comment citing P2-3 |
| **P2-4** | `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx:494-501` | Visible caption "Pick an audience above to save your draft." when `isDirty && audienceId === null && brandId !== null` | ✓ verified at line 494; conditional includes the `brandId !== null` clause so no double-message with ComposerStepWho's disabled-state caption |
| **P2-5** | `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx:92-98` | `audienceParam` wrapped in `useMemo(..., [params.audience])` | ✓ verified — memoised with the correct primitive dep |
| **P3-1** | `supabase/functions/marketing-unsubscribe/index.ts:25-26, 123-144` | Module-scope `BRAND_NAME_CACHE` Map with 5-min TTL; cache-check before SELECT | ✓ verified — `BRAND_NAME_CACHE` + `BRAND_NAME_TTL_MS = 5 * 60 * 1000` at the top of the file; cache-check + populate path inside the request handler |

All 6 fixes present, in the right place, doing the right thing.

---

## 3. Independent Gate Re-Run

```bash
$ deno test --allow-read --allow-env (4 suites)
ok | 31 passed | 0 failed (150ms)

$ npx tsc --noEmit  # from mingla-business/
# no output — clean

$ npx jest --testPathPattern="(parseAudienceParam|marketingRenderingService|marketingAudience)"
Test Suites: 3 passed, 3 total
Tests:       34 passed, 34 total

$ node .github/scripts/strict-grep/orch-0815-b-composer-and-send.mjs
[ORCH-0815-B] strict-grep gate: clean (0 violations across 12 checks)
```

All four gates green post-rework, identical to pre-rework state.

---

## 4. Regression Surface Check

The rework touched 5 files. I re-read each for unintended consequences:

| Surface | Outcome |
|---|---|
| MarketingSubNav on non-composer paths | `pathname.includes("/campaigns/compose")` is a substring match. Audited every legitimate path: `/marketing`, `/marketing/audiences`, `/marketing/campaigns` (history list), `/marketing/templates` — none match. Only `/marketing/campaigns/compose` and `/marketing/campaigns/compose?audience=...` match. No false positives. ✓ |
| Dirty-state Alert still fires on actual dirt | 4-way truth table re-checked: isDirty=true intercepts in both `campaignId=null` and `campaignId=non-null` cases (the Alert path), `isDirty=false` returns silently (the new behaviour, regardless of campaignId). The "Save draft" Alert action still calls `flushDraft` correctly. ✓ |
| P2-4 caption gating | `isDirty && audienceId === null && brandId !== null` — the `brandId !== null` clause prevents the caption from showing on the disabled-brand path (where ComposerStepWho already shows its own disabled-state caption). No duplicate messaging. ✓ |
| useMemo dep correctness | Dep is `[params.audience]` — a string primitive. React re-runs the memo only when the underlying query param changes. `parseAudienceParam` is pure, so this is correct. ✓ |
| Brand-name cache module-scope persistence | The Map survives across requests within the same Deno isolate (intentional per SPEC §7.3). Cold-start clears (operator-expected). ✓ |

No regressions found.

---

## 5. New Issues Introduced by Rework

| ID | Severity | Notes |
|---|---|---|
| (none P0–P2) | — | The rework was surgical; no new bugs of meaningful severity surfaced. |
| **P4-1** | observation | `BRAND_NAME_CACHE` Map in marketing-unsubscribe has no expired-entry eviction. When an entry's TTL elapses, the cache returns false on the freshness check and falls through to refetch — but the stale entry stays in the Map. Over a long-lived isolate with thousands of unique brand IDs, the Map grows monotonically. Not a real-world concern at Mingla's brand-count scale (hundreds, not millions). Worth a `BRAND_NAME_CACHE.delete(k)` on miss-due-to-expiry as a future cleanup; flagging as P4 (note) not a finding. |

---

## 6. Live-Device Parity — Still Operator-Unblocked

Same blocker as prior QA report §3.2 and §8:
- iOS Simulator not running in this shell
- Android Emulator not running in this shell
- Expo web server not running in this shell
- Migration not applied (`mkt_claim_campaigns` plpgsql helper still pending `supabase db push --linked`)
- Edge functions not deployed (the 3 `supabase functions deploy` commands listed in §9 of the implementation report are post-CLOSE)

The rework did NOT cause this unblock — it was the same shape on the prior QA dispatch. Either:
(a) Operator runs the live verification manually post-deploy and reports back; or
(b) Re-dispatch a tester session with simulators attached.

The 12 SPEC criteria covered by live testing (SC-B4, B6, B8, B9, B12-14, B19-25, B28) remain UNVERIFIED. The 17 SPEC criteria covered by code review + gates remain PASS (as enumerated in the prior QA §3.1, unchanged by this rework).

---

## 7. Constitution Re-Check

| Rule | Prior status | Post-rework status |
|---|---|---|
| 3 No silent failures | brush — flushDraft silent no-op when audienceId=null | **PASS** — visible caption "Pick an audience above to save your draft." now surfaces the previously-silent path (P2-4 fix). |

All other constitutional rules unchanged.

---

## 8. Discoveries for Orchestrator

None new.

---

## 9. Recommended Routing

The retest verdict is CONDITIONAL PASS, with the conditionality being **operator-blocking** (live-device + deploy), not implementor-blocking. Two valid next moves:

1. **Operator accepts CONDITIONAL PASS for the code-review scope and unblocks live verification** → operator runs `supabase db push --linked` + sets Function secrets per §9 of the implementation report → Claude `mingla-implementor` (post-CLOSE) deploys the 3 edge functions → operator manually exercises iOS / Android / Web parity → if green, Codex `orchestrator-mingla` for CLOSE.

2. **Operator dispatches tester #2 with simulators attached** → live SC-B4 / B6 / B8 / B9 / B12-14 / B19-25 / B28 verification → re-dispatch this retest cycle or send to Codex `orchestrator-mingla` for CLOSE based on outcome.

In either path, **zero implementor rework is needed**. The 6 fixes from the prior CONDITIONAL PASS are all verified in code and all gates pass.

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

**End retest report. ORCH-0815-B is code-complete and code-verified; awaiting operator unblock for live-device parity.**
