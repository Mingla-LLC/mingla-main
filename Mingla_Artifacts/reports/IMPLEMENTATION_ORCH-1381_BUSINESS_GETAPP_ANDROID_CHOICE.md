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
