# IMPLEMENTATION — ORCH-1381 [business-getapp-android-choice]

**Skill:** mingla-implementor (Claude). **Date:** 2026-07-15.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1381-[business-getapp-android-choice]` on branch `ORCH-1381-business-getapp-android-choice`.
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1381_BUSINESS_GETAPP_ANDROID_CHOICE.md` (`ef90bd4f0`) — implemented as a binding contract.
**Ledger:** COMMS-0101 (WARN, OPEN) ingested; `acked_by` appended at anchor `7ae450ccc` (pushed to `main`).
**Status:** `implemented and verified` (source + gates + runtime). Physical-Android-device evidence is the tester's, per §17.

---

## 1. Summary

Business "Get the app" sent **every Android owner to the web app** and never offered the Play listing. Correct when it shipped (ORCH-1324, business Play was in review); wrong since 2026-07-15, when the business Play listing went live (production versionCode 33 / 1.1.2 — COMMS-0101). An Android business owner was silently denied the app.

All four business get-app surfaces now present an explicit inline choice — **Download the app** (iOS → business App Store, Android → the LIVE business Play listing) and **Use on web** — plus a code-verified note. Desktop renders the web action only, with no dead install button. The decision collapses into one shared module (`lib/business-app-target.ts`); the ternary that was copy-pasted across 5 call sites is gone.

**The money shot, runtime-proven:** `GET /business/download` under an Android UA now returns **HTTP 200 HTML containing the Play href** — it previously 307'd to `business.usemingla.com`.

---

## 2. SPEC success-criteria coverage

| SC | Verdict | How verified | Commit |
|---|---|---|---|
| **SC-1-Android-Nav** | ✓ PASS | Runtime click (Chrome, Pixel-8 UA): nav Download → `https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness` | `6df5b122b` |
| **SC-1-Android-Hero** | ✓ PASS | Runtime: hero renders both actions; same helper + `action` props as nav | `6df5b122b` |
| **SC-1-Android-Links** | ✓ PASS | Runtime (375×667, Android UA): Business tab shows both actions, `moreNote` exact | `6df5b122b` |
| **SC-1-Android-Download** | ✓ PASS | `curl -A '<Android>'` → **HTTP 200** + `<a href="…minglabusiness">` **and** `<a href="https://business.usemingla.com">`. Not 307. | `6df5b122b` |
| **SC-2-iOS-{Nav,Hero,Links,Download}** | ✓ PASS | Runtime: Download → `https://apps.apple.com/app/id6768737367`; `/business/download` iOS → **200 HTML, no 307** | `6df5b122b` |
| **SC-3-Web-Action** | ✓ PASS | Runtime iOS+Android, all 4 surfaces → `https://business.usemingla.com` | `6df5b122b` |
| **SC-4-Desktop** | ✓ PASS | Runtime desktop + `Googlebot` + empty UA: exactly one action (`Use on web`) + `desktopNote`; **no** install anchor, **no** QR; 200 HTML | `6df5b122b` |
| **SC-5-Note** | ✓ PASS | Runtime byte-exact match of `moreNote` (ios/android) and `desktopNote` (desktop) on /links + /business/download | `6df5b122b` |
| **SC-6-Links-NoScroll** | ✓ PASS | Chrome @375×667: `scrollHeight 667 === clientHeight 667`; socials row bottom=647 < 667 (visible); both CTAs one row, 56px | `6df5b122b` |
| **SC-7-Analytics** | ✓ PASS (source+gate) | Both `action: 'download'` / `action: 'use_web'` on all surfaces; gate B requires both. **PostHog delivery is the tester's live check.** | `6df5b122b`, `10a1165b2` |
| **SC-8-Email-Href** | ✓ PASS | Deno test: href byte-exact, `!html.includes("business/download?")` — 38/38 pass | `6df5b122b` |
| **SC-9-Email-Copy** | ✓ PASS | T-11 (new): both variants name "iPhone or Android", neither claims "everywhere else opens"; **proven fails-on-revert** | `65ee89d85` |
| **SC-10-No-OneLink** | ✓ PASS | Gate E bans `minglabiz.onelink.me` + `go.usemingla.com` over helper + 4 surfaces; T-6 asserts it | `10a1165b2` |
| **SC-11-SSOT** | ✓ PASS | No `apps.apple.com`/`play.google.com` literal outside `store-links.ts` in touched files; runtime desktop HTML has no consumer package | `10a1165b2` |
| **SC-12-Consumer-Untouched** | ✓ PASS | Runtime: `/download` still **307** → Play (Android) / App Store (iOS). `git diff --stat origin/main...HEAD -- app-mobile/` = **empty** | — |
| **SC-13-Popup-Fallback** | ✓ PASS | All 3 client surfaces route both actions through `window.open` + `window.location.assign` fallback; pinned by tests + gate B | `6df5b122b` |

---

## 3. Files changed

