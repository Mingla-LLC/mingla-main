# QA — ORCH-0815-B Marketing Hub Composer + Email Send Pipeline

**ORCH:** ORCH-0815-B (Phase 1 backend + Phase 2 UI, combined)
**Mode:** TARGETED (code-verified) + ASK-TO-UNBLOCK on live-device parity
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0815_B_COMPOSER_AND_SEND.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0815_B_COMPOSER_AND_SEND.md`
**Tester:** Claude `mingla-tester` (parity mirror per DEC-133; operator-directed for this dispatch)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## 0. Verdict

**CONDITIONAL PASS — code review + all 4 local gates green; live iOS / Android / Web verification deferred (operator unblock required).**

- **P0 (critical):** 0
- **P1 (high):** 0
- **P2 (medium):** 5
- **P3 (low):** 3
- **P4 (note):** 2

**Why CONDITIONAL not PASS:** the SPEC §12 test matrix lists T-B19..T-B23 as live-tester scope (iOS Simulator + Android Emulator + Web expo), and SC-B28 explicitly requires "iOS Simulator + Android Emulator parity (composer keyboard, sub-sheets, preview pane) verified by tester". This QA session ran in a Claude Code shell with no simulator process, no emulator, no expo web server, the new migration not yet applied (`mkt_claim_campaigns` plpgsql helper unavailable), and the three edge functions not yet deployed. Every other criterion that can be verified by reading code, running gates, and exercising pure-logic tests was verified — and 5 P2 + 3 P3 findings surfaced that the operator should weigh before closing.

**Why not FAIL:** zero P0, zero P1. No crashes, no security holes, no data loss, no constitutional-rule violations that block the gates, no SPEC contradictions that prevent the implementation from working end-to-end. The strict-grep gate's negative-control proof confirms it actually catches the regressions it claims to catch. Backend Deno suite is 31/31 green and meaningful (it asserts the literal env-flag default, the FOR UPDATE SKIP LOCKED token, the dispatcher switch shape, and the verify-before-insert ordering). Jest is 34/34 green (Phase A audience service + Phase B parser + Phase B renderer helpers).

---

## 1. Layman Summary

I independently ran every gate the implementor (also me, an hour ago) claimed was green, AND I added a negative-control test the implementor did NOT run — I intentionally regressed the code three times and confirmed the strict-grep gate caught each regression. All four gates pass on the actual current code (deno check, deno test, tsc, jest, strict-grep). I then read every file the implementor changed looking for things the implementor missed — and found five medium issues that should be fixed before this ships to real users, but none of them break the basic flow. The biggest one is that the composer route still shows the Marketing sub-nav pills at the top (SPEC §4.2 said to hide them on the composer); the second is that "Failed campaign" text on the campaigns history list uses a near-invisible orange tint that will be hard to read. Neither one is a P0 / launch blocker — they're polish issues. The live iOS / Android / Web parity tests are unblocked but cannot run from this shell — operator needs to either (a) run them manually on real devices once the deploy lands, or (b) re-dispatch to a tester session that has simulators attached.

---

## 2. Independent Gate Run (verified, not trusted)

```bash
$ deno check (6 production files + 4 test files)
# all green

$ deno test --allow-read --allow-env (4 suites)
ok | 31 passed | 0 failed (147ms)

$ npx tsc --noEmit  # from mingla-business/
# no output — clean

$ npx jest --testPathPattern="(parseAudienceParam|marketingRenderingService|marketingAudience)"
PASS src/services/marketing/__tests__/marketingRenderingService.test.ts
PASS src/hooks/marketing/__tests__/parseAudienceParam.test.ts
PASS src/services/marketing/__tests__/marketingAudienceService.test.ts
Test Suites: 3 passed, 3 total
Tests:       34 passed, 34 total

