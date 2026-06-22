# IMPLEMENTATION — ORCH-1224: marketing `/organisers` → `/business` rename + footer on business only

**Status:** COMPLETE — implemented, self-verified, browser-proven, fails-on-revert proven. NOT deployed, NOT merged, NOT closed.
**Surface:** `mingla-marketing` (marketing-web) ONLY. No backend, no app, no `eas update`, no new deps.
**Branch / worktree:** `1224-business-route-rename-footer` @ `~/Desktop/mingla-orchs/1224-business-route-rename-footer/`
**Commit:** `61c98fa75` (single commit) — rebased onto `origin/main` `39e4cf630` (after META-ORCH-1222 careers merged mid-flight; careers preserved, see "Mid-flight rebase").

---

## 1. What changed

### Part A — Footer: OFF explorer, ON business only
- `mingla-marketing/app/(explorer)/layout.tsx`: removed the ORCH-1223 `<Footer surface="explorer" />` render AND the `Footer` import. Explorer is back to `<GlassNav /> + <main>` (its pre-ORCH-1223 shape) — it is a deliberate one-viewport non-scrolling hero (`hero.tsx` `h-[100svh]`) with its own bottom pill row + Support/Privacy/Terms modal sheets.
- `mingla-marketing/app/business/layout.tsx` (moved): footer KEPT — `<Footer surface="organiser" />`. Renamed the component fn `OrganiserLayout → BusinessLayout`; updated the comment.

### Part B — Route rename `/organisers` → `/business` (+ permanent redirect)
- `git mv mingla-marketing/app/organisers → mingla-marketing/app/business` (layout.tsx + page.tsx). The business page now lives at `/business`.
- `mingla-marketing/lib/subdomain.ts`: `ORGANISER_PATH = '/organisers'` → `BUSINESS_PATH = '/business'` (export name + value + comment); `getSurfaceFromPath` keys off `pathname.startsWith('/business')`. The internal `surface` discriminator VALUE stays `'organiser'` (never user-visible — limits blast radius); surface DETECTION keys off `/business`.
- Repointed every navigable `/organisers` ref → `/business`:
  - `components/marketing/glass-nav.tsx` — surface detection + `homeHref`.
  - `components/marketing/surface-toggle.tsx` — href + surface detection.
  - `components/marketing/footer.tsx` — import + cross-link via `BUSINESS_PATH`.
  - `components/sections/explorer-home/hero.tsx` — SITE_CHIPS pill `{ href:'/organisers', label:'Organiser' }` → `{ href:'/business', label:'Business' }` (the ONLY explorer change allowed).
  - `components/ui/animate-card-animation.tsx` — 3 case-study hrefs `/organisers/case-studies/*` → `/business/case-studies/*`.
  - `components/ui/spotlight-band.tsx` + `lib/subdomain.ts` — historical comments updated to `/business`.
- `mingla-marketing/next.config.ts`: added `async redirects()` — PERMANENT `/organisers` → `/business` AND `/organisers/:path*` → `/business/:path*`.
- `components/sections/organiser-home/` folder NOT renamed (internal, not user-facing — per spec §B.4). The `organiser-redesign.test.ts` references `/organisers` ONLY in a doc comment (line 4), no assertion — left as an intentionally-kept historical comment (NOT modified, no token needed for it).

