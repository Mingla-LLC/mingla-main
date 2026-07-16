# IMPLEMENTATION — ORCH-1382 [links-src-tracking-getapp-stack]

**Skill:** mingla-implementor+claude · 2026-07-15
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1382-[links-src-tracking-getapp-stack]` on branch `ORCH-1382-links-src-tracking-getapp-stack`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1382_LINKS_SRC_TRACKING_GETAPP_STACK.md` (binding)
**Rebased onto:** `origin/main` @ `92d1960d8` (origin moved during the session — re-rebased; clean)
**Commits:** `6968b9725` (implementation) · `e951da8db` (HEAD — the fifth-decorative-guard repair)
**Status:** **implemented and verified** (runtime-verified in a real browser; two spec gaps found; SC-8 finding below)

---

## 1. Summary

Five changes to the public marketing site, all in `mingla-marketing/`. In plain English:

- **(A)** Every "get the app" button on the website is now a **real link** pointing at the AppsFlyer
  OneLink instead of a JavaScript popup opening a plain store URL. Tapping it opens the **store app
  directly** — no Play *website* flashing up first.
- **(B) The headline.** `usemingla.com/links?src=youtube` now tells us the install came from Seth's
  YouTube bio, **whichever app the visitor picks**. Every bio install was previously anonymous.
- **(C)** The business button reads **"Get the app"** (was "Download the app") and the two business
  actions **stack vertically** instead of squeezing side-by-side.
- **(D)** **Snapchat** joins the Explorer socials — Explorer only, because there is no business
  Snapchat account.
- **(E)** The socials data model now states scope **explicitly**, so "neutral" and "explorer-only" can
  never be confused again.

**Plus the OQ-3 monitoring probe** (orchestrator-ordered; the spec deferred it) — a scheduled check
that alerts if either OneLink stops working.

---

## 2. SPEC success-criteria coverage

| SC | Verdict | How verified | Commit |
|---|---|---|---|
| SC-1-Links-Explorer | ✓ | Playwright, Android UA: `href=https://go.usemingla.com/w36m?pid=bio_youtube&c=explorer_bio`, element is `<a>` | `6968b9725` |
| SC-1-Links-Business | ✓ | Playwright: `href=https://biz.usemingla.com/ZSCW?pid=bio_youtube&c=business_bio` | `6968b9725` |
| SC-1-Nav-Explorer / Nav-Business / Hero | ✓ | anchors render `<a href={…installHref}>`; gates orch-1319/1324 pin it | `6968b9725` |
| SC-1-BizDownload | ✓ | `curl -A '<Android UA>' /business/download` → install `<a href="https://biz.usemingla.com/ZSCW?pid=mingla_web&c=business_download">`, **no query param required** | `6968b9725` |
| SC-1-iOS | ✓ | Playwright iOS UA → `go.usemingla.com/w36m?pid=bio_seth&c=explorer_bio` | `6968b9725` |
| SC-1-Desktop | ✓ | Playwright: desktop CTA is a `<button>`, opens a new tab → `/download`, `/links` stays mounted | `6968b9725` |
| SC-1-Rel | ✓ | **per-anchor** check (see §11 — the file-level version was decorative) | `e951da8db` |
| SC-1-NoOrphanState | ✓ | Playwright: after the desktop open, `page.url()` still `/links` | `6968b9725` |
| SC-2-Ride | ✓ | both tabs carry `pid=bio_youtube`; only `c` differs | `6968b9725` |
| SC-3-Persist | ✓ | Playwright: explorer→business→explorer→business, `pid=bio_youtube` on every resolve | `6968b9725` |
| SC-4-FailSafe | ✓ | T-4: **50 hostile inputs**, all → `bio_direct`, nothing reflected, never throws | `6968b9725` |
| SC-5-Prefix (HARD) | ✓ | T-4 asserts `/^bio_[a-z0-9_]{1,32}$/` for **every** input | `6968b9725` |
| SC-5-NeverCrossed (HARD) | ✓ | T-7 by identity + gate R1/R2 + live probe | `6968b9725` |
| SC-6-Label | ✓ | curl: `Get the app` ×1, `Download the app` ×**0**; Playwright: 0 in rendered output | `6968b9725` |
| SC-6-Stack | ✓ | measured 375×667: getApp `y=476–532`, useWeb `y=540–596` → stacked, tops differ | `6968b9725` |
| SC-6-NoScroll | ✓ | **clipping-aware**, both viewports — see §9 | `6968b9725` |
| SC-6-Tap | ✓ | both pills **56px** ≥ 44px at 375×667 and 360×640 | `6968b9725` |
| SC-7-PxRedundant | ✓ | computed `padding-left: 28px` (px-7, not px-4); per-pill `scrollHeight === clientHeight` | `6968b9725` |
| **SC-8-NoBannerRegression** | **✓ by its written criterion — with a finding** | primary CTA overlap **11px → 0px** (improved). **BUT the secondary deepened 11px → 42px.** See §10.1 | `6968b9725` |
| SC-9-Snap-Explorer | ✓ | Playwright: `https://www.snapchat.com/add/usemingla`, `target=_blank` | `6968b9725` |
| SC-9-Snap-NotBusiness | ✓ | Playwright: business tab renders **no** Snapchat | `6968b9725` |
| SC-9-Counts | ✓ | Explorer **8**, Business **7**; all visible at both viewports | `6968b9725` |
| SC-10-Neutral | ✓ | YouTube/LinkedIn identical href on both tabs | `6968b9725` |
| SC-10-PerSurface | ✓ | Instagram → `@minglabusiness` on business | `6968b9725` |
| SC-10-TypeSafety | ✓ | 5 `@ts-expect-error` negative cases; collapsing the union → **4 build errors** | `6968b9725` |

