# QA — ORCH-1399 [links-src-tracking-getapp-stack]

**Skill:** mingla-tester+claude · 2026-07-18
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1382-[links-src-tracking-getapp-stack]` (spawn-named dir) on branch `ORCH-1399-links-src-tracking-getapp-stack`, HEAD at QA start `1d3a5d686`, clean, current with `origin/main` (`ca4781b1a`).
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1399_LINKS_SRC_TRACKING_GETAPP_STACK.md` (incl. §10.8 probe addendum + §12 attack list).
**Impl report under attack:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1399_LINKS_SRC_TRACKING_GETAPP_STACK.md` (§14 = the rebuild).
**Posture:** first independent QA pass this build has ever had. Assumed BROKEN until proven. Every verdict below is backed by a run I performed in this session — no implementor claim was accepted unverified.

---

## 1. VERDICT: **PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 5

Regression gate: implementor happy-path tests fails-on-revert **independently re-proven at `1d3a5d686`** (3 reverts re-run, output §4) + tester adversarial test **`mingla-marketing/components/marketing/__tests__/orch-1399-campaign-tab-binding.tester.test.ts`** (NEW file, different angle, fails-on-revert both directions, in the closing diff — §5).

Explicitly stated evidence caps (none blocking; all named in §8):
- **In-app-browser leg (spec attack #8 ⭐) NOT run** — no logged-in Instagram/TikTok session available (IG login expired per infra state); I will not fabricate device evidence. Mechanism verified structurally (plain `<a>` anchors) + on real Android Chrome.
- **Real-Safari-engine runtime not driven** — iOS evidence is Chrome-emulated iOS UA (DOM) + live curl 301s to the correct App Store IDs. The physical iPhone is HITL and this was an autonomous dispatch.
- **Samsung Galaxy-Store-choice dead-end risk** remains UNVERIFIED — carried open question from COMMS-0107(2)/§14.7, candidate fix is AppsFlyer-dashboard-side, no repo change. I reproduced the chooser itself from a genuine trusted tap (§7).

---

## 2. SC-by-SC matrix (all runtime unless marked)

Runtime rig: fresh `next build` (exit 0, my own build — implementor's `.next` deleted first), served via `next start :3199`, driven with Playwright-core + Chrome at real viewports/UAs (70-check script `/tmp/orch-1399/driver/qa-links.mjs`), plus the physical **Samsung SM-A725F** over adb+CDP with trusted `Input.dispatchTouchEvent` taps.

| SC | Verdict | My evidence |
|---|---|---|
| SC-1-Links-Explorer | **PASS** | Android UA 375×667: CTA is `<a href="https://go.usemingla.com/w36m?pid=bio_youtube&c=explorer_bio" target="_blank" rel="noopener">`. Real-Samsung trusted tap → native Play app on **"Mingla–Date Plans & City Gems"** (consumer listing), **no Play website flash** (screenshots `/tmp/orch-1399/samsung-*.png`) |
| SC-1-Links-Business | **PASS** | `<a href="https://biz.usemingla.com/ZSCW?pid=bio_youtube&c=business_bio">`; real-Samsung tap → Samsung "Open with" chooser (pre-existing COMMS-0107(2)) → Play → **"Mingla: Host, Sell & Grow"** (correct business listing) |
| SC-1-Nav-Explorer / Nav-Business / Hero | **PASS** | Runtime DOM: nav explorer phone `<a>` → `go...?pid=mingla_web&c=explorer_nav`; nav business `<a>` → `biz...?pid=mingla_web&c=business_nav`; hero `<a>` → `biz...?pid=mingla_web&c=business_hero`; all `rel="noopener" target="_blank"` (checks 7.2/7.7/8.1) |
| SC-1-BizDownload | **PASS** | `curl -A '<Android UA>'` → 200 HTML, install `<a href="https://biz.usemingla.com/ZSCW?pid=mingla_web&c=business_download">`, **no query param required**; Server Component (grep `window`/`navigator`/`<form>` = 0) |
| SC-1-iOS | **PASS (engine cap §8)** | iOS-UA DOM: both tabs resolve correct OneLinks (checks 5.1/5.2); live iOS-UA curls: `biz → 301 apps.apple.com/US/app/id6768737367`, `go → 301 …id6760440898` — not crossed |
| SC-1-Desktop | **PASS** | Desktop: explorer CTA is a `<button>`; tap → `/download` opens in a NEW tab, `/links` stays mounted (checks 6.1–6.3); nav desktop = `<button aria-haspopup="dialog">` QR panel (7.8); business desktop = web action only, **no dead install button** (6.4/7.6/8.4) |
| SC-1-Rel | **PASS** | Every store/web CTA anchor on all 4 surfaces: `target="_blank"` + `rel` containing `noopener`, asserted per-anchor at runtime. (`/business/download` anchors are same-tab by pre-existing ORCH-1381 shape — spec §2.2 "only its href value changes"; no tabnabbing vector without `_blank`.) |
| SC-1-NoOrphanState | **PASS (real device)** | After store hand-off and return: `/links` same tab, tablist visible, `readyState=complete`, **sessionStorage sentinel intact** (page never unloaded) |
| SC-2-Ride | **PASS** | Exact hrefs: `pid=bio_youtube&c=explorer_bio` / `pid=bio_youtube&c=business_bio` (URL-parsed identity) |
| SC-3-Persist | **PASS** | Explorer→Business→Explorer→Business: `pid=bio_youtube` on every resolve, only `c` flips (check 1.21); re-proven on real Samsung with `src=qa_samsung` |
| SC-4-FailSafe | **PASS** | 19-case runtime fuzz incl. `<script>…`, `a&b=c`, `a%20b`, `../../etc/passwd`, `%2e%2e%2f`, `a%00b`, SQL, unicode, 33/200 chars, `src=a&src=b`, bare `?src=`, wrong-case `?SRC=` → all `pid=bio_direct`, zero page errors, zero raw reflection (see P4-2 for the RSC-payload note) |
| SC-5-Prefix (HARD) | **PASS** | Every fuzz emission matched `/^bio_[a-z0-9_]{1,32}$/`; `facebook`/`tiktok` → `bio_facebook`/`bio_tiktok` (never bare); `bio_youtube` → `bio_bio_youtube` (ugly-but-safe, per spec) |
| SC-5-NeverCrossed (HARD) | **PASS** | Runtime: business panel never emits `go.*`, explorer never `biz.*`, zero `*.onelink.me` (checks 1.5/1.12/1.13/8.3); live: probe confirms each domain 301s to its OWN package; **on-device end-to-end both directions** (§7) |
| SC-6-Label | **PASS** | "Get the app" rendered on all 4 business surfaces; zero "Download the app" in rendered output; `moreNote`/`desktopNote`/`useWeb` byte-identical to spec'd values (rendered + source) |
| SC-6-Stack | **PASS** | 375×667: getApp y=362–418, useWeb y=426–482 → stacked, tops differ (check 1.19); real Samsung 384×718: stacked=true (§7) |
| SC-6-NoScroll | **PASS (clipping-aware)** | 375×667 AND 360×640, business tab, `?src=youtube`, consent accepted: `scrollHeight===clientHeight` AND all 13 per-element rects (wordmark, tablist, heading, both CTAs, note, every social icon) inside the viewport — maxBottom 647/667 and 620/640, headroom 20px. Measured per-element, NOT scrollHeight-only |
| SC-6-Tap | **PASS** | Both pills 56px ≥ 44px |
| SC-7-PxRedundant | **PASS** | Computed `padding-left: 28px` (px-7) and per-pill `scrollHeight===clientHeight` at **320/360/375/390/412** — no wrap/spill at any width |
| SC-8-NoBannerRegression | **PASS by criterion, carried finding** | Pre-consent 375×667: banner top=440; primary CTA overlap **0px** (baseline 11px — improved); secondary "Use on web" **42px** (was 11px) — the implementor's §10.1 finding reproduced exactly; carried per §14.7 as Seth-accepted; #905 is the real fix |
| SC-9-Snap-Explorer | **PASS** | Explorer: Snapchat present, exact `https://www.snapchat.com/add/usemingla`, `_blank`; glyph PAINTS (path d=1415 chars, bbox 25×23 — not an empty box) |
| SC-9-Snap-NotBusiness | **PASS** | Business tab: NO Snapchat (runtime, both rigs) |
| SC-9-Counts | **PASS** | Explorer 8 / Business 7, labels enumerated; all visible at both viewports (SC-6 criterion 2) |
| SC-10-Neutral | **PASS** | YouTube + LinkedIn identical hrefs on both tabs |
| SC-10-PerSurface | **PASS** | Instagram/X/TikTok/Facebook/Threads → `@minglabusiness` variants on business |
| SC-10-TypeSafety | **PASS (source + tsc)** | Discriminated union in `links-config.ts`; `npx tsc --noEmit` exit 0 on the branch incl. my new test; T-8's `@ts-expect-error` negatives present |