$ node .github/scripts/strict-grep/orch-0815-b-composer-and-send.mjs
[ORCH-0815-B] strict-grep gate: clean (0 violations across 12 checks)
```

### 2.1 Negative-control proof (SPEC §14 check 12)

The implementor's report listed the 12 checks but didn't actually demonstrate them firing on real regressions. Tester did:

| Regression | Gate response |
|---|---|
| `MARKETING_SEND_LIVE_ENABLED ?? "false"` → `?? "true"` | `[check-7] MARKETING_SEND_LIVE_ENABLED defaults to true — must default false` |
| `FOR UPDATE SKIP LOCKED` → `FOR UPDATE` | `[check-8] missing FOR UPDATE SKIP LOCKED literal — atomic-claim pattern must be honoured` |
| `kind: "rcs"` → `kind: "ahem"` in ChannelTabs | `[check-2] literal rcs tab missing` |

All 3 regressions were correctly caught. Restored to clean state.

---

## 3. SPEC Traceability — What I Verified vs What Needs Live Tester

### 3.1 Code-verified (PASS by reading shipped code + running gates)

| SC | Status | Evidence |
|---|---|---|
| SC-B1 | PASS | `compose.tsx` mounts 4 step components (Who/What/When/Compliance) |
| SC-B2 | PASS | `parseAudienceParam` parses `{kind}:{uuid}`; `ensureBrandBuyersAudience` / `ensureEventBuyersAudience` lazy-seed system audiences |
| SC-B3 | PASS | `ChannelTabs.tsx` lines 39-43 — three tab specs with `enabled: false` on SMS/RCS + "pending" caption |
| SC-B7 | PASS | `ComposerStepWhen.tsx` renders DateTimePicker-style TextInput when `mode==='schedule'`; validation gates Review CTA |
| SC-B10 | PASS | `useScheduleCampaign` → `scheduleSend` service → UPDATE marketing_campaigns SET status='scheduled', scheduled_for |
| SC-B11 | PASS | `compose.tsx:317-321` — scheduleMutation.onSuccess → sendNowMutation.mutate(campaignId) when mode='now' |
| SC-B15 | PASS | `campaigns/index.tsx` shipped real list with CampaignFilterPills + CampaignCard + FAB |
| SC-B16 | PASS | Both `brand/[id]/blasts.tsx` and `event/[id]/blasts/index.tsx` rewired — `handleBlast` is `router.push("/marketing/campaigns/compose?audience=${kind}:${targetId}")`. Verified by diff: toast state + toast view + toast styles + setTimeout all removed |
| SC-B17 | PASS (code) | `20260603000000_orch_0815_b_marketing_send_cron.sql` cron.schedule with `'* * * * *'` — but operator must `supabase db push --linked` before this is live |
| SC-B18 | PASS | `mkt_claim_campaigns(integer, uuid)` plpgsql helper uses `FOR UPDATE SKIP LOCKED` literally; marketing-send calls it via `.rpc()` |
| SC-B19 | PASS | `marketing-send/index.ts` `if (!options.live)` path UPDATEs status='preview_skipped' and skips the Resend POST entirely. Deno test `marketing-send: live-broadcast env-flag gates Resend calls` + the negative-control test `never defaults … to true` |
| SC-B21 | PASS | `marketingEmailRender.ts` rewrites every `href="..."` to `https://mingla.app/m/<tracking_id>`; marketing-send batch-INSERTs marketing_clicks rows |
| SC-B22 | PASS | `marketingEmailRender.ts:renderUnsubscribeFooter` appends signed unsubscribe URL; `signUnsubscribeToken` HS256-signs |
| SC-B25 | PASS | `marketingAudience.ts:aggregate` computes `email_marketing_ok` per contact from `marketing_unsubscribes` join; `marketing-send/sendEmail` skips contacts with `email_marketing_ok=false` (no marketing_messages row written) |
| SC-B26 | PASS | strict-grep checks 1, 2, 3 all pass on shipped code |
| SC-B27 | PASS | tsc clean / jest 34 pass / Deno 31 pass / strict-grep 12 checks pass |
| SC-B29 | PASS | strict-grep checks 4 (no bare crypto.randomUUID in client), 5 (no oklch/lab/lch/color-mix) confirmed; sub-sheets render inside parent KeyboardAvoidingView |