---

## 3. Files changed (32)

**New product code (3):** `lib/links-src.ts` · `lib/explorer-app-target.ts` · `scripts/probe-onelink-health.mjs`
**Changed product code (8):** `lib/store-links.ts` (+2 consts, stale comment corrected) · `lib/business-app-target.ts` · `lib/links-config.ts` · `app/links/page.tsx` · `components/marketing/links-experience.tsx` · `components/marketing/glass-nav.tsx` · `components/sections/organiser-home/hero.tsx` · `app/business/download/page.tsx` · `components/ui/button.tsx` (additive `buttonClasses`)
**New tests (4):** `links-src.test.ts` · `links-src.tester.test.ts` · `explorer-app-target.test.ts` · `onelink-never-crossed.tester.test.ts`
**Modified tests (8, all `[TEST-MOD-APPROVED ORCH-1382]`):** `business-app-target.test.ts` · `business-app-target.tester.test.ts` · `links-config.tester.test.ts` · `links-cta-device-aware.test.ts` · `links-cta-device-aware.tester.test.ts` · `business-download-route.tester.test.ts` · **`business-getapp-cta.test.ts`** · **`business-getapp-cta.tester.test.ts`** ← the last two are the **§7.3 gap** (§10.2)
**Gates (5):** orch-1328 / orch-1319 / orch-1324 / orch-1381 **amended** · **orch-1382 NEW**
**CI (2):** `strict-grep-mingla-business.yml` (job + invariant stanza) · `onelink-health-probe.yml` **NEW**
**Spec (1):** §10.8 added (the probe — flagged as an implementor addition)

---

## 4. Data-model changes applied

**None.** No DB, no migration, no edge function, no RLS, no realtime. Marketing web only.

## 5. Edge functions touched

**None.** `supabase/functions/invite-brand-member/index.ts` is byte-frozen and **untouched** (verified).

---

## 6. Regression tests — the fails-on-revert contract

Every test proven to FAIL when its defect is reintroduced (by **true line deletion/mutation**, never a
comment-out) and PASS when restored. Actual output pasted, not the word "verified".

