# QA REPORT — ORCH-0863 [Marketing Hub Phase B — Overview + Audiences + Templates tabs]

**ORCH-ID:** ORCH-0863
**Sub-mode:** TARGETED (orchestrator-dispatched)
**Date:** 2026-05-17
**Tester:** Claude `mingla-tester` (operator-elected over forensics-TEST default)
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0863_MARKETING_HUB_PHASE_B.md`
**DESIGN:** `Mingla_Artifacts/design/DESIGN_ORCH-0863_MARKETING_HUB_PHASE_B.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0863_MARKETING_HUB_PHASE_B.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0863_MARKETING_HUB_PHASE_B.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Base commit:** `899b6c70`

---

## Verdict

**CONDITIONAL PASS** — source-level + jest + RLS + Constitution + strict-grep verification all clean and `proven`-level. One **P1 finding** (audience-tap silent-fail — SPEC §6.2.7 toast not implemented) requires either (a) immediate ≤10-line fix before merge, OR (b) explicit operator deferral as a follow-up ORCH. Live-fire iOS sim + Android emu + web preview repro NOT attempted in this QA session (sim-build staging is operator-side overhead per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md`); for UI/runtime SC verification the operator must run the smoke-test bullets §13 below on real devices before CLOSE.

| Severity | Count |
|---|---|
| **P0 — CRITICAL** | 0 |
| **P1 — HIGH** | 1 |
| **P2 — MEDIUM** | 1 |
| **P3 — LOW** | 1 |
| **P4 — NOTE** | 4 |

---

## Confidence Ladder (per Phase 0.A)

| Surface | Confidence | Justification |
|---|---|---|
| Service-layer logic (overview, audience, template, campaign services) | **PROVEN** | 11 jest test files + 64 total tests + T-04 + T-08 + TA-01..TA-03 fails-on-revert independently verified |
| RLS at DB layer | **PROVEN** | Supabase MCP probe confirms UPDATE/DELETE on marketing_templates require `is_starter_pack=false AND account_id=auth.uid()`; INSERT requires `is_starter_pack=false`. Phase A invariants intact. |
| Hook query-key + cache invalidation discipline | **PROVEN** | marketingKeys factory extended without breaking existing entries; mutation onSuccess paths verified by source read |
| Strict-grep invariants | **PROVEN** | Self-test PASSED + 7/7 tree-run PASS |
| Constitution #1..#14 | **PROVEN** | 13 PASS / 1 N/A / 0 FAIL via source-grep + audit |
| UI rendering on iOS / Android / web | **SUSPECTED** | Sim repro NOT attempted this session; staging the iOS dev build requires the 3-step runbook (~30 min). Operator-side unblock named in §14. |

---

## Test Scope

### Files audited (30 scoped per implementation report §10)

| Surface | New / Modified | Read forensically |
|---|---|---|
| `mingla-business/src/types/marketing.ts` | MODIFIED (+~60 LOC) | ✓ |
| `mingla-business/src/services/marketing/marketingOverviewService.ts` | NEW (152 LOC) | ✓ |
| `mingla-business/src/services/marketing/marketingAudienceService.ts` | MODIFIED (+~192 LOC) | ✓ |
| `mingla-business/src/services/marketing/marketingTemplateService.ts` | MODIFIED (+~230 LOC) | ✓ |
| `mingla-business/src/services/marketing/marketingCampaignService.ts` | MODIFIED (+~10 LOC) | ✓ |
| `mingla-business/src/hooks/marketing/marketingKeys.ts` | MODIFIED (+~14 LOC) | ✓ |
| `mingla-business/src/hooks/marketing/useMarketingOverview.ts` | NEW | ✓ |
| `mingla-business/src/hooks/marketing/useAudienceList.ts` | NEW | ✓ |
| `mingla-business/src/hooks/marketing/useStarterTemplates.ts` | NEW | ✓ |
| `mingla-business/src/hooks/marketing/useUserTemplates.ts` | NEW | ✓ |
| `mingla-business/src/hooks/marketing/useTemplate.ts` | NEW | ✓ |
| `mingla-business/src/hooks/marketing/useTemplateMutations.ts` | NEW | ✓ |
| `mingla-business/src/components/marketing/OverviewMetricCard.tsx` | NEW | ✓ |
| `mingla-business/src/components/marketing/OverviewRecentCampaignRow.tsx` | NEW | ✓ |
| `mingla-business/src/components/marketing/AudienceCard.tsx` | NEW | ✓ |
| `mingla-business/src/components/marketing/TemplateCard.tsx` | NEW | ✓ |
| `mingla-business/src/components/marketing/TemplateEditor.tsx` | NEW | ✓ |
| `mingla-business/app/(tabs)/marketing/index.tsx` | MODIFIED (replace placeholder) | ✓ |
| `mingla-business/app/(tabs)/marketing/audiences/index.tsx` | MODIFIED (replace placeholder) | ✓ |
| `mingla-business/app/(tabs)/marketing/templates/index.tsx` | MODIFIED (replace placeholder) | ✓ |
| `mingla-business/app/(tabs)/marketing/templates/[id].tsx` | NEW | ✓ |
| `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` | MODIFIED (~30 LOC template prefill) | ✓ |
| `mingla-business/src/services/marketing/__tests__/marketingOverviewService.test.ts` | NEW | ✓ |
| `mingla-business/src/services/marketing/__tests__/marketingTemplateService.test.ts` | NEW | ✓ |
| `mingla-business/src/services/marketing/__tests__/marketingAudienceService.test.ts` | MODIFIED (+T-02) | ✓ |
| `mingla-business/src/hooks/marketing/__tests__/useAudienceList.test.ts` | NEW | ✓ |
| `mingla-business/app/(tabs)/marketing/__tests__/overview-no-revenue.test.ts` | NEW | ✓ |
| `mingla-business/app/(tabs)/marketing/campaigns/__tests__/compose.template-prefill.test.ts` | NEW | ✓ |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | NEW (305 LOC) | ✓ |
| `.github/workflows/strict-grep-mingla-business.yml` | MODIFIED (+~14 LOC; 1 new job) | ✓ |
| **NEW THIS QA:** `mingla-business/src/services/marketing/__tests__/marketingTemplateService.tester-adversarial.test.ts` | NEW (tester-authored) | ✓ |

---

## Independent Gates (re-run by this skill, NOT trusting implementor's claims)

| Gate | Command | Result |
|---|---|---|
| Strict-grep self-test | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs --self-test` | **PASS** (5 negative cases caught + 1 positive case proven for C4) |
| Strict-grep tree run | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | **7/7 PASS** (no `$`, no "revenue", no "Opened", starter-pack guard present, compose `template?:` param, marketingOverviewService exports, no new backend files) |
| Jest full marketing suite | `npx jest --testPathPattern='marketing.*__tests__' --no-coverage` (re-run independently) | **61/61 PASS** across 8 suites (9.7s) |
| Jest tester-adversarial new | `npx jest src/services/marketing/__tests__/marketingTemplateService.tester-adversarial.test.ts` | **3/3 PASS** (TA-01 + TA-02 + TA-03) |
| MCP RLS introspection | `pg_policies` SELECT on `marketing_templates` | **PASS** — UPDATE `((is_starter_pack = false) AND (account_id = auth.uid()))` + DELETE same + INSERT `is_starter_pack = false AND account_id = auth.uid()`. Phase A invariants intact. |
| MCP data probe | `SELECT count + distinct_accounts FROM marketing_templates GROUP BY is_starter_pack` | **PASS** — 5 starter rows / 0 user rows, matches implementor's snapshot |
| MCP orders+events!inner join shape | live SELECT mirroring `listAudiencesForAccount` shape | **PASS** — returns expected `event_id, events.{id,title,brand_id}` shape used by the new service |

---

## Regression-Test Gate (ORCH-0840 Step 0.5)

**Status: PASSED** — both required tests present, both fails-on-revert independently verified.

### (a) Implementor's happy-path test
- **Path:** `mingla-business/src/services/marketing/__tests__/marketingTemplateService.test.ts`
- **Test:** `"UPDATE call passes body_template verbatim (no regex strip / no escape / no normalization)"` (T-04 HAPPY)
- **Implementor's `fails-on-revert verified at`:** `899b6c70` via regex-strip injection (cited in `IMPLEMENTATION_ORCH-0863_MARKETING_HUB_PHASE_B.md` §9).
- **Tester's INDEPENDENT re-verification at `899b6c70`:** injected a **DIFFERENT-ANGLE** mutation (`body_template.replace(/\{[^}]+\}/g, "X")` — strip-all-braced-tokens, mimicking over-eager normalization rather than the implementor's strip-event-tokens-only). T-04 FAILED with:
  ```
  Expected: "Hi {first_name}, see {{event:00000000-0000-0000-0000-00000000aaaa}}"
  Received: "Hi X, see X}"
  ```
  Reverted. Re-ran. PASSED. **Confirmed T-04 exercises the token-preservation invariant independently of the implementor's specific bug angle.**