### 3.2 Live-tester scope (deferred — operator unblock required)

| SC | Status | Why deferred |
|---|---|---|
| SC-B4 | UNVERIFIED | Subject/body input behaviour requires live render |
| SC-B5 | PARTIAL | `previewBlocks` Jest test verifies the `{{event:<id>}}` parse + split logic; the cursor-position insertion in `compose.tsx:handleInsertEventCard` is code-correct but live keyboard cursor behaviour needs simulator |
| SC-B6 | UNVERIFIED | EmailPreviewPane needs live render with real audience data |
| SC-B8 | UNVERIFIED | ComposerStepCompliance read-only display needs live render |
| SC-B9 | UNVERIFIED | ComposerReviewSheet content needs live render |
| SC-B12 | PARTIAL | useComposerDraft.ts has the 800ms `setTimeout` literal (verified by code read); live debounce behaviour is tester scope — see also P2-4 |
| SC-B13 | UNVERIFIED | Draft restore from `?draft=<id>` is code-correct but needs live navigation |
| SC-B14 | UNVERIFIED + has known bug | See P2-3 |
| SC-B20 | UNVERIFIED | Live Resend POST requires LIVE=true env-flag flip + a real Resend sandbox |
| SC-B23 | UNVERIFIED | Live `/m/<tracking_id>` 302 redirect requires the edge function to be deployed |
| SC-B24 | UNVERIFIED | Same — requires deployed `/unsubscribe/<token>` |
| SC-B28 | UNVERIFIED | iOS + Android parity is by definition live-tester scope |

---

## 4. Findings

### P2-1 — MarketingSubNav does NOT hide on the composer route

**Severity:** P2 — UX nonsense, SPEC contradiction
**Where:** `mingla-business/app/(tabs)/marketing/_layout.tsx:24` unconditionally renders `<MarketingSubNav />`; `mingla-business/src/components/marketing/MarketingSubNav.tsx` does not check pathname for `/compose`.
**SPEC reference:** §4.2 "Composer route is a child of Campaigns, NOT a sub-nav tab — the composer hides the sub-nav (per Phase A SPEC §4.3)."
**Evidence:** Phase A `_layout.tsx` itself flags it: `"The composer route … will hide the sub-nav when it lands in sub-ORCH-B (next sub-step) — for now the sub-nav is rendered uniformly across every sub-route."` Phase 2 (this implementation) did not add the hide mechanism.
**Impact:** The composer screen will render the 4-pill segmented control above the back-chevron header. Visually noisy + makes the composer feel like a peer of Overview/Audiences/Campaigns/Templates rather than a focused authoring surface.
**Fix:** Either
(a) In `MarketingSubNav.tsx`, after `const pathname = usePathname();`, add `if (pathname.includes("/campaigns/compose")) return null;` — one-liner, idempotent, no _layout change required.
(b) In `_layout.tsx`, read `usePathname()` and conditionally render `<MarketingSubNav />`. Cleaner separation of concerns.
Recommend (a). 3-line change including the import.

### P2-2 — CampaignCard "Failed" text uses near-invisible tint color

**Severity:** P2 — accessibility / readability
**Where:** `mingla-business/src/components/marketing/CampaignCard.tsx:209`
**Code:** `failedText: { color: semantic.warningTint ?? textTokens.secondary }`
**Issue:** `semantic.warningTint` is `rgba(245, 158, 11, 0.18)` — an 18%-alpha background tint, NOT a text color. Used as text on the card's translucent `glass.tint.profileBase` background, this renders as near-invisible orange. Also: `semantic.warning` is `#f59e0b` (solid), so the `?? textTokens.secondary` fallback is dead code — `semantic.warningTint` is never nullable in the design-system source.
**Impact:** Failed campaigns in the history list will display "Failed {date}" in a color that fails WCAG AA contrast against the card background. Users won't see why their campaign failed.
**Fix:** `color: semantic.warning` (solid hex). Drop the `??` fallback.