| File | Δ | Note |
|---|---|---|
| `mingla-marketing/lib/store-links.ts` | +12 / −5 | `BUSINESS_PLAY_STORE_URL` added; stale "still in review" comment retired |
| `mingla-marketing/lib/business-app-target.ts` | **+99 (NEW)** | the ONE decision module + copy constants |
| `mingla-marketing/lib/__tests__/business-app-target.test.ts` | **+178 (NEW)** | T-1..T-6, T-9 — imports the REAL helper |
| `mingla-marketing/app/business/download/page.tsx` | +75 / −18 | de-redirected → inline choice (Server Component, plain `<a>`) |
| `mingla-marketing/components/marketing/glass-nav.tsx` | +64 / −22 | organiser branch → two actions (explorer branch untouched) |
| `mingla-marketing/components/sections/organiser-home/hero.tsx` | +62 / −22 | two actions; stale subcopy → note |
| `mingla-marketing/lib/links-config.ts` | +5 / −1 | stale business-tab body trimmed (buys /links height) |
| `mingla-marketing/components/marketing/links-experience.tsx` | +67 / −16 | business branch → two actions + note (explorer branch untouched) |
| `supabase/functions/invite-brand-member/index.ts` | +9 / −5 | copy only, both variants — **href untouched** |
| `.github/scripts/strict-grep/orch-1326-…mjs` | +79 / −45 | A1–A7 (incl. the `\b` trap fix) |
| `.github/scripts/strict-grep/orch-1324-…mjs` | +76 / −41 | B1–B6 |
| `.github/scripts/strict-grep/orch-1328-…mjs` | +36 / −13 | C1–C4 |
| `.github/scripts/strict-grep/orch-1342-…mjs` | +18 / −1 | self-test case only (no logic change) |
| `.github/scripts/strict-grep/orch-1381-…mjs` | **+289 (NEW)** | gate E |
| `.github/workflows/strict-grep-mingla-business.yml` | +17 / −4 | 1381 job + 4 invariant doclines |
| 5 test locks + invite-email test | +216 / −114 | §11 rewrites + T-11 |

**Out-of-allowlist files touched: NONE.** `lib/device-platform.ts` untouched (D-3), all of `mingla-business/**` untouched, `app-mobile/**` untouched.

---

## 4. Data-model changes applied

**None.** No DB, no migration, no RLS, no realtime, no service/hook layer. Nothing to `db push`.

## 5. Edge functions touched

| Function | Change | `verify_jwt` |
|---|---|---|
| `invite-brand-member` | **Copy only** (`secondarySub` both variants + stale comment). No logic, no href, no signature change. | **PRESERVE existing value — unchanged by this ORCH.** |

Deploy is orchestrator/operator-owned from MERGED `main`. Because the change is copy inside the email renderer, the function **must be redeployed** for the new copy to reach real invitees — the tests prove the renderer, not the deployed artifact.

---

## 6. Regression tests added

- **`mingla-marketing/lib/__tests__/business-app-target.test.ts`** — 7 cases (T-1..T-6, T-9). **T-1 imports the real `resolveBusinessAppTarget`**, so it exercises the real decision path rather than grepping source.
- **`supabase/functions/invite-brand-member/__tests__/orch-1329-invite-email.tester.test.ts`** — T-11 added (additions-only; the byte-frozen href pin was NOT weakened).

### fails-on-revert PROOF — verified at commit `e6dbe68f6`

Both reverts were **true line deletions/replacements**, not comment-outs (`git diff --stat` confirmed real deletions).

**Revert A — delete the android branch (8 lines removed):**
```
FAIL  T-1: android installHref is "null", expected the business Play listing
FAIL  T-5: android resolves to a Play URL that is not the business package
2 test(s) failed   → exit 1
```

**Revert B — restore the exact ORCH-1324 collapsed ternary (the real historical bug):**
```
FAIL  T-1: android installHref is "https://business.usemingla.com",
           expected "https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness"
FAIL  T-3: desktop installHref is "https://business.usemingla.com", expected null
FAIL  T-5: android resolves to a Play URL that is not the business package
3 test(s) failed   → exit 1
```

**Restored → `All 7 business-app-target tests passed` (exit 0)**, working tree byte-identical to `e6dbe68f6`.

**T-11 fails-on-revert** (email copy restored to the falsehood): both variants `FAILED`; restored → `38 passed | 0 failed`.

---

## 7. Old → New receipts

### `lib/business-app-target.ts` (NEW)
**Before:** did not exist; the ternary `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` was copy-pasted across 5 call sites.
**Now:** the single source of truth. `ios → App Store`, `android → Play`, `other → null install + web`, `canInstall` gate.
**Why:** §6.2. The triplication *is* the bug class — one store going live left 4 surfaces stale.

### `app/business/download/page.tsx`
**Before:** `if (platform === 'ios') redirect(BUSINESS_APP_STORE_URL); redirect(BUSINESS_WEB_URL)` — Android/desktop 307'd to web, Android never saw Play.
**Now:** renders both destinations as plain `<a>`, branching on `canInstall`. No `redirect`, no `window`/`navigator`/`<form>`. `force-dynamic` kept.
**Why:** SC-1-Android-Download, SC-2, SC-4. iOS deliberately no longer auto-redirects (§6.3) — auto-jumping would deny the choice to invite-email iPhone arrivals.

### `glass-nav.tsx` (organiser branch only)
**Before:** one "Get the app" pill → ternary; Android → web.
**Now:** two pills (Download canInstall-gated + Use on web), `BUSINESS_APP_CHOICE_COPY` labels, separate handlers each firing `action`. **Explorer branch byte-untouched** (QR panel intact — pinned by the surviving sanity case).
**Why:** SC-1-Android-Nav, U-1/U-2/U-3, SC-7.

### `hero.tsx`
**Before:** one button + `"On iPhone now — or get started on the web."` (the same falsehood as the email).
**Now:** two buttons (row ≥sm, column below), note from the shared constant.
**Why:** SC-1-Android-Hero, SC-5, D-7.

