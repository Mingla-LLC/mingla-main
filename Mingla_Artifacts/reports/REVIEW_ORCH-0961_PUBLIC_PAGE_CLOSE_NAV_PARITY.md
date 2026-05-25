# REVIEW Report — ORCH-0961 [Public brand + event page dead-end fix; close/back nav parity]

**Reviewer:** Claude `mingla-orchestrator` · **Date:** 2026-05-25 · **Verdict:** **APPROVED → proceed to TEST**.

**Commit reviewed:** `d243050b1` "fix(public): add close fallback chrome" on branch `ORCH-0961-public-page-close-nav-parity`.

**Inputs read:**
- Dispatch prompt `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0961_PUBLIC_PAGE_CLOSE_NAV_PARITY.md`
- Implementation report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0961_PUBLIC_PAGE_CLOSE_NAV_PARITY.md`
- Full diff of `d243050b1` (`git show d243050b1`)
- Re-ran the focused Jest suite at REVIEW time — 2 suites / 4 tests PASS in 3.271s

---

## 1. Commit-hash verification (mandatory per DEC-179)

Every claimed-changed file is present in commit `d243050b1`:

| File | In commit? |
|---|---|
| `mingla-business/src/components/brand/PublicBrandPage.tsx` | ✅ |
| `mingla-business/src/components/event/PublicEventPage.tsx` | ✅ |
| `mingla-business/src/components/brand/__tests__/PublicBrandPage.closeButton.test.tsx` | ✅ (new) |
| `mingla-business/src/components/event/__tests__/PublicEventPage.closeButton.test.tsx` | ✅ (new) |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0961_PUBLIC_PAGE_CLOSE_NAV_PARITY.md` | ✅ (new) |

`git status` shows only `M Mingla_Artifacts/WORKTREE_REGISTRY.md` uncommitted — this is the INTAKE row-add from spawn; it will be reverted-in-place (row removed) in the CLOSE commit per `feedback_orchestrator_removes_registry_row_in_close_commit.md`. No product file is modified-but-uncommitted.

## 2. Dependency walk (mandatory per DEC-179)

No config-layer file is touched (`app.json`, `app.config.ts`, `vercel.json`, `package.json`, `tsconfig*.json`, `metro.config.*`, `babel.config.*`, `next.config.*`, `.github/workflows/**`, `.github/scripts/**`). Dep-walk gate is **N/A — no consumers to assess.**

## 3. Hard-guard check

| Guard | Status | Evidence |
|---|---|---|
| Zero backend touches | ✅ | `git show --stat d243050b1` shows zero paths under `supabase/`. |
| No route-file edits (`app/b/`, `app/e/`, `app/t/`) | ✅ | Route files absent from diff. |
| No public-trip-page edits | ✅ | `app/t/[brandSlug]/[tripSlug].tsx` absent from diff. |
| Use existing `IconChrome` primitive | ✅ | Both components import + render existing `IconChrome` (no new chrome component). |
| `accessibilityLabel="Close"` on X buttons | ✅ | Both components set the label. |
| No `any` / no `@ts-ignore` introduced | ✅ | Implementor grep returned zero matches; spot-check of diff confirms. |
| `orch-strict-grep-allow safearea-on-fullscreen-routes` comment preserved | ✅ | Route files untouched, comments intact. |

## 4. Behavior check

**Brand page `handleClose` (PublicBrandPage.tsx:180-186):**
```ts
router.canGoBack() ? router.back() : router.replace("/")
```
Correct — there is no brand-of-the-brand fallback floor for the brand page; root is the right terminus. Matches dispatch §3.1.

**Event page `handleClose` (PublicEventPage.tsx:205-215):**
```ts
router.canGoBack() ? router.back()
  : brand?.slug ? router.replace(`/b/${brand.slug}`)
  : event.brandSlug ? router.replace(`/b/${event.brandSlug}`)
  : router.replace("/")
```
Correct — uses `brand?.slug` preferentially with `event.brandSlug` (frozen-at-publish slug) as a secondary public fallback before root. Matches dispatch §3.2 with one defensible defensive layer added.

**Constitutional check #1 (no dead taps):** Both buttons are wired to a non-throwing callback; no dead taps. The dead-end this ORCH fixes is the converse — the lack of any tap surface — and that's resolved.

## 5. Regression-test gate (Step 0.5 — partial)

**(a) Implementor happy-path:** ✅
- Paths: `mingla-business/src/components/brand/__tests__/PublicBrandPage.closeButton.test.tsx` + `mingla-business/src/components/event/__tests__/PublicEventPage.closeButton.test.tsx`
- Run at REVIEW: 2 suites / 4 tests PASS in 3.271s
- Fails-on-revert: implementor proved at tree `98833f6774e318774e960440b5c68b6019a545a3` (pass) and `cbe65a007a0cee30982f74d976b832a9290d9180` (fail).
- **Caveat noted by implementor:** repo has no `@testing-library/react-native` renderer installed, so the tests are source-level (assert the JSX block exists in the file content). Acceptable here because the bug is "the chrome block must be present" — source-level assertion attacks it directly. Tester's adversarial test should attack a **different angle** (callback behavior with a mocked router, OR a Playwright DOM assertion on the rendered web build).

**(b) Tester adversarial:** TODO → owned by `mingla-tester` next phase. The Step 0.5 gate runs at CLOSE; this REVIEW only confirms (a) is in place.

## 6. Discoveries from REVIEW (must flow to tester)

1. **Shared-package legacy chrome (implementor §10 + §14):** `packages/event-rendering/PublicEventPage.tsx` still renders a plain-Pressable floating share chrome under the new adapter IconChrome row. The adapter sits above via higher z-index and matching top spacing, but the tester MUST visually confirm on both Playwright Chromium and iOS Safari simulated that:
   - No duplicate Share control is visible underneath the new IconChrome.
   - No duplicate / mis-positioned close control bleeds through.
   - Tap target on the new IconChrome is the one that responds.
2. **`packages/event-rendering` callback rewire:** the adapter now overrides `callbacks.onClose` so the shared renderer routes to the public fallback chain instead of `/(tabs)/hub/events`. Tester should verify the founder/organizer visit (signed-in) is not regressed — the founder dashboard's own chrome is rendered upstream, so this should be inert, but parity warrants a check.
3. **Pre-existing repo blockers documented by implementor (§12):** `npx tsc --noEmit` is red on broader repo debt unrelated to ORCH-0961 (checkout buyer implicit-any, Playwright typings, `@mingla/payments-native` package, IconChrome/Sheet fixtures); ESLint blocked by `@mingla/event-rendering` alias resolver. Neither is introduced by this ORCH. Tester should NOT block on these.

## 7. Verdict

**APPROVED.** Hand off to `mingla-tester` for Playwright Chromium + iOS Safari simulated deep-link checks where `canGoBack()=false`. Tester must:
- Attack the close behavior via runtime/render simulation, not source-level (different angle from the implementor's happy-path).
- Visually verify the shared-package chrome duplication caveat (§6.1) is not user-visible on either browser.
- Verify founder/organizer regression check (§6.2) is inert.

Downstream after tester PASS: orchestrator CLOSE with `[deploy]` tag (touches `mingla-business/src/`) + reap the worktree.