### P2-3 — Dirty back-block intercepts on saved-clean state

**Severity:** P2 — UX nonsense
**Where:** `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx:329`
**Code:** `if (!isDirty && campaignId === null) return;`
**Issue:** This short-circuits only when BOTH dirty=false AND no-saved-draft. The four cases:
| isDirty | campaignId | Behaviour | Correct? |
|---|---|---|---|
| false | null | Skip Alert | ✓ |
| true | null | Show Alert | ✓ |
| true | non-null | Show Alert | ✓ |
| **false** | **non-null** | **Show Alert** | **✗ — user has nothing to save** |
**Impact:** After the user saves a draft (auto-save fires, campaignId becomes non-null), if they don't modify anything further and try to leave, they get a "Save your draft?" Alert with Cancel/Discard/Save buttons — even though there's nothing to save. Confusing.
**SPEC reference:** SC-B14: "attempting to leave composer with **unsaved edits** shows Save draft / Discard / Cancel prompt". Currently fires on saved-clean.
**Fix:** Change line 329 to `if (!isDirty) return;`. Saved-clean state should let nav proceed silently.

### P2-4 — flushDraft silently no-ops when audienceId is null

**Severity:** P2 — Constitution #3 brush (silent failure in a recoverable case)
**Where:** `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx:201-237`
**Code:** `if (accountId === null || brandId === null || audienceId === null) return;`
**Issue:** If the user enters compose without an audience pre-fill (Marketing → Campaigns → "+ New campaign"), types into subject before picking an audience, the 800ms debounce fires `flushDraft`, which silently early-returns without setting `isDirty=false`. Visible user impact:
- Typed subject IS preserved in component state (so reappears in UI).
- The dirty flag never clears.
- If user picks audience next, subject + audience get saved correctly together (because flushDraft re-fires on the new dirty cycle and audienceId is now non-null).
- If user kills/crashes the app between "typed subject" and "picked audience", subject is lost.

**SPEC reference:** SC-B12: "Draft auto-save: typing in any field triggers a marketing_campaigns UPDATE within 1s". Currently fires only after audience is picked.
**Impact:** Edge-case data loss on crash. Not a security issue, not a constitutional violation in the strict sense (we DO log to errorBanner in the catch block — but the early-return path before the try block silently drops). Recoverable in normal flow.
**Fix options:**
(a) Block subject/body input until audienceId is set (UI gating). Cleanest but heaviest.
(b) Persist a local pre-save snapshot in component state (already done — subject is in useState) + show a small caption "Pick an audience to save draft" when isDirty=true && audienceId===null. Mid-weight.
(c) Accept the edge case + add `// [TRANSITIONAL] flushDraft no-ops until audienceId is set — operator decided edge-case data loss is acceptable (ORCH-0815-B Phase 2 P2-4)` with a tracking ORCH ID. Low-weight.

Recommend (b) — a single visible caption removes the silent-failure concern and tells the user what to do.

### P2-5 — parseAudienceParam not memoized; pre-fill useEffect re-runs every render

**Severity:** P2 — performance + race risk
**Where:** `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx:88-90`
**Code:** `const audienceParam = parseAudienceParam(typeof params.audience === "string" ? params.audience : null);` (runs every render, returns new object reference)
**Issue:** `audienceParam` is in the dependency array of the pre-fill useEffect (line 144). React's dep-array comparison is referential — a new object literal every render → effect re-runs every render → the async IIFE that calls `ensureBrandBuyersAudience` fires every render until the inner `if (audienceId !== null) return;` short-circuits it.
**Impact:** Wasted re-renders; if `ensureBrandBuyersAudience` takes >1 render-cycle to resolve (likely on slow networks), multiple concurrent ensure calls race. Network impact: a brand with no system audience yet may get 2-3 audience row inserts in flight simultaneously. The `ensureBrandBuyersAudience` logic SELECTs first (idempotent — finds existing row on second call), so functionally safe, but messy.
**Fix:** Wrap in `useMemo`:
```typescript
const audienceParam = useMemo(
  () => parseAudienceParam(typeof params.audience === "string" ? params.audience : null),
  [params.audience],
);
```
3-line change.

