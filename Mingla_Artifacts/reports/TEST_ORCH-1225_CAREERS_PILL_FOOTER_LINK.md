# TEST — ORCH-1225 [Careers pill (explorer hero) + Careers link (business footer)]

**Tester:** mingla-tester
**Date:** 2026-06-22
**Branch:** `1225-careers-pill-footer-link` (worktree `~/Desktop/mingla-orchs/1225-careers-pill-footer-link/`)
**Fix commit under test:** `fdcd42a2d` (clean rebase on `origin/main`, working tree clean at entry)
**Surfaces:** marketing-web ONLY (`mingla-marketing`) — explorer `/` + business `/business`

---

## VERDICT: ✅ PASS — ship-ready, no conditions

The two Seth-directed careers entry points are present, correct, and the single
load-bearing correctness fact (absolute subdomain URL, NOT a relative `/careers`
that would 404 on the apex) is proven at the **rendered-DOM** level, not just in
source. The implementor's source-grep gate AND my independent runtime-DOM gate
both PASS on the fix and FAIL on revert (proven live against a reverted build).
No P0/P1/P2 found.

---

## 1. What was verified

### 1.1 Explorer `/` — "Career" pill
- **Rendered DOM** (live `next start`, prod build): exactly **ONE**
  `<a href="https://career.usemingla.com">Career</a>` chip — absolute URL, real
  anchor (`tagName === "A"`), NOT a button (so it navigates, unlike the
  Support/Privacy/Terms modal pills which remain `<button type="button">`).
- **Placement:** chip order in `nav[aria-label="Site"]` =
  `["Business","Career","Support","Privacy","Terms"]` — Career is immediately
  after Business, exactly as specced. (At 1280px desktop, "Business" is
  `mobileOnly` / `md:hidden`, so Career is the first *visible* chip — correct:
  Career is intentionally always-visible where Business is hidden.)
- **Unchanged surface:** Support/Privacy/Terms still render as modal `<button>`s
  (verified in DOM); rotating hero deck + modal sheets untouched.
- **No footer** on `/` (count `<footer` = 0), preserving ORCH-1224.
- Evidence: `Mingla_Artifacts/evidence/ORCH-1225/home-career-chip.png`,
  `home-chips-row.png`, `home-explorer-full.png`.

### 1.2 Business `/business` — "Careers" footer link
- **Rendered DOM:** exactly **ONE** `<a href="https://career.usemingla.com">Careers</a>`
  anchor element, living **inside** `<footer>`, under a new **"COMPANY"** column
  (heading present), beside the existing **LEGAL** column (Privacy/Terms).
  (Raw HTML shows 3 occurrences of the `career.usemingla.com` string but only
  **1** `<a …>` element; the other 2 are the Next.js RSC flight-payload
  serialization of the same single link — confirmed by anchor-tag regex count = 1.)
- **Footer present** on `/business` (count `<footer` = 1) — business-surface only.
- Evidence: `Mingla_Artifacts/evidence/ORCH-1225/business-footer.png`.

### 1.3 Absolute, NOT relative (the load-bearing point)
- Neither page renders any `href="/careers"` anchor (both grep + DOM-regex = 0).
- **Live apex-guard proof** (curl + node:http, both against the running prod
  server):
  - `GET http://localhost/careers` (apex host) → **HTTP 404**, body marker
    `not-found` (middleware rewrites to `/careers-not-found`, which has no
    route → 404). So a relative `/careers` link WOULD be broken.
  - `GET /careers` with `Host: career.usemingla.com` → **HTTP 200**, real
    careers page (`career` content marker). Proves the apex 404 is the
    META-ORCH-1222 guard, not a build break, and that the absolute URL is the
    only correct form.
- `mingla-marketing/middleware.ts` confirms the mechanism: `isCareersHost(host)`
  rewrites only on the `career.` host; every other host gets the apex guard
  (`/careers*` → `/careers-not-found`).

---

## 2. My OWN adversarial test (independent angle)

**Path:** `.github/scripts/strict-grep/orch-1225-careers-runtime-dom.test.mjs`