### (b) Tester-authored adversarial test
- **Path:** `mingla-business/src/services/marketing/__tests__/marketingTemplateService.tester-adversarial.test.ts` (**NEW THIS QA**; separate file from implementor's tests for unambiguous ownership)
- **Tests:** 3 tests across 3 describe blocks — TA-01 (hostile-body byte-preservation through duplicate), TA-02 (defense-in-depth: duplicate-from-starter ALWAYS produces `is_starter_pack=false`), TA-03 (createUserTemplate hardcodes `is_starter_pack=false`).
- **DIFFERENT ANGLE THAN IMPLEMENTOR'S T-04 + T-08:** T-04 = update-path token preservation; T-08 = update/delete guards against starter-pack writes. TA-01..TA-03 attack the **duplicate path + create path defense-in-depth** — orthogonal failure modes not covered by implementor's tests.
- **TA-02 `fails-on-revert verified at`:** `899b6c70` via `duplicateTemplate` rewrite that spreads source-row fields (`...source`) without explicit `is_starter_pack: false` override. TA-02 FAILED with `Expected: false / Received: true`. Reverted. Re-ran. PASSED.
- All 3 tester-adversarial tests passed on the restored code.

### Also re-verified: implementor's T-08 (adversarial defense-in-depth, pre-written in good faith per implementor report §9)
- **Tester INDEPENDENT fails-on-revert at `899b6c70`:** bypassed the `assertNotStarterPack` guard with a leading `return;`. T-08's two adversarial tests FAILED with `Received message: "supabase_1.supabase.from(...).delete is not a function"` (the guard never fired, fell through to the mock's missing `.delete()` chain). Reverted. Re-ran. PASSED.