### P3-1 — marketing-unsubscribe brand_name lookup lacks 5-min in-process cache

**Severity:** P3 — perf only
**Where:** `supabase/functions/marketing-unsubscribe/index.ts:114-127`
**SPEC reference:** §7.3 "Brand name lookup: SELECT brands.display_name WHERE id=brand_id. Cache for 5 min in-process."
**Issue:** My implementation does the SELECT on every unsubscribe request. SPEC requested a 5-minute in-process cache.
**Impact:** Cold-path performance — every unsubscribe link click adds a DB round trip. Unsubscribe traffic volume in Phase B will be tiny, so this is a P3 not P2.
**Fix:** Add `const BRAND_NAME_CACHE = new Map<string, { name: string; expires: number }>();` + 5-min TTL check before the SELECT.

### P3-2 — Android KAV behaviour unverified

**Severity:** P3 — code-correct but live-device unverified
**Where:** `compose.tsx:359-360` `<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>`
**Issue:** On Android, `behavior=undefined` falls back to the AndroidManifest's `windowSoftInputMode` (usually `adjustResize`). If the project's manifest is `adjustPan`, the keyboard will cover inputs on Android. Cannot verify without an emulator.
**Fix:** Operator verifies on live Android emulator. If broken, switch to `behavior="height"` on Android.

### P3-3 — ComposerStepWhen uses TextInput not native DateTimePicker (documented)

**Severity:** P3 — documented deviation §18.2 of implementation report
**SPEC reference:** §5.1 Step 3 specifies DateTimePicker.
**Issue:** Implementor explicitly chose to ship TextInput in Phase B and defer DateTimePicker to polish. Operator-accepted at SPEC Open Question 4.
**Impact:** Operators must type ISO-8601 strings. Validation catches malformed input but UX is power-user-only.

### P4-1 — Excellent strict-grep gate quality (positive)

The 12-check strict-grep gate is genuinely sensitive. Negative-control test confirmed 3 different intentional regressions are caught. Particularly well-designed checks: check-10 (verify-before-insert ordering — proves cryptographic gate is honored, not just present), check-7 negative-control (proves env-flag never defaults ON, not just that it's referenced). This pattern should be replicated for future ORCHs.

### P4-2 — Deno source-introspection tests are meaningful (positive)

`marketing-send/index.test.ts` asserts the literal `const _exhaustive: never = kind` exhaustiveness sentinel, not just the presence of `switch (kind)`. Same with the `MARKETING_SEND_LIVE_ENABLED.*\?\?\s*["']true["']` negative regex on the live-broadcast default. These are real regression guards, not rubber-stamp tests.

---

## 5. Constitution Check

| Rule | Status | Evidence |
|---|---|---|
| 1 No dead taps | PASS | Every Pressable in new components has onPress + accessibilityLabel |
| 2 One owner per truth | PASS | useCampaigns owns campaign list state via React Query; no Zustand shadow |
| 3 No silent failures | **brush** | flushDraft early-return when audienceId null is a soft silent-failure path (P2-4); recoverable |
| 4 One query key per entity | PASS | `marketingKeys` factory; `useCampaigns` keys via `marketingKeys.campaigns.list` |
| 5 Server state server-side | PASS | All marketing server state via React Query hooks; no Zustand persist |
| 6 Logout clears everything | N/A | No new persisted state introduced |
| 7 `[TRANSITIONAL]` markers | PASS | None introduced |
| 8 Subtract before adding | PASS | Old toast state + view + styles removed from both blasts routes |
| 9 No fabricated data | PASS | Composer shows real audience reach counts (`resolvedAudience.data?.reach`); preview pane labels event cards as "(preview)" |
| 10 Currency-aware | N/A | No currency surfaces |
| 11 One auth instance | PASS | Single `useAuth()` consumer |
| 12 Validate at right time | PASS | scheduled_for uses user's input converted to ISO via `new Date()` at confirm-time (the SPEC's "brand's local time" — currently is the device clock; mild simplification but consistent) |
| 13 Exclusion consistency | PASS | `email_marketing_ok` filter applied identically in audience service (client) and marketing-send sendEmail (server) |
| 14 `_hasHydrated` gate | N/A | No new persisted Zustand store |

