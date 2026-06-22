# TEST — ORCH-1223 [footer-dead-link-cleanup]

**Skill:** mingla-tester
**Date:** 2026-06-22
**Branch:** `1223-footer-dead-link-cleanup` (worktree; `git fetch && rebase origin/main` → clean, up to date)
**Scope under test:** marketing-web only (`mingla-marketing`) — 9 dead footer links removed, grid→flex reflow, new strict-grep gate.

---

## VERDICT: CONDITIONAL PASS

The *code change* is correct and well-guarded: the 9 removed footer hrefs genuinely 404, every surviving href resolves to a real 200 page, the new gate's route-resolution logic is sound (proven on adversarial edges the implementor never tested, with fails-on-revert), tsc/append-only/self-test all green.

**The condition is a scope/premise correction, not a code defect:** the `Footer` component edited by ORCH-1223 **is not rendered on any live page**. It has been **dead, unmounted code since ORCH-1053 (`ee5c8df38`)**. No user can see or click these links on `/` or `/organisers` (both render `<footer> count = 0` at runtime). So the bug as framed — "dead links 404ing for users" — has **zero live blast radius today**. ORCH-1223 is a correct *source-hygiene + regression-guard* change to a currently-unused component, NOT a user-facing fix. The dispatch's headline browser proof ("screenshot BOTH footers", "click each surviving footer link") was **not literally satisfiable** because there is no rendered footer to screenshot.

This is a CONDITIONAL (not FAIL) because nothing the implementor built is wrong, and the gate is a genuine, CI-enforced, CLOSE-HARD-grade regression guard that will protect the footer the moment it is ever re-mounted. The condition is: **the orchestrator must record that this is dead-component hygiene, not a live fix, and decide whether re-mounting the footer is in or out of scope.**

---

## P0 / P1 / P2

### P1-A — Edited component is dead code; not mounted on any route (premise correction)
- **Repro:** `cd mingla-marketing && npm run dev`; Playwright `await page.locator('footer').count()` on `http://localhost:3000/` → **0**; same on `/organisers` → **0**. Source: zero files import `components/marketing/footer.tsx` (exhaustive grep across `app/` + `components/`). `app/(explorer)/layout.tsx` renders only `GlassNav` + `<main>`; `app/organisers/layout.tsx` line 10 carries the explicit comment `{/* ORCH-1053 — footer removed from the business (organiser) surface per operator. */}`.
- **History:** `git log -S "marketing/footer" --all` → last mount-touching commit `ee5c8df38` (ORCH-1053, "remove organiser-surface footer"). The component has been orphaned ever since.
- **Impact:** the 9 dead links were never reachable by a user (no footer renders), so this ORCH did not fix a live defect. It is correct source hygiene + a forward-looking guard.
- **Action for orchestrator:** record ORCH-1223 as dead-code cleanup + regression guard. If a footer is wanted live, that is a separate ORCH; the gate here will protect it automatically once mounted.

### P2-A — Gate is invisible to JSX inline-literal hrefs (`href={'/x'}`)
- **Repro:** the gate's extractor regex `/href\s*[:=]\s*(['"`])…/` matches `href: '/x'` (object property) and `href="/x"` (string attr) but **not** `href={'/x'}` (JSX curly-brace expression). A footer authored with `<Link href={'/ghost'}>` yields "No internal hrefs found … parser likely broke" (the fail-closed guard fires, exit 1) rather than flagging `/ghost` specifically. Confirmed in `/tmp` repro.
- **Impact:** none today — the real footer authors all literal hrefs as `href: '/…'` object properties (verified lines 16/21/22/31/32/41/42) and renders them via `href={l.href}` (a *variable*, correctly out of literal-scope). The fail-closed guard still prevents a silent pass. But if a future edit inlines a literal `href={'/dead'}`, the gate fails with a misleading "parser broke" message instead of naming the dead link.
- **Action:** optional hardening — extend the extractor to also match `href={'…'}` / `href={"…"}`. Non-blocking.

No P0. No other P1/P2.

---

## Browser evidence (screenshots)