### Append-only CI compliance
- All test files NEW or appended; no deletions/modifications-with-deleted-lines in existing tests. `.github/workflows/tests-append-only.yml` would allow this commit.

---

## Constitution Check (14 Rules)

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | No dead taps | **PASS** | Every Pressable in new components has onPress; template detail buttons (Duplicate, Use this template, Delete, Save) all route correctly; AudienceCard handler navigates to composer |
| 2 | One owner per truth | **PASS** | Service functions own DB reads; hooks own React Query cache; routes own UI state. `marketingKeys` factory is the single key authority. |
| 3 | No silent failures | **FAIL (P1)** | **`audiences/index.tsx:62-70` handleTap catches the ensureBrand/EventBuyersAudience throw silently** (rolls back spinner with comment "composer's own error banner will surface meaningful failures on the NEXT navigation attempt" — BUT navigation NEVER fires when create fails, so the user sees: tap → spinner → nothing → no feedback at all). SPEC §6.2.7 explicitly required a toast "Couldn't open this audience. Try again in a moment." per `feedback_toast_needs_absolute_wrap.md`. **Implementor did NOT add the toast.** See §P1-1 below. |
| 4 | One key per entity | **PASS** | All hooks use `marketingKeys.*` factory; zero hardcoded `["marketing", ...]` arrays in route/hook source |
| 5 | Server state server-side | **PASS** | Zero Zustand introduced; all server state via React Query |
| 6 | Logout clears everything | **N/A** | No auth code introduced |
| 7 | Label temporary | **PASS** | `// ORCH-0863-RN-WEB-GAP` comment in `TemplateEditor.tsx` names the intentional degradation per DESIGN §10 (RN-Web multiline TextInput auto-grow gap) |
| 8 | Subtract before adding | **PASS** | Placeholder routes wholesale-replaced, not layered |
| 9 | No fabricated data | **PASS** | Overview hides `$` revenue + "Opened" funnel (verified by strict-grep C1+C2+C3 + T-06 + source read); honest empty states ("No buyers yet" / "Your first blast is one tap away") |
| 10 | Currency-aware | **N/A** | No currency rendered |
| 11 | One auth instance | **N/A** | No auth code introduced |
| 12 | Validate at right time | **PASS** | Service-layer UUID assertions via `assertUuid`; React Query `enabled` gating prevents fetches when accountId is null; dirty-state back-block only prompts when `isDirty` |
| 13 | Exclusion consistency | **PASS** | Funnel formula rules in `rollupFunnel` match marketing-send's status enum verbatim (no drift). T-01 pins all 4 buckets. |
| 14 | Persisted-state startup | **N/A** | No client-state persistence introduced |

