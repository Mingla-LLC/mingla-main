# SPEC ADDENDUM — ORCH-1381 [business-getapp-android-choice]: P2 fixes (D-A + D-B)

**Mode:** SPEC (mingla-forensics). Addendum to `SPEC_ORCH-1381_BUSINESS_GETAPP_ANDROID_CHOICE.md` (the base contract).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1381-[business-getapp-android-choice]` on branch `ORCH-1381-business-getapp-android-choice` (rebased on `origin/main`).
**Inputs:** base SPEC · `Mingla_Artifacts/reports/QA_ORCH-1381_BUSINESS_GETAPP_ANDROID_CHOICE.md` (P2-1, P2-2, D-T2) · COMMS-0101 (ground truth, WARN, ingested + acked).
**Authority:** Seth ruled on the QA's two P2 defects and **explicitly authorised a scope widening** into explorer/consumer paths the base SPEC's §15 forbade. This addendum makes that widening a contract rather than a smuggled-in edit.
**Date:** 2026-07-15

> **This addendum supersedes the base SPEC's §15 allowlist.** Everything else in the base SPEC stands unchanged.

---

## 0. Corrections to the inputs (read this first)

Everything below is measured, not argued. Probes are copy-pasteable in §11.

| # | Claim in the input | Verdict | Evidence |
|---|---|---|---|
| **C-1** | Orchestrator's reframe: *"the row overflows rather than the label — the fix is the flex/wrap behaviour of the container, not the pill"* | **WRONG — measurement refutes it** | At 360px the `/links` row measures `clientWidth 270 === scrollWidth 270` (**no** row overflow) and the page measures `clientWidth 360 === scrollWidth 360` (**no** horizontal page scroll). The defect is exactly what the QA said: a **pill-internal vertical overflow**. The reframe was seeded by a measurement of a *candidate fix* (`whitespace-nowrap`), not of the shipped code — under nowrap the pills DO grow to 217+156+8=381 and overflow the row, which is why that candidate is **rejected** in §3.2. **The QA's original framing is correct and is what this addendum specs against.** |
| **C-2** | Dispatch: *"the CI gates currently MANDATE the bug… Naively removing the broken null-check trips them."* | **WRONG as stated** | **Executed, not reasoned:** with the prescribed pattern applied to all 4 call sites, **all 5 strict-grep gates exit 0** and **all 3 existing test suites pass**, unamended. The gates require only the *tokens* `window.open(` and `window.location.assign(` — the prescribed pattern retains both. The gates do **not** mandate the bug; they are **blind** to it. This inverts the amendment's purpose: it is not needed to *permit* the fix, it is needed to *forbid* the bug (§6). Amendments DO become mandatory under the §5 extraction, for a different reason. |
| **C-3** | Dispatch: 3 call sites (`glass-nav:71`, `glass-nav:95`, `links-experience:176`) | **INCOMPLETE — a 4th exists** | `mingla-marketing/components/sections/organiser-home/hero.tsx:44` (`openDest`) carries the identical pattern. Full sweep in §4. |
| **C-4** | Dispatch: *"Recommended correct pattern… drop `noopener`"* | **CORRECT, but carries a trap** | Browser-verified: `noreferrer` **alone** also returns `null`. An implementor who "drops `noopener`" but keeps `noreferrer` **reproduces the bug exactly**. Both tokens must go. §5.1. |
| **C-5** | QA P2-1 Required-fix + Retest cover **only** `/links` at 360px | **INCOMPLETE — under-reports the defect** | The QA *observed* the nav wrap ("the same label wraps to two lines inside the nav pills on the real Pixel") but excluded it from its Required-fix and Retest. Measured: **`glass-nav` overflows on BOTH labels at 360 AND 375 AND 412** — i.e. every tested Android width, not just 360. Its prescribed retest (`/links`, 360, `scrollHeight === clientHeight`) would **not catch it**. §3.3. |
| **C-6** | QA P2-1 suggested fix: *"drop the fixed `h-14` for a `min-h` + vertical padding"* | **WRONG — breaks a QA-verified contract** | Measured at 375×667: `min-h` + grow puts the two pills on **different tops** (386 vs 385) because `items-center` centres unequal-height boxes — breaking the same-row contract the QA itself verified (`both CTAs share top:394`). Rejected in §3.2. |
| **C-7** | QA P2-2: *"Required fix. Out of scope here… → Discovery D-T2, own ORCH"* | **Superseded by Seth's ruling** | Folded in. §4–§7. |

**C-1 is the honest headline: my own reframe was wrong and the QA was right.** It is recorded here so no downstream agent re-derives a false mechanism from the dispatch prose.

---

## 1. Executive summary

Two P2 defects from the ORCH-1381 QA, ruled in by Seth.

- **D-A — the business "get the app" pills overflow their own edges on Android.** On `/links` at 360px the "Use on web" label wraps to three lines and spills 9px past the pill. In the **top nav** it is worse and wider than reported: **both** labels spill on **every** tested Android width (360/375/412). Fix is layout-only; the pinned copy never changes.
- **D-B — every client CTA navigates twice.** `window.open(dest,'_blank','noopener,noreferrer')` returns `null` **even on success** (HTML spec), so the `if (!win) window.location.assign(dest)` "popup-blocked fallback" fires **unconditionally**: a new tab opens **and** the current tab navigates away. The marketing page is destroyed on every tap, and ORCH-1328's own "/links stays mounted" contract is violated in production today. 4 call sites.

**D-B is fully specified and closeable.** **D-A splits**: the `/links` half is fully specified; the **nav half is proven geometrically unsolvable layout-only** and needs one design ruling from Seth (§3.3, §9 OQ-1) before it can be built.

---

## 2. Scope & non-goals

**In scope**
1. D-A: kill the pill overflow on `/links` business tab at 360px, preserving SC-6 at 375×667.
2. D-A-2: the same defect in `glass-nav` — **evidence + options only**, pending OQ-1.
3. D-B: kill the double navigation at all 4 call sites, in explorer **and** business paths (Seth-authorised).
4. Amend the CI gates so they **forbid** the D-B bug (today they cannot see it).
5. Ship a fails-on-revert regression contract for both.

**Non-goals**
- **`BUSINESS_APP_CHOICE_COPY` MUST NOT change.** CI-pinned and a code-verified claim (QA P4-2). Fix the container, never the words.
- No change to the platform→destination decision (`resolveBusinessAppTarget`) — the base SPEC owns it and the QA proved it correct on a real Android.
- No fix for P1-1 (PostHog dark in prod, D-T1) — env, not code; own ORCH.
- No fix for P2-3 (cookie banner overlay) — pre-existing, consent-gated, QA demanded none.
- No new native build. No store action. Web-only PR.
- **`components/ui/button.tsx` size classes are NOT touched** — shared by every surface; changing `sm`/`lg` to fix two pills would silently restyle the whole site.

---

## 3. D-A — pill overflow

### 3.1 Proven mechanism (`/links`, 360px)

Measured on the branch build, Android UA, `/links` → Business tab, post-consent:

| Pill | clientHeight | scrollHeight | V-overflow | width | text lines |
|---|---|---|---|---|---|
| `Download the app` | 56 | 56 | 0 | 145 | 2 |
| **`Use on web`** | **54** | **63** | **9px** | **115** | **3** |

Row: `clientWidth 270 === scrollWidth 270` → **no row overflow.** Page: `360 === 360` → **no H-scroll.** (This is C-1: the reframe is refuted.)

**Causal chain:**
1. `CTA_BASE` (`links-experience.tsx:52-53`) puts **`w-full`** on both pills inside `<div className="flex items-center justify-center gap-2">` (`:383`). Both demand 100% of the 270px row, so flexbox shrinks each **proportionally to its content** → unequal widths (145 / 115), *not* equal halves.
2. `Use on web` therefore gets only **115px**; `px-7` eats 56px → a **59px content box**.
3. `Use on web` at `text-base` cannot fit 59px → wraps to **3 lines ≈ 63px**.
4. `h-14` pins the height at 56px (**54px** inner for the `glass` variant, which carries a 1px border — this is why the two pills report 56 vs 54).
5. `63 > 54` with `overflow: visible` → the label spills past the rounded edge ("Use" above, "web" below).

At **375px** the same pill measures `54 / 54` → **no overflow**. The `/links` defect is **360-only**.

### 3.2 Rejected candidates (each measured, not argued)

| Candidate | Verdict | Why |
|---|---|---|
| `min-h-14` + `py-3` (QA suggestion #1) | **REJECT** | Kills the overflow but breaks the same-row contract at 375×667 (tops **386 vs 385**) — `items-center` centres unequal-height boxes. Violates a QA-verified PASS. (C-6) |
| `whitespace-nowrap` alone (QA suggestion #2) | **REJECT** | Pills grow to 217+156+8 = **381 > 270** → the **row** overflows. (This — and only this — is what seeded the C-1 reframe.) |
| `flex-1 min-w-0 px-4 whitespace-nowrap` | **REJECT** | Pill H-overflow: `Download the app` needs 146px of content in a 130px box (`scrollWidth 146 > clientWidth 130`) → text clipped by the pill. |
| Shorten the label | **FORBIDDEN** | Copy is pinned + code-verified. |
| Stack the pills vertically <375px | **REJECT** | Breaks the SC-6 one-row contract; no default Tailwind breakpoint at 375. |

### 3.3 D-A-2 — the nav defect the QA under-reported (BLOCKED on OQ-1)

`glass-nav.tsx` business pills use `<Button size="sm">` = **`h-10 px-4 text-base`** (40px tall). Measured on `/business`:

| Viewport | `Download the app` | `Use on web` |
|---|---|---|
| 360px | h=40 sh=44 → **4px over** | h=38 sh=43 → **5px over** |
| 375px | h=40 sh=44 → **4px over** | h=38 sh=43 → **5px over** |
| 412px | h=40 sh=44 → **4px over** | h=38 sh=43 → **5px over** |

Both labels wrap to 2 lines; `h-10` (40px) cannot hold 2 lines of 16px text (44px). Visually confirmed by screenshot: both labels visibly spill past the pill edges. **Desktop (1280) is clean** (h=38 sh=38, and only "Use on web" renders — correct). **The hero is clean** at every width (it stacks `flex-col` on mobile, `sm:flex-row` above).

**Why this is not a padding tweak.** The nav bar is `logo + 2 pills` in `328px` at 360. The logo's `<Link>` (`glass-nav.tsx:~156`) has **no `shrink-0`**, so it silently absorbs the pressure by squashing. Pinning the logo at its natural 84px and re-measuring the bar (`clientWidth 328`):

| Option (logo pinned `shrink-0`) | Bar scrollWidth | Fits? |
|---|---|---|
| `text-sm` + nowrap + `px-3` | **382** | ✗ over by 54px |
| `text-xs` + nowrap + `px-3` | **350** | ✗ over by 22px |
| `text-xs` + nowrap + `px-2` | **334** | ✗ over by 6px |
| **ONE action** + nowrap + `px-4` (`text-base`) | **328** | ✓ **fits, logo 84px, no overflow** |

**PROVEN: the nav cannot hold the logo + BOTH pinned-copy pills at 360px — not even at 12px text with 8px padding.** It only "fits" today by destroying the brand (logo squashed 84px → **30px** at `text-sm`; → ~0 and *invisible* under plain `nowrap`).

This is a **design** decision, not a layout fix, so it is **not prescribed here**. → **OQ-1 (§9).**

### 3.4 Prescribed change — D-A (`/links`), the only D-A work authorised to build now

**File:** `mingla-marketing/components/marketing/links-experience.tsx`

`cn` is `twMerge(clsx(...))` (`lib/cn.ts`) — **verified** — so a later `px-4` cleanly displaces `px-7` with no class-order ambiguity.

| Line | From | To |
|---|---|---|
| `:388` | `className={cn(CTA_BASE, CTA_INTENT.primary)}` | `className={cn(CTA_BASE, CTA_INTENT.primary, 'px-4')}` |
| `:396` | `className={cn(CTA_BASE, CTA_INTENT.glass)}` | `className={cn(CTA_BASE, CTA_INTENT.glass, 'px-4')}` |

**`CTA_BASE` itself (`:52-53`) MUST NOT change** — it is shared with the **explorer/other** tab's single CTA at `:411`, which is out of D-A's scope and renders correctly today. The override is applied **only** to the two business pills.

Add the protective comment (the "why", per the regression-prevention contract):

```
// ORCH-1381 ADDENDUM D-A — px-4 (not CTA_BASE's px-7) ONLY on the business pair.
// Two w-full pills share this row, so flex shrinks each to ~130px at 360px; px-7
// left "Use on web" a 59px content box → 3-line wrap → 9px spill past the fixed
// h-14. px-4 restores a 98px box. h-14 is deliberately UNCHANGED: SC-6's 375x667
// no-scroll budget was measured against it. Copy is pinned — never shorten it.
```

**Measured result of exactly this change:**

| Viewport | Result |
|---|---|
| 360×800 | both pills **130/130**, `vOverflow 0`, no pill H-overflow, no row overflow, no page H-scroll |
| 375×667 (**SC-6**) | `scrollHeight 667 === clientHeight 667` (no scroll) · **7/7** socials visible (`lastBottom 647 ≤ 667`) · both CTAs `top:394` (**one row**) · no page H-scroll |

---

## 4. D-B — the double-navigation bug

### 4.1 Exhaustive call-site sweep

`grep -rn "window\.open" mingla-marketing/` (excluding `node_modules`, `.next`), cross-checked against `location.assign`:

| # | File:line | Path | In dispatch? |
|---|---|---|---|
| 1 | `components/marketing/glass-nav.tsx:71` | **explorer** `handleGetTheApp` | yes |
| 2 | `components/marketing/glass-nav.tsx:95` | business `openBusinessDest` | yes |
| 3 | `components/marketing/links-experience.tsx:176` | `openExternal` (explorer **and** business) | yes |
| 4 | **`components/sections/organiser-home/hero.tsx:44`** | business `openDest` | **NO — missed** |

**4 call sites, 3 files.** All four carry the byte-identical defect. Remaining `window.open` / `location.assign` hits in `mingla-marketing/` are **test assertions and comments only** (`__tests__/business-getapp-cta.test.ts`, `__tests__/links-cta-device-aware*.test.ts`) — no other product call site exists.

`/business/download` is **immune** and stays so: it is a plain server-rendered `<a>` (see §5.2).

### 4.2 Proven mechanism (real Chromium, isolated contexts)

`window.open()` return value by feature string:

| Feature string | Returns |
|---|---|
| `'noopener,noreferrer'` | **`null`** ← shipped |
| `'noopener'` | **`null`** |
| **`'noreferrer'`** | **`null`** ← **the half-fix trap (C-4)** |
| *(none)* | `WindowProxy` |
| `''` | `WindowProxy` |

Per the HTML spec, `noreferrer` **implies** `noopener`, and `noopener` forces a `null` return. Navigation outcome, measured in virgin browser contexts:

| Pattern | Origin page survived? | Main-frame navigations | Popups |
|---|---|---|---|
| **SHIPPED** `open(d,'_blank','noopener,noreferrer')` + `if(!win) assign(d)` | **NO** — ended on the store | **1** | 1 |
| **HALF-FIX TRAP** `'noreferrer'` only | **NO** — ended on the store | **1** | 1 |
| **PRESCRIBED** `open(d,'_blank')` + `if(win) win.opener=null else assign(d)` | **YES** — stayed on `/marketing` | **0** | 1 |

**Confirmed:** the fallback fires on every successful open → a tab opens **and** the page navigates away. Seth's reading of the bug is **correct**.

Also verified: `win.opener = null` on a **cross-origin** popup **does not throw**; and with `window.open` stubbed to `null` (a real popup blocker) the prescribed pattern **still** calls `location.assign` → no dead tap.

---

## 5. D-B — prescribed design

### 5.1 The pattern

```ts
const win = w.open(dest, '_blank')   // no noopener/noreferrer → WindowProxy on success, null when blocked
if (win) { win.opener = null }        // preserve the noopener security property
else { w.location.assign(dest) }      // genuine popup-block fallback (no silent failure)
```

**Validated, not accepted on faith:**
- **Both** `noopener` and `noreferrer` must be absent — either alone nulls the return (C-4). This is the single most likely way to "fix" this and still ship the bug.
- `win.opener = null` is safe cross-origin (verified: no throw) and is **synchronous**, so it runs before any script in the popup can execute — the reverse-tabnabbing window never opens.
- **`rel="noreferrer"` semantics ARE lost**: the `Referer` header (`https://usemingla.com/business`) will now reach Apple/Google. **Assessment: acceptable, arguably beneficial.** These are Mingla's own store listings, not third parties; the referrer is attribution signal, not a leak. No PII is in the URL. Recorded so it is a decision, not an oversight.

### 5.2 Chosen: JS handler, **not** `<a target="_blank" rel="noopener noreferrer">`

A plain anchor is browser-native, unblockable, and needs no JS — genuinely attractive. **It is nonetheless wrong for these three components**, for a reason that is specific to this ORCH:

> An `<a href>` must resolve its destination at **render** time. On these components the platform is only known **after hydration** — `useState<Platform>('other')` + `useEffect(setPlatform(detectClientPlatform()))` (`glass-nav.tsx:53-56`, `hero.tsx:36-39`), seeded to `'other'` *deliberately* so the server HTML and first client render agree (no hydration mismatch). `'other'` resolves to the **web** destination. An anchor would therefore ship an href pointing at **business.usemingla.com** until hydration completes — and an Android owner who taps in that window gets the web app instead of Play. **That is ORCH-1381's original bug, re-introduced as a race, on slow Android — the exact platform this ORCH exists to serve.**
>
> The handlers instead re-read `detectClientPlatform()` **fresh on the tap** (Constitution #12, QA-verified PASS), so a tap can never resolve a stale platform.

**The contrast proves the rule:** `/business/download` **is** a plain `<a>` and is **correct** there — because that route is server-rendered and reads the UA header, so its href is already right at render time. Same product, two mechanisms, two different correct answers. `<a>` where the server knows the platform; JS where only the client does.

**Verdict: keep `window.open`.** Anchor rejected on a hydration-race argument, not on gate convenience.

### 5.3 Extract to one owner (required)

The pattern currently exists 4×. Duplicating the corrected form 4× repeats the mistake that let one bug ship to every surface, and — because `mingla-marketing` has **no DOM test infra** (no jsdom/RTL; the house convention is `tsc` + `node` on plain modules, per `business-app-target.test.ts`) — an inline pattern is **not behaviourally testable**, which would force exactly the decorative source-grep test this addendum is required to avoid.

**Create `mingla-marketing/lib/open-external.ts`:**

```ts
export function openExternal(dest: string, w: Window = window): void {
  const win = w.open(dest, '_blank')
  if (win) { win.opener = null }
  else { w.location.assign(dest) }
}
```

The injectable `w` (defaulting to the real `window`) is what makes the behavioural test possible with zero new test infrastructure. This mirrors the base SPEC's own accepted precedent: the decision lives in **one** module (`resolveBusinessAppTarget`) and every surface delegates (Constitution #2 — "one owner per truth", QA-verified PASS).

**All 4 call sites become `openExternal(dest)`**, deleting the local `openBusinessDest` / `openDest` / `openExternal` helpers and the now-false `// Popup-blocked (window.open → null) → same-tab navigation fallback.` comments (which document the bug as if it were the design).

| File | Change |
|---|---|
| `components/marketing/glass-nav.tsx:70-72` | explorer: `openExternal(store)` |
| `components/marketing/glass-nav.tsx:93-97` | delete `openBusinessDest`; call `openExternal(...)` at `:110` and in `handleUseBusinessOnWeb` |
| `components/marketing/links-experience.tsx:170-178` | replace the local `openExternal` `useCallback` with the imported one |
| `components/sections/organiser-home/hero.tsx:42-46` | delete `openDest`; call `openExternal(...)` at `:60` / `:72` |

---

## 6. Gate amendments (exact regexes — every one executed against the real shapes)

Per D-T3, each regex below was run against the shipped shape, the prescribed shape, the half-fix trap, and each revert shape. All 6 validated. **None is decorative.**

### 6.1 Why amendments are needed (and why not for the reason given)

Baseline fact (C-2): the prescribed **inline** pattern passes all 5 gates + all 3 suites **unamended** — the gates only require the *tokens*, which it keeps. The gates are **blind**, not prohibitive.

Amendments are mandatory because of **§5.3**: once the components delegate to `openExternal`, they no longer contain `window.open(` or `window.location.assign(`, so `orch-1324` check **(e)** and `orch-1328` check **4** would fire — a *false* failure. The amendments (a) relocate the no-silent-failure guard to the module that now owns it, and (b) add the ban that makes the bug **impossible to re-introduce anywhere**.

### 6.2 `orch-1324-business-getapp-device-aware.mjs`

Targets `glass-nav.tsx` + `hero.tsx`.

**REPLACE check (e)** — currently `:133`:
```js
// BEFORE (blind: satisfied by the buggy code)
if (!/window\.location\.assign\(/.test(src)) { … }
```
```js
// AFTER — delegation to the one owner (ORCH-1381 ADDENDUM D-B)
if (!/openExternal\(/.test(src)) {
  failures.push(
    `${label}: must open destinations via openExternal( from lib/open-external — the ` +
    `popup-block decision lives in exactly ONE module. Inlining window.open re-introduces ` +
    `the double-navigation bug (ORCH-1381 ADDENDUM D-B).`,
  );
}
```
**ADD to `BANNED`:**
```js
{ re: /window\.open\(/, why: "inlines window.open — must delegate to openExternal( (ORCH-1381 ADDENDUM D-B)" },
{ re: /\.open\([^)\n]*\bno(?:opener|referrer)\b[^)\n]*\)/, why: "passes noopener/noreferrer to window.open — per the HTML spec it then returns null EVEN ON SUCCESS, so the popup-block fallback fires unconditionally and the page double-navigates (ORCH-1381 ADDENDUM D-B)" },
```
**Self-test cases to add:** compliant delegating fixture → pass · fixture inlining `window.open(…,'noopener,noreferrer')` → fire · fixture dropping `openExternal(` → fire · **`'noreferrer'`-only fixture → fire** (the half-fix trap).

### 6.3 `orch-1328-links-cta-opens-store-clientside.mjs`

Targets `links-experience.tsx`.

**REPLACE check 4** — currently `:121-126`:
```js
// BEFORE (blind)
if (!/window\.open\(/.test(src)) { … }
if (!/window\.location\.assign\(/.test(src)) { … }
```
```js
// AFTER — /links still must open on the tap gesture, but via the one owner.
if (!/openExternal\(/.test(src)) {
  failures.push(
    `${TARGET}: must open the destination via openExternal( from lib/open-external on the ` +
    `tap gesture (so /links stays mounted) — the popup-block decision lives in ONE module.`,
  );
}
```
**ADD to `BANNED`:**
```js
{ re: /window\.open\(/, why: "inlines window.open — must delegate to openExternal( (ORCH-1381 ADDENDUM D-B)" },
{ re: /\.open\([^)\n]*\bno(?:opener|referrer)\b[^)\n]*\)/, why: "noopener/noreferrer makes window.open return null even on success → the fallback always fires → /links does NOT stay mounted, violating this gate's own invariant (ORCH-1381 ADDENDUM D-B)" },
```
> The `import { openExternal } from '@/lib/open-external'` line must be added to this gate's `good` self-test fixture, and its existing `noFallback` case (`:214`) replaced by a `no openExternal` case.

### 6.4 NEW gate `orch-1381-open-external-no-double-nav.mjs`

Target: `mingla-marketing/lib/open-external.ts`. This is where the no-silent-failure guard now lives.

```js
const TARGET = "mingla-marketing/lib/open-external.ts";

// R4 — no silent failure: a genuinely blocked popup must still navigate.
if (!/\.location\.assign\(/.test(src))
  failures.push(`${TARGET}: missing the .location.assign( popup-block fallback — a blocked popup would be a dead tap.`);

// R1 — BAN the null-returning feature string (the D-B bug itself).
if (/\.open\([^)\n]*\bno(?:opener|referrer)\b[^)\n]*\)/.test(src))
  failures.push(`${TARGET}: window.open( carries noopener/noreferrer — per the HTML spec it then returns null EVEN ON SUCCESS, so the fallback fires unconditionally and every CTA double-navigates. Use a bare window.open(dest,'_blank') + win.opener = null.`);

// R2 — the noopener SECURITY property must be preserved another way.
if (!/\.opener\s*=\s*null/.test(src))
  failures.push(`${TARGET}: win.opener is not severed — dropping noopener without setting opener = null exposes the origin to reverse tabnabbing.`);

// R3 — STRUCTURAL: assign must be the NEGATIVE branch of a successful open,
// not an unconditional sibling. This is what makes the guard non-decorative.
if (!/else\s*\{[^}]*\.location\.assign\(/.test(src))
  failures.push(`${TARGET}: .location.assign( is not in the else-branch of a successful open — the fallback must fire ONLY when open() returned null.`);
```

**Regex validation matrix (executed):**

| Regex | Fires on | Does NOT fire on |
|---|---|---|
| `R1` `/\.open\([^)\n]*\bno(?:opener\|referrer)\b[^)\n]*\)/` | shipped · `noreferrer`-only · `noopener`-only · module-revert · component-inline-revert | prescribed module · prescribed component |
| `R2` `/\.opener\s*=\s*null/` | prescribed module · fallback-dropped revert | shipped · module-revert |
| `R3` `/else\s*\{[^}]*\.location\.assign\(/` | prescribed module | module-revert · fallback-dropped revert · shipped |
| `R4` `/\.location\.assign\(/` | prescribed · module-revert · shipped | fallback-dropped revert |
| `R5` `/openExternal\(/` | prescribed component | inline revert |
| `R6` `/window\.open\(/` | inline revert · shipped | prescribed component |

**Register** the new gate in `.github/workflows/strict-grep-mingla-business.yml` with a `--self-test` step **and** a live step, following the `orch-1381-…` precedent at `:3427`, plus the invariant docblock convention at `:179`.

### 6.5 Gates needing NO amendment

`orch-1326-links-business-download-route.mjs`, `orch-1342-store-links-ssot.mjs`, `orch-1342-landing-single-parse.mjs` — **verified exit 0** against the prescribed shape. Do not touch them.

---

## 7. REVISED §15 — allowlist + DO-NOT-TOUCH

> **This section SUPERSEDES the base SPEC's §15.** The base §15 forbade explorer/consumer paths. **Seth explicitly authorised the widening below**; it is a contract, not an implementor's judgement call. Anything not named here still requires a stop-and-amend.

### 7.1 Newly permitted (were forbidden by base §15)

| Path | Why newly permitted |
|---|---|
| `mingla-marketing/components/marketing/glass-nav.tsx` — **incl. the EXPLORER branch (`:70-72`)** | D-B call sites #1 (explorer) + #2 (business). The explorer path carries the identical bug; fixing only the business half would leave the consumer CTA double-navigating. |
| `mingla-marketing/components/marketing/links-experience.tsx` — **incl. the explorer tab** | D-B call site #3 — one shared helper serves **both** tabs. Also the D-A `px-4` override (business pills only). |
| `mingla-marketing/components/sections/organiser-home/hero.tsx` | D-B call site #4 (**dispatch missed it**). |
| `mingla-marketing/lib/open-external.ts` | **NEW** — the single owner (§5.3). |
| `mingla-marketing/lib/__tests__/open-external.test.ts` | **NEW** — the §8 regression contract. |
| `.github/scripts/strict-grep/orch-1324-business-getapp-device-aware.mjs` | §6.2 |
| `.github/scripts/strict-grep/orch-1328-links-cta-opens-store-clientside.mjs` | §6.3 |
| `.github/scripts/strict-grep/orch-1381-open-external-no-double-nav.mjs` | **NEW** — §6.4 |
| `.github/workflows/strict-grep-mingla-business.yml` | register the new gate only |

### 7.2 DO-NOT-TOUCH (unchanged from base §15 unless noted)

| Path | Why |
|---|---|
| **`mingla-marketing/lib/device-platform.ts`** | **No change needed — orchestrator-verified.** Detection is correct; the bug is in what the callers do with it. |
| **`BUSINESS_APP_CHOICE_COPY` in `mingla-marketing/lib/business-app-target.ts`** | CI-pinned + code-verified claim (QA P4-2). The `resolveBusinessAppTarget` logic is equally frozen — base SPEC owns it, QA proved it on real Android. |
| **`mingla-marketing/components/ui/button.tsx`** | Shared by every surface; changing `sizes.sm`/`sizes.lg` to fix two pills would silently restyle the whole site. **NEW to this list** (§3.3 makes it tempting). |
| **`CTA_BASE` (`links-experience.tsx:52-53`)** | Shared with the out-of-scope explorer tab CTA (`:411`). Override per-pill instead (§3.4). **NEW to this list.** |
| `mingla-marketing/lib/store-links.ts` | SSOT (SC-11). |
| `mingla-marketing/app/business/download/**` | Plain `<a>`, immune to D-B (§5.2). |
| `supabase/functions/invite-brand-member/**` | Invite href is byte-frozen (T-10/T-11; COMMS-0101 trap). |
| `app-mobile/**` · `mingla-business/**` · `mingla-admin/**` | Not shipped to. `git diff --stat` must stay **empty** (SC-12). |
| `orch-1326` / `orch-1342` gates | Verified passing unamended (§6.5). |

---

## 8. Regression contract (CLOSE Step 0.5) — must FAIL ON REVERT

**File:** `mingla-marketing/lib/__tests__/open-external.test.ts` (append-only; new file).

**A test that merely asserts `window.location.assign(` exists is DECORATIVE and is rejected** — it passes on the buggy code (proven: that is exactly what the gates do today, C-2). The contract below is **behavioural** and was **prototyped and proven fails-on-revert before being specified.**

The fake `Window` **must model the browser-verified HTML-spec rule** — this is the load-bearing part:

```ts
function makeFakeWindow({ popupBlocked = false } = {}) {
  const log = { opened: [] as any[], assigned: [] as string[] }
  const w = {
    open(url: string, target?: string, features = '') {
      log.opened.push({ url, target, features })
      if (popupBlocked) return null
      // HTML spec, verified in Chromium: noopener OR noreferrer => null EVEN ON SUCCESS.
      if (/\bnoopener\b|\bnoreferrer\b/.test(features)) return null
      return { opener: {} }
    },
    location: { assign: (u: string) => log.assigned.push(u) },
  }
  return { w, log }
}
```

| Test | Scenario | Expected | Catches |
|---|---|---|---|
| **T-A** | successful open | `log.assigned.length === 0` **and** exactly 1 `open()` | **the double navigation itself** — the fallback must NOT fire on success |
| **T-B** | inspect the feature string | no `noopener`/`noreferrer` | the null-return cause + **the `noreferrer`-only half-fix trap** |
| **T-C** | `popupBlocked: true` | `log.assigned.length === 1` | silent failure / dead tap (the guard the old gates *meant* to enforce) |
| **T-D** | successful open | returned `win.opener === null` | reverse tabnabbing (the security property `noopener` used to provide) |

**Prototyped result (executed):**

| Implementation | Failures |
|---|---|
| **FIX** (`open(d,'_blank')` + `if(win) opener=null else assign`) | **0 — PASS** |
| **REVERT** (`open(d,'_blank','noopener,noreferrer')` + `if(!win) assign`) | **2 — FAIL** (T-A behavioural **and** T-B structural — two independent angles) |

> **Verdict: NON-DECORATIVE — passes on the fix, fails on the revert.**

**Run command** (mirrors the ORCH-1329/tester convention; note `tsc` roots the emit at `lib/`, so the artifact lands at `__tests__/…`, per the base SPEC's own §9 erratum):
```
cd mingla-marketing
npx tsc lib/__tests__/open-external.test.ts --outDir /tmp/oe \
  --module commonjs --target es2020 --moduleResolution node --skipLibCheck \
  && node /tmp/oe/__tests__/open-external.test.js
```

**D-A regression.** There is **no CI gate for `/links`'s single-viewport contract** (QA D-T4). This addendum does **not** add one — a layout invariant needs a real browser, and no such harness exists in this repo's CI. It is a **measured retest** (§10) and the gap stays registered as D-T4. **Do not fake it with a source-grep for `px-4`** — that would be precisely the decorative guard this contract forbids.

---

## 9. Open questions (Seth must rule)

**OQ-1 — the nav cannot show both actions on a phone. Which way?** (blocks D-A-2 only; D-A and D-B are unblocked)

Proven: logo + both pinned-copy pills do **not** fit at 360px at any tested text size (§3.3). Today it "fits" only by squashing the logo 84px → 30px (→ invisible under `nowrap`). Measured options:

| | Option | Cost | Measured |
|---|---|---|---|
| **A** | `text-xs` + nowrap + `px-3`, accept a squashed logo | 12px labels; logo 84→62px | kills overflow; brand degraded |
| **B** | **Nav shows ONE action on mobile** (`Download the app` when installable, else `Use on web`); hero keeps the full choice + note; add `shrink-0` to the logo | nav is a shortcut, not the full choice | **bar 328/328, logo 84px natural, `text-base`, no overflow — the only clean pass** |
| **C** | Hide the nav business choice below `sm`; hero owns it entirely | nav loses its CTA on mobile | fits trivially |

**Recommendation: B.** It is the only measured option that preserves the brand *and* kills the overflow at full 16px, and it matches the nav's own stated design intent — `glass-nav.tsx:185-187` already says *"the nav is a shortcut with no room for it [the note]; the hero, /links and /business/download surfaces carry it."* Extending "no room" from the note to the second action is consistent, not a new concession. **B changes which actions render, so it needs Seth's ruling before build.**

**OQ-2 — `Referer` now reaches Apple/Google** (§5.1). Assessed as acceptable/beneficial. Flagged, not silently absorbed. Ruling wanted, but **not blocking**.

---

## 10. Implementation order

1. **`lib/open-external.ts`** — create the one owner (§5.3).
2. **`lib/__tests__/open-external.test.ts`** — write the §8 contract. Prove it **fails on revert before wiring any call site** (this is the whole point).
3. **Rewire all 4 call sites** to `openExternal` (§5.3), deleting the local helpers **and** the now-false "popup-blocked" comments.
4. **D-A**: `px-4` on `links-experience.tsx:388` + `:396` **only** (§3.4) + the protective comment.
5. **Gates**: amend `orch-1324` (§6.2) + `orch-1328` (§6.3); add `orch-1381-open-external-no-double-nav.mjs` (§6.4) with self-tests incl. the **`noreferrer`-only** case; register in the workflow.
6. **Verify**: all 5 existing gates + the new one exit 0; the 3 existing suites still pass; `npx tsc --noEmit` clean.
7. **D-A-2**: **BLOCKED on OQ-1** — do not build without Seth's ruling.

**The CLOSE commit must carry `[deploy]`** — production still 307s every Android owner to the web (QA §7 cap 3), and D-B is live on `usemingla.com` **today**.

---

## 11. Verification — copy-pasteable

**D-B, real browser** (the evidence in §4.2; needs `playwright`):
```js
// Per-pattern, in a virgin context: did the ORIGIN page survive the click?
const win = window.open(DEST, '_blank', 'noopener,noreferrer'); if (!win) window.location.assign(DEST)
//   => origin ends on DEST  (page destroyed + a popup = DOUBLE navigation)
const win2 = window.open(DEST, '_blank'); if (win2) { win2.opener = null } else { window.location.assign(DEST) }
//   => origin stays on /marketing (single navigation)  <-- required
```

**D-A, measured retest** (dev server + Android UA, `/links` → Business, **post-consent** — pre-consent the banner overlays the CTAs, QA P2-3):
```js
// 360x800 — the defect must be GONE:
[...document.querySelectorAll('button')]
  .filter(b => ['Download the app','Use on web'].includes(b.textContent.trim()))
  .map(b => ({ label: b.textContent.trim(), ok: b.scrollHeight === b.clientHeight }))
// => every ok === true

// 375x667 — SC-6 must still hold:
document.documentElement.scrollHeight === document.documentElement.clientHeight  // no scroll
// + 7/7 socials visible (lastBottom <= 667) + both CTAs share the same top (one row)
```

**Gates:**
```
node .github/scripts/strict-grep/orch-1324-business-getapp-device-aware.mjs --self-test
node .github/scripts/strict-grep/orch-1328-links-cta-opens-store-clientside.mjs --self-test
node .github/scripts/strict-grep/orch-1381-open-external-no-double-nav.mjs --self-test
for g in orch-1324-business-getapp-device-aware orch-1326-links-business-download-route \
         orch-1328-links-cta-opens-store-clientside orch-1342-store-links-ssot \
         orch-1342-landing-single-parse orch-1381-open-external-no-double-nav; do
  node .github/scripts/strict-grep/$g.mjs || echo "FAIL $g"
done
```

---

## 12. Tester attack list (adversarial angles)

Beyond re-running §11. The tester must **not** trust this spec's own measurements.

1. **The half-fix trap.** Patch the module to `window.open(dest,'_blank','noreferrer')` — **the suite MUST fail** (T-A + T-B). If it passes, the fake `Window` is not modelling the spec and the whole contract is decorative.
2. **The fake is a lie.** The contract rests on a hand-written `Window`. Prove the real browser agrees: assert in a real Chromium that `open(u,'_blank','noreferrer') === null` and `open(u,'_blank') !== null`. If the fake and the browser ever diverge, the test is theatre.
3. **Live double-nav on a real Android.** QA proved the store opens; it did **not** prove the marketing page survives. Tap each of the 4 CTAs on a real device and confirm **`/links` is still mounted** on back — this is ORCH-1328's actual invariant, and the thing D-B breaks in production today.
4. **The 4th call site.** The dispatch missed `hero.tsx:44`. Independently re-sweep `mingla-marketing/` for `window.open` — assume this spec missed a 5th.
5. **Explorer blast.** The widening touches the **consumer** CTA (`glass-nav.tsx:71`). Verify the explorer "Get the app" still reaches the **consumer** App Store / Play (`com.mingla.app.v2`, `id6760440898`) and that no business URL leaked into the explorer path. **A cross-app contamination here is a P0.**
6. **Desktop/other regression.** `openExternal` now serves the explorer QR panel path too. Confirm desktop still opens the QR panel and does **not** navigate away.
7. **`opener` severing is real.** Assert `win.opener === null` post-open in a real browser, cross-origin. If `opener` survives, dropping `noopener` was a **security regression**, not a fix.
8. **D-A at the boundaries.** 320px (iPhone SE / smallest live), 360, 375, 390, 412, 768. The QA tested 4 widths; the nav defect appeared at **all** of them. Also test **landscape** — SC-6 is portrait-only by construction.
9. **Consent-gated first paint.** Measure `/links` **pre**-consent too: P2-3 says the banner overlays the CTAs. Confirm `px-4` did not change what the banner covers.
10. **`twMerge` order.** Confirm `cn(CTA_BASE, CTA_INTENT.glass, 'px-4')` actually emits `px-4` and not both — read the **rendered** `class` attribute, do not trust `cn`'s contract.
11. **SC-12 still holds.** `git diff origin/main...HEAD --stat` must remain **empty** for `app-mobile/`, `mingla-business/`, `mingla-admin/`, `lib/device-platform.ts`.
12. **Gate teeth.** Revert each of the 4 call sites **individually** and confirm a gate fires for each — a gate that only catches an all-4 revert is a gate with one tooth.

---

## 13. Downstream routing

- **Next → `mingla-implementor`**, worktree `~/Desktop/mingla-orchs/ORCH-1381-[business-getapp-android-choice]`, branch `ORCH-1381-business-getapp-android-choice`. Build **§10 steps 1–6 only**. **§10 step 7 (D-A-2 / nav) is BLOCKED on OQ-1** — do not build it without Seth's ruling; stop-and-amend if tempted.
- **Then → `mingla-tester`** with §12.
- **Then → `mingla-orchestrator` CLOSE**: flip `I-PROPOSED-1381-…` → ACTIVE; amend the 1324/1328 invariant docblocks per §6; propose **`I-PROPOSED-1381-OPEN-EXTERNAL-SINGLE-OWNER`** (DRAFT → ACTIVE on CLOSE); resolve **D-T2** (fixed here); keep **D-T1** (PostHog env), **D-T4** (no `/links` layout gate), **D-T5** (lint trap) open; register **OQ-1** as a follow-up if Seth defers it. **CLOSE commit MUST carry `[deploy]`.**

---

## 14. Discoveries for the orchestrator

| ID | Discovery |
|---|---|
| **D-A1** | **The nav logo has no `shrink-0`** (`glass-nav.tsx:~156`). It silently absorbs any nav overcrowding by squashing (84px → 30px → invisible), so **the nav can never fail a width check — it just destroys the brand instead**. This masked D-A-2 from every automated check. Worth a global audit: any `justify-between` bar with a shrinkable logo has this failure mode. |
| **D-A2** | **`window.open(…, 'noopener')` returning `null` on success is a general trap**, not a marketing-web one. Any Mingla surface using the `if (!win) fallback` idiom has this bug. `mingla-marketing` is now clean; **nothing swept `mingla-admin/` or the RN webviews.** Recommend a repo-wide sweep as its own ORCH. |
| **D-A3** | **The gates were blind, not wrong.** `orch-1324`/`orch-1328` required `window.location.assign(` as a "no silent failure" guard and were satisfied by code where the fallback fired **100% of the time**. A presence-check for an error path cannot distinguish "handles the error" from "is permanently in the error path". **Process note: every gate asserting an error path needs a case proving the happy path does NOT take it.** Same family as D-T3. |
| **D-A4** | **The QA's D-A retest would have passed the shipped nav bug** — it scoped to `/links` at 360 while the nav overflows at 360/375/412. Not a criticism of the verdict (P2-1 was real and correctly graded) but of retest **scope**: the QA saw the nav wrap and did not carry it into its Required-fix. Retests should cover every surface where the observed symptom appears. |

---

## 15. Confidence

**PROVEN** for D-B: real-Chromium return values across 5 feature strings, navigation-survival measured in isolated contexts, cross-origin `opener` write verified, popup-block fallback verified, all 5 gates + 3 suites executed against the prescribed shape, all 6 proposed regexes executed against 8 real code shapes, and the regression contract prototyped to fail-on-revert.

**PROVEN** for D-A: measured on the real branch build at 360/375/412/1280 with an Android UA, mechanism traced to the exact classes, every candidate measured (not argued), winner verified against SC-6, and the nav's geometric impossibility established with the logo pinned. Screenshots corroborate every numeric claim.

**Caps.** All D-A/D-B measurement is Chromium (desktop engine, mobile-emulated UA + viewport) on the branch dev build — **not** Seth's physical Samsung and **not** production. Safari/WebKit was **not** measured; `window.open` return semantics are spec-mandated and unlikely to differ, but the pixel measurements may. **No claim here is production-verified** — the fix is undeployed and D-B is live on `usemingla.com` today.