### Guard
- NEW gate `.github/scripts/strict-grep/i-proposed-1224-business-route.mjs` (I-PROPOSED-1224-BUSINESS-ROUTE): (a) no navigable `/organisers` href in `mingla-marketing/{components,lib}` *.ts/*.tsx (comment-stripped), (b) the `/organisers`→`/business` PERMANENT redirect + its `:path*` sub-path form exist in `next.config.ts`. `--self-test` + wired as workflow job `orch-1224-business-route` in `strict-grep-mingla-business.yml`.
- AMENDED gate `.github/scripts/strict-grep/i-proposed-1223-footer-mounted.mjs` (I-PROPOSED-1223-FOOTER-MOUNTED): now requires the footer on the BUSINESS layout ONLY (`app/business/layout.tsx`, `surface="organiser"`) AND asserts the EXPLORER layout mounts NO footer. Self-test fixtures rewritten (good-business-mount, good-explorer-no-footer, good-explorer-commented, bad-business-no-render, bad-business-commented, bad-explorer-remounted). Workflow job name updated to "ORCH-1223/1224".
- SIBLING gate `i-proposed-1223-footer-links-resolve.mjs` + its adversarial test `i-proposed-1223-footer-links-resolve-adversarial.test.mjs`: updated the `ORGANISER_PATH`→`BUSINESS_PATH` symbol extraction + `/organisers`→`/business` self-test/synthetic-tree fixtures so they keep meaningfully exercising the renamed cross-link symbol (without this, the live gate would silently STOP validating the business cross-link). `[TEST-MOD-APPROVED ORCH-1224]` in the commit body.

**Files changed/moved (17):**
```
 .github/scripts/strict-grep/i-proposed-1223-footer-links-resolve-adversarial.test.mjs | 23 +-   [TEST-MOD]
 .github/scripts/strict-grep/i-proposed-1223-footer-links-resolve.mjs                  | 45 +-   [TEST-MOD]
 .github/scripts/strict-grep/i-proposed-1223-footer-mounted.mjs                        | 187 +-  (amended gate)
 .github/scripts/strict-grep/i-proposed-1224-business-route.mjs                        | 179 ++  (NEW gate)
 .github/workflows/strict-grep-mingla-business.yml                                     | 18 +-
 mingla-marketing/app/(explorer)/layout.tsx                                            | 8 +-
 mingla-marketing/app/business/layout.tsx                                              | 16 ++
 mingla-marketing/app/{organisers => business}/page.tsx                                | 0   (git mv)
 mingla-marketing/app/organisers/layout.tsx                                            | 16 --  (moved+edited)
 mingla-marketing/components/marketing/footer.tsx                                      | 4 +-
 mingla-marketing/components/marketing/glass-nav.tsx                                   | 4 +-
 mingla-marketing/components/marketing/surface-toggle.tsx                              | 4 +-
 mingla-marketing/components/sections/explorer-home/hero.tsx                           | 2 +-
 mingla-marketing/components/ui/animate-card-animation.tsx                             | 6 +-
 mingla-marketing/components/ui/spotlight-band.tsx                                      | 2 +-
 mingla-marketing/lib/subdomain.ts                                                     | 8 +-
 mingla-marketing/next.config.ts                                                       | 10 ++
```

---

## 2. Browser proof (Playwright, headless chromium, against `next build` + `next start` prod server)

| Check | Result |
|---|---|
| `GET /` (explorer) | **200** |
| Explorer `<footer>` count | **0** ✓ |
| Explorer `a[href="/business"]` (Business pill) | **2** present ✓ |
| Explorer stray `a[href^="/organisers"]` | **0** ✓ |
| Explorer Support/Privacy/Terms pill labels | present (1/1/1); **Support click opens `[role="dialog"]` modal, stays on `/`** ✓ |
| Explorer surface toggle "Explorer" `aria-selected` | **true** ✓ |
| `GET /business` | **200** |
| Business `<footer>` count | **1** ✓ |
| Business footer Privacy / Terms / cross-link-to-`/` | 1 / 1 / 1 ✓ |
| Business stray `a[href^="/organisers"]` | **0** ✓ |
| Business surface toggle "Business" `aria-selected` | **true** ✓ |
| `GET /organisers` | **308 Permanent Redirect → `/business`** (lands on `/business`, final 200) ✓ |
| `GET /organisers/foo/bar` | **308 → `/business/foo/bar`** ✓ |

**Note on 301 vs 308:** the spec asked for a "PERMANENT (301)" redirect. Next.js implements `permanent: true` as an HTTP **308** (Permanent Redirect) — the modern spec-equivalent of a permanent redirect that also preserves the request method. This is the correct, standard Next.js behavior; it IS a permanent redirect (cached by browsers/crawlers identically). Use `permanent: true` (done), not a hand-rolled 301.

**Evidence (`Mingla_Artifacts/evidence/ORCH-1224/`):**
- `explorer-no-footer.png` — 1280×900 single-viewport hero, surface toggle (Explorer active), NO footer.
- `business-with-footer.png` — 1280×6075 scrolling business page with footer.
- `business-footer-crop.png` — footer close-up: "Mingla Business" + LEGAL(Privacy/Terms) + "Looking for the consumer app? → Back to Mingla" (`/`) + © line.
- `explorer-support-modal.png` — Support pill → modal sheet open, URL still `/`.

---

## 3. Zero stray `/organisers` refs + redirect confirmation

`grep -rn "/organisers" mingla-marketing --include=*.ts --include=*.tsx` returns ONLY:
- `next.config.ts` — the redirect rule source + its comments (the gate OWNER of the string; intentional).
- `lib/subdomain.ts` — the ORCH-1224 explanatory comment.
- `components/sections/organiser-home/organiser-redesign.test.ts:4` — a historical doc comment (no assertion).

ZERO navigable `/organisers` hrefs / `startsWith('/organisers')` checks remain. `ORGANISER_PATH` symbol: ZERO residue (renamed to `BUSINESS_PATH` everywhere).

Redirect present in `next.config.ts`:
```ts
async redirects() {
  return [
    { source: '/organisers', destination: '/business', permanent: true },
    { source: '/organisers/:path*', destination: '/business/:path*', permanent: true },
  ]
}
```

---

## 4. Gate / tsc / next-build / append-only results

| Item | Result |
|---|---|
| `i-proposed-1224-business-route.mjs` `--self-test` | **PASS** |
| `i-proposed-1224-business-route.mjs` live | **PASS** |
| `i-proposed-1223-footer-mounted.mjs` (amended) `--self-test` | **PASS** |
| `i-proposed-1223-footer-mounted.mjs` (amended) live | **PASS** |
| `i-proposed-1223-footer-links-resolve.mjs` `--self-test` + live | **PASS** (symbol/fixtures updated for rename) |
| `i-proposed-1223-footer-links-resolve-adversarial.test.mjs` | **PASS** |
| marketing `tsc --noEmit` | **EXIT 0 (clean)** |
| marketing `next build` | **clean** — `/business` (24.8 kB), careers routes present, NO `/organisers` route, 12/12 static pages |
| `node .github/scripts/test-append-only-check.js` (GITHUB_BASE_REF=main) | **1 passed, 0 failed** — the modified adversarial `.test.mjs` is accepted because `[TEST-MOD-APPROVED ORCH-1224]` is in the commit body |

---

## 5. Fails-on-revert proof

| Revert | Gate | Result |
|---|---|---|
| Re-add a `/organisers` href in `surface-toggle.tsx` | `i-proposed-1224-business-route.mjs` | **EXIT 1** — "a navigable `/organisers` href survived" |
| Remove the `async redirects()` block from `next.config.ts` | `i-proposed-1224-business-route.mjs` | **EXIT 1** — "missing an `async redirects()` block" + missing bare + missing sub-path |
| Re-mount `<Footer surface="explorer" />` on the explorer layout | `i-proposed-1223-footer-mounted.mjs` | **EXIT 1** — "explorer must NOT mount a footer (ORCH-1224)" |
| Un-mount the footer from the business layout | `i-proposed-1223-footer-mounted.mjs` | **EXIT 1** — "footer is un-mounted (ORCH-1053 failure mode)" |
| (post-restore baseline, both gates) | both | **EXIT 0** |

All reverts caught; working tree fully restored after each.

---

## 6. Invariant registry entries (for the orchestrator at CLOSE)

### AMENDED — I-PROPOSED-1223-FOOTER-MOUNTED (was DRAFT under ORCH-1223; now DRAFT under ORCH-1224)
**File:** `.github/scripts/strict-grep/i-proposed-1223-footer-mounted.mjs`
**Was:** the cleaned footer must be MOUNTED on BOTH surfaces (`app/(explorer)/layout.tsx` `surface="explorer"` + `app/organisers/layout.tsx` `surface="organiser"`).
**Now:** the cleaned footer must be MOUNTED on the BUSINESS surface ONLY (`app/business/layout.tsx`, `surface="organiser"`) AND must NOT be mounted on the EXPLORER surface (`app/(explorer)/layout.tsx` renders NO `<Footer .../>`). Comment-stripped both ways. Guards BOTH the ORCH-1053 silent-un-mount on business (drops Privacy/Terms) AND a stray ORCH-1223-style re-mount on the one-viewport explorer hero. Per Seth 2026-06-22. Self-tested. Workflow job renamed to "ORCH-1223/1224".
**Registry action at CLOSE:** keep the invariant ID (continuity), update its description + ownership to ORCH-1224, flip DRAFT→ACTIVE.

### NEW — I-PROPOSED-1224-BUSINESS-ROUTE (DRAFT until ORCH-1224 CLOSE)
**File:** `.github/scripts/strict-grep/i-proposed-1224-business-route.mjs` (workflow job `orch-1224-business-route`)
**Asserts:** (a) NO navigable `/organisers` href survives in `mingla-marketing/{components,lib}` *.ts/*.tsx (comment-stripped; only tolerated strings are the redirect rule + comments in `next.config.ts` and bare historical code comments); (b) `next.config.ts` has the PERMANENT `/organisers`→`/business` redirect AND its `/organisers/:path*`→`/business/:path*` sub-path form. Self-tested. Flip DRAFT→ACTIVE at CLOSE.

---

## Mid-flight rebase (process note)
META-ORCH-1222 (careers site, PR #652 `39e4cf630`) merged to `origin/main` WHILE this work was in progress. The branch was originally rebased onto the pre-careers `origin/main`. Before committing, a `git diff --stat origin/main` falsely showed ~40 careers files as "deletions" (branch predated them). Diagnosed (branch 2 behind), committed ORCH-1224 as one commit, then `git rebase origin/main` replayed it cleanly on top of careers. Post-rebase: diff vs `origin/main` is EXACTLY the 17 ORCH-1224 files, `mingla-marketing/app/careers/**` PRESERVED, `next build` shows both `/business` and the careers routes, all gates + append-only still PASS. No careers code was touched or clobbered.

## Out of scope / NOT done (per hard guards)
- NO PR opened, NO merge, NO deploy, NO `eas update`. No backend/app/migration/edge-function changes. No new deps (`package.json` untouched; `npm install` only restored the lockfile-pinned set).