**Angle (distinct from the implementor's source-grep gate):** the implementor's
gate reads the **.tsx source**. Mine asserts the **rendered DOM of the built
site** served by a live `next start`, plus the **live apex-guard HTTP behavior** —
catching regressions source-grep structurally cannot (correct-in-source-but-
stripped-at-render, duplicate anchors, explorer footer leaking back on, OR the
apex `/careers` route silently starting to serve a real 200 page, which would
quietly make a relative link "work" and erode the absolute-URL contract).

7 live assertions: (1) `/` has exactly one absolute "Career" anchor; (2) `/` has
no relative `/careers`; (3) `/` has no `<footer>`; (4) `/business` has exactly
one absolute "Careers" anchor *inside* `<footer>`; (5) `/business` has no
relative `/careers`; (6) apex `GET /careers` is NOT a 200 careers page;
(7) subdomain `GET /careers` (Host header) IS 200. Uses `node:http` (not
`fetch`) deliberately — `Host` is a forbidden fetch header and is silently
dropped, which would falsely make the subdomain probe hit the apex.

Also ships a `--self-test` with 9 pure-string fixtures (2 GOOD + 7 BAD:
home-relative, home-missing, home-footer-leak, home-duplicate, biz-relative,
biz-missing, biz-anchor-outside-footer).

### Results
| Run | Mode | Result |
|---|---|---|
| `--self-test` | 9 fixtures, no server | **PASS** (exit 0) |
| live | fix build, server :3457 | **PASS** (exit 0) — "live DOM + apex-guard" |

### Fails-on-revert — PROVEN LIVE (not just source)
I reverted `hero.tsx` + `footer.tsx` to the fix's parent
(`6fae477ae`), **rebuilt** (`next build`, 12/12 pages), and started a **fresh
prod server on :3458**, then ran both gates against the reverted artifacts:

| Gate | Against fix | Against REVERTED build | ✓ |
|---|---|---|---|
| Implementor source-grep `i-proposed-1225-careers-links.mjs` | exit 0 | **exit 1** — both links flagged | ✅ |
| My runtime-DOM `orch-1225-careers-runtime-dom.test.mjs` | exit 0 | **exit 1** — 0 Career anchors on `/`, 0 Careers anchors in `/business` footer | ✅ |

Reverted-build run output (my gate):
```
- / : expected EXACTLY ONE "Career" anchor at https://career.usemingla.com, found 0.
- /business : expected EXACTLY ONE "Careers" anchor at https://career.usemingla.com, found 0.
- /business : the "Careers" anchor must live INSIDE <footer>.
```
Source then restored to `HEAD`; both gates green again. Reverted hash:
`6fae477ae3fe8ff5d5eee139f6d214ab10a09b00`.

---

## 3. Gate / tsc / build / append-only results

| Check | Result |
|---|---|
| `i-proposed-1225-careers-links.mjs --self-test` | PASS (exit 0) |
| `i-proposed-1225-careers-links.mjs` (live) | PASS (exit 0) |
| `i-proposed-1223-footer-links-resolve.mjs` --self-test + live | PASS / PASS — external careers URL legitimately out-of-scope (gate filters `href.startsWith("/")`), NOT weakened |
| `i-proposed-1223-footer-mounted.mjs` --self-test + live | PASS / PASS |
| `i-proposed-1224-business-route.mjs` --self-test + live | PASS / PASS |
| `orch-1225-careers-runtime-dom.test.mjs --self-test` (mine) | PASS (exit 0) |
| `orch-1225-careers-runtime-dom.test.mjs` live (mine) | PASS (exit 0) |
| marketing `npx tsc --noEmit` | PASS (exit 0) |
| marketing `npx next build` | PASS — 12/12 static pages; `/`, `/business`, `/careers*` all built |
| `npm install` (marketing) | clean — **0 new deps** (package.json / package-lock.json unchanged) |
| Append-only | PASS — my test is an **ADDED** `*.test.mjs` file (status A = ALLOWED); no test file modified/deleted/renamed |

---

## 4. P0 / P1 / P2

**None.** No defects found at any severity.

Non-blocking observations (FYI only, no action required):
- The "Career" chip and the footer "Careers" link are same-tab (no
  `target="_blank"`/`rel`). This is intentional per the fix (same brand family).
  Acceptable; a future polish could open the careers subdomain in a new tab, but
  that is out of scope and not a defect.
- The raw `/business` HTML contains the careers URL string 3× (1 anchor + 2 RSC
  flight-payload copies). Verified harmless — exactly one `<a>` element renders.

---

## 5. Evidence index (local, gitignored per repo convention — text report committed)
- `Mingla_Artifacts/evidence/ORCH-1225/home-explorer-full.png` — explorer `/`
- `Mingla_Artifacts/evidence/ORCH-1225/home-career-chip.png` — Career chip in hero
- `Mingla_Artifacts/evidence/ORCH-1225/home-chips-row.png` — chip row (Career/Support/Privacy/Terms)
- `Mingla_Artifacts/evidence/ORCH-1225/business-footer.png` — COMPANY → Careers + footer present
- `Mingla_Artifacts/evidence/ORCH-1225/explorer-home.html`, `business.html` — raw rendered HTML

**Exact hrefs proven (live DOM, Playwright `getAttribute('href')`):**
- `/` Career chip → `https://career.usemingla.com`
- `/business` footer Careers link → `https://career.usemingla.com`

---

## 6. Adversarial test path + fails-on-revert proof (recap)
- Test: `.github/scripts/strict-grep/orch-1225-careers-runtime-dom.test.mjs`
- Self-test: PASS (9 fixtures). Live: PASS.
- Fails-on-revert: PROVEN against a **rebuilt + live-served** reverted artifact
  (parent `6fae477ae`) — exit 1; restored to green.

---

**Scope honored:** No deploy, no merge, no close. Test + report committed on the
branch only.
