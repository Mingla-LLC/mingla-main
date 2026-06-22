# IMPLEMENTATION — ORCH-1223 [footer-dead-link-cleanup]

**Skill:** mingla-implementor
**Date:** 2026-06-22
**Branch:** `1223-footer-dead-link-cleanup` (worktree, spawned off `origin/main`, rebased clean)
**Scope:** marketing-web ONLY (`mingla-marketing`). No backend / migration / edge fn / app change / `eas update` / new deps.

---

## 1. Summary

Removed all **9 dead links** from the Mingla marketing footer, collapsed the now-empty
columns, and reflowed the grid so 1–2 link columns sit balanced opposite the brand block
instead of leaving a sparse 4-column skeleton. Added a CI strict-grep gate that
**parses every internal `href` in `footer.tsx` and validates it against the live Next.js
route set** (rebuilt by walking `mingla-marketing/app/**`), so ANY future dead footer
link — not just these 9 — fails CI.

---

## 2. Files changed + commit

| File | Change |
|---|---|
| `mingla-marketing/components/marketing/footer.tsx` | Removed 9 dead links, collapsed empty columns, reflowed grid → flex layout |
| `.github/scripts/strict-grep/i-proposed-1223-footer-links-resolve.mjs` | NEW gate (route-set parser + `--self-test`) |
| `.github/workflows/strict-grep-mingla-business.yml` | Registered `orch-1223-footer-links-resolve` job + registry comment |

**Commit hash:** `b46c25d98a413d82b7c48332573a7ea8adcacf19`

The 9 removed dead links:
- Explorer: `/how-it-works`, `/download`, `/cities`, `/about`
- Organiser: `/organisers/features`, `/organisers/pricing`, `/organisers/case-studies`, `/organisers/help`, `/organisers/get-started`

Surviving footer hrefs (all resolve): `/` (home, `app/(explorer)/page.tsx`), `/support`,
`/privacy-policy`, `/terms-of-service`, `ORGANISER_PATH` = `/organisers`.

---

## 3. Final footer column structure (per surface)

**Explorer surface** (`surface !== 'organiser'`):
- **Company** → Support (`/support`)
- **Legal** → Privacy (`/privacy-policy`), Terms (`/terms-of-service`)
- Cross-link: "Are you a venue or organiser? → Mingla Business" (`/organisers`)

**Organiser surface** (`surface === 'organiser'`):
- **Legal** → Privacy (`/privacy-policy`), Terms (`/terms-of-service`)
- Cross-link: "Looking for the consumer app? → Back to Mingla" (`/`)

Brand blurb block, cross-link, and copyright bar: **untouched**.

---

## 4. How the grid was adapted

The old layout used `grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]` — it hard-coded a
brand column + **4** link columns. With only 2 (explorer) / 1 (organiser) link columns
left, that grid would render a sparse, left-weighted skeleton with empty tracks.

Replaced with a **flex layout**:
- Outer: `flex flex-col gap-12 md:flex-row md:items-start md:justify-between md:gap-16`
  → brand block left, link area pushed to the right edge on desktop; stacks vertically on mobile.
- Brand block: `flex max-w-md flex-col gap-3` (unchanged content).
- Link area: `flex flex-wrap gap-x-16 gap-y-10 md:justify-end` with each column
  `flex min-w-[7rem] flex-col gap-3`.

This makes the column count **data-driven by `cols.length`** — 1 or 2 columns flow
naturally and stay right-aligned/balanced against the brand block; it wraps and stacks on
mobile exactly as before. No empty grid tracks, no fixed `repeat(4,…)`.

---

## 5. Gate + tsc + append-only results

| Check | Result |
|---|---|
| New gate `i-proposed-1223-footer-links-resolve.mjs` `--self-test` | **PASS** (GOOD fixture 0 failures; BAD_A `/how-it-works` ≥1; BAD_B `/organisers/pricing` ≥1; live route-builder sanity) |
| New gate live run (against real footer + `app/**`) | **PASS** — zero dead links |
| `npm run typecheck` (`tsc --noEmit`) in `mingla-marketing` | **PASS** (exit 0, after `npm install` of the standalone app's deps) |
| `npx next build` (`mingla-marketing`) | **PASS** — 12/12 static pages, footer compiles on `/` and `/organisers` |
| Happy-path assertion: none of the 9 removed paths present in `footer.tsx` | **PASS** |
| Workflow YAML parse (js-yaml) | **OK** — 244 jobs, `orch-1223-footer-links-resolve` registered correctly |
| `test-append-only-check.js` (`GITHUB_BASE_REF=main`) | **CLEAN** — no test files changed |
| Full existing `.mjs` strict-grep suite for this workflow | **317/323 PASS**; the 6 non-passing are pre-existing **environmental** (5 need `@babel/parser`/`@babel/traverse` which their CI jobs `npm install`; 1 needs the `expo export` stderr file their CI job generates) — none touch the footer or my gate, not regressions |

---

## 6. Fails-on-revert proof

Re-added the dead `/about` link into the explorer Company column, ran the gate:

```
ORCH-1223 footer-links-resolve gate failed:
- footer href '/about' (normalized '/about') does not resolve to any marketing route
  under mingla-marketing/app/** — it is a DEAD link. I-PROPOSED-1223-FOOTER-LINKS-RESOLVE.
REVERT_GATE_EXIT:1
```

Restored the footer → gate exit 0 ("gate passed"). **Fails-on-revert proven** (exit 1 on
a re-added dead link, exit 0 on the fixed footer). The gate is structural: it does not
enumerate the 9 paths, it rebuilds the live route set, so re-adding ANY non-existent
footer link breaks CI.

---

## 7. Rendered-result note

Verified at **build + source level** (no browser was driven):
- `npx next build` compiled the footer on both surface routes (`/` explorer, `/organisers`)
  with zero errors, confirming the new flex JSX is valid.
- The build's route manifest lists exactly the 9 live routes; every surviving footer href
  is in that manifest and all 9 removed hrefs are absent — so the rendered footer has
  **ZERO dead links** on both surfaces.
- Layout (DOM/source): brand block + blurb on the left, link columns reflow to the right
  via flex `justify-end`, wrapping/stacking on mobile; cross-link + copyright bar unchanged.

A live visual screenshot was not captured (the gate + build provide the deterministic
dead-link and compile evidence; visual balance is a Tailwind flex reflow with no new
tokens). Tester to add the adversarial half + any on-page visual confirmation.

---

## Self-verification (CLOSE-HARD)

- Step-0.5 happy-path regression protection: the new gate IS the regression guard, backed
  by a strict-grep job wired into `strict-grep-mingla-business.yml` (a CI job that
  ACTUALLY RUNS), plus an explicit assertion that none of the 9 paths remain. Invariant
  **I-PROPOSED-1223-FOOTER-LINKS-RESOLVE** is ACTIVE (DRAFT until CLOSE).
- PASS-on-fix + FAIL-on-revert both proven above.
- No `*.test.*` file modified → no `[TEST-MOD-APPROVED]` token needed; append-only check clean.

**NOT closed, NOT deployed, NO PR opened, NO `eas update`** — per dispatch.
