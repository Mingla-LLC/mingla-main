# IMPLEMENTATION — ORCH-1279 · Business "Manage tax and registrations" CTA 404s (wrong web domain)

**Status:** implemented and verified (unit/gate level; runtime unchanged behaviorally except the target host).
**Worktree:** `~/Desktop/mingla-orchs/orch-1279-[tax-registrations-wrong-domain]/` on branch `orch-1279-tax-registrations-wrong-domain`
**Fix + test commit:** `bb3d684cc070bd98ff9fe2aaf0583cf6d66a867c`

---

## 1. Summary

The Brand → Payments "Manage tax and registrations" CTA minted a Stripe Tax AccountSession and opened
a web page whose base URL was resolved from two env vars that are never set in any build
(`EXPO_PUBLIC_MINGLA_PUBLIC_WEB_BASE_URL`, `EXPO_PUBLIC_WEB_BASE_URL`), falling back to
`https://usemingla.com` — the **marketing** app, which has no `/connect-tax-registrations` route and
renders a 404. The route lives only in the mingla-business web export, served at
`business.usemingla.com`.

The fix resolves the base from the canonical `MINGLA_BUSINESS_WEB_URL`
(`mingla-business/src/constants/platformUrl.ts`) — the single source of truth for that domain — and
removes the two dead env-var reads and the `usemingla.com` fallback. One product file changed, plus
a happy-path regression test.

**Before:** `https://usemingla.com/connect-tax-registrations?clientSecret=…&brandStripeAccountId=…` → 404
**After:** `https://business.usemingla.com/connect-tax-registrations?clientSecret=…&brandStripeAccountId=…` → serves the embedded Stripe Tax page

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Commit |
|----|-----------|--------|--------|
| SC-1 | CTA URL base resolves to `business.usemingla.com` via canonical `MINGLA_BUSINESS_WEB_URL` (not the two bogus env vars / marketing apex) | ✓ | `bb3d684c` |
| SC-2 | Trailing-slash normalization preserved; exact query params (`clientSecret`, `brandStripeAccountId`) preserved | ✓ | `bb3d684c` |
| SC-3 | Two dead env-var reads + `usemingla.com` fallback removed; file comment reflects canonical resolver | ✓ | `bb3d684c` |
| SC-4 | Happy-path regression test asserting host/origin, path, no-marketing-apex, and encoded params; fails-on-revert | ✓ | `bb3d684c` |
| SC-5 | Typecheck clean on touched files; strict-grep I-PROPOSED-Y green; no payments/hook regression | ✓ | `bb3d684c` |

---

## 3. Files changed

| File | Δ |
|------|---|
| `mingla-business/src/hooks/useBrandStripeTaxAccountSession.ts` | +19 / −7 (net; env-var reads + fallback removed, canonical import + doc comment added, `taxToolsUrl` now exported) |
| `mingla-business/src/hooks/__tests__/useBrandStripeTaxAccountSession.orch1279.test.ts` | +80 (new) |

`git diff origin/main...HEAD --stat`: 2 files changed, 99 insertions(+), 7 deletions(-).

---

## 4. Data-model changes applied

None. No migrations, schema, RLS, or edge-function changes. Client-only URL-builder fix.

---

## 5. Edge functions touched

