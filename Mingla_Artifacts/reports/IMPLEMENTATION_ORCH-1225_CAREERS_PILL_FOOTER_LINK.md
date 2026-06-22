# IMPLEMENTATION — ORCH-1225 [careers pill + footer link]

**Skill:** mingla-implementor
**Branch:** `1225-careers-pill-footer-link` (off origin/main, rebased clean)
**Date:** 2026-06-22
**Scope:** marketing-web ONLY. No backend, no app, no `eas update`, no new deps.

---

## Summary

Two Seth-directed additions linking the main marketing site to the careers
site, which lives at the **`career.usemingla.com` SUBDOMAIN** (META-ORCH-1222
apex guard 404s `usemingla.com/careers/*`). Both links therefore use the
**ABSOLUTE external URL `https://career.usemingla.com`** rendered as a real
`<a>` anchor (a relative `/careers` would 404 on the apex). Plus a CLOSE-HARD
regression gate.

### Fix 1 — "Career" pill in the explorer hero
Added a "Career" pill to `SITE_CHIPS` positioned RIGHT AFTER "Business".
- ALWAYS VISIBLE (no `mobileOnly`) → discoverable on desktop where Business is hidden.
  - mobile: Business · Career · Support · Privacy · Terms
  - desktop: Career · Support · Privacy · Terms
- Extended `ChipLink` with `external?: boolean`; added an external-URL render
  branch that emits a real `<a href="https://career.usemingla.com">` with the
  SAME `chipClassName` styling. Same tab (no `target`/`rel`). The
  Support/Privacy/Terms modal special-cases were refactored from a ternary into
  guard-style `if` returns so the external branch falls through cleanly before
  the `<Link>` fallthrough. Entrance motion (the shared `<motion.nav>` row) is
  unchanged. Modal sheets and the non-scroll hero are untouched.

### Fix 2 — "Careers" link in the BUSINESS footer
Added a "Company" column to `organiserColumns` with a single "Careers" link to
`https://career.usemingla.com`. Business footer ONLY — NOT added to
`explorerColumns` (explorer has no footer since ORCH-1224). Extended the footer
link type with `external?: boolean`; external links render as `<a>` (same tab),
internal routes stay Next.js `<Link>`.

---

## Files changed

| File | Change |
|------|--------|
| `mingla-marketing/components/sections/explorer-home/hero.tsx` | `ChipLink.external?`; Career chip in `SITE_CHIPS`; external-`<a>` render branch |
| `mingla-marketing/components/marketing/footer.tsx` | link `external?`; "Company" column with "Careers" link; external-`<a>` render branch |
| `.github/scripts/strict-grep/i-proposed-1225-careers-links.mjs` | NEW — I-PROPOSED-1225-CAREERS-LINKS gate (self-tested) |
| `.github/workflows/strict-grep-mingla-business.yml` | new job `orch-1225-careers-links` + invariant doc line |

**Commit:** `e0f7013ca` (on branch `1225-careers-pill-footer-link`)

---

## Exact rendered hrefs (live, `next start` production build)

Explorer home `/`:
```html
<a href="https://career.usemingla.com" class="glass-soft inline-flex h-7 ... sm:text-sm">Career</a>
```

Business `/business` footer:
```html
<a href="https://career.usemingla.com" class="rounded-sm text-sm text-text-secondary ... focus-ring">Careers</a>
```

Surface checks (live curl):
- `/` : 1 careers anchor (Career pill), 0 `<footer>` (explorer has no footer ✓)
- `/business` : 1 careers anchor (Careers link), "Company" heading present, 1 `<footer>` ✓

Evidence HTML: `Mingla_Artifacts/evidence/ORCH-1225/explorer-home.html`, `business.html`.
(Playwright browsers not installed locally → asserted exact href + render via the
production build's served HTML instead, which is concrete render evidence. The
real `career.usemingla.com` subdomain cannot be hit locally.)

---

## footer-links-resolve gate (1223) — external URL skipped, still PASSES

`i-proposed-1223-footer-links-resolve.mjs` filters to `hrefs.filter(h => h.startsWith('/'))`
— external `http(s)://` hrefs are out of scope, so `https://career.usemingla.com`
is NOT checked against the route set. Gate verified PASS live (see below). The
gate was NOT weakened.

---

## Gate / tsc / build / append-only results

| Check | Result |
|-------|--------|
| `i-proposed-1225-careers-links.mjs --self-test` | **PASS** (exit 0) |
| `i-proposed-1225-careers-links.mjs` (live) | **PASS** (exit 0) |
| `i-proposed-1223-footer-links-resolve.mjs --self-test` | **PASS** (exit 0) |
| `i-proposed-1223-footer-links-resolve.mjs` (live) | **PASS** (exit 0) — external careers URL skipped |
| `i-proposed-1223-footer-links-resolve-adversarial.test.mjs` | **PASS** (exit 0) |
| `i-proposed-1223-footer-mounted.mjs --self-test` + live | **PASS** (exit 0) |
| `i-proposed-1224-business-route.mjs --self-test` + live | **PASS** (exit 0) |
| `i-proposed-1224-business-route-adversarial.test.mjs` | exit 1 — **PRE-EXISTING** P2 "T4 documented scope gap" (identical exit 1 on origin/main; NOT caused by this change) |
| marketing `tsc --noEmit` | **PASS** (exit 0) |
| marketing `next build` | **PASS** (exit 0) — compiled, linted, 12/12 static pages |
| `test-append-only-check.js` (GITHUB_BASE_REF=main) | **PASS** (exit 0) — no test files changed |

No existing test was modified → no `[TEST-MOD-APPROVED]` token required.

---

## Fails-on-revert proof (new 1225 gate)

| Perturbation | Gate exit |
|--------------|-----------|
| Remove Career chip from `hero.tsx` | **1** (fails) ✓ |
| Remove Careers link from `footer.tsx` | **1** (fails) ✓ |
| Downgrade hero Career to relative `/careers` | **1** (fails) ✓ |
| Restored (both at absolute URL) | **0** (passes) ✓ |

---

## I-PROPOSED-1225-CAREERS-LINKS (for the registry)

- **Gate:** `.github/scripts/strict-grep/i-proposed-1225-careers-links.mjs`
- **Workflow job:** `orch-1225-careers-links` in `strict-grep-mingla-business.yml`
- **Status:** DRAFT until ORCH-1225 CLOSE.
- **Asserts:** (a) the explorer hero (`hero.tsx`) has a "Career" chip with href
  `https://career.usemingla.com`; (b) the business footer (`footer.tsx`) has a
  "Careers" link with the same absolute URL. Removing EITHER, or downgrading
  either to a relative `/careers` (404s on the apex), breaks CI. Comment-stripped
  so a commented-out reference never satisfies the gate. Self-tested
  (GOOD + 4 BAD fixtures: hero-removed, hero-relative, footer-removed, footer-commented).

---

## Out of scope / NOT done (per dispatch)

- Did NOT open PR / merge / deploy / close / `eas update`.
- No backend, app, or new-dep changes. (`npm ci` only restored lockfile-pinned
  marketing deps to run tsc/build — no `package.json` change.)