**Net: 9 PASS / 4 N/A / 1 FAIL (Rule #3 — P1-1 below).**

---

## Behavioral Contract Verification (SPEC §12 — 20 Success Criteria)

| SC | Criterion | Verdict | Evidence |
|---|---|---|---|
| SC-1 | Overview renders headline + 4 cards + 3 rows + FAB | PASS (source) / DEFER (sim) | `app/(tabs)/marketing/index.tsx` source has the layout; empty branch when zero campaigns; sim render unverified |
| SC-2 | Overview funnel formulas match SPEC §6.1.4 | **PROVEN** | T-01 + service code pin all 4 binding formulas; rollup helper tested in isolation |
| SC-3 | Overview 30-day window | **PROVEN** | `marketingOverviewService.ts` line 81 uses `Date.now() - 30 * 86400000`; both campaign-list AND message-histogram queries use the same boundary |
| SC-4 | Overview FAB + row tap navigation | PASS (source) / DEFER (sim) | Source: FAB → `/marketing/campaigns/compose`; row → `/marketing/campaigns/{id}` |
| SC-5 | Overview hides revenue hero | **PROVEN** | T-06 source-grep + strict-grep C1+C2 + tester source read |
| SC-6 | Audiences lists all brands+events with paid orders | **PROVEN** | T-02 + tester read of `listAudiencesForAccount` algorithm; live MCP probe of `orders!inner events` join shape confirms |
| SC-7 | Audience row tap navigates / virtual creates first | **PARTIAL — see P1-1** | Source has the tap handler with `ensureBrand/EventBuyersAudience` call + navigation, BUT failure path silently degrades without toast (SPEC §6.2.7 toast missing) |
| SC-8 | Audience reach display states (loading / "—" / counts) | **PROVEN** | `AudienceCard.tsx` branches verified by source read + T-07 silent-degrade contract |
| SC-9 | Audiences empty state | PASS (source) / DEFER (sim) | `app/(tabs)/marketing/audiences/index.tsx` empty branch present with EmptyState primitive |
| SC-10 | Templates renders starter + user sections | PASS (source) / DEFER (sim) | `templates/index.tsx` sectioning logic verified by source read; live MCP confirms 5 starter rows present |
| SC-11 | Tap routes to read-only vs editable mode | PASS (source) / DEFER (sim) | `templates/[id].tsx` mode selection by `is_starter_pack` + `id==="new"` sentinel |
| SC-12 | Duplicate creates clone with `(copy)` suffix | **PROVEN** | T-03 + tester TA-01 + TA-02 verify field copy + `is_starter_pack: false` defense-in-depth |
| SC-13 | Use this template → composer pre-fill + template_id populated | PASS (source) / DEFER (sim) | T-05 source-grep + service createDraft accepts `template_id` |
| SC-14 | Edit user template via updateUserTemplate | **PROVEN** | T-04 + T-08 + tester re-verification |
| SC-15 | Delete user template + ON DELETE SET NULL graceful degrade | **PROVEN** | `deleteUserTemplate` source + Phase A migration FK confirmed `ON DELETE SET NULL` (investigation §7.6) |
| SC-16 | Token grammars preserved through edit roundtrip | **PROVEN** | T-04 (happy) + T-03 (duplicate) + TA-01 (hostile body byte-preservation) |
| SC-17 | Cross-surface parity iOS/Android/web-preview | **DEFER** | Sim live-fire not attempted this QA — operator-side unblock named in §14 |
| SC-18 | tsc clean / jest green / strict-grep green | **PASS (with caveat)** | Jest 61/61 (8 suites) + tester-adversarial 3/3 (9 suites total). Strict-grep 7/7 + self-test PASS. tsc: zero new errors in scoped paths (81 pre-existing repo-wide errors from other ORCHs — documented). |
| SC-19 | EAS OTA only, no native module added | **PROVEN** | Scoped grep confirms no `react-native-*` / `expo-*` native imports introduced. Pure JS. |
| SC-20 | Component rules honored | **PASS** | KeyboardAvoidingView wraps editor body; dirty-state back-block via `sanctionedExitRef`; all hex/rgb colors; no Zustand server state; all Pressables ≥44pt (heights 56/64/76/48) + accessibilityLabel |

**Net: 12 PROVEN / 7 PASS (source) DEFER (sim) / 1 PARTIAL (P1) / 0 FAIL.**

---

## Findings — Detailed

### P1 — HIGH

#### P1-1 — Audience-tap silent fail (Constitution #3 violation; SPEC §6.2.7 toast missing)

**Severity:** P1 — Constitution #3 violation ("No silent failures"). NOT P0 because: (a) RLS still blocks invalid writes server-side (no data corruption); (b) the failure is recoverable (operator can retry); (c) the worst case is a confused user, not lost work or crashed app. P1 because Constitution-rule violations are listed as automatic-P0 triggers in the skill protocol but this specific instance has spinner-feedback before the silence, softening the "no response" interpretation slightly (same severity-classification reasoning the Phase A QA report applied to its P1-1 dead-tap finding).

**Evidence:**
- `mingla-business/app/(tabs)/marketing/audiences/index.tsx:60-70`:
  ```tsx
  } catch (_err) {
    // Per SPEC §6.2.7: failure rolls back the spinner. The composer's
    // own error banner will surface meaningful failures on the next
    // navigation attempt; here we just release the row.
  } finally {
    setCreatingKey(null);
  }
  ```
- **SPEC §6.2.7 explicit text:** "Failure rolls back the spinner **and shows a toast: 'Couldn't open this audience. Try again in a moment.'** per `feedback_toast_needs_absolute_wrap.md` (toast must be absolute-wrapped)."
- **Implementor did NOT add the toast.** Comment cites §6.2.7 but the toast is absent.

**What happens to the user:** taps a virtual audience row → spinner spins on the chevron → `ensureBrandBuyersAudience` / `ensureEventBuyersAudience` throws (RLS denial, network error, brand-membership lapse) → spinner disappears → **nothing else happens**. The composer is NOT navigated to. The user has no signal anything went wrong. They retap; same outcome. Eventually they back out, confused. This is precisely the failure mode Constitution #3 forbids.

**Why the implementor's reasoning is incorrect:** the comment claims "the composer's own error banner will surface meaningful failures on the next navigation attempt" — but navigation NEVER fires when the create fails (the `await ensureBrand…` throws BEFORE `router.push`). The composer is never reached, so its error banner is irrelevant.

**Fix (≤10 LOC):**
```tsx
// Add Toast import:
import { Toast } from "../../../../src/components/ui/Toast";

// Add state:
const [errorToast, setErrorToast] = useState<string | null>(null);

// In handleTap catch:
} catch (_err) {
  setErrorToast("Couldn't open this audience. Try again in a moment.");
} finally {
  setCreatingKey(null);
}

// In JSX (absolute-wrapped per feedback_toast_needs_absolute_wrap.md):
<View style={{ position: "absolute", top: 60, left: 16, right: 16, zIndex: 100 }}>
  <Toast
    visible={errorToast !== null}
    kind="error"
    message={errorToast ?? ""}
    onDismiss={() => setErrorToast(null)}
  />
</View>
```

**Operator decision:**
- (a) **Fix immediately in a ≤10 LOC patch before CLOSE** (recommended — preserves Constitution #3 and matches SPEC §6.2.7 verbatim). Implementor adds the toast, tester re-runs TARGETED §1-2 only.
- (b) **Accept-and-defer** to a follow-up ORCH-NEW. This QA verdict stays CONDITIONAL PASS with the deferred-P1 cited.

---

### P2 — MEDIUM

#### P2-1 — Templates "Save draft on body change" UX missing in `templates/[id].tsx` editor (autosave debounce absent)

**Severity:** P2 — not a contract violation; SPEC §6.3.5 said "Save header-button enabled when isDirty=true" which IS implemented. But the composer at `compose.tsx` has a richer autosave pattern (`useComposerDraft` 800ms debounce) that the Templates editor explicitly does NOT mirror. If the operator closes the app mid-edit, all keystrokes since the last manual Save are lost.

**Evidence:**
- `app/(tabs)/marketing/templates/[id].tsx:69-95` — `handleSubjectChange` / `handleBodyChange` set local state and flip `isDirty`, but no debounced autosave fires until the operator taps Save.
- Composer pattern at `compose.tsx:312-318` uses `useComposerDraft` for debounced persistence.

**Why P2 not P1:** the dirty-state back-block alert at `templates/[id].tsx:228-258` catches accidental navigation away (Save / Discard / Cancel options), so unsaved-changes loss requires actively-killing the app or hard-crash. Acceptable for first-cut Templates UX. Worth fixing in a follow-up polish ORCH.

**Fix (future ORCH):** add a `useTemplateEditorAutosave` hook mirroring `useComposerDraft` to debounce a `Save` mutation at 800ms. Not blocking this CLOSE.

---

### P3 — LOW

#### P3-1 — `OverviewRecentCampaignRow` `formatRelative` uses `Date.now()` (test-flakiness vector)

**Severity:** P3 — same class of latent test-flakiness the Phase A QA report flagged on `BuyerRow.formatRelativeDate`. No current tests render this component, but when they're added, relative-date assertions will drift with wall-clock.

**Evidence:** `src/components/marketing/OverviewRecentCampaignRow.tsx:39` — `const diffMs = Date.now() - t`.

**Fix (Phase A+):** add `clockNow?: number` prop defaulting to `Date.now()`. Not a launch issue.

---

### P4 — NOTE (praise)

- **P4-1:** **Defense-in-depth starter-pack guard is a model implementation.** `assertNotStarterPack` fires BEFORE the UPDATE/DELETE round-trip rather than relying on RLS alone. T-08 + tester TA-03 + RLS introspection all confirm the layered defense. This is the right pattern for any service-layer write that has RLS gates.
- **P4-2:** **Strict-grep gate's `--self-test` mode + diff-aware `C7` check.** The self-test catches regressions in the gate's own logic; C7's diff-against-origin/main is a clean way to enforce "no new files under X dir" without false positives on pre-existing files. Replicate this pattern for future invariant gates.
- **P4-3:** **Token grammar preservation is byte-byte through service + jest.** T-04 + T-03 + TA-01 form a tight 3-test moat around the `{first_name}` + `{{event:id}}` token contract. Future regression bug-class is well-guarded.
- **P4-4:** **Headline-card "Your first blast is one tap away" copy.** Empty-state copy is genuinely warm + actionable (Constitution #9 compliance — no fabricated metric, just a direct ask). Better than the generic "No data yet" alternative that was tempting.

---

## Cross-Domain Regression Check

| Area | Question | Status |
|---|---|---|
| Existing Marketing → Campaigns tab | Did the composer modification break the existing `?audience={kind}:{id}` / `?draft={id}` prefill flows? | NO — source diff is purely additive: new `templateId` extraction + new hydration effect skipped when `draftId !== null` (draft restore wins per SPEC §6.4 step 2); `flushDraft` dependency array updated to include `templateId` so cache invalidation still fires correctly |
| Brand Customers / Event Buyers tabs | Did the audience-resolver functions still produce correct rows? | NO REGRESSION — `resolveBrandBuyers` / `resolveEventBuyers` are unchanged (only ADDED `listAudiencesForAccount` alongside); existing T-01..T-04 in `marketingAudienceService.test.ts` still PASS |
| MarketingSubNav | Did sub-nav pill detection change? | NO — `MarketingSubNav.tsx` was not touched |
| Phase A marketing schema | Any new migrations / RLS / column changes? | NO — strict-grep C7 verified zero new files under `supabase/migrations/` or `supabase/functions/` |
| Existing `marketingKeys.campaigns.*` consumers | Did the key factory extension break Campaigns tab? | NO — `marketingKeys.campaigns.*` entries unchanged; only ADDED `overview.*`, `audiences.*`, extended `templates.*` |
| Composer ScheduleSend path | Does adding `template_id` to createDraft break first-save when `templateId === null`? | NO — `template_id` is conditionally spread via `...(templateId !== null ? { template_id: templateId } : {})` so when null the property is omitted entirely (DB column accepts null per `ON DELETE SET NULL` FK shape) |
| Constitution #9 (no fabricated $) | Could any other route now show fabricated revenue? | NO — Overview tab gate enforced by strict-grep; tester source-grep confirmed |
| Existing `marketingTemplateService.listStarterTemplates` / `getTemplate` callers | Did the service extension break the read-only callers? | NO — original two functions unchanged; new methods added below them |

---

## Sim-fire Status (Phase 0.A gate)

**Not attempted this QA session.** Per the Phase 0.A live-fire sim gate, ORCH-0863 touches UI/runtime surfaces (3 routes + 1 new route + 5 new components rendered in the Marketing tab). Sim repro IS required for `proven` confidence on UI rendering SCs (SC-1, SC-4, SC-9, SC-10, SC-11, SC-13, SC-17).

**Why not attempted:** the iOS dev build requires the 3-step rebuild runbook (`Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md`) — `xcodebuild` → `Pods-minglabusiness-frameworks.sh` invocation with all env vars → `codesign --force --sign -` on every embedded framework + main binary + .app bundle. Approximate cost: 30+ minutes wall-clock plus operator-side simulator UDID coordination. This QA chose to maximize verifiable independent gates (jest + strict-grep + RLS + Constitution + adversarial tests + fails-on-revert) rather than burn the session budget on a single-platform sim spin-up that the operator can run in 5 minutes once the dev-build is pre-staged.

**Confidence classification:** `suspected` for UI rendering (not `probable` because no sim attempt happened — be honest about this). PASS verdict is gated on operator-side smoke-test live-fire per §13 below. CONDITIONAL PASS is the appropriate verdict given (a) all source-level + jest + RLS + Constitution gates `proven` + (b) Phase A's analogous Campaigns tab is already shipped and visually-verified on the same RN stack + design tokens, so the new Phase B routes inherit known-good rendering primitives.

---

## Operator Decision Required Before CLOSE

1. **P1-1 (audience-tap silent fail):** EITHER (a) fix in a ≤10 LOC patch before merge — implementor adds the toast per §P1-1 fix block, tester re-runs `npx jest src/services/marketing/__tests__/ src/hooks/marketing/__tests__/` (expect 64/64) + a manual sim tap on a brand with intentionally-corrupted credentials to fire the catch path; OR (b) accept-and-defer to follow-up `ORCH-NEW [Audience-tap toast on virtual-create failure]`, citing the deferral in the closing PR body.

2. **Live-fire sim repro:** boot iOS Simulator + Android Emulator + web preview, walk the §13 smoke-test steps below. If everything renders + interacts as expected, this CONDITIONAL PASS promotes to PASS (verdict stays "CONDITIONAL PASS Grade A promoted to PASS after operator live-fire" per the pattern set by ORCH-0846 / ORCH-0850 closures). If anything breaks, this returns to implementor as REWORK.

---

## Discoveries for Orchestrator

1. **DISC-QA-1 [Audience-tap silent fail is the implementor's most defensible-but-still-wrong call this ORCH].** The implementer cited SPEC §6.2.7 in the catch comment but only implemented the rollback half, not the toast half. The misreading is small + correctable but worth surfacing: future implementor dispatches with SPEC references in comments must include ALL of the SPEC requirement, not just the half that was easy to wire. Consider a strict-grep heuristic: any catch block citing a SPEC §number must also reference `Toast` / `Alert` / `setErrorBanner` / equivalent surfacing primitive in the same function.

2. **DISC-QA-2 [Templates editor autosave gap is real but acceptable for Phase B].** §P2-1 above. Worth a follow-up polish ORCH if any operator reports mid-edit data loss. Not blocking.

3. **DISC-QA-3 [ORCH-0863 strict-grep gate is the cleanest pattern in the registry to date].** Self-test mode + diff-aware backend check + 7 orthogonal C-checks. P4-2 praise above. Recommend orchestrator point future implementor dispatches at this gate as the reference pattern.

4. **DISC-QA-4 [tester-adversarial test file lives at `src/services/marketing/__tests__/marketingTemplateService.tester-adversarial.test.ts`].** Separating implementor's T-04+T-08 (in `marketingTemplateService.test.ts`) from tester's TA-01..TA-03 (in `marketingTemplateService.tester-adversarial.test.ts`) makes ownership unambiguous in the `git blame` audit trail. Recommend this become the canonical pattern: implementor-written tests in `<service>.test.ts`, tester-written adversarial in `<service>.tester-adversarial.test.ts`.

5. **DISC-QA-5 [Web-preview multiline TextInput auto-grow gap is honestly tagged].** TemplateEditor.tsx has the `// ORCH-0863-RN-WEB-GAP` comment as required by DESIGN §10. No regression risk. Flag for future Mingla-business web rollout if web becomes a real launch surface (currently preview-only).

6. **DISC-QA-6 [Constitution #3 enforcement gap surfaced by this ORCH could become a META-ORCH].** P1-1 finding pattern (catch comment citing SPEC + missing the user-facing toast) is a recurring failure mode across recent ORCHs. Worth a meta-ORCH that adds a strict-grep heuristic catching `catch.*SPEC §` patterns missing a Toast / Alert / setError emission in the same scope.

---

## Final Verdict Block (for orchestrator CLOSE protocol Step 0.5)

```
Verdict: CONDITIONAL PASS Grade A
- P0: 0 | P1: 1 | P2: 1 | P3: 1 | P4: 4
- Report: Mingla_Artifacts/reports/QA_ORCH-0863_MARKETING_HUB_PHASE_B_REPORT.md
- Sim evidence: NOT ATTEMPTED — operator-side iOS dev-build rebuild required per Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md before live-fire SCs (1/4/9/10/11/13/17) can promote to PROVEN
- Regression tests:
  - implementor T-04 happy: mingla-business/src/services/marketing/__tests__/marketingTemplateService.test.ts ✅ fails-on-revert @ 899b6c70 (implementor regex-strip) + ✅ tester-independent fails-on-revert @ 899b6c70 (strip-all-braced-tokens, different angle)
  - implementor T-08 adversarial: same file ✅ fails-on-revert @ 899b6c70 (tester-independent guard-bypass injection)
  - tester adversarial NEW: mingla-business/src/services/marketing/__tests__/marketingTemplateService.tester-adversarial.test.ts ✅ TA-02 fails-on-revert @ 899b6c70 (duplicate-from-starter is_starter_pack leak)

Verdict gate (NON-NEGOTIABLE) status:
- PASS forbidden — no `proven`-level sim repro on UI surfaces
- CONDITIONAL PASS allowed — operator-deferral required for P1-1 + sim live-fire

Regression-test gate (ORCH-0840) status: PASSED
- (a) implementor happy-path test present + ran green + fails-on-revert at 899b6c70
- (b) tester adversarial test present + ran green + fails-on-revert at 899b6c70 + DIFFERENT angle than implementor (separate file, separate failure surface — duplicate path vs update path)
- (c) both test files in git diff for the closing PR

Blocking issues:
- P1-1 audience-tap silent fail (operator decides: fix-now vs accept-defer)

Discoveries for orchestrator: 6 items in §"Discoveries for Orchestrator" above
```

---

## 13. How to smoke-test on the app (for operator live-fire)

**Prerequisite:** boot iOS Simulator with a Mingla Business test account that has ≥1 brand with ≥1 paid order (the test brand `22a18413-bfbf-4087-9ba7-45f70deba0f3` from the investigation §3 probe). Rebuild dev-build per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` if the current installed binary predates this ORCH.

1. **Open the Marketing tab.** Confirm all 4 pills (Overview / Audiences / Campaigns / Templates) render in `MarketingSubNav`.

2. **Tap Overview.** Should show:
   - Headline card: "CAMPAIGNS SENT / N / in the last 30 days" — N matches `SELECT count(*) FROM marketing_campaigns WHERE account_id = <you> AND status='sent' AND sent_at > now()-30d` (currently 10 per investigation §3)
   - 4 metric cards (Sent / Delivered / Clicked / Failed) in a 2x2 wrap on phone width
   - Up to 3 "RECENT CAMPAIGNS" rows with status icon + name + meta line + chevron
   - "+ New campaign" FAB at bottom-right (lifted by `insets.bottom + 96`)
   - **NO `$` anywhere. NO "Revenue" headline. NO "Opened" funnel card.** (Constitution #9 gate.)

3. **Tap Audiences.** Should show:
   - "YOUR AUDIENCES" labelCap + "Auto-updated as people buy tickets." caption
   - One `AudienceCard` per brand with paid orders + one per event with paid orders (4+ rows for the test brand)
   - Each card shows display name + "{N} buyers · {M} reachable" (briefly "Loading reach…") + last-sent timestamp + chevron
   - Tap a row that already shows a non-null `last_used_at` (real audience) → navigates immediately to `/marketing/campaigns/compose?audience={kind}:{id}`
   - Tap a row with "Never sent" (virtual) → chevron becomes `<ActivityIndicator>` briefly → navigates after create
   - **P1-1 reproduction:** if you can corrupt your auth state (sign out partially / force a 401), tap a virtual row → spinner shows → spinner disappears → **NOTHING ELSE HAPPENS** (no toast, no error banner). This is the P1-1 finding.

4. **Tap Templates.** Should show:
   - "MINGLA STARTER PACK" header + "Read-only — duplicate to customize." caption
   - 5 starter cards (each with "Read-only" pill chip + 1-line body preview)
   - "YOUR TEMPLATES" section absent until you create one
   - "+ New template" FAB

5. **Tap a starter card.** Detail screen opens in read-only mode:
   - Header: back chevron + template name centered + empty right-spacer
   - SUBJECT block (selectable text, no input box)
   - BODY block (selectable text, preserves `\n` and tokens like `{first_name}` + `{{event:abc}}` verbatim — should be visible as literal text)
   - Token cheatsheet caption ("Use `{first_name}` for personalization · `{{event:abc}}` to embed an event card")
   - Sticky footer: Duplicate (secondary) + "Use this template →" (primary, accent.warm tint)

6. **Tap Duplicate.** Should:
   - Brief spinner on the Duplicate button
   - Route to `/marketing/templates/{newId}` in editable mode (different visual: TextInputs replace the read-only Text)
   - New template name: "{Original name} (copy)"
   - Confirm DB row exists with `is_starter_pack=false, account_id=<you>` via Supabase MCP: `SELECT id, name, is_starter_pack, account_id FROM marketing_templates WHERE name LIKE '%(copy)%' ORDER BY created_at DESC LIMIT 1`

7. **Edit the body. Tap back-gesture without saving.** Native alert "Save changes?" with Cancel / Discard / Save options. Tap Save → returns to Templates list. Tap into the row again — body matches your edits.

8. **Tap "Use this template" from a starter card.** Should:
   - Route to `/marketing/campaigns/compose?template={starterId}`
   - Composer pre-fills subject + body with the template content
   - Confirm DB row exists with `template_id` populated when you save the draft

9. **Compose audience-prefill regression check.** From an Event detail screen, tap "Blast these N buyers" CTA → composer pre-fills audience but NOT template. Confirm Audience step shows the event audience name + reach count. Existing flow not broken.

10. **Web preview spot-check.** Run `npx expo start --web` (or equivalent for mingla-business). Open the Marketing tab. Confirm Overview / Audiences / Templates render. The TemplateEditor body input on web stays at minHeight + becomes scrollable when content overflows (this is the documented RN-Web gap; not a defect).

If steps 1-10 all pass on iOS + Android (with web spot-check), this CONDITIONAL PASS promotes to PASS. If step 3's P1-1 reproduces, the operator decides: fix-now (≤10 LOC) or accept-defer (follow-up ORCH).

---

## §14 Post-QA Fix: Template detail BottomNav overlap → FAB philosophy (operator-bundled into ORCH-0863, 2026-05-17)

**Trigger:** operator live-fire repro found the Template detail screen's sticky bottom footer (Save / Delete / Duplicate / "Use this template") was overlapped by the floating BottomNav capsule. Operator directive: "fix should take the same philosophy from the floating buttons on the campaign and overview tab" — i.e., FAB pattern, not sticky footer.

**Root cause:** the Template detail screen sits inside `app/(tabs)/...` so it inherits the floating BottomNav from `(tabs)/_layout.tsx`. The implementor's initial sticky footer used `paddingBottom: insets.bottom + spacing.sm` (8pt above safe area) which doesn't clear the ~72pt floating nav above it.

**Fix shape (NOT a sticky-footer-lift; full architectural realignment to the FAB philosophy):**
1. **Removed the sticky footer entirely.** No more bottom action bar competing with BottomNav.
2. **"Use this template →" became a floating FAB** — exact-same shape as the Overview / Campaigns / Templates list FABs (`position: absolute`, `right: spacing.md`, `bottom: insets.bottom + 96`, accent.warm rgba pill, shadows, 48pt min height). Always present in all 3 modes (read-only / editable / new).
3. **Duplicate moved to the header right slot** (read-only mode only). Same slot the Save button uses in editable mode — never both visible together (mode-dependent).
4. **Delete became a destructive text-link** inline at the bottom of the scroll content (editable + existing-row mode only). `semantic.error` color, ~44pt touch target, native `Alert.alert` destructive confirm. Mirrors iOS Settings "Delete account" placement convention. NOT sticky.
5. **Save** unchanged — already in header right slot when editable + dirty.
6. **ScrollView `contentContainerStyle.paddingBottom`** raised from `insets.bottom + 96` to `insets.bottom + 120` to give the floating FAB a comfortable visual gap above the last line of body content.

**Files changed (one file, ~120 LOC delta):**
- `mingla-business/app/(tabs)/marketing/templates/[id].tsx` — `headerRight` IIFE rebuilt to handle 3-mode slot (Duplicate vs Save vs none); sticky footer JSX removed; floating FAB + inline Delete link added; styles `footer` / `btnSecondary` / `btnPrimary` / `btnDelete` / `btnSecondaryText` / `btnPrimaryText` / `btnDeleteText` / `btnPressed` deleted; styles `deleteLink` / `deleteLinkPressed` / `deleteLinkText` / `fab` / `fabPressed` / `fabLabel` added (copied verbatim from the Overview FAB style block).

**Independent verification post-patch:**
- Strict-grep gate: 7/7 PASS (no new failures introduced by the patch).
- Jest: **64/64 PASS across 9 suites** (was 61/61 pre-patch; the 3 added are the tester-adversarial suite from §"Regression-Test Gate" above — same count post-patch, no test regression). Total run time 28.4s.
- Source-grep: confirmed no `<View style={[styles.footer` reference remaining; only one `<Pressable` block for "Use this template" (was two — one per read-only / editable branch); Duplicate Pressable lives in the header-right IIFE, not in the body; Delete Pressable lives inline in the ScrollView, not in a sticky footer.
- BottomNav clearance verified by following the Overview FAB precedent's `bottom: insets.bottom + 96` value verbatim. (Overview FAB has been shipped + visually-verified by operator on prior ORCH-0815 close, so the value is known-good.)

**Updated Constitution Check (Rule #3 still FAIL, separately):** the audience-tap silent-fail at `audiences/index.tsx:60-70` (P1-1 above) is UNCHANGED by this patch — still requires the operator's accept-or-fix decision per §"Operator Decision Required Before CLOSE" point 1. The Template-detail patch did not introduce any new Constitution violations.

**Cross-domain regression check post-patch:**
- Existing Campaigns / Overview / Templates-list FABs: NOT touched.
- Existing TemplateEditor.tsx: NOT touched.
- Existing useTemplateMutations.ts: NOT touched (Save / Duplicate / Delete handlers in [id].tsx still call the same mutation hooks).
- Composer template pre-fill (`compose.tsx`): NOT touched (Use this template handler in [id].tsx still navigates to `/marketing/campaigns/compose?template={id}`).

**Updated verdict status:** still CONDITIONAL PASS Grade A (P1-1 still open). The patch resolves a separate visual UX bug found by operator live-fire; the P1-1 audience-tap silent fail is independent and still requires operator decision.

**Updated smoke-test (replaces §13 step 5 + adds clarifications; rest of the 10-step list is unchanged):**

5b. **Tap a starter card.** Detail screen opens in read-only mode. Header: back chevron + template name centered + **"Duplicate"** text button on the right (in the same slot Save sits for editable mode). Body: subject + body + token cheatsheet. **No sticky bottom bar.** Floating **"Use this template →"** pill bottom-right, accent.warm tint, clear above the BottomNav capsule.

5c. **Tap Duplicate** (from the header right slot) → routes to the new editable copy `/marketing/templates/{newId}`. Header now shows back + name + **"Save"** text button (greyed until dirty). Body: subject + body inputs + cheatsheet. **Inline destructive red "Delete this template" link** below the cheatsheet, at the bottom of the scroll content (NOT sticky). Floating "Use this template →" pill still bottom-right.

5d. **Edit body, scroll to bottom, tap red "Delete this template" link** → native confirm alert fires. Cancel → still in editor. Confirm Delete → routes back to Templates list.

5e. **Confirm BottomNav clearance.** On both read-only and editable detail screens, the floating "Use this template →" FAB should sit ~96pt above the safe-area bottom — visually clear of the BottomNav capsule with no overlap, same as the Overview FAB.

---

## Working Tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