None. (The `brand-stripe-tax-account-session` edge function is unchanged and continues to mint the
AccountSession; only the client's post-session web URL host changed.)

---

## 6. Regression tests added

- **Path:** `mingla-business/src/hooks/__tests__/useBrandStripeTaxAccountSession.orch1279.test.ts` (3 tests)
- **Approach:** mocks `expo-constants` extra to supply the canonical `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL`
  (same pattern as `src/constants/__tests__/publicUrls.test.ts`); mocks `expo-web-browser` and the
  Supabase-backed service to keep the import hermetic; imports the now-exported pure `taxToolsUrl`
  builder and asserts:
  1. `URL.origin` === `https://business.usemingla.com`, `host` === `business.usemingla.com`, `pathname` === `/connect-tax-registrations`.
  2. URL starts with `https://business.usemingla.com/connect-tax-registrations` and never contains `://usemingla.com/connect-tax-registrations` (marketing apex).
  3. Both query params present and correctly encoded (round-trip decode + raw percent/form-encoding check).

**Passing run (fixed code):** `Tests: 3 passed, 3 total`.

**fails-on-revert verified at `bb3d684cc070bd98ff9fe2aaf0583cf6d66a867c`** — by true line-deletion of the fix (restored the `process.env.… ?? "https://usemingla.com"` fallback):
```
● … › origin is https://business.usemingla.com …    FAIL (origin was https://usemingla.com)
● … › never emits the marketing apex …               FAIL (url was https://usemingla.com/connect-tax-registrations…)
✓ … › carries both query params (domain-agnostic)     pass
Tests: 2 failed, 1 passed, 3 total
```
Fix restored via `git checkout -- …`; re-run → `Tests: 3 passed, 3 total`; working tree clean.

Both the implementor happy-path test AND the product fix are in the closing diff
(`git diff origin/main...HEAD --name-only` shows both). The tester's adversarial test is a separate
downstream deliverable.

---

## 7. Old → New receipts

### `mingla-business/src/hooks/useBrandStripeTaxAccountSession.ts`
**What it did before:** `taxToolsUrl()` (module-private) resolved its base from
`process.env.EXPO_PUBLIC_MINGLA_PUBLIC_WEB_BASE_URL ?? process.env.EXPO_PUBLIC_WEB_BASE_URL ?? "https://usemingla.com"`.
Both env vars are unset in every build → fallback to the marketing apex → `/connect-tax-registrations` 404.
**What it does now:** base = `MINGLA_BUSINESS_WEB_URL.replace(/\/$/, "")` (imported from `../constants/platformUrl`).
`taxToolsUrl` is now `export`ed for unit testing. Trailing-slash normalization and the two query params
are unchanged. Doc comment added explaining why the base must be the business subdomain.
**Why:** SC-1/SC-2/SC-3 — point the CTA at the domain that actually serves the route.
**Lines changed:** ~19 added / 7 removed.

### `mingla-business/src/hooks/__tests__/useBrandStripeTaxAccountSession.orch1279.test.ts` (new)
**What it did before:** did not exist.
**What it does now:** pins the URL builder to `business.usemingla.com`; fails on any regression to the
marketing apex.
**Why:** SC-4 — CI-enforced regression guard.
**Lines changed:** +80.

---

## 8. Cross-surface impact

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Consumer iOS | No | Consumer app does not surface the tax-registrations CTA. |
| Consumer Android | No | Same. |
| Buyer/anonymous Web | No | Anon buyer routes do not open this CTA. |
| Business iOS | **Yes** | CTA (`WebBrowser.openAuthSessionAsync`) now opens `business.usemingla.com`. Parity: **automatic** (shared `mingla-business/src` code). |
| Business Android | **Yes** | Same shared code path. Parity **automatic**. |
| Admin Web (adjacent) | No | Not a consumer of this hook. |
| Business Web preview (adjacent) | **Yes** | Same shared code; on web the CTA opens the same-origin `/connect-tax-registrations` route on `business.usemingla.com`. Parity **automatic**. |

Parity is automatic across all affected surfaces (one shared RN codebase, one changed builder). No
manual parity work.

---

## 9. Smoke result

No simulator/device runtime run this pass (the change is a pure URL-host swap with no UI/interaction
surface of its own; the CTA wiring is unchanged). Verified at unit + gate level:
- New regression test: 3/3 PASS; fails-on-revert proven by true line-deletion.
- Existing payments + stripe-hook + publicUrls suites: `5 suites, 25 tests, all PASS`.
- Strict-grep I-PROPOSED-Y: self-test PASS, live scan 0 violations over 2058 files.
- `tsc --noEmit`: no errors on any touched file (pre-existing repo-wide errors in unrelated render
  tests / `app.config.ts` / checkout buyer screens are unchanged and not introduced here).

Runtime confirmation (opening the CTA on a business device and observing `business.usemingla.com`
loads the embedded Stripe Tax page) is the tester's live-fire leg.

---

## 10. Known issues / deferred

None. No `[TRANSITIONAL]` code added. (The pre-existing `[TRANSITIONAL]` throw in `platformUrl.ts` is
untouched and unrelated.)

---

## 11. Operator action required

- **Migration `db push`:** none (no migration).
- **Edge-fn deploy:** none. `brand-stripe-tax-account-session` is unchanged; its `verify_jwt` value is
  unaffected by this change.
- Route back to the orchestrator for REVIEW → tester dispatch. Do NOT deploy/merge/close from here.

---

## 12. Discoveries for Orchestrator

1. **ID-numbering note (COMMS-0069, WARN):** COMMS-0069 (2026-07-03, mingla-orchestrator ORCH-1270
   CLOSE) records that `ORCH-1279` was *renumbered from a stray WORLD_MAP registration* for the
   `country?.slice(0,2)`→`venue_listings.country_code` bug (S2). This dispatch and the worktree/branch
   (`orch-1279-tax-registrations-wrong-domain`) use ORCH-1279 for the **tax-registrations wrong-domain**
   bug instead. Both cannot own 1279 — flagging the collision for orchestrator reconciliation of the
   World Map / registry. I proceeded on the dispatch as authoritative (branch + spec both name
   tax-registrations); the numbering is an orchestrator-owned bookkeeping decision, not a code issue.
2. **No behavioral coupling found:** the hook's only runtime consumers (`BrandPaymentsView.tsx`,
   `src/lib/search/registry.ts`) use the unchanged `useBrandStripeTaxAccountSession()` public API — no
   cascade changes needed.