### `links-experience.tsx` (business branch only)
**Before:** single CTA → ternary; Android → web.
**Now:** `onCtaClick(tab, action?)`; business branch delegates to the helper and renders two buttons **side-by-side in one row** + a single-line note. Explorer branch untouched.
**Why:** SC-1-Android-Links + SC-6 (one row protects the no-scroll contract).

### `links-config.ts`
**Before:** body ended `"Now on iPhone — or get started on the web."`
**Now:** trimmed — buys the note's height (§6.3 mitigation 2).

### `invite-brand-member/index.ts`
**Before:** both variants claimed "iPhone opens the App Store, everywhere else opens the web".
**Now:** both name "iPhone or Android". **Href byte-frozen — untouched.**
**Why:** SC-9, D-5.

---

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---|---|---|
| Consumer iOS | **NO** — no web version → no choice exists | — |
| Consumer Android | **NO** — same | — |
| Buyer/anonymous Web | **NO** — consumer-facing CTAs, out of scope | — |
| Business iOS (native) | **NO** — already installed, no get-app CTA | — |
| Business Android (native) | **NO** — same | — |
| Admin Web | **NO** — no get-app CTA | — |
| Business Web preview | **NO** — it is the *destination*, not a CTA host | — |
| **Marketing web** | **YES** — 4 surfaces render the inline choice | **Manual** (4 render paths); **automatic** for the decision (one helper) |
| **Transactional email** | **YES** — copy stops promising web-for-everyone | Manual — copy only, no href change |

Consumer regression swept: `/download` still 307s device-aware; explorer QR intact; `git diff origin/main...HEAD -- app-mobile/` **empty**.

---

## 9. Gates & smoke results

| Gate | Self-test | Live |
|---|---|---|
| `orch-1324-business-getapp-device-aware` | **PASS** (12/12) | **PASS** |
| `orch-1326-links-business-download-route` | **PASS** (12/12) | **PASS** |
| `orch-1328-links-cta-opens-store-clientside` | **PASS** (11/11) | **PASS** |
| `orch-1342-store-links-ssot` | **PASS** (11/11) | **PASS** (unamended, as spec'd) |
| `orch-1381-business-getapp-android-choice` | **PASS** (14/14) | **PASS** |

- `tsc --noEmit` (marketing): **exit 0**
- `next build`: **success**; `/business/download` = `ƒ` dynamic (force-dynamic preserved)
- Marketing test suite (tsc+node): business-app-target **7/7**, download-route **7/7**, getapp-cta **12/12**, getapp-cta.tester **9/9**, links-cta **7/7**, links-cta.tester **7/7**, links-config **10/10**
- `deno check` invite-brand-member: **OK**; `deno test`: **38 passed / 0 failed**
- `test-append-only-check.js` vs `origin/main`: **7 passed, 0 failed** (5 modified test files authorised by `[TEST-MOD-APPROVED ORCH-1381]` at HEAD)
- **Lint: NOT RUN — no gate exists.** `mingla-marketing` has **no ESLint config** (`next lint` drops into interactive setup) and **no workflow runs lint**. Pre-existing; not introduced here. Reported rather than claimed green.

### Runtime smoke (Chrome + curl, local `next start`)
| UA | HTTP | Anchors | Note |
|---|---|---|---|
| Android Pixel 8 | **200** | Play (business pkg) + business web | `moreNote` |
| iPhone iOS 17 | **200** | App Store + business web | `moreNote` |
| macOS desktop | **200** | business web ONLY | `desktopNote` |
| `Googlebot/2.1` | **200** | business web ONLY | `desktopNote` |
| empty UA | **200** | business web ONLY | — |

Dead-button hunt (desktop): no `href="null"`/`""`/`"#"`/`"undefined"`; "Download the app" absent. Wrong-package check: no `com.mingla.app.v2`.

---

## 10. Known issues / deferred

- **No `[TRANSITIONAL]` code introduced.**
- **SC-7 analytics delivery** is source+gate-verified only; PostHog receipt of `action: 'download'` / `'use_web'` is the tester's live check (§16 #9).
- **OQ-1 (copy) / OQ-2 (nav note omitted) / OQ-3 (desktop has no install path)** remain open for Seth. I implemented the spec's proposals verbatim; copy is cheap to change, the 2-actions+1-note structure is the contract.
- **OQ-4 (iPad-as-Mac → desktop treatment on `/business/download`)** — pre-existing, unfixed here, as spec'd (D-4).

---

## 11. Operator action required

- **Migration `db push`: NONE** — this ORCH ships no SQL.
- **Edge deploy (orchestrator/operator, from MERGED `main`):**
  ```
  invite-brand-member   — copy-only change; PRESERVE its existing verify_jwt value
  ```
  Without redeploy the invite email keeps sending the false "everywhere else opens the web" copy.
- **CLOSE commit MUST carry `[deploy]`** (touches `mingla-marketing/`) — §2.
- **Invariants (orchestrator owns the flip):** create `I-PROPOSED-1381-…` ACTIVE; **amend the three ACTIVE invariants** 1324 / 1326 / 1328 per §8 (D-6). 1342 needs no amendment.

---

## 12. Discoveries for Orchestrator

| ID | Discovery |
|---|---|
| **N-1** ⚠ | **SPEC §10 gate-E G-b was DECORATIVE — found and fixed.** The spec mandates `/'android'[^\n]*BUSINESS_WEB_URL/` ("on the same line"), but the spec's **own §6.2 reference implementation is a multi-line block**, so `'android'` and `BUSINESS_WEB_URL` never share a line — the regex would have **passed on the exact revert it claims to catch** (precisely §16 attack #3's "decorative guard"). Gate E ships the same-line check **plus a structural check** that reads the android branch's own `installHref:` and pins it to `BUSINESS_PLAY_STORE_URL`. Both forms have self-test cases (4 and 4b); case 4 also asserts its own fixture isn't a no-op. |
| **N-2** | **SPEC §9's T-1 run command path is wrong.** `tsc` roots the emit at `lib/`, so the runnable JS is `/tmp/o/__tests__/business-app-target.test.js`, not `/tmp/o/business-app-target.test.js`. Corrected in the test header. |
| **N-3** | **`links-config.tester.test.ts` needed NO change** (spec listed it conditionally). It pins hrefs/destinations/socials, never the `body` copy. Left untouched. |
| **N-4** | **The email's plain-text fallback was already truthful** and needed no change — it says only "Prefer to manage on your phone? Get the Mingla Business app: <url>" with no platform claim. The spec cited only the HTML variants; I verified the text path independently. |
| **N-5** | **Two stale self-test fixtures were silently no-ops** and were caught only because the gates self-test. In `orch-1326` the "App Store literal" case patched a `redirect(...)` string that no longer existed; in `orch-1324` the `surface:'organiser'` case used a non-global replace against a now-two-handler fixture. Both fixed. **Pattern worth noting:** a self-test case whose `.replace()` misses silently becomes vacuous — the fixture-is-a-no-op assert added in gate E case 4 is the cheap defence. |
| **N-6** | **`mingla-marketing` has NO lint gate.** No ESLint config, no workflow. `next lint` is interactive-only. Candidate for its own ORCH. |
| **N-7** | **`node_modules` was absent across the whole worktree** — `npm ci` in `mingla-marketing` was required before any gate could run. Worth noting for future worktree spawns. |
| **N-8** (relayed) | Spec D-1 (business `BUSINESS_*` SSOT migration into `mingla-business`), D-4 (/links no-scroll invariant + gate), D-9 (manual check-in writes to a device-local `scanStore` with no backend sync — a real data-integrity gap on a paid surface) all remain unregistered follow-up ORCHs. |