| ID | Revert applied | Observed failure |
|---|---|---|
| **T-1** | android `installHref` → web app | `FAIL T-1: android installHref is "https://business.usemingla.com", expected the business OneLink` |
| **T-2/A-6** | business → the **consumer** OneLink | `FAIL A-4: ios resolves to … https://go.usemingla.com/w36m?pid=bio_youtube&c=business_bio` |
| **T-3** | drop `.toLowerCase()` | `FAIL T-3: YouTube → direct` |
| **T-4** ⭐ | **unanchor the regex** | `FAIL B-1: sanitizeLinksSrc("<script>alert(1)</script>") = "<script>alert(1)</script>"` + `FAIL B-3: round-tripped pid violates H-1: bio_<script>alert(1)</script>` |
| **T-4** ⭐ | `toBioPid` → bare `${src}` | `FAIL B-1: H-1 VIOLATED — pid "" does not match /^bio_…/` (4 cases) |
| **T-4** ⭐ | delete the fail-safe | `FAIL B-3: round-tripped pid violates H-1: bio_` ← **the exact `pid=bio_` hole** |
| **T-5** | manual concat | `FAIL T-5: builder concatenated a raw value — query injection: …?pid=a&c=evil&c=business_bio` |
| **T-6** | desktop grows an install button | `FAIL T-6: desktop installHref is "https://go.usemingla.com/…", expected null` |
| **T-7** ⭐ | **swap the two bases** | `FAIL C-3: business/ios: installHref carries the CONSUMER branded domain` + `FAIL C-4` + `FAIL C-1` |
| **T-8** ⭐ | Snapchat `explorer_only` → `neutral` | `FAIL T-8: Snapchat must be scope:'explorer_only', got 'neutral'` + `FAIL: business socials = 8, expected 7` |
| **T-8** | collapse the union | **tsc:** `error TS2578: Unused '@ts-expect-error' directive.` ×4 |
| **T-9** | **strip `rel` from all 3 CTA anchors** | `FAIL T-9: a CTA anchor lost rel="noopener" … Anchor: <a href={businessTarget.installHref} target="_blank" onClick={()…` |
| **T-10** | `px-4` creeps back | `FAIL T-10: the business pills carry a 'px-4' override again` |
| **T-10** | un-stack the pills | `FAIL T-10: the two business actions are not stacked in a flex column` |
| **T-11** | attribution → a query param | `FAIL T-11: the route does not compose siteAttribution('business_download')` |

**All restored → green.** `fails-on-revert verified at 6968b9725` (T-9 re-proven at `e951da8db`).

### Gate amendments — fails-on-revert (against the REAL files, not fixtures)

