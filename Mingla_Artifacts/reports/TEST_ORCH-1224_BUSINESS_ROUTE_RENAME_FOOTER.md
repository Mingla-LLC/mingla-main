# TEST — ORCH-1224: marketing `/organisers` → `/business` rename + footer on business only

**Tester:** mingla-tester (independent verification; assume-broken-until-proven)
**Date:** 2026-06-22
**Surface:** `mingla-marketing` (marketing-web) ONLY
**Branch / worktree:** `1224-business-route-rename-footer` @ `~/Desktop/mingla-orchs/1224-business-route-rename-footer/`, rebased clean on `origin/main` `39e4cf630`. Tip `a9673109f`.
**Method:** read every changed file, ran ALL gates (self-test + live), `tsc --noEmit`, `next build`, append-only check, and ran **runtime** verification (Playwright/Chromium against a real `next build` + `next start` prod server on :4124) with curl redirect tracing. Wrote my OWN adversarial gate test (different angle than the implementor's in-memory self-test) with proven fails-on-revert.

---

## 1. VERDICT: **PASS (with 2 non-blocking P2 notes)**

Every spec requirement is met and runtime-proven. The route rename, permanent redirect (incl. sub-path + query preservation), footer-on-business-only, explorer-no-footer, working pills, surface toggle, gates, tsc, build, and append-only are all green on live evidence. The two P2s below are pre-existing/bounded hygiene items with **zero user-facing blast radius** and do NOT block close.

**Conditions:** none blocking. Recommend the orchestrator log P2-1 (gate `app/` scope gap) and P2-2 (orphaned `organiser-copy-fidelity.test.ts` now reads a moved path) as follow-ups; neither runs in CI today.

---

## 2. P0 / P1 / P2

### P0 — none.
### P1 — none.

### P2-1 — `i-proposed-1224-business-route.mjs` does NOT scan `app/**` (scope gap)
- **What:** the gate's source-scan walks only `mingla-marketing/{components,lib}`. A navigable `/organisers` href re-introduced in an `app/` file (e.g. `app/business/page.tsx`) is **NOT** caught — gate still EXITs 0.
- **Repro (proven live):**
  ```
  printf '\nexport const STRAY = <a href="/organisers/case-studies/leak">leak</a>\n' >> mingla-marketing/app/business/page.tsx
  node .github/scripts/strict-grep/i-proposed-1224-business-route.mjs   # → EXIT 0 (regression NOT caught)
  ```
  (asserted as test T4 in my adversarial test; file restored).
- **Why only P2:** runtime impact is nil — any `/organisers/...` href still 308-redirects to `/business/...` (proven below), so a user never breaks; it's just an avoidable extra hop + a guard blind spot. Today there are zero navigable `/organisers` hrefs in `app/**` (grep-confirmed), so the gap is latent, not active.
- **Fix (follow-up):** add `app` to `SCAN_DIRS` (the route-group `(explorer)`/`business` page/layout tsx), excluding `next.config.ts` as it already does.

### P2-2 — orphaned `organiser-copy-fidelity.test.ts` reads the moved page path
- **What:** `components/sections/organiser-home/__tests__/organiser-copy-fidelity.test.ts:96` does `readFileSync(join(process.cwd(),'app','organisers','page.tsx'))`. The page was `git mv`'d to `app/business/page.tsx`, so this `readFileSync` now throws `ENOENT` if the test is ever run. The implementation report (§3) listed only the `organiser-redesign.test.ts:4` doc comment as a remaining `/organisers` string and did not flag this **active** assertion.
- **Why only P2:** this test file is **orphaned** — it is not wired to any npm script (`package.json` has only dev/build/start/lint/typecheck) and not referenced by any GitHub workflow (`grep` confirmed: zero CI references). It does not run in CI, so it cannot break any pipeline. It's a latent footgun for anyone who runs it by hand.
- **Repro:** `cd mingla-marketing && node components/sections/organiser-home/__tests__/organiser-copy-fidelity.test.ts` → ENOENT on `app/organisers/page.tsx`.
- **Fix (follow-up, append-only-token-gated):** repoint the path to `app/business/page.tsx`, or delete the orphaned test.

---

## 3. Screenshots (in `Mingla_Artifacts/evidence/ORCH-1224/`) + what each proves

| File | Proves |
|---|---|
| `explorer-no-footer.png` | `/` is a single-viewport hero ("Find romantic plans that fit the vibe" + rotating deck card), surface toggle (Explorer active / Business), bottom Support/Privacy/Terms pill row, and **NO footer** at the bottom of the viewport. |
| `explorer-support-modal.png` | Clicking the Support pill opens a `[role="dialog"]` modal sheet ("How can we help?" — email + Privacy/Terms/Delete quick links) **overlaying** the explorer hero; **URL stays `/`** (pill opens a modal, does NOT navigate). |
| `business-with-footer.png` | Full-page `/business` (the old organiser landing) renders and scrolls, with the footer present at the bottom. |
| `business-footer-crop.png` | The business footer: **"Mingla Business"** wordmark + **LEGAL → Privacy / Terms** + cross-link **"Looking for the consumer app? → Back to Mingla"** (`href="/"`) + © 2026 line. |

### Runtime DOM assertions (Playwright, prod server)
| Check | Result |
|---|---|
| `GET /` status | 200 |
| Explorer `<footer>` count | **0** ✓ |
| Explorer headline present | yes ✓ |
| Explorer `a[href="/business"]` (Business pill) | **2** ✓ |
| Explorer stray `a[href^="/organisers"]` | **0** ✓ |
| Explorer toggle: Explorer `aria-selected` / Business `aria-selected` | **true / false** ✓ |
| Support pill → non-consent `[role="dialog"]` | **1**, URL unchanged (`/`) ✓ |
| `GET /business` status | 200 |
| Business `<footer>` count | **1** ✓ |
| Business footer Privacy / Terms / cross-link-to-`/` | 1 / 1 / 1 ✓ |
| Business stray `a[href^="/organisers"]` | **0** ✓ |
| Business toggle: Business `aria-selected` / Explorer `aria-selected` | **true / false** ✓ |
| Business "Get Beta Access" CTA | present (2) ✓ |

*(Note: the page mounts a cookie-consent banner that is itself `role="dialog"` aria-label="Cookie consent"; the script dismisses it first and counts only NON-consent dialogs — so the Support-modal count is clean and not inflated by the consent banner.)*

### Redirect tracing (curl, no-follow + follow)
| Request | Result |
|---|---|
| `GET /organisers` | **308** → `Location: /business` (follow → final `/business`, 200) ✓ |
| `GET /organisers/case-studies/foo?x=1&y=2` | **308** → `Location: /business/case-studies/foo?x=1&y=2` — **sub-path AND query string preserved** ✓ |

308 is accepted as the permanent-redirect verdict (Next.js `permanent: true` emits 308; spec note accepts 301/308 as permanent).

---

## 4. My OWN adversarial test (different angle) + fails-on-revert proof

**File:** `.github/scripts/strict-grep/i-proposed-1224-business-route-adversarial.test.mjs`

**Angle:** the implementor's `--self-test` exercises the gate's matcher *functions on in-memory strings*. My test instead drives the **live gate binary as a subprocess** against **real on-disk perturbations** of the marketing source (then restores), proving the gate's end-to-end behavior on the actual file tree. It also probes the redirect-query-preservation angle (verified separately via curl above) and pins the gate's `app/` scope gap.

**Result (all PASS):**
```
PASS T3 baseline: pristine tree -> gate EXIT 0
PASS T1 fails-on-revert: /organisers href in surface-toggle.tsx -> gate EXIT 1
PASS T2 fails-on-revert: delete async redirects() from next.config.ts -> gate EXIT 1
PASS T4 documented scope gap: /organisers href in app/business/page.tsx -> gate STILL EXIT 0 (P2)
PASS CLEANUP: perturbed files restored (git diff empty)
```
- **T1** (real path, green-on-fix, **fails-on-revert proven**): re-introducing a `/organisers` href in `components/marketing/surface-toggle.tsx` flips the live gate to EXIT 1.
- **T2** (fails-on-revert proven): deleting the `async redirects()` block from `next.config.ts` flips the live gate to EXIT 1.
- **T3** baseline: pristine tree → EXIT 0.
- **T4** asserts the current (gappy) `app/`-scope behavior so any future widening is a deliberate, visible assertion flip (P2-1).
- Self-restoring; final `git diff` guard confirms the tree is clean after the run.

**Separately proven fails-on-revert (footer-mounted gate, explorer-must-not-mount branch):** re-mounting `<Footer surface="explorer" />` on `app/(explorer)/layout.tsx` → `i-proposed-1223-footer-mounted.mjs` EXIT 1 with message *"explorer must NOT mount a footer (ORCH-1224)"*; EXIT 0 after restore. Tree clean.

---

## 5. Gate / tsc / build / append-only results (exact)

| Item | Result |
|---|---|
| `i-proposed-1224-business-route.mjs --self-test` | **PASS** (rc 0) |
| `i-proposed-1224-business-route.mjs` live | **PASS** (rc 0) |
| `i-proposed-1223-footer-mounted.mjs --self-test` (amended) | **PASS** (rc 0) |
| `i-proposed-1223-footer-mounted.mjs` live | **PASS** (rc 0) |
| `i-proposed-1223-footer-links-resolve.mjs --self-test` | **PASS** (rc 0) |
| `i-proposed-1223-footer-links-resolve.mjs` live | **PASS** (rc 0) |
| `i-proposed-1223-footer-links-resolve-adversarial.test.mjs` | **PASS** (rc 0) — all 5 classification cases |
| **My** `i-proposed-1224-business-route-adversarial.test.mjs` | **PASS** (rc 0) |
| All 3 gates wired as real CI jobs in `strict-grep-mingla-business.yml` | confirmed (jobs `orch-1223-footer-links-resolve`, footer-mounted block, `orch-1224-business-route`) |
| marketing `npx tsc --noEmit` | **EXIT 0 (clean)** |
| marketing `npm run build` (next build) | **clean** — route map shows `/business` (24.8 kB) + careers routes; **NO `/organisers` route** (redirect, not a page); 12/12 static pages |
| `GITHUB_BASE_REF=main node .github/scripts/test-append-only-check.js` | **1 passed, 0 failed** — the modified adversarial `.test.mjs` is accepted via `[TEST-MOD-APPROVED ORCH-1224]` token in the commit body |

---

## 6. Source verification (read every changed file)
- `app/(explorer)/layout.tsx` — `GlassNav` + `<main>` only, NO `<Footer>` import/render (ORCH-1224 comment explains why). ✓
- `app/business/layout.tsx` — imports `Footer`, renders `<Footer surface="organiser" />`; fn renamed `BusinessLayout`. ✓
- `lib/subdomain.ts` — `BUSINESS_PATH='/business'`; `getSurfaceFromPath` keys off `startsWith(BUSINESS_PATH)`; internal `Surface='organiser'` discriminator kept (never user-visible). ✓
- `next.config.ts` — `async redirects()` with bare + `:path*` permanent `/organisers`→`/business`. ✓
- `components/marketing/surface-toggle.tsx` + `footer.tsx` — all hrefs `/business`, footer cross-link via `BUSINESS_PATH`. ✓
- `git grep` for navigable `/organisers` hrefs / `startsWith('/organisers')` → **0**; `ORGANISER_PATH` symbol → **0 residue**. Remaining `/organisers` strings are: `next.config.ts` redirect rule + comments, `lib/subdomain.ts` comment, and the two orphaned `organiser-home` test files (P2-2 doc + the active-but-uncalled readFileSync). ✓

---

## 7. Scope / hygiene
- No deploy, no merge, no close performed (per dispatch). Test artifacts + my adversarial test committed on the branch only.
- The `app/business/page.tsx`, `surface-toggle.tsx`, `next.config.ts`, and `(explorer)/layout.tsx` files were perturbed during fails-on-revert proofs and **fully restored** (git status clean, verified).