---

## 13. Commits (branch `ORCH-1381-business-getapp-android-choice`)

| Hash | Subject |
|---|---|
| `e6dbe68f6` | shared decision helper + `BUSINESS_PLAY_STORE_URL` (**T-1 fails-on-revert proven at this hash**) |
| `6df5b122b` | 4 surfaces offer the inline choice + truthful email copy |
| `10a1165b2` | amend 3 CI gates, add the 1381 gate, pin 1342's safety |
| `65ee89d85` | rewrite the 4 test locks that pinned Android→web + T-11 (`[TEST-MOD-APPROVED ORCH-1381]`) |

Anchor (`main`, ledger only): `7ae450ccc` — COMMS-0101 implementor ack, pushed.

**No PR opened, nothing merged, nothing deployed** — orchestrator owns those (§17).

---
---

# ADDENDUM P2 FIXES — implementation (D-A, D-A-2, D-B)

**Contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1381_ADDENDUM_P2_FIXES.md` (commit `e99aa38aa`), §10 steps 1–7.
**Seth's rulings applied:** **OQ-1 = option B** (nav shows ONE action on a phone; logo restored to its full 84px; hero keeps the full choice). **OQ-2 = drop `noreferrer`** (accepted: our own store listings, no PII, useful attribution; `noopener`'s security property preserved by nulling `opener`).
**Date:** 2026-07-15 · **Rebased onto** `origin/main` (`aa54dc2c8`).

> **§13 of the addendum says "build steps 1–6 only; step 7 is BLOCKED on OQ-1."** That block is **lifted** — Seth ruled OQ-1 = B, so step 7 (D-A-2) is built here.

## A1. Summary (plain English)

Every "Download the app" / "Use on web" button on the Mingla marketing site was navigating **twice** on a single tap: it opened the store in a new tab **and** destroyed the page you were standing on. That is fixed at all 4 buttons. Separately, on an Android phone the two business buttons were spilling their own text past their rounded edges — also fixed, without touching a single word of the (CI-pinned, code-verified) copy. And the Mingla logo in the business nav — which had been quietly squashed from 84px to 30px to make room — is back at full size.

## A2. What changed, by defect

### D-B — the double navigation (4 call sites, 3 files)

`window.open(dest,'_blank','noopener,noreferrer')` returns `null` **even on success** (HTML spec), so the `if (!win) window.location.assign(dest)` "popup-blocked fallback" fired on **every** tap.

**NEW single owner:** `mingla-marketing/lib/open-external.ts`
```ts
const win = w.open(dest, '_blank')   // no noopener/noreferrer → real WindowProxy on success
if (win) { win.opener = null }        // preserves the noopener SECURITY property
else { w.location.assign(dest) }      // genuine popup-block fallback (no dead tap)
```

All 4 call sites now delegate; the local helpers **and their now-false "popup-blocked" comments** are deleted:

| # | File | Was | Now |
|---|---|---|---|
| 1 | `components/marketing/glass-nav.tsx` (**explorer**) | inline open+fallback | `openExternal(store)` |
| 2 | `components/marketing/glass-nav.tsx` (business) | local `openBusinessDest` | `openExternal(...)` ×2 |
| 3 | `components/marketing/links-experience.tsx` | local `openExternal` `useCallback` | imported `openExternal` |
| 4 | `components/sections/organiser-home/hero.tsx` | local `openDest` | `openExternal(...)` ×2 |

**Sweep confirms 4 sites, no 5th** (tester attack #4 pre-answered). The only remaining `noopener noreferrer` hits in `mingla-marketing/` are `rel=` attributes on real `<a>` elements (`careers/layout.tsx:63`, `links-experience.tsx:455`, `careers-markdown.ts:28`) — **correct and unaffected**: an anchor returns no `WindowProxy`, so the null-return trap does not apply to `rel`.

### D-A — the `/links` pill overflow (360px)

`links-experience.tsx:388/:396` → `cn(CTA_BASE, CTA_INTENT.x, 'px-4')` on the **business pair only**, + the protective comment. `CTA_BASE` and `h-14` deliberately **unchanged** (SC-6's 375×667 budget was measured against `h-14`; a `min-h`+grow breaks the same-row contract).

**twMerge verified by execution** (tester attack #10 — read the emitted string, don't trust the contract):
```
contains px-4 : true   |  contains px-7 : false  (displaced cleanly)
h-14 retained : true   |  w-full retained: true
```

### D-A-2 — the nav (Seth's OQ-1 = B) — addendum §10 step 7, unblocked

- **Logo restored to its full 84px:** `shrink-0` added to the logo `<Link>`. This is **load-bearing, not cosmetic** — without it the logo was a shrinkable flex item that silently absorbed all nav overcrowding by squashing (84→30px, →invisible under nowrap). That is exactly why **no automated check ever caught the nav overflow: the bar could not fail a width check, it just destroyed the brand instead** (addendum D-A1).
- **One action on a phone:** when the device can install, the nav renders `Download the app` only; the `Use on web` pill carries `hidden … sm:inline-flex` and returns at `sm` (640px). When the device **cannot** install, `Use on web` is the only action and always renders (that branch is unchanged).
- **`whitespace-nowrap`** on the nav business pills.
- **Both handlers survive**, so both `action: 'download'` and `action: 'use_web'` captures remain on the surface — which is what the orch-1324 two-action check pins.

**Ruling → code mapping:** "on a PHONE exactly ONE action — Download when installable, Use on web when not" = the `canInstall` branch. "Desktop nav unchanged (both actions fit)" = desktop has `canInstall === false`, so it renders the single web action exactly as before; the `sm:` breakpoint additionally restores the full inline choice on any wide viewport (e.g. tablet/landscape) where it genuinely fits.

**twMerge verified by execution:** `hidden` displaces the base `inline-flex`; `sm:inline-flex` survives → correct hide-below-`sm` behaviour.

## A3. Gate amendments — BOTH-DIRECTION PROOF (the headline evidence)

The orchestrator's C-2 correction is **independently confirmed**: the gates never mandated the bug — **they were blind to it**. Baseline, before any of my changes, all 5 gates passed the unmodified (buggy) code.

**The counterfactual, executed against the real files:**

| Gate | vs the SHIPPED BUG (`git show HEAD:` sources) | vs THE FIX |
|---|---|---|
| **ORIGINAL** `orch-1324` | **PASS** ← green while the bug shipped to prod | PASS |
| **ORIGINAL** `orch-1328` | **PASS** ← green while the bug shipped to prod | PASS |
| **AMENDED** `orch-1324` | **FAIL** ← now caught | **PASS** |
| **AMENDED** `orch-1328` | **FAIL** ← now caught | **PASS** |

**Per-call-site revert matrix** (tester attack #12 — "a gate that only catches an all-4 revert is a gate with one tooth"). Each of the 6 revert shapes was injected **individually** into the real tree and the live gates run:

| Injected revert | orch-1324 | orch-1328 | orch-1381-openext |
|---|---|---|---|
| *(the fix — baseline)* | PASS | PASS | PASS |
| R1 `open-external.ts` → shipped bug | PASS | PASS | **FAIL** |
| R2 `open-external.ts` → **`noreferrer`-only half-fix trap** | PASS | PASS | **FAIL** |
| R3 glass-nav **business** inlines the bug | **FAIL** | PASS | PASS |
| R4 glass-nav **explorer** inlines the bug | **FAIL** | PASS | PASS |
| R5 links-experience inlines the bug | PASS | **FAIL** | PASS |
| R6 hero inlines the bug | **FAIL** | PASS | PASS |
| *(restored fix)* | PASS | PASS | PASS |

**Every call site fires a gate on its own.** All 4 files verified restored byte-identical afterwards.

**Amendments made:**
- `orch-1324` check **(e)**: `window.location.assign(` token → **`openExternal(` delegation**; BANs added: `window.open(`, and `.open(` carrying `noopener|referrer`. Self-test **15/15** (was 12/12) incl. the **`noreferrer`-only trap** + a bare-inline case.
- `orch-1328` check **4**: `window.open(`+`assign(` tokens → **`openExternal(` delegation**; same two BANs; the old `noFallback` case replaced by a `no openExternal` case. Self-test **13/13** (was 11/11).
- **NEW** `orch-1381-open-external-no-double-nav.mjs` (R1–R4 per §6.4). Self-test **8/8**, including two cases the addendum did not specify: a **`noopener`-only** case, and an **unconditional-sibling `assign(`** case that **only R3 catches** (R1/R2/R4 all pass it) — that case is what proves R3 is the non-decorative tooth.
- Registered in `.github/workflows/strict-grep-mingla-business.yml` (self-test + live steps; **YAML validated by parse — 338 jobs, job present**), + the `:179` invariant docblock for **`I-PROPOSED-1381-OPEN-EXTERNAL-SINGLE-OWNER`**, + the 1324/1328 docblocks corrected (they still described the blind checks).
- `orch-1326`, `orch-1342-*` **untouched** — verified PASS unamended (§6.5). The 6th gate `orch-1381-business-getapp-android-choice` (base ORCH; **absent from the addendum's §11 list**) also verified **PASS**.

## A4. Regression test — fails-on-revert PROVEN

**File:** `mingla-marketing/lib/__tests__/open-external.test.ts` (NEW, append-only). Behavioural, not a source grep — it drives `openExternal` against a fake `Window` that models the browser-verified rule *(noopener OR noreferrer ⇒ null even on success)*.

Run: `npx tsc lib/__tests__/open-external.test.ts --outDir /tmp/oe --module commonjs --target es2020 --moduleResolution node --skipLibCheck && node /tmp/oe/__tests__/open-external.test.js`

| Implementation | Result |
|---|---|
| **THE FIX** | **All 4 pass** (T-A, T-B, T-C, T-D) |
| REVERT A — shipped bug | **3 FAIL** (T-A behavioural, T-B structural, T-D security) |
| REVERT B — **`noreferrer`-only half-fix trap** | **3 FAIL** ← catches the trap identically |
| REVERT C — fallback deleted | **1 FAIL** (T-C — dead tap) |
| REVERT D — `opener` not severed | **1 FAIL** (T-D — tabnabbing) |
| **RESTORED** | **All 4 pass** |

**`fails-on-revert verified at commit `54b7a8692`** — by **true line deletion** of the fix body (not comment-out), across **4** distinct revert shapes, each caught by an independent angle. **T-A is the real tooth: it asserts the fallback does NOT fire on a successful open.** The addendum predicted 2 failures for REVERT A; the actual result is **3** (T-D also catches that the shipped bug never severed `opener`) — stronger than specified, not a contradiction.

## A5. Verification matrix

| Check | Result |
|---|---|
| `npx tsc --noEmit` (mingla-marketing) | **exit 0** |
| `npx next build` | **exit 0** (all routes compiled) |
| 7 strict-grep gates, live | **all PASS** (5 addendum + base `orch-1381-*` + new) |
| 3 gate self-tests | **15/15 · 13/13 · 8/8** |
| `lib/__tests__/open-external.test.ts` (NEW) | **4/4 PASS** + fails-on-revert ×4 shapes |
| `lib/__tests__/business-app-target.test.ts` | **7/7 PASS** |
| `lib/__tests__/business-app-target.tester.test.ts` | **5/5 PASS** |
| `lib/device-platform.test.ts` | **7/7 PASS** |
| `components/marketing/__tests__/business-getapp-cta.tester.test.ts` | **9/9 PASS** |
| **3 component source-grep suites** | **4 FAILURES — see A6 BLOCKER** |
| SC-12 (`app-mobile/`, `mingla-business/`, `mingla-admin/`, `device-platform.ts`) | **empty diff vs origin/main — HOLDS** |
| `BUSINESS_APP_CHOICE_COPY` | **byte-frozen** (empty diff) |
| Invite-email href | **untouched** (no supabase diff in this work) |
| `/business/download` | **untouched** — still a Server Component, plain `<a>` |
| Real-browser pixel re-measurement | **NOT RUN — no playwright in this env.** See A7 cap. |

## A6. 🚨 BLOCKER — the addendum is INTERNALLY CONTRADICTORY (stop-and-amend, not actioned)

**The addendum's §10 step 6 — "the 3 existing suites still pass" — is IMPOSSIBLE as written.**

The addendum caught this hazard for **gates** (§6.1: "once the components delegate to `openExternal`, they no longer contain `window.open(` … so orch-1324 (e) and orch-1328 (4) would fire — a *false* failure") and **amended them accordingly**. It did **not** apply the same reasoning to the **test suites**, which assert the identical tokens. C-2's "all 3 existing test suites pass" was measured against the prescribed **inline** pattern — but §5.3 then **mandates extraction**, which breaks them.

**4 failing assertions, all decorative token-presence checks that were green while the bug shipped (the D-A3 class exactly):**

| File | Failing assertion |
|---|---|
| `components/marketing/__tests__/business-getapp-cta.test.ts:126-141` | requires `openBusinessDest(` + `window.open(` + `window.location.assign(` in the **deleted** local helper |
| `components/marketing/__tests__/business-getapp-cta.test.ts:205-209` | `hero: has the window.location.assign popup fallback` |
| `components/marketing/__tests__/links-cta-device-aware.test.ts:86-87` | requires `window.open(` + `window.location.assign(` in `links-experience.tsx` |
| `components/marketing/__tests__/links-cta-device-aware.tester.test.ts:125-126` | same |

**Why I did NOT fix them (deliberate stop-and-amend, per the dispatch's hard guard):**
1. **All 3 files are OUTSIDE the addendum's §7.1 allowlist**, which states: *"Anything not named here still requires a stop-and-amend."* The dispatch reinforces: *"Stop and report before touching anything outside it."*
2. Rewriting them is a **modify-with-deletion**, which `tests-append-only.yml` blocks without a **`[TEST-MOD-APPROVED ORCH-1381]`** token in the commit body — an authorization I was not granted.

**There is no legitimate way to satisfy both** the extraction (binding, §5.3) and these token assertions. Reverting the extraction would violate the contract; gaming a comment to re-introduce the token would be precisely the decorative behaviour the addendum forbids.

**Recommended resolution (one-step, precedent already on this branch):** amend §7.1 to add the 3 test files, and authorize `[TEST-MOD-APPROVED ORCH-1381]`. **Precedent:** commit **`65ee89d85`** on this exact branch already used `[TEST-MOD-APPROVED ORCH-1381]` to rewrite 4 test locks that pinned the old Android→web behaviour — the identical situation. The edit is mechanical: replace each `window.open(` / `window.location.assign(` / `openBusinessDest(` token assertion with an `openExternal(` **delegation** assertion, matching the amended gates.

**Until then: CI is RED on those 3 suites, and this ORCH is not closeable.**

## A7. Caps on my claims (do not over-read)

- **No real-browser measurement was performed.** `playwright` is not installed in this environment, so the addendum's 360/375/412 pixel measurements were **not independently reproduced**. The D-A/D-A-2 layout claims rest on (a) the addendum's measured tables and (b) my **executed** twMerge verification of the emitted classes. **The pixel outcome is `implemented, unverified` and needs the tester's real-device/browser pass** (addendum §12 attacks 8, 9).
- **D-B is `implemented and verified`** at the logic layer (behavioural test + 4 revert shapes + both-direction live gate proof), but **not** runtime-verified in a real browser here. Attack #3 (tap all 4 CTAs on a real Android and confirm the page survives) remains the tester's.
- **The `Referer` now reaches Apple/Google** — Seth's OQ-2 ruling, documented in the module.

## A8. Discoveries for the orchestrator

| ID | Discovery |
|---|---|
| **AD-1** | **The addendum's §10 step 6 is impossible** (A6). Its own §6.1 reasoning about gates applies verbatim to the test suites and was not carried over. Needs a §7.1 amendment + `[TEST-MOD-APPROVED ORCH-1381]`. |
| **AD-2** | **The addendum's §11/§6.5 gate list is incomplete** — it names 5 gates + the new one, but a **6th** exists: `orch-1381-business-getapp-android-choice.mjs` (from the base ORCH), which also targets all 4 CTA surfaces. Verified **PASS**, no amendment needed, but any future sweep that trusts §11's list will miss it. |
| **AD-3** | **D-A2 (repo-wide `window.open` sweep) is now higher-value than stated.** `mingla-marketing` is clean, but nothing has swept `mingla-admin/` or the RN webviews for the `if (!win) fallback` idiom. The addendum's own trap-verification proves this is a general HTML-spec trap, not a marketing-web quirk. |
| **AD-4** | **The `shrink-0`-less-logo failure mode is systemic** (addendum D-A1): any `justify-between` bar with a shrinkable logo **cannot fail a width check** — it silently destroys the brand instead. Worth a global audit; the business nav had been shipping a 30px logo. |
| **AD-5** | **My own test caught my own test bug.** T-D initially failed because I destructured `lastPopup` before the call (capturing `null` by value). Worth noting that the fake-Window pattern's mutable-handle semantics are a live footgun for anyone copying it. |

## A9. Addendum commits

| Hash | Subject |
|---|---|
| `54b7a8692` | ADDENDUM D-A + D-A-2 + D-B: the one owner, 4 call sites, 2 gate amendments + 1 new gate, behavioural fails-on-revert test (**fails-on-revert proven at this hash**) |

**No PR opened, nothing merged, nothing deployed.** The CLOSE commit must carry `[deploy]` (addendum §10) — D-B is live on `usemingla.com` today.

---

# ADDENDUM B — the 4 false-failing assertions, re-pointed (final step)

**Commit `69431e43b`** · authorization `[TEST-MOD-APPROVED ORCH-1381]` (granted by the orchestrator, which independently reproduced the blocker and confirmed the failures were FALSE) · scope: **exactly 3 test files**, no product code.

This closes **A6** ("CI is RED on those 3 suites, and this ORCH is not closeable") and **AD-1**.

## B1. What was actually wrong

Four assertions grepped the **CTA component source** for `/window\.open\(/` and `/window\.location\.assign\(/`. The §5.3 (D-B) extraction legitimately relocated both tokens into `lib/open-external.ts` — the ONE owner. The assertions pinned **WHERE the code lived, not WHAT it did**, so they went red against a *correct* implementation while the behaviour they existed to protect was fully intact.

| # | File | Red assertion (verbatim) |
|---|---|---|
| 1 | `links-cta-device-aware.test.ts` | `CTA no longer opens via window.open( on the tap gesture` |
| 2 | `business-getapp-cta.test.ts` | `nav download handler does not navigate via openBusinessDest` |
| 3 | `business-getapp-cta.test.ts` | `hero missing window.location.assign popup fallback` |
| 4 | `links-cta-device-aware.tester.test.ts` | `no window.open( — the store is not opened on the gesture` |

\#2 is the starkest: `openBusinessDest` **no longer exists**. It was one of four copy-pasted twins, every one carrying the double-navigation bug; D-B replaced them all with `lib/open-external.ts`.

## B2. The protection MOVED — it did not vanish

**Zero assertions deleted.** Counts went **UP**; every case survives:

| File | assert() HEAD → now | cases HEAD → now |
|---|---|---|
| `business-getapp-cta.test.ts` | 38 → **43** | 12 → **12** |
| `links-cta-device-aware.test.ts` | 14 → **18** | 7 → **7** |
| `links-cta-device-aware.tester.test.ts` | 17 → **21** | 7 → **7** |

Each assertion is re-pointed at where the behaviour now lives, as the **two-link chain** it actually is:

- **Link 1 — delegation + anti-bypass (source).** The surface routes the tap through `openExternal(` **and hand-rolls neither** `window.open(` nor `.location.assign(`. Inlining is *exactly* how this bug reached four surfaces, so bypassing the helper must fail. This mirrors the pattern **this ORCH's own CI gates already adopted** (`orch-1324` / `orch-1328`: *require delegation, BAN inlining*) — the gates were re-pointed correctly in D-B; these 3 suites were the last artifacts still grepping moved tokens.
- **Link 2 — the delegated behaviour (driven, not grepped).** `openExternal` is **imported and DRIVEN against a fake `Window`**. The helper is React-free with an injectable window *precisely* so this is possible with no DOM test infra in the marketing package.

## B3. Both-direction proof, per assertion

Every rewritten assertion PASSES on the correct implementation **and** goes RED in **four** independent defect directions. Product code was restored **byte-clean** after each (`git diff` empty).

### Direction 1 — PASS on the current correct implementation

```
business-getapp-cta:            All 12 business-getapp happy-path tests passed
links-cta-device-aware:         All 7 links-cta-device-aware happy-path tests passed
links-cta-device-aware.tester:  All 7 links-cta-device-aware adversarial tests passed
```

### Direction 2 — RED on defect reintroduction

**Defect A — delete the fallback** (true line deletion of `w.location.assign(dest)`; the direction the orchestrator named):

```
FAIL nav: both business actions navigate through openExternal — neither can dead-tap:
  openExternal does not fall back when the popup is genuinely blocked (assigned=[]) —
  the business CTA would be a DEAD TAP.
FAIL hero: delegates the tap to openExternal — a blocked popup is never a dead tap: (same)
FAIL opens the store client-side via openExternal — no dead tap, no double-nav: (same)
FAIL the tap is delegated to openExternal, which cannot dead-tap or double-navigate: (same)
→ 4/4 RED
```

**Defect B — reintroduce the SHIPPED bug** (`open(dest,'_blank','noopener,noreferrer')` + `if(!win) assign(dest)`):

```
FAIL … DOUBLE NAVIGATION — a successful open ALSO navigated the current tab to
  "https://play.google.com/…" (features="noopener,noreferrer").
→ 4/4 RED
```

> **This is the decorative-guard failure being fixed.** The **OLD** assertions **PASSED** on this exact code — both tokens are present. That is precisely why the gates stayed green while the double-nav bug shipped to production.

**Defect C — the C-4 half-fix trap** (`'noreferrer'` alone, which also returns `null`): **4/4 RED** (2 + 1 + 1).

**Defect D — inline `window.open(` back into each component** (bypass the helper): **4/4 RED** via the Link 1 anti-bypass assertion.

The fake `Window` models the browser-verified HTML rule (*noopener OR noreferrer ⇒ null even on success*). **That model is the load-bearing part** — weaken it and Defects B and C stop being caught.

## B4. Verification

| Gate | Result |
|---|---|
| 3 target suites | **GREEN** — 12 / 7 / 7 |
| Full marketing tsc+node suite | **18/19**. The one failure, `lib/city-decks.test.ts`, is a pre-existing `@/` path-alias resolution artifact of the ad-hoc tsc runner — untouched by and unrelated to this change |
| All 382 strict-grep gates | 22 failures, **IDENTICAL to the stashed baseline** (pre-existing/environmental) — **this change introduces zero** |
| 8 ORCH-relevant gates | **ALL PASS** (1381-android-choice, 1381-open-external, 1324, 1328, 1326, 1319, 1342, 1327) |
| `tests-append-only` | **PASS** 9/9 — marker recognized, self-test 6/6 |
| `tsc --noEmit` | **exit 0** |
| `next build` | **GREEN** |
| Product-code diff | **EMPTY** — only the 3 authorized test files changed |

## B5. Scope discipline

Only the 3 authorized files. No product code touched (no test revealed a real defect). `lib/device-platform.ts`, `app-mobile/**`, `mingla-business/**`, `mingla-admin/**` untouched. `BUSINESS_APP_CHOICE_COPY` byte-frozen. No PR, no merge, no deploy.

Docblocks updated to describe the new contract and the **corrected run commands** — the `openExternal` import roots the tsc emit at the package, so the runnable JS now lands under `components/marketing/__tests__/` (the old documented paths were stale).

## B6. Rebase note (not a code change)

`git rebase origin/main` conflicted on `COMMS_LEDGER.md`: the **same** COMMS-0101 row had accumulated **different acks** on each side — origin/main carried the implementor `ADDENDUM BUILD` ack (committed direct-to-main), the branch carried the forensics `SPEC ADDENDUM` ack. Resolved as a **union of all 6 acks** (columns compared field-by-field; only `acked_by` differed). Picking either side would have silently erased a real ack — the exact fragility recorded in `feedback_comms_ledger_direct_main_commits_fragile.md`.

## B7. Addendum-B commits

| Hash | Subject |
|---|---|
| `69431e43b` | Re-point the 4 open/fallback assertions at the shared helper — behavioural, not token-presence (**both-direction proof: PASS on correct impl; RED on defects A/B/C/D**) |