All under `Mingla_Artifacts/evidence/ORCH-1223/` (Playwright/Chromium 1.61, viewport 1280×900, against the marketing `npm run dev` server):

| File | What it proves |
|---|---|
| `page-bottom-explorer-home.png` | Bottom of `/` (HTTP 200). Renders the ExplorerHero; **no `<footer>` element** (runtime `footer count = 0`). Proves the marketing footer does not render on the explorer surface. |
| `page-bottom-organiser.png` | Bottom of `/organisers` (HTTP 200). Blank dark region, **no footer** (runtime `footer count = 0`, 5 KB near-solid image). Proves the footer is absent on the organiser surface (consistent with the ORCH-1053 removal comment). |
| `dead-route-404-example.png` | A removed route (`/about` / `/how-it-works` / `/organisers/pricing`) returns **HTTP 404** — confirming those links WOULD have been dead had the footer rendered, validating the gate's premise. |

**Surviving footer-href routes — runtime 200 (not the not-found page):**
```
/                 -> HTTP 200  title="Mingla — Find a vibe, not a venue."        404-ish=false
/support          -> HTTP 200  title="Support — Mingla"                          404-ish=false
/privacy-policy   -> HTTP 200  title="Privacy Policy — Mingla"                   404-ish=false
/terms-of-service -> HTTP 200  title="Terms of Service — Mingla"                 404-ish=false
/organisers       -> HTTP 200  title="Mingla Business — …"                       404-ish=false
```
**Removed routes — runtime 404 (proving the cleanup's premise):**
```
/about            -> HTTP 404
/how-it-works     -> HTTP 404
/organisers/pricing -> HTTP 404
```

> Note: the dispatch asked to screenshot "BOTH footers" and click each *surviving footer link*. Because no footer renders, I instead proved (a) no footer exists on either surface and (b) the 5 routes the surviving footer hrefs point at all 200, and the 9 removed ones all 404. This is the strongest available evidence given the component is unmounted.

---

## Adversarial test (my own, distinct axis) + fails-on-revert

**Path:** `.github/scripts/strict-grep/i-proposed-1223-footer-links-resolve-adversarial.test.mjs`

**Distinct angle:** the implementor's `--self-test` only re-added flat dead links against a **hard-coded** `FAKE_ROUTES` set. My test drives the gate's **real `buildRouteSet` App Router walker** against a **synthetic on-disk tree** (created in a tmp dir, real `page.tsx` files) and runs the **actual gate binary as a subprocess** (verbatim copy, unmodified) — so it tests the shipped route-resolution code, not a re-implementation. It attacks edges the implementor never touched:

1. route **GROUP index** `(explorer)/page.tsx` → `/` (accept)
2. route-group-wrapped **NESTED DYNAMIC** `(blog)/blog/[slug]/page.tsx` → exact href `/blog/[slug]` (accept)
3. **TRAILING-SLASH** normalization `/support/` → `/support` (accept)
4. **PRIVATE folder** `_draft/secret/page.tsx` → href `/_draft/secret` **rejected** (not a route)
5. **wrong dynamic shape** `/blog/anything` (literal, not `[slug]`) → **rejected**
6. **plainly fake** `/ghost` → **rejected**

Fixtures mirror the real footer's authoring style (`{ href: '/…' }` object props rendered via `href={l.href}`).

**Green run:**
```
PASS [exit 0, want 0] GOOD: group index "/" + nested dynamic + trailing-slash + ORGANISER_PATH
PASS [exit 1, want non-0] REJECT: href into a PRIVATE _draft folder (not a real route)
PASS [exit 1, want non-0] REJECT: wrong dynamic shape /blog/anything (literal, not the [slug] route)
PASS [exit 1, want non-0] REJECT: plainly fake /ghost
PASS [exit 0, want 0] ACCEPT: organisers nested static route, exact
ORCH-1223 adversarial gate test passed (…all correctly classified).  exit=0
```

**Fails-on-revert (PROVEN):** I broke the gate's route-group stripping (`const nextSegments = [...urlSegments, entry]`, no `isGroup` check) so `(explorer)` index resolves to `/(explorer)` instead of `/`.
- Reverted gate hash: **`d234c478aab80d40cd263ca39f2018cfb8030788`**
- Adversarial test on broken gate: **FAIL** — `FAIL [exit 1, want 0] GOOD: group index "/" …` (adv-exit=1). (The implementor's own self-test also caught it: `routeBuilderOk: false`.)
- Restored gate hash: **`dce180275942d93a792ec5d013121352b3829d4d`** → adversarial test exit 0, gate live exit 0.

So my test reliably fails on a real regression of the route-resolution logic and passes on the shipped code.

---

## Gate / tsc / append-only results

| Check | Command | Result |
|---|---|---|
| New gate `--self-test` | `node .github/scripts/strict-grep/i-proposed-1223-footer-links-resolve.mjs --self-test` | **PASS** (exit 0) |
| New gate live | `node …/i-proposed-1223-footer-links-resolve.mjs` | **PASS** — "gate passed", zero dead links (exit 0) |
| My adversarial test | `node …/i-proposed-1223-footer-links-resolve-adversarial.test.mjs` | **PASS** (5/5, exit 0) |
| Marketing typecheck | `cd mingla-marketing && npm run typecheck` (`tsc --noEmit`) | **PASS** (exit 0; `npm install` added **no** package.json/lock diff — worktree clean, no new deps) |
| Append-only | `GITHUB_BASE_REF=main node .github/scripts/test-append-only-check.js` | **CLEAN** — new `.test.mjs` is an *added* file (status A → allowed, no token needed) |
| Workflow registration | `strict-grep-mingla-business.yml` | Job `orch-1223-footer-links-resolve` present (lines 358-369): self-test step + live step, `actions/checkout` + `setup-node@20`, well-formed, matches sibling job shape. Registry comment at line 135. |
| Route facts on disk | `find app -name page.tsx` | 9 routes: `(explorer)`→`/`, `delete-account`, `intent-preview`, `organisers`, `privacy-policy`, `sms-terms`, `support`, `terms-of-service`, `unsubscribe`. All 5 surviving footer hrefs present; all 9 removed hrefs absent. |
| Dead links absent in footer | grep | none of the 9 removed paths remain in `footer.tsx`. |

---

## Accessibility / layout sanity

- **Source-level:** the reflowed footer keeps semantic `<footer>` + `<ul>/<li>` lists, each `<Link>` carries `focus-ring`, the outer wrapper is `flex flex-col … md:flex-row` (stacks on mobile, row on ≥md), link columns `flex-wrap … min-w-[7rem]` (wrap/stack on narrow). Keyboard nav and mobile stacking are preserved by construction — this matches the prior structure, just flex instead of a 4-col grid.
- **Runtime caveat:** I could **not** exercise keyboard-tab / mobile-stack behavior in the browser **because the footer never renders on any page**. This is a direct consequence of P1-A. If the footer is re-mounted in a future ORCH, a live a11y/responsive pass should be run then.

---

## What I verified vs. what I could not

- **Verified (runtime + source):** 9 removed hrefs 404; 5 surviving hrefs 200; gate self-test + live + adversarial green; fails-on-revert proven with hashes; tsc clean; append-only clean; no new deps; workflow job registered; footer authors hrefs in the colon form the gate parses.
- **Could not verify (blocked by P1-A, not a code defect):** rendered footer visual balance, in-footer link clicks, in-footer keyboard nav, in-footer mobile stacking — **there is no rendered footer**. The build/source/runtime route evidence is the deterministic substitute.

---

## Recommendation

**CONDITIONAL PASS — safe to merge as source-hygiene + a CLOSE-HARD regression guard.** Before CLOSE, the orchestrator should:
1. Record in the World Map that ORCH-1223 cleaned **dead/unmounted** footer code (not a live user-facing bug) — premise correction, blast radius = 0 today.
2. Decide whether re-mounting the footer is desired (separate ORCH); if so, the new gate already protects it.
3. (Optional, P2-A) harden the gate's extractor to also catch JSX `href={'…'}` inline literals, so a future inline dead link is *named* rather than tripping the generic "parser broke" guard.

No deploy / merge / close performed (per dispatch).