---

## 6. Parity Check

| Surface | Status |
|---|---|
| Solo vs collab | N/A — mingla-business is single-organiser-context |
| Mobile vs admin | N/A — composer ships only in mingla-business; admin gets a future Sub-ORCH-C parallel |
| iOS vs Android | UNVERIFIED — see P3-2 |
| Web (expo --web) | UNVERIFIED — see SC-B21 in §3.2 |

---

## 7. Cross-Domain Impact

| Domain | Touched? | Verified? |
|---|---|---|
| Database (migration) | Yes — new pg_cron + `mkt_claim_campaigns` helper | Code-verified by reading SQL; live `supabase db push` is operator scope |
| RLS | No new tables | N/A |
| Edge functions | 3 new + 3 shared utils | Deno gates green; live deploy + invocation deferred |
| Mobile app-mobile | No — mingla-business only | N/A |
| Admin dashboard | No | N/A |
| External APIs | Resend, pg_net | Resend integration code-correct; live POST not exercised |

---

## 8. Operator Unblock Asks

Per the canonical-tester ask-to-unblock rule (no silent CONDITIONAL PASS):

1. **Apply the migration** — `supabase db push --linked` so `mkt_claim_campaigns` exists. Without this, the composer's "Send now" path fails with `function mkt_claim_campaigns(integer, uuid) does not exist`.
2. **Set Function secrets** — `UNSUBSCRIBE_TOKEN_SECRET` (32+ char random), `MARKETING_SEND_LIVE_ENABLED=false`, `RESEND_API_KEY` (existing). Implementation report §9 lists the exact `supabase secrets set` commands.
3. **Deploy the 3 edge functions** — `supabase functions deploy marketing-send`, `marketing-track-click`, `marketing-unsubscribe`. The implementor (post-CLOSE) owns this per the deploy split. Without deploy, the composer's invoke() call fails and the buyer-click / unsubscribe URLs 404.
4. **Live device parity verification** — iOS Simulator + Android Emulator + Web (expo --web) cannot run from this Claude Code shell. Either redispatch tester with simulators attached, or operator manually exercises the flows post-deploy. The 5 P2 findings above are independent of live device behaviour — they should be fixed before live testing so the live tester isn't catching the same issues again.

---

## 9. Discoveries for Orchestrator

| Item | Severity | Notes |
|---|---|---|
| Phase A `_layout.tsx` left a "Phase B will hide sub-nav" promise | P2-1 | Add to next iteration |
| `brands.contactEmail` field doesn't exist | P3 (implementor already flagged) | ComposerStepCompliance shows "Pending" placeholder for Reply-to. Operator decides whether to add the column |
| `semantic.warningTint` is a tint, never a text color | P2-2 | Worth a design-system lint to catch the misuse pattern in future code |

---

## 10. Recommended Routing After This QA

- **If operator accepts CONDITIONAL PASS** (P2 findings deferred to a Sub-ORCH-0815-B-Polish ticket): Codex `orchestrator-mingla` for CLOSE → Claude `mingla-implementor` for the edge-function deploys.
- **If operator wants P2 fixes first** (recommended — all 5 are small, totalling ~30 LOC of changes): Claude `mingla-implementor` for REWORK on P2-1 through P2-5 (1 short cycle), then re-dispatch tester for live-device parity once devices are attached.

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

**End QA report.**