| Gate | Revert | Observed |
|---|---|---|
| **orch-1328** ⭐ | CTA → a plain `<div>`, tablist buttons remain (**attack #27** — this **PASSES on main today**) | `FAIL — … the store/web CTA must be a real <a href={…}> anchor … (This check REPLACES a decorative /<button/ token check that only ever matched the TABLIST buttons and could never fail)` |
| **orch-1328** | strip CTA `rel` (socials row keeps its own) | `FAIL — a CTA anchor is missing rel="noopener" … Offending anchor: <a href={businessTarget.installHref} …` |
| **orch-1381** | android → `BUSINESS_WEB_URL` | `FAIL — the 'android' branch resolves installHref to BUSINESS_WEB_URL() — it MUST be buildOneLinkHref(BUSINESS_ONELINK_URL, …)` |
| **orch-1381** | android → plain Play URL (**new tooth**) | `FAIL — … resolves installHref to BUSINESS_PLAY_STORE_URL() …` |
| **orch-1382 R4** ⭐ | unanchor the regex | `FAIL — LINKS_SRC_PATTERN /[a-z0-9_]{1,32}/ is NOT ANCHORED (^…$)…` |
| **orch-1382 R5** ⭐ | bare `${src}` | `FAIL — toBioPid does not return a template/concat ROOTED at LINKS_PID_PREFIX…` |
| **orch-1382 R1/R2** | swap bases | `FAIL — EXPLORER_ONELINK_URL "https://biz.usemingla.com/ZSCW" … CROSSED` (4 failures) |
| **orch-1382 R7** | raw `searchParams.src` | `FAIL — must call sanitizeLinksSrc( on searchParams.src…` |

**Self-tests:** orch-1328 **18/18** · orch-1319 **9/9** · orch-1324 **19/19** · orch-1381 **20/20** · orch-1382 **18/18**.

---

## 7. Old → New receipts

### `lib/links-src.ts` (NEW, ~150 lines)
**Before:** did not exist; `src` was not captured at all — every bio install anonymous.
**Now:** the single sanitisation boundary. Anchored charset, `bio_direct` fail-safe, `toBioPid` as the
sole writer of `bio_`, `URLSearchParams` builder.
**Why:** SC-2/4/5, H-1..H-4.

### `lib/explorer-app-target.ts` (NEW, ~90 lines)
**Before:** `platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL` duplicated in `glass-nav:69` **and**
`links-experience:214` — the same triplication class ORCH-1381 killed for business.
**Now:** one decision module; `installStore` stays platform-derived (analytics label), which keeps the
surfaces' `platform ===` branching load-bearing rather than decorative.

### `lib/business-app-target.ts` (~40 lines)
**Before:** `resolveBusinessAppTarget(platform)` → plain store URLs; label `'Download the app'`; docblock
asserted the OneLink is "DEAD on Android".
**Now:** `resolveBusinessAppTarget(platform, attribution)` (**required** param = compile-time attribution
guard) → attributed OneLink; label `'Get the app'`; the stale "DEAD" claim corrected with the re-proof.
**Why:** §5.2.4 + §5.3.1 + §0.1.

### `lib/links-config.ts` (~60 lines)
**Before:** `businessHref?: string` — absence carried all the meaning, so `neutral` and `explorer_only`
were **indistinguishable**.
**Now:** a 3-kind discriminated union + `socialsForTab()`; Snapchat added as `explorer_only`.
**Why:** (D) is only safe because (E) exists.

### `components/marketing/links-experience.tsx` (~90 lines)
**Before:** `<button onClick={onCtaClick}>` → `openExternal(plainStoreUrl)`; two pills side-by-side with
the D-A `px-4` patch; `LINKS_SOCIALS.map`.
**Now:** real anchors → attributed OneLink; `onCtaTrack` (analytics only); stacked pills, `px-4` and its
comment block removed; `socialsForTab(activeId)`; Snapchat icon; `src` prop; budget levers.
**`openExternal` survives** for the one desktop QR path.

### `glass-nav.tsx` / `hero.tsx` (~50 / ~35 lines)
**Before:** `<Button onClick={handler}>` → `openExternal(...)`.
**Now:** `<a href={…} target="_blank" rel="noopener" onClick={trackHandler}>` consuming
`buttonClasses()` — pixel-identical to the `<Button>` they replace, by construction.

### `app/business/download/page.tsx` (~8 lines)
**Before:** `resolveBusinessAppTarget(platform)` → plain store URL.
**Now:** `resolveBusinessAppTarget(platform, siteAttribution('business_download'))` — **self-attributes
server-side, no query param**, because the invite-email href is byte-frozen.

### `components/ui/button.tsx` (~30 lines) — additive only
`buttonClasses()` exported; `Button` consumes the same function, so they cannot drift. Props/DOM/
behaviour unchanged.

---

## 8. Cross-surface impact

| # | Surface | Affected | Why |
|---|---|---|---|
| 1 | Consumer iOS | **NO** (code) | Not a code surface. The **installed app** receives `pid=bio_*` from the live 1.1.2 build — **no native build needed** (COMMS-0100). |
| 2 | Consumer Android | **NO** (code) | As #1; `pid` arrives via the Play referrer (curl-proven). |
| 3 | Buyer/anonymous Web | **NO** | `mingla-business/**` DO-NOT-TOUCH; `GUEST_FUNNEL_ONELINK_URL` left dark. |
| 4 | Business iOS | **NO** (code) | As #1. |
| 5 | Business Android | **NO** (code) | As #2. |
| 6 | Admin Web | **NO** | DO-NOT-TOUCH. |
| 7 | Business Web preview | **NO** | Untouched. |
| — | **Marketing Web** | **YES** | A–E. **Parity is MANUAL across the 4 CTA surfaces** — they share `lib/`, not a component. Each verified separately. |

**`[deploy]` tag present on both commits** (touches `mingla-marketing/`).

---

## 9. Smoke result — runtime, real browser

Production build served locally; driven with Playwright/Chromium at real viewports + UAs.

**SC-6-NoScroll — clipping-aware, per §5.3.3 (NOT `scrollHeight`):**

```
=== 375x667 (Business, ?src=youtube, consent accepted) ===
  PASS  criterion 1: no scroll (scrollHeight 667 === clientHeight 667)
  measured elements: 13, innerHeight=667, maxBottom=647, headroom=20px
  PASS  criterion 2 (MANDATORY): nothing clipped
=== 360x640 ===
  measured elements: 13, innerHeight=640, maxBottom=620, headroom=20px
  PASS  criterion 2 (MANDATORY): nothing clipped
```

All 13 elements (wordmark, tablist, heading, both CTAs, note, **every social icon**) satisfy
`rect.bottom <= innerHeight && rect.top >= 0` at both viewports. **OQ-2 escalation NOT needed** — the
§5.3.3 levers (`p-6→p-5`, tablist `mt-6→mt-5`, CTA `mt-5→mt-4`, note `mt-3→mt-2`, socials `mt-5→mt-4`)
reclaimed the ~64px stacking cost. **No forbidden lever used**: the copy is byte-unchanged and `h-14`
(56px) is intact.

**Snapchat actually paints** (attack #22 — a broken glyph lays out identically):
`svg=true path=true d.length=1415 pathBBox={"w":25,"h":23}` — real geometry, not an empty box.

**Live OneLink verification (5/5 each, Android UA):**
```
biz.usemingla.com/ZSCW → 301 market://details/?id=com.sethogieva.minglabusiness   (5/5)
go.usemingla.com/w36m  → 301 market://details/?id=com.mingla.app.v2               (5/5)
?pid=bio_youtube&c=business_bio → referrer=pid=bio_youtube&c=business_bio&af_tranid=…
```

**Gates:** 13/13 green (self-test + live). **Suite:** 23/23 files green. **tsc:** clean. **Build:**
green (`/links` now `ƒ` dynamic — correct per §4.5). **deno:** invite-email byte-frozen **26 passed**.
**Append-only:** **12 passed, 0 failed**.

**NOT verified here (needs the tester / a real device):** the in-app-browser case (attack #8 — the
decisive reason anchors were chosen; cannot be proven in a desktop browser), real-device tap → Play app
opens with no web flash (attack #9), and SC-8 pre-consent on a real deploy.

---

## 10. Discoveries for the orchestrator

### 10.1 ⚠ SC-8 — the primary CTA improved, but the SECONDARY deepened (needs a ruling)

Measured at 375×667 **pre-consent**, Business tab:

```
BASELINE (ORCH-1381): banner top=439 | both pills shared ONE row y=394-450 → each overlapped 11px
NOW      (ORCH-1382): banner top=440
  Get the app    y=362-418  overlap= 0px  vs 11px baseline -> IMPROVED
  Use on web     y=426-482  overlap=42px  vs 11px baseline -> DEEPENED
```

**SC-8 is written against "the PRIMARY business CTA" — that overlap went 11px → 0px, so SC-8 PASSES by
its literal criterion.** But I am not going to let that stand as the whole story: stacking necessarily
pushes the second pill down, and **"Use on web" is now 42px covered pre-consent where it was 11px**.

- This is an **inherent consequence of (C)**, which the spec mandated, and the spec anticipated the
  panel growing (that is *why* SC-8 exists).
- It affects the **pre-consent state only**; the banner is dismissible, and post-consent (the state
  SC-6 measures) everything is fully visible.
- #905 is explicitly out of scope (§2.2), so I did **not** fix the banner, and I did **not** un-stack.

**Orchestrator/Seth call.** If the 42px matters, the cheapest fix is #905 itself (a separate ORCH), not
a change here.

### 10.2 ⚠ TWO SPEC GAPS — both proven by execution, both need ratification

**GAP 1 — §10.4 under-specifies the orch-1381 amendment (3 failures it does not mention).** The spec
says orch-1381 is "PARTIAL — AMEND" and lists only the ban rationale + a 2-arg check. Proven by running
the gate against the **spec-mandated** helper:
```
orch-1381 gate vs the SPEC-MANDATED ORCH-1382 helper:
FAILS with 3 failure(s):
  - check1: must reference BUSINESS_APP_STORE_URL
  - check1: must reference BUSINESS_PLAY_STORE_URL
  - G-b structural: android installHref resolves to 'buildOneLinkHref' — gate demands BUSINESS_PLAY_STORE_URL
```
I amended all three (destination consts → `BUSINESS_ONELINK_URL`; G-b re-pointed to
`buildOneLinkHref(BUSINESS_ONELINK_URL, …)`, and it now catches **more** than before: android→web,
android→plain-URL, and android→crossed).

**GAP 2 — §7.3's `[TEST-MOD-APPROVED]` list omits two files that the spec's own §10.3 forces to change.**
§10.3 states outright that "`openExternal` legitimately disappears from both files" (nav + hero) — but
`components/marketing/__tests__/business-getapp-cta.test.ts` **requires** `openExternal(` on both, and
neither it nor its `.tester` twin is in §7.3's list (nor in its "not covered" list). They would have
hard-failed the correct implementation.

**What I did:** treated both as covered by §7.3's stated principle ("these files assert tokens the spec
deliberately removes… retarget the assertion, never delete it"), retargeted them **without weakening any
angle**, and cited `[TEST-MOD-APPROVED ORCH-1382]`. **This needs the orchestrator to formally ratify the
§7.3 extension at review.** I did not stop the build for a clerical omission whose intent §10.3 states
outright — but it is the orchestrator's call to bless.

### 10.3 ⭐ A FIFTH DECORATIVE GUARD — found, repaired, and it was nearly mine

The spec warned of four. **There is a fifth, and I wrote it**, then caught it by actually running the
fails-on-revert proof rather than trusting it:

> T-9 and the orch-1328 gate asserted `/rel="noopener/` at **file level** on `links-experience.tsx`.
> That file's **socials row** has carried `rel="noopener noreferrer"` since ORCH-1317 — so the check
> **passed with every CTA anchor stripped of its rel.** Same class as `/<button/` matching the tablist.
> It would have shipped a real reverse-tabnabbing regression *while a green gate claimed otherwise* —
> the exact §5.1 trap, one level up.

Repaired per-anchor in both gates and both tests (`e951da8db`), each with a self-test case that a
file-level check provably fails. `orch-1324`/nav/hero were **not** decorative today (only CTA anchors)
but were one footer link away — hardened for the same reason.

**The lesson for the registry: "prove it fails" is not paperwork. It is the only thing that found this.**

### 10.4 COMMS-0103 (BLOCK) — acknowledged; and the probe is **born dark**

GitHub Actions is **dead repo-wide** (private repo + failed billing). Consequences I complied with:
**no merge** (the orchestrator owns that anyway), **all gates run locally** and pasted here as the
evidence, **no edge deploy** (none needed).
**Material for this ORCH: the OneLink probe I built cannot fire until Seth fixes org billing.** The
design is right, but it is **unmonitored until then** — trigger it once via `workflow_dispatch` after the
fix, before trusting its silence.

### 10.5 COMMS ledger — an ID collision, and I did NOT touch the anchor (deliberately)

- **The spec's §0/§14 reference "COMMS-0103 files the correction" — that ID is TAKEN** by the ad-engine
  billing BLOCK. **The OneLink correction was never actually filed** (`grep biz.usemingla.com/ZSCW
  COMMS_LEDGER.md` → **0 hits**). Next free ID: **COMMS-0104**.
- **This matters right now:** COMMS-0100 (3) is **OPEN** and states *"BUSINESS ONELINK IS DEAD ON ANDROID
  RIGHT NOW"*. That is **false** (5/5 → 301, re-proven twice this session), and it has **already
  propagated**: the ad-engine sessions acked it as *"ads must NEVER use minglabiz.onelink.me on Android
  (DEAD, AppsFlyer Pending)"*. Live, cross-ORCH misinformation.
- **I did not write to the ledger.** The anchor (`~/Desktop/mingla-main`) is **behind origin/main AND
  dirty** — another live session (`cinematic-ad-director+codex`) has an **uncommitted in-flight ack of
  COMMS-0102** in the working tree. The documented write procedure requires `git checkout main && git
  pull` on that anchor, which would have clobbered a concurrent session's work during an Actions outage.
  Deferring to the orchestrator, which owns ledger sync at CLOSE, was the lower-risk call.

**Ready-to-file row for the orchestrator (COMMS-0104):**
> `WARN` · `to: ALL` · **COMMS-0100 (3) and COMMS-0101 are STALE — the business OneLink is ALIVE on
> Android.** Re-proven by execution twice on 2026-07-15: `biz.usemingla.com/ZSCW` under an Android UA →
> `301 → market://details/?id=com.sethogieva.minglabusiness`, **5/5**; `go.usemingla.com/w36m` → `301 →
> market://details/?id=com.mingla.app.v2`, **5/5**; AppsFlyer `get_apps` reports **all 4 apps Active**.
> `?pid=bio_youtube&c=business_bio` rides through to the Play referrer intact. **Any session that
> excluded the business OneLink on "DEAD on Android" grounds (notably the ad-engine destination policy)
> should re-evaluate.** The raw `*.onelink.me` domains remain banned — on **routing policy** (branded
> domains only, ORCH-1346), **not** liveness. It is possible COMMS-0101's single "200" reading was itself
> the documented ~1-in-8 flake and the link was never dead.

### 10.6 Pre-existing, unrelated (not mine)

- **`mingla-marketing/lib/city-decks.test.ts` fails** under the repo's bare `tsc+node` pattern:
  `Cannot find module '@/lib/dc-showcase-places'` — a path-alias artifact of invoking `tsc` without
  `--project`. **Byte-identical to `origin/main`; my diff does not touch it.** Worth a hygiene ORCH.
- **`BUSINESS_APP_STORE_URL` / `BUSINESS_PLAY_STORE_URL` are now referenced only by tests**, since the
  helper resolves the OneLink. I did **not** remove them (§7.1 forbids it, and they remain the SSOT record
  of the listings + what the OneLink resolves to). Flagging the dead-const question, not acting on it.
- **`GUEST_FUNNEL_ONELINK_URL`** left dark, per §2.3.

---

## 11. Known issues / deferred

- **No `[TRANSITIONAL]` markers were needed** — nothing temporary was introduced.
- **`buttonClasses` (§5.4)** was implemented, not deferred; `links-experience`'s local `CTA_BASE` is
  **retained** deliberately (it encodes the `/links`-specific `h-14 w-full` pill, which `buttonClasses`
  does not, and §7.2 forbids touching it).
- **SC-8 secondary-CTA overlap** — §10.1, needs a ruling.
- **Probe born dark** — §10.4.

---

## 12. Operator action required

- **Migration `db push`:** **NONE** — this ORCH has no migration.
- **Edge functions to deploy:** **NONE**.
- **Seth (blocking the probe's usefulness only):** fix org billing (GitHub → Settings → Billing & plans →
  payment method + Actions spending limit), then re-run the failed workflows on `main` (`gh run rerun`)
  and trigger **OneLink Health Probe** once via `workflow_dispatch` to confirm green.
- **Orchestrator at CLOSE:** flip `I-PROPOSED-1382-LINKS-SRC-BIO-PID-NEVER-CROSSED` DRAFT → ACTIVE ·
  **ratify the §7.3 extension (§10.2)** · **file COMMS-0104 (§10.5)** and resolve/supersede COMMS-0101 +
  COMMS-0100 (3) · register the §2.2 repo-wide `if (!win)` sweep + the `city-decks` harness bug as new
  ORCHs · CLOSE commit carries `[deploy]`.

---

## 13. Verification matrix (gates run in THIS session)

| Gate/suite | Command | Result |
|---|---|---|
| tsc | `npx tsc --noEmit` | **clean** |
| build | `npm run build` | **green** (`/links` ƒ dynamic) |
| 13 strict-grep gates | `--self-test` + live | **13/13 green** |
| orch-1381-open-external / orch-1342-ssot | live | **green + UNTOUCHED** (attack #28) |
| 23 marketing suites | tsc+node | **23/23 green** (city-decks excluded — pre-existing, §10.6) |
| invite-email byte-frozen | `deno test` | **26 passed** (attack #25) |
| append-only | `test-append-only-check.js` | **12 passed, 0 failed** |
| runtime | Playwright, 4 viewports/UAs | **all green** |
| OneLink probe | live | **both healthy, 301 → market://** |