### Scope items beyond the SC table

| Dispatch item | Verdict | Evidence |
|---|---|---|
| 6. Probe | **PASS** | Ran `node scripts/probe-onelink-health.mjs` live: both OneLinks HEALTHY 301→market:// with own package, exit 0. Retry design verified in code: ATTEMPTS=5 (≥3 required), alerts only if ALL fail (~0.003% false alarm at the measured 1-in-8 flake), CROSSED never retried away + breaks the loop, workflow opens/dedupes one `onelink-outage` issue. BORN-DARK banner correctly updated to post-billing-fix wording (arm via `workflow_dispatch` after merge) |
| 7. Renumber integrity | **PASS with P3-1** | Gate renamed + registered in MANIFEST.json (`batch:A`, node, self-test+plain wired, `expectedStrictGrepMjsFiles` 405 = on-disk count incl. subdirs, `selfTestWiredFloor` 185); manifest parity **PASS P1–P9** + 16/16 self-test; `[TEST-MOD-APPROVED ORCH-1399]` on HEAD commit body; append-only **12 passed, 0 failed** (re-run 13 passed at my HEAD). Remaining 1382 refs: impl-report §14 provenance (fine) + **3 cosmetic refs in `links-src.tester.test.ts`** (P3-1) |
| 8. Invite email byte-frozen | **PASS** | `deno test` invite-brand-member suites: **38 passed, 0 failed** (suite grew again on main; all green); href literal `https://usemingla.com/business/download` with no query string confirmed at `_shared/brandInviteEmail.ts:175,200`; zero `supabase/` files in the branch diff |
| Gates | **PASS** | All 8 relevant gates self-test + live green in the bracketed worktree (orch-1399 18/18, 1328, 1319, 1324, 1381-choice, plus UNTOUCHED 1381-open-external + 1342-ssot — attack #28 satisfied, neither edited); full batches in a **bracket-free** worktree of HEAD: **A 539/539 · B 10/10 (with CI's exact dep set) · C 1/1 · D 2/2 · E 3/3**. The §14.6 bracketed-path false-fails confirmed as environment artifacts (ERR_MODULE_NOT_FOUND on `@babel/parser` without CI's install step; bracket percent-encoding class) |
| Marketing suites | **PASS** | **23/23** green under tsc+node (city-decks excluded — pre-existing harness bug §10.6, byte-identical to main) |
| Build/tsc | **PASS** | My own fresh `npm run build` exit 0 (`/links` ƒ dynamic, `/business/download` ƒ dynamic); `npx tsc --noEmit` exit 0 |

---

## 3. Findings

**P3-1 — renumber miss inside the NUL-byte test file (and the reason it was missed).**
- Evidence: `mingla-marketing/lib/__tests__/links-src.tester.test.ts` contains 3 × `ORCH-1382` (header comment, `describe()` title, final `console.log`) and **zero** `ORCH-1399`. Impl report §14.1 claims all in-file markers were renumbered — disproven for this file.
- Root cause worth recording: the file deliberately embeds a **raw NUL byte** as a hostile fuzz input (`['raw null byte', 'a\x00b', …]`), which makes git treat it as binary — so every grep-based sweep (including the renumber pass, and any future strict-grep-style check) **silently skips it**. The test itself compiles and runs green (part of the 23/23).
- Impact: cosmetic provenance only — no gate key, path, or invariant ID carries the stale number.
- Required fix: none blocking; a one-line follow-up may retitle the three strings (needs `[TEST-MOD-APPROVED]` since the file is now pre-existing). Recommend the orchestrator note the "NUL byte = grep-invisible file" hazard in the registry.
- Retest: `python3 -c "print(open('...','rb').read().count(b'1399'))"` > 0.

**P4-1 (note) — `/business/download` anchors are same-tab (no `target`/`rel`).** Pre-existing ORCH-1381 shape; spec §2.2 restricted this route to "href value only". Same-tab navigation has no `window.opener`, so no tabnabbing vector. No action.

**P4-2 (note) — hostile `?src=` values appear in Next's RSC flight payload.** e.g. `__PAGE__?{"src":"'; DROP TABLE users;--"}` inside `self.__next_f.push(...)`. JSON-escaped with `<`/`>` as `</>` — zero raw `<script>` in HTML, not injectable, framework-standard for any dynamic route. Not an ORCH-1399 defect; recorded so nobody re-reports it.

**P4-3 (note) — gate R7b's raw-passthrough check has a hole**: a page calling `sanitizeLinksSrc` somewhere while still passing `src={src}` raw would pass the static gate. R7 (call-presence) + runtime fuzz + T-4 cover the actual behavior; defence-in-depth only.

**P4-4 (note) — `SocialIcon` default case renders the X glyph for ANY unknown label** (pre-existing pattern; a future mistyped social would silently show X's icon).

**P4-5 (praise) — two things worth replicating.** (1) The fifth-decorative-guard repair is REAL: I proved the amended orch-1328 and T-9 both fire on a **single** rel-stripped anchor (per-anchor, not file-level) — §4. (2) The probe's crossed-package check breaks the retry loop and can't be flaked away; the retry math is written into the alert text so the on-call reader knows 5/5 ≈ real.

---

## 4. Step 0.5 — implementor's fails-on-revert proof independently re-run

Performed in a detached scratch worktree of `1d3a5d686` (`/tmp/orch-1399/verify`, bracket-free), true line/character mutation, restored via `git checkout --` after each. All three reproduce the implementor's §14.5 pastes:

| Revert (impl §14.5 #) | My observed failure (verbatim) | Restored |
|---|---|---|
| #1 unanchor `LINKS_SRC_PATTERN` | T-4: `FAIL B-1 … sanitizeLinksSrc("<script>alert(1)</script>") = "<script>alert(1)</script>"` + `FAIL B-3 … bio_<script>alert(1)</script>` + `FAIL B-5 … NOT start-anchored`; gate: `LINKS_SRC_PATTERN /[a-z0-9_]{1,32}/ is NOT ANCHORED (^…$)` | test "All 5 … 50 hostile inputs" + gate PASS |
| #2 swap the OneLink bases | T-7: `FAIL C-1/C-3/C-4 … installHref carries the CONSUMER branded domain … go.usemingla.com/w36m?pid=bio_youtube&c=explorer_bio`; gate: `EXPLORER_ONELINK_URL "https://biz.usemingla.com/ZSCW" carries the BUSINESS token — CROSSED` ×2 | test "All 7 …" + gate PASS |
| #4 strip CTA `rel="noopener"` (tested SINGLE anchor, stricter than impl's all-3) | T-9 (`links-cta-device-aware.test.ts`): `FAIL T-9: … a CTA anchor lost rel="noopener" — reverse-tabnabbing … Anchor: <a href={businessTarget.installHref} target="_blank" onClick={()…`; amended orch-1328: same per-anchor failure | "All 11 happy-path tests passed" + gate PASS |

Method note for the record: the per-anchor rel assertion lives in the **`.test.ts`** twin (T-9), not the `.tester.test.ts` twin — my first run against the wrong twin looked like a gap and was my error, corrected above with the per-anchor proof.

---

## 5. Tester adversarial test (mine)

**Path:** `mingla-marketing/components/marketing/__tests__/orch-1399-campaign-tab-binding.tester.test.ts` (NEW file — append-only) · committed on this branch (hash in commit log; in `git diff origin/main...HEAD --name-only`).

**Angle (uncovered by all 15 implementor tests + 5 gates): CAMPAIGN↔SURFACE binding.** Everything existing pins the DESTINATION half of attribution (domains by identity, anchors, pid grammar). Nothing pins which **campaign** a surface passes — `links-cta-device-aware.test.ts:215` only checks both tokens are *present in the file*. Flip `business_bio`↔`explorer_bio` in the render-time resolves and: tsc green (both valid union members), every domain/anchor/pid check green, page works — and every bio install reports under the wrong surface forever. Plus a second angle: `/g`-flag statefulness of the sanitiser (lastIndex makes `.test()` alternate on identical input → every second visitor falls to `bio_direct`).

**Checks:** C-A/C-B/C-C paren-balanced per-call binding on all 4 surfaces (each `resolve*AppTarget(` call must carry its OWN campaign and no foreign one) · C-D campaign+pid ride by URL-parsed identity · C-E stateless regex (flags + repeated/alternating behavioural calls) · C-F sanitiser idempotence.

**Fails-on-revert, both directions, `fails-on-revert verified at 1d3a5d686` (scratch worktree):**
- Flip the two campaign literals in `links-experience.tsx` → **my test FAILS** (`CROSSED CAMPAIGN … resolveBusinessAppTarget( call #1 carries the FOREIGN campaign 'explorer_bio'`) while the **entire existing battery stays GREEN** (both device-aware twins, onelink-never-crossed, links-src fuzz, business-app-target, orch-1399 gate, orch-1328 gate — all run, all green on the defect). That is the different-angle proof in its strongest form.
- Add `/g` to `LINKS_SRC_PATTERN` → **my test FAILS** twice over (C-E structural flag check AND C-F behavioural: `accept path not idempotent` — the statefulness genuinely broke repeated sanitisation at runtime).
- Restored → **All 6 … passed**, and 6/6 green on the intact branch worktree.

---

## 6. Constitution — 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | Every CTA either navigates (anchor, proven on device) or acts (desktop button → new tab/QR panel, proven); `canInstall===false` renders no install control |
| 2 | One owner per truth | PASS | OneLink bases only in `store-links.ts` (gate R6 bans surface literals); campaign per surface; `toBioPid` sole prefix writer (R3b structural) |
| 3 | No silent failures | PASS | Sanitiser fail-safe is a REAL value (`bio_direct`), never omission; probe exists precisely to catch the silent-301 failure; analytics fire-and-return can't block navigation |
| 4 | One query key per entity | N/A | No React Query surface |
| 5 | Server state stays server-side | PASS | `src` resolved server-side, passed as prop; no client store introduced |
| 6 | Logout clears everything | N/A | Anonymous marketing site |
| 7 | `[TRANSITIONAL]` labelled | PASS | None introduced; none needed |
| 8 | Subtract before adding | PASS | `px-4` patch + D-A comment REMOVED; `openExternal` calls removed from nav/hero; explorer ternary triplication deleted into one module |
| 9 | No fabricated data | PASS | Copy claims byte-unchanged (`moreNote`/`desktopNote` verified claims untouched) |
| 10 | Currency-aware | N/A | No money surface |
| 11 | One auth instance | N/A | No auth surface |
| 12 | Validate at the right time | PASS | `src` sanitised once at the boundary (page server component), before any href |
| 13 | Exclusion consistency | PASS | `explorer_only` filter applied via `socialsForTab` at the single render site; 8/7 counts proven both rigs |
| 14 | Persisted-state startup | N/A | No persisted store touched |

---

## 7. Device / parity matrix

| Surface | Result | Evidence |
|---|---|---|
| Marketing Web — desktop Chrome | **PASS** | Sections 6/7/8 of the 70-check drive |
| Marketing Web — Android (emulated 320–412w) | **PASS** | Sections 1–4; 19-case fuzz; clipping-aware layout |
| Marketing Web — **physical Samsung SM-A725F** (adb+CDP, trusted taps) | **PASS** | `/links?src=qa_samsung` → correct attributed anchors both tabs, 8/7 socials, stacked, no scroll @384×718; business tap → chooser (COMMS-0107(2) pre-existing) → Play → **correct business listing**; explorer tap → Play → **correct consumer listing**; return → `/links` mounted, sessionStorage intact. Screenshots: `/tmp/orch-1399/samsung-after-tap.png`, `samsung-play.png`, `samsung-chooser2.png` |
| Marketing Web — iOS | **PASS with cap** | Chrome-emulated iOS UA DOM + live curls (§2 SC-1-iOS); real Safari engine not driven (autonomous run; physical iPhone is HITL) |
| In-app webviews (IG/TikTok) | **NOT RUN — stated cap** | No logged-in session available; the decisive mechanism (real anchors) verified structurally + on real Chrome |
| Consumer iOS/Android, Business iOS/Android, Buyer web, Admin, Biz-web preview | **skipped — not code surfaces** | Spec §3: web-only ORCH; zero files outside `mingla-marketing/` + CI/scripts in the diff (verified by `git diff --name-only`); apps receive attribution only |
| Physical iPhone HITL | **not requested** | Autonomous dispatch; no HITL step was defined for this web-only surface |
| Edge functions | **N/A** | None touched (verified: no `supabase/` in diff) |

Live third-party state re-verified by me this session: probe run (both healthy, 1st attempt), Android-UA + iOS-UA curls, correct packages/app-IDs both domains — retry rule honoured (no single-shot conclusions; first attempts happened to succeed).

---

## 8. Evidence caps (explicit)

1. **Attack #8 (in-app browsers)** — not performed; would require a logged-in IG/TikTok device session. Risk bounded: anchors are the primitive that works where `window.open` doesn't, and the real-Chrome device journey passes end-to-end.
2. **Real Safari engine** — iOS behavior proven at the UA-detection + live-301 layers only.
3. **Galaxy Store choice dead-end** (COMMS-0107(2) UNVERIFIED RISK) — I reproduced the chooser from a trusted tap but did not drive the Galaxy-Store branch; carried to CLOSE per §14.7 (candidate fix: AppsFlyer dashboard 301 target → play.google.com App Link).
4. **SC-8 secondary 42px pre-consent overlap** — reproduced exactly (banner 440, useWeb 426–482); carried per impl §10.1 / §14.7 as the Seth-accepted pre-consent state; #905 owns the real fix.

## 9. Discoveries for Orchestrator

1. **NUL-byte test files are grep-invisible** (P3-1): the renumber sweep missed `links-src.tester.test.ts` because git treats it as binary. Any future grep-based sweep/gate silently skips such files. Candidate registry note + one-line retitle follow-up.
2. **Bracketed-worktree gate artifacts confirmed** (impl §14.6 accurate): 3 module-URL percent-encoding gates + `orch-0964` `.next/` walker; plus **class B requires CI's `npm install --no-save @babel/parser @babel/traverse madge typescript@~5.9.2 yaml`** to run locally — third undocumented local-run dependency after the `yaml` note in §14.8(3).
3. The Samsung `market://` chooser is now reproduced from a genuine trusted tap on the SHIPPED build (was previously only on the pre-renumber build) — strengthens the case for the AppsFlyer-dashboard `play.google.com` App-Link mitigation follow-up.
4. `BUSINESS_APP_STORE_URL`/`BUSINESS_PLAY_STORE_URL` now referenced only by tests (impl §10.6 flag stands).

## 10. Accepted conditions

None required — verdict is PASS, not CONDITIONAL. Carried items (§8.3/§8.4) are pre-documented, Seth-accepted states of OTHER issues (#905, COMMS-0107), not conditions on this build.
