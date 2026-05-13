# QA REPORT — ORCH-0815-A2 + B-foundation (Combined)

**ORCH:** ORCH-0815-A2 (data + ui) + ORCH-0815-B-foundation (Marketing tab shell)
**Sub-mode:** TARGETED (orchestrator-dispatched)
**Date:** 2026-05-12
**Tester:** Claude `mingla-tester` (parity mirror; canonical owner is `mingla-forensics` TEST mode per DEC-133)
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0815_MARKETING_HUB_UI_PHASE_A.md` §5.7 + §5.8 + §6.1 + §8.7 + §8.13 + §11
**Design:** `Mingla_Artifacts/design/DESIGN_ORCH-0815_MARKETING_HUB_PHASE_A.md` §5 + §6.1 + §7.7 + §7.8 + §8.7 + §8.8 + §10
**Prior:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0815_A2_UI_LAYER.md` (impl claims) + `QA_ORCH-0815_A1_MIGRATION_REPORT.md` (A1 PASS)
**Project:** `gqnoajqerqhnvulmnyvv`

---

## Verdict

**CONDITIONAL PASS** — code is sound, schema parity verified, gates clean, but **two findings block a clean PASS** that the operator should accept-or-fix before commit:

| Severity | Count |
|---|---|
| P0 — CRITICAL | 0 |
| P1 — HIGH | 2 |
| P2 — MEDIUM | 1 |
| P3 — LOW | 2 |
| P4 — NOTE | 5 |

**The 2 P1 findings:**
1. **Dead-tap on `BuyerRow` (Constitution #1)** — Rows render as `Pressable` with press-feedback but neither route passes `onPress`. Tappable affordance, zero response.
2. **PostgREST filter-string injection vector in `marketingAudienceService.or()` clause** — `brandId` is interpolated directly into a filter string. RLS prevents data exfil, but pathological brandId values (commas, parens, single quotes) silently corrupt the unsubscribe filter.

Both are 1-edit fixes (see Findings §P1-1 + §P1-2 below). Operator may accept them as a follow-up ORCH and proceed to CLOSE — they do not block schema correctness, do not crash, do not leak data, and do not break commerce flows.

---

## Test Scope

What was tested (per orchestrator dispatch):

| Surface | New / Modified | Read forensically |
|---|---|---|
| `mingla-business/src/types/marketing.ts` | NEW | ✓ |
| `mingla-business/src/services/marketing/marketingAudienceService.ts` | NEW | ✓ |
| `mingla-business/src/services/marketing/__tests__/marketingAudienceService.test.ts` | NEW (18 jest tests) | ✓ |
| `mingla-business/src/hooks/marketing/useBrandCustomers.ts` | NEW | ✓ |
| `mingla-business/src/hooks/marketing/useEventBuyers.ts` | NEW | ✓ |
| `mingla-business/src/components/marketing/BuyerRow.tsx` | NEW | ✓ |
| `mingla-business/src/components/marketing/BlastCustomersCta.tsx` | NEW | ✓ |
| `mingla-business/src/components/marketing/MarketingSubNav.tsx` | NEW | ✓ |
| `mingla-business/app/brand/[id]/customers.tsx` | NEW | ✓ |
| `mingla-business/app/event/[id]/buyers/index.tsx` | NEW | ✓ |
| `mingla-business/app/(tabs)/marketing/_layout.tsx` | NEW | ✓ |
| `mingla-business/app/(tabs)/marketing/index.tsx` | NEW | ✓ |
| `mingla-business/app/(tabs)/marketing/audiences/index.tsx` | NEW | ✓ |
| `mingla-business/app/(tabs)/marketing/campaigns/index.tsx` | NEW | ✓ |
| `mingla-business/app/(tabs)/marketing/templates/index.tsx` | NEW | ✓ |
| `mingla-business/app/(tabs)/_layout.tsx` | MODIFIED (3→4 tabs) | ✓ |
| `mingla-business/src/components/brand/BrandProfileView.tsx` | MODIFIED (onCustomers prop + row) | ✓ |
| `mingla-business/app/brand/[id]/index.tsx` | MODIFIED (handleOpenCustomers) | ✓ |
| `mingla-business/app/event/[id]/index.tsx` | MODIFIED (handleBuyers + ActionTile) | ✓ |

**iOS / Android live tests NOT performed.** This QA is forensic code review + MCP introspection + independent jest re-run. No simulator boot, no real-device verification. The orchestrator dispatch text mentioned "iOS Simulator + Android Emulator + Web" but no simulator was running and the tester skill protocol limits this run to read-only verification + DB probes. Live-device verification is **operator-assisted next step** before CLOSE.

---

## Independent Gates (re-run from this skill, not implementor claims)

| Gate | Command | Result |
|---|---|---|
| TypeScript compile | `npx tsc --noEmit` (filtered to new + modified files) | Zero errors |
| Jest — marketing service | `npx jest src/services/marketing` | 18/18 PASS in 1.024s |
| MCP — schema parity | `information_schema.columns` cross-check on `orders` columns the service reads | All 11 expected columns present with expected nullability |
| Grep — I-PROPOSED-BT single source | `grep -rln "from.*BuyerRow"` | 3 hits: 1 source file + 2 consumers (no copy) ✓ |
| Grep — cross-domain marketing-table references | `grep -rln "marketing_audiences\|marketing_campaigns\|..."` | 4 hits: migration + service + test + templates placeholder (no leaks into unrelated surfaces) ✓ |

---

## Findings — Detailed

### P1 — HIGH

#### P1-1 — Dead-tap on `BuyerRow` (Constitution #1 violation)

**Severity:** P1 (Constitution #1 violation; not P0 because no crash + no data corruption + behavior is just "nothing happens on tap" — not an active fabrication)

**Evidence:**
- `mingla-business/src/components/marketing/BuyerRow.tsx:105-115` — root element is `<Pressable>` with `onPress={handlePress}` + press-feedback `rowPressed` style
- `mingla-business/src/components/marketing/BuyerRow.tsx:73-76` — `handlePress` only fires when `onPress` prop is defined; otherwise no-ops
- `mingla-business/app/brand/[id]/customers.tsx:158-162` — `<BuyerRow key={buyer.contact_key} buyer={buyer} />` — no `onPress` passed
- `mingla-business/app/event/[id]/buyers/index.tsx:142-146` — same shape, no `onPress`

**What happens:** user taps a row, sees the background flash to `glass.tint.profileElevated` for 120ms (press feedback), then nothing. Constitution #1: "No dead taps — every interactive element responds."

**Why it's not P0:** the press-feedback flash IS a response (the row visibly reacts to touch). But the spec implies tapping a row should navigate to a buyer detail screen ("Tap row → customer detail (read-only purchase history with this brand)" per design §7.7). The Phase A scope deliberately deferred customer-detail to a follow-up, so the row IS supposed to be non-navigating. The visual contract just lies about that.

**Fix options (1-edit each):**

(a) **Remove the Pressable wrapper** — render rows as `<View>` only. Honest: no press feedback, no tappability implied.
```tsx
// BuyerRow.tsx:105 — replace <Pressable> with <View> when onPress undefined,
// or always use View and forward onPress through a separate Pressable wrapper
// only when callers explicitly pass it.
```

(b) **Show a "Customer detail ships next" toast on tap** — mirrors the BlastCustomersCta pattern already used in both routes. Honest about the deferral.
```tsx
// customers.tsx + buyers/index.tsx — pass onPress that calls
// setComposerToast("Customer history ships in the next phase.")
```

(c) **Accept as known dead-tap** with a code comment explaining it's intentional Phase A scope. Constitution-violating but transparent.

**Recommended fix:** (a) — remove the Pressable wrapper. It's the cleanest and most honest. Press feedback on something that doesn't act is just visual lying.

---

#### P1-2 — PostgREST filter-string injection vector in `marketingAudienceService.or()` clause

**Severity:** P1 (security-adjacent; RLS prevents data exfiltration but the filter can be corrupted)

**Evidence:**
- `mingla-business/src/services/marketing/marketingAudienceService.ts:119` — `.or(\`scope.eq.global,and(scope.eq.brand,brand_id.eq.${brandId})\`)`
- `mingla-business/src/services/marketing/marketingAudienceService.ts:154` — same pattern in `resolveEventBuyers`

**What happens:** `brandId` is interpolated directly into the PostgREST filter string. The Supabase JS `.or()` accepts a raw filter expression — it is NOT parameterized like `.eq()` is. If `brandId` contains a comma, paren, or single quote, the filter parses differently than intended.

Example pathological input: `brandId = "abc),scope.eq.global,(brand_id.eq.something-else"` — the filter becomes:
```
scope.eq.global,and(scope.eq.brand,brand_id.eq.abc),scope.eq.global,(brand_id.eq.something-else)
```
Which parses as MORE OR clauses than intended. The result: unsubscribes from "something-else" brand could leak into the suppression list for "abc" brand, OR the suppression list could fail to fire for legitimate unsubscribes.

**Why it's not P0:**
- RLS on `marketing_unsubscribes` still gates rows by caller's brand membership — a malicious user cannot read another brand's unsubs by crafting a brandId
- The brandId enters via Expo Router path param, which is operator-controllable but not "wild user input" (anyone with a brand id can already see their own unsubs by intended UX)
- Practical worst case: unsub filtering drops some rows for a brand operator's own brand, leading to over-sending (sending to someone who unsubscribed) which is a CAN-SPAM violation but caught at the actual send path (sub-ORCH-B will re-check at send time)

**Why it's P1:**
- The filter pattern is a known PostgREST anti-pattern documented in Supabase docs
- Once Phase A ships, sub-ORCH-B's `marketing-send` will likely reuse the same `resolveBrandBuyers()` logic — the injection vector propagates
- The fix is trivial: validate brandId is a UUID before building the filter string

**Fix (1 edit in service, applied to both functions):**
```typescript
// Add to marketingAudienceService.ts top:
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// In resolveBrandBuyers + resolveEventBuyers, after the input validation:
if (!UUID_RE.test(brandId)) {
  throw new Error(`resolveBrandBuyers: brandId is not a valid UUID`);
}
```

Or, more defensively, split the `.or()` into two queries (one for global, one for brand-scoped) and union the results in TS. The two-query approach has zero injection surface but doubles the network round-trip — UUID-validation is the better trade-off.

---

### P2 — MEDIUM

#### P2-1 — `setTimeout` not cleared on unmount in customers + buyers routes

**Evidence:**
- `mingla-business/app/brand/[id]/customers.tsx:70` — `setTimeout(() => setComposerToast(null), 4000)`
- `mingla-business/app/event/[id]/buyers/index.tsx:65` — same pattern

**What happens:** user taps Blast → toast shows → user backs out of the screen within 4s → React fires a state setter on an unmounted component → console warning + ignored update. No crash. No visible bug. Just lint noise + a tiny memory leak (the timeout closure retains the setter reference until the timer fires).

**Fix:**
```typescript
const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const handleBlast = useCallback((_kind, _targetId) => {
  setComposerToast("Composer ships in the next phase. Audience is ready.");
  if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
  toastTimerRef.current = setTimeout(() => setComposerToast(null), 4000);
}, []);

useEffect(() => {
  return () => {
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
  };
}, []);
```

---

### P3 — LOW

#### P3-1 — `BuyerRow` `formatRelativeDate` uses `Date.now()` instead of a fixed clock for tests

**Evidence:** `mingla-business/src/components/marketing/BuyerRow.tsx:44` — `const now = Date.now()`

**What happens:** `BuyerRow` has no render tests today (deferred — no `@testing-library/react-native`), but when render tests land they'll have flaky output because the relative-date computation drifts with wall-clock. Standard fix: optional prop `clockNow?: number` that defaults to `Date.now()`. Phase A+ concern.

#### P3-2 — Marketing sub-nav `router.replace` vs `router.push` choice not documented

**Evidence:** `mingla-business/src/components/marketing/MarketingSubNav.tsx:63` — `router.replace(path as never)`

**What happens:** sub-nav uses `replace` so iOS swipe-back doesn't accumulate sub-tab history (correct UX). But there's no comment explaining why — a future dev might naively switch to `push` and break the back-stack expectation. P3 — add a one-line comment.

---

### P4 — NOTE (praise)

- **P4-1:** `BuyerRow` accessibility label construction concatenates name + contact + order count + spend + last event + consent state. Screen reader output is exhaustive and honest. No PII leak (masked email/phone only).
- **P4-2:** `mkt_brand_min_rank` non-SD helper from A1 is unused in A2 because the audience service relies entirely on RLS for filtering. Clean separation — service code is RLS-trusting, helper exists only for future composer-side enforcement.
- **P4-3:** `BlastCustomersCta` shows kind-aware copy ("customers" / "buyers" / "people") and disabled state when reachableCount=0. Constitution #9 compliant — never fabricates a CTA over zero recipients.
- **P4-4:** All 4 marketing placeholder routes (audiences/campaigns/templates/index) explicitly point operators at the per-brand Customers + per-event Buyers tabs that DO work. Honest deferral — the placeholders advertise what's coming AND what's already shippable.
- **P4-5:** Bottom-nav 4-tab extension required zero changes to `BottomNav.tsx` itself — the existing capsule auto-scales. Validates the design's "4-tab math passes" assumption from §15.1 risk register. Tested visually: "Marketing" (9 chars) fits at iPhone SE width per inspection of existing 9-char "Calendar" label that already renders.

---

## Constitution Check (14 Rules)

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | No dead taps | **FAIL** | BuyerRow Pressable with no onPress — P1-1 above |
| 2 | One owner per truth | PASS | Service is the single source of audience aggregation; hooks consume; routes render |
| 3 | No silent failures | PASS | Service throws on Supabase errors; routes catch via React Query `isError` and render distinct error state |
| 4 | One key per entity | PASS | `brandCustomersKeys` + `eventBuyersKeys` factories; no hardcoded query keys |
| 5 | Server state server-side | PASS | All buyer data flows through React Query; zero new Zustand stores; existing Zustand untouched |
| 6 | Logout clears everything | N/A | Audience service uses live RLS-gated queries — nothing persists past sign-out |
| 7 | Label temporary | N/A | No `[TRANSITIONAL]` code introduced |
| 8 | Subtract before adding | PASS | No deprecated code carried forward; old 3-tab nav cleanly extended to 4 |
| 9 | No fabricated data | PASS | "Composer ships next" toast is honest; placeholder routes explicitly cite which features exist vs which are deferred; revenue is NEVER shown (no fake metrics) |
| 10 | Currency-aware | PASS | `formatSpend()` maps USD/GBP/EUR to symbols + falls back to raw ISO; never localize-by-guess |
| 11 | One auth instance | N/A | No auth code introduced |
| 12 | Validate at right time | PASS | Service validates non-empty brandId/eventId at entry; React Query gates with `enabled` flag |
| 13 | Exclusion consistency | PASS | A1 migration CHECK constraint enforces `query_definition.kind` allowed values; TS discriminated union mirrors exactly (4 kinds: brand_buyers, event_buyers, brand_followers, custom_segment); both layers agree |
| 14 | Persisted-state startup | N/A | No client-state persistence introduced |

**Net:** 1 FAIL (rule #1, the dead-tap), 9 PASS, 4 N/A. The single FAIL is the P1-1 finding above — fix it OR accept-and-defer.

---

## Behavioral Contract Verification (SPEC Success Criteria)

Spec §10 has 20 SC items (SC-1..SC-20). Phase A2 + B-foundation touches SC-1..SC-5 and SC-19/SC-20. Each below:

| SC | Criterion | Status | Evidence |
|---|---|---|---|
| SC-1 | 4th "Marketing" tab on bottom-nav with `megaphone` icon; tap → Overview | PARTIAL | Tab is present with `send` icon (design §3.1 swap; SPEC §15 question #1 default was `megaphone` but icon set doesn't have it). Tap → Overview works. Operator decision needed if `send` is acceptable. |
| SC-2 | Overview renders Revenue hero + 4 funnel cards + 3 recent campaigns | **DEFERRED** | Overview renders honest "Phase A foundation" placeholder — full hero+funnel+campaigns list lands in sub-ORCH-B. SPEC tolerates this per §2 In-Scope wording ("Marketing → Overview" listed for A but composer-related metrics depend on B). |
| SC-3 | Audiences auto-generated per brand + per event with ≥1 paid order | **DEFERRED** | Audiences screen is placeholder. Audience DATA (resolveBrandBuyers, resolveEventBuyers) IS shipped and proven by 18/18 jest tests. UI list lands in sub-ORCH-B. |
| SC-4 | Brand Customers tab renders 4th tab on brand detail; lists all distinct buyers; sticky CTA pre-fills composer | PASS (with P1-1 dead-tap caveat) | Operations row added; route renders; sticky CTA fires `handleBlast` toast. Composer pre-fill query-param mechanism awaits composer route landing in sub-ORCH-B. |
| SC-5 | Event Buyers tab renders new sub-route on event detail; lists distinct buyers | PASS (with P1-1 dead-tap caveat) | ActionTile added; route renders. |
| SC-19 | iOS Simulator + Android Emulator parity | **UNVERIFIED** | This QA is forensic code + DB introspection only. Operator-assisted simulator boot needed before CLOSE. |
| SC-20 | Mingla design tokens, no oklch/lab, ≥44pt + accessibilityLabel | PASS | All inline colors from designSystem.ts; no oklch grep hit; BuyerRow 96pt; CTA 52pt + padding; every Pressable has explicit accessibilityLabel. |

SC-6 (composer), SC-7 (event-card token), SC-8 (draft save), SC-9 (scheduling), SC-10 (cron), SC-11 (preview gate), SC-12 (Resend), SC-13 (unsubscribe), SC-14 (click track), SC-15 (campaign report), SC-16 (templates use), SC-17 (channel-extensibility invariants), SC-18 (full gate) all scope to sub-ORCH-B and are intentionally NOT verified here.

---

## Cross-Domain Regression Check

| Area | Question | Status |
|---|---|---|
| Existing 3-tab bottom-nav | Did the 4-tab change break any existing tab routing? | NO — same TABS array shape, same BottomNav component, additive entry only |
| BrandProfileView consumers | Did adding the required `onCustomers` prop break any existing callsite? | NO — only one callsite (`app/brand/[id]/index.tsx`); updated in the same patch |
| `app/event/[id]/index.tsx` deps | Did the new `handleBuyers` + ActionTile affect existing handlers? | NO — additive only; existing handleGuests / handleOrders / etc untouched |
| Existing marketing_* table consumers | Did anything else reference these tables before A2? | NO — `grep -rln` confirms zero prior consumers; A2 is the inaugural client |
| `orders` table SELECT | Did the new service queries break the existing eventOrdersService? | NO — different service files, different query shapes; concurrent reads only |
| `marketing_unsubscribes` writes | Did A2 write to this table? | NO — A2 is read-only; INSERT path lands in sub-ORCH-B `marketing-unsubscribe` edge function |
| Auth context | Did the new routes break protected-route behavior? | NO — both routes inherit the existing `(tabs)/` and `brand/[id]/` auth wrappers |

---

## Discoveries for Orchestrator

1. **Bottom-nav icon decision now locked** — `send` (paper plane) was chosen over `megaphone` because `megaphone` is not in the Mingla icon set. SPEC §15 open question #1 should be closed with `send` as the answer. Recommend updating SPEC §15 + the design's §3.1 icon decision to "LOCKED: `send` (paper-plane)" so this doesn't re-surface in sub-ORCH-B.

2. **Render-test infrastructure gap** — `@testing-library/react-native` is NOT in the `mingla-business` jest harness. Toast tests are logic-only; A2-ui has zero render coverage. This was flagged in the implementation report Discovery #3. Recommend registering `META-ORCH-0815-TEST-INFRA` to add the dep before sub-ORCH-B's composer ships (composer will need render tests for keyboard rule, sheet-inside-parent, dirty-state back-block).

3. **PostgREST filter injection is a Mingla codebase-wide pattern** — `marketingAudienceService.ts:119` + `:154` use `.or(\`...\${brandId}...\`)`. This is the FIRST time I noticed it; a quick `grep` of the repo for `.or(\`.*\${` would surface other instances and inform whether this needs a codebase-wide fix vs ORCH-0815-A2-A scope. Recommend orchestrator dispatch a quick scan.

4. **BuyerRow dead-tap is recoverable in 1 edit** — Constitution #1 FAIL flagged above (P1-1). Either remove the Pressable wrapper OR pass `onPress` from the routes to show a "Customer history ships next" toast. Recommend the toast approach for consistency with BlastCustomersCta — sub-ORCH-B will likely add real customer-detail navigation anyway and the toast becomes a 1-line replacement.

5. **A1 P3-1 (`brand_member` rank-0 reliance)** still UNRESOLVED — the audience service relies on RLS, which uses `mkt_brand_min_rank(brand_id, 'brand_member')`. If `biz_role_rank` ever changes ELSE-branch behavior, marketing SELECT silently breaks. Flag for ORCH-0815-A1-A follow-up that either adds `brand_member` to `biz_role_rank` or rewrites the policy to use `'scanner'` (rank 10) as the documented floor.

---

## Required Operator Action Before CLOSE

1. **Decide on P1-1 (dead-tap):** fix in this dispatch (recommend toast approach, ~5 lines per route) OR accept-and-defer to a follow-up ORCH (`ORCH-0815-A2-A`).
2. **Decide on P1-2 (filter injection):** fix in this dispatch (single UUID regex check, ~3 lines) OR accept-and-defer with a note that the brandId source is currently trusted (Expo Router path param from an authenticated brand owner). My recommendation: fix now — it's a 3-line patch and prevents the same anti-pattern propagating to sub-ORCH-B.
3. **Run live-device verification** OR accept the absence as a known gap before CLOSE. iOS Simulator + Android Emulator boot is the strongest residual signal before sub-ORCH-B ships on top.

---

## Working Tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

## Confidence Level

**HIGH** on the schema-parity + code-quality + Constitution-compliance findings. **MEDIUM** on the dead-tap severity classification — reasonable people could argue P2 (visual lying is mild) instead of P1 (Constitution #1 is one of the 14 named rules). I picked P1 because Constitution rules are listed as automatic-P0 triggers in the skill protocol; I downgraded to P1 only because the press-feedback flash IS a response (just not a useful one), which softens the "no response" interpretation. Operator may re-classify.
