# TEST — ORCH-1326 [links-business-tab-reflects-live-app] + ORCH-1327 [links-tab-switcher-swing]

**Phase:** TEST (gatekeeper) · **Verdict: PASS**
**Worktree/branch:** `/Users/sethogieva/Desktop/mingla-orchs/orch-1326-[links-reality-and-switcher]` @ `orch-1326-links-reality-and-switcher` HEAD `fcd1cab5e` (unchanged, tree clean at exit).
**Contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1326_1327_LINKS_REALITY_AND_SWITCHER.md`
**Method:** re-ran every gate independently; drove the built `/links` page + `/business/download` route in headless Chromium (Playwright 1.61.1, chromium-1223, 390×844 DPR2 mobile) with a per-frame `requestAnimationFrame` transform sampler; curl-drove the server route per UA; live fails-on-revert on both ORCHs.
**Scratch:** `/tmp/orch-1326/`.

---

## 1. VERDICT: PASS

All gates green (re-run by me), the swing is provably GONE (pill vertical translate = 0 on every frame, both directions), reduced-motion snaps instantly, WAI-ARIA roving-tabindex + arrow/Home/End + wrap all intact, one-viewport no-scroll holds at 844 & 667, the business CTA routes correctly on iOS/iPad/Android/desktop/bot/empty-UA, Explorer `/download` regression clean, and Step 0.5 satisfied (both guards + tests bite on live revert; TEST-MOD token present and scope-clean).

---

## 2. Gate results (all GREEN, re-run by me)

| Gate | Command | Result |
|---|---|---|
| deps | `npm ci` (mingla-marketing) | **OK** (exit 0) |
| typecheck | `npm run typecheck` (`tsc --noEmit`) | **exit 0** |
| build | `npm run build` (`next build`) | **exit 0** — `/business/download` = ƒ (Dynamic), `/links` static 4.8 kB |
| guard 1327 self-test | `orch-1327-links-tab-switcher-persistent-pill.mjs --self-test` | **PASS 8/8** |
| guard 1327 live | same, no flag | **PASS** (exit 0) |
| guard 1326 self-test | `orch-1326-links-business-download-route.mjs --self-test` | **PASS 11/11** |
| guard 1326 live | same, no flag | **PASS** (exit 0) |
| ORCH-1319 guards ×4 | `--self-test` | download-route-ua 6/6, getapp-cta-direct-store 8/8, no-testflight 4/4, qr-encodes 5/5 — **GREEN** |
| ORCH-1324 guard | `--self-test` | **GREEN** (exit 0) |
| ORCH-1325 guard | `--self-test` | **GREEN** (exit 0) |
| switcher happy-path test | tsc+node | **6/6 PASS** |
| switcher adversarial test | tsc+node | **4/4 PASS** |
| links-config.tester test | tsc+node | **10/10 PASS** (business case pins `/business/download`) |
| route adversarial test | tsc+node | **5/5 PASS** |
| device-platform.test.ts | tsc+node | **7/7 PASS** (regression) |
| `grep -rn layoutId links-experience.tsx` | raw grep | **NONE** (exit 1) |
| append-only gate | `test-append-only-check.js` | **4 passed / 0 failed** — TEST-MOD token recognized |
| CI wiring | ruby YAML parse | 324 jobs, both new jobs present, each runs `--self-test` + live |
| scope | `git diff --name-status` | exactly the spec allowlist; **no DO-NOT-TOUCH file touched** |

---

## 3. RUNTIME PROOF — the swing is GONE (core)

Per-frame sampler on the built page (pill = the `bg-warm` `motion.div` inside `[role=tablist]`; `ty` = decomposed vertical translate of the pill's OWN computed transform; `top` = pill top relative to tablist). 30 frames/switch, both directions.

**Explorer → Business:** `maxAbsTy = 0.00` across all 30 frames; `top` = 5 on every frame (`maxAbsTopDelta = 0`); `tx` monotonic **0 → 172**; lands `left=177` = target `177`.
```
t=6.1   tx=0      ty=0  left=5     top=5
t=56    tx=14.63  ty=0  left=19.63 top=5
t=106   tx=119.64 ty=0  left=124.6 top=5
t=156   tx=163.09 ty=0  left=168.1 top=5
t=206   tx=172    ty=0  left=177   top=5  (settled, stays)
```
**Business → Explorer:** `maxAbsTy = 0.00`; `top` = 5 every frame; `tx` monotonic **172 → 0**; lands `left=5` = target `5`.
```
t=12.5  tx=172    ty=0  left=177   top=5
t=62.4  tx=159.59 ty=0  left=164.6 top=5
t=112.5 tx=52.37  ty=0  left=57.37 top=5
t=160.7 tx=9.28   ty=0  left=14.28 top=5
t=212.6 tx=0      ty=0  left=5     top=5  (settled)
```
**Contrast with the documented pre-fix arc (INVESTIGATION §2.2):** `ty` started at **+157.81px** and `tx` at **−172px**, sweeping a diagonal arc. Post-fix `ty` is pinned at **0** on every frame in both directions — a pure straight horizontal slide. **Swing eliminated.** Geometry exact: pill width 168px, rest slots at left 5 / 177 = the two tab left-edges (baseline `tab0Left=5`, `tab1Left=177`).

**Reduced-motion** (`reducedMotion: 'reduce'` context): `maxAbsTy = 0`, settles in **2 frames** (`instant=true`), pill jumps `left [5, 5, 177, 177]` straight to target — no animation, no arc, lands correctly.

---

## 4. A11y, SNAPSHOT, business CTA routing, Explorer regression

**A11y (driven, keyboard):**
- `role=tablist` present, 2 `role=tab`, `role=tabpanel` present.
- `aria-selected` flips `[true,false] ⇄ [false,true]` on every move.
- Roving tabindex: only the active tab is `0`, the other `-1` — always exactly one focusable tab.
- **ArrowRight** moves selection AND focus (focusedIdx 0→1, aria-selected flips). **ArrowRight wraps last→first** (idx1→idx0). **ArrowLeft wraps first→last** (idx0→idx1). **Home**→idx0, **End**→idx1 — each moves both selection and focus.

**One-viewport SNAPSHOT (no scroll):**
- 390×844: `verticalOverflow=0`, `horizontalOverflow=0`.
- 390×667 (short phone): `verticalOverflow=0`, `horizontalOverflow=0`.
The absolutely-positioned pill (out of flow) did not perturb the fixed-height flex column — §1 contract intact.

**Business CTA routing (`/business/download`, curl, no-follow, real UAs):**
| UA | HTTP | Location |
|---|---|---|
| iPhone iOS 17 | 307 | `https://apps.apple.com/app/id6768737367` (business App Store) |
| iPad (iPad token) | 307 | `https://apps.apple.com/app/id6768737367` |
| Android (Pixel 8) | 307 | `https://business.usemingla.com` |
| Desktop Mac Chrome | 307 | `https://business.usemingla.com` |
| iPadOS desktop-UA (no iPad token) | 307 | `https://business.usemingla.com` (documented safe fallback) |
| Googlebot | 307 | `https://business.usemingla.com` |
| **empty UA** (SSR safety) | 307 | `https://business.usemingla.com` (no crash — falls to business web) |

**Business CTA on /links (driven DOM):** label **"Get the app"**, href **`/business/download`**, body **"Put your experiences in front of people planning their next outing. Now on iPhone — or get started on the web."** — no store URL hardcoded (href is the smart route → consts).

**Explorer regression (driven DOM + curl):** CTA label "Get Mingla" → **`/download`** (unchanged); heading/body unchanged. `/download` still resolves iOS→consumer store `id6760440898`, Android→Play, desktop→QR page (no redirect). Tagline "Find a vibe, not a venue." and the 7 socials (with @minglabusiness swap on business tab) unchanged (pinned by the 10/10 config test).

---

## 5. Adversarial edge probes

- **Rapid double-switch** (Explorer→Business→Explorer 30ms apart): `maxAbsTy=0`, pill lands cleanly on Explorer (`left=5`=`tab0=5`) — no desync, no mid-tab landing.
- **Switch during the entrance animation** (tab clicked ~80ms after load, entrance still running): `maxAbsTy=0`, `topDelta=0` — no re-introduced arc; lands on Business (`177`=`177`). The persistent pill's own transform is immune to the still-animating ancestor.
- **"Everyone→App Store" mutation** (stripped `BUSINESS_WEB_URL` branch): caught by the guard (3 failures incl. G-b "non-iOS stranded") AND the route adversarial test (2 failures) — restored.
- **SSR safety** (no UA): route falls to business web, 307, no crash (see §4 table).
- **N-tab generality:** today exactly 2 tabs (pinned by config test). The `x = activeIndex * (100% + gap)` multiplier generalizes to N equal tabs; only the width `calc(50% - 6px)` is 2-specific and documented in-code. Non-issue today.

---

## 6. Step 0.5 audit

- **TEST-MOD token:** `[TEST-MOD-APPROVED ORCH-1326]` present on HEAD `fcd1cab5e` (count 1). Append-only gate recognizes it and passes 4/0.
- **TEST-MOD scope clean:** diff of `links-config.tester.test.ts` touches ONLY the business-tab case (rewritten and STRENGTHENED: now pins `href===LINKS_BUSINESS_DOWNLOAD_PATH`, `==='/business/download'`, `!=='/business'`, `destination==='business_download'`) plus one import line; the `LINKS_BUSINESS_PATH === BUSINESS_PATH` assertion is preserved; Explorer/socials/no-hardcode cases untouched. Nothing pre-existing weakened beyond the approved business-tab case.
- **Live fails-on-revert (re-verified BOTH by me, then restored — tree clean):**
  - Route (ORCH-1326): mutated to everyone→App Store → guard **fires exit 1** (3 failures) + adversarial test **fails 2/5** → `git checkout` restored → guard **exit 0**.
  - Switcher (ORCH-1327): re-introduced `layoutId` (dropped `initial={false}`) → guard **fires exit 1** (2 failures: missing `initial={false}`, contains `layoutId`) + happy-path test **fails 2/6** → restored → guard **exit 0**.
- **Adversarial angles genuinely different:** switcher adversarial proves NEGATIVE space (no `layoutId`, no `<motion>` in a `selected ?` ternary, pill `aria-hidden`+`pointer-events-none`, full a11y survival) vs happy-path PRESENCE; route adversarial attacks wrong-destination/QR-creep/hardcode/SSR vs the config happy-path pinning the href. Distinct.
- No test strengthening needed — coverage is already adequate across both triads. **No commits added by test phase.**

---

## 7. Issues

- **P0/P1:** none.
- **P2 (non-blocking, out of gate scope):** `mingla-marketing/app/links/page.tsx` `<meta>` description still reads "…if you run a venue, event, or trip, get started on the web." — the pre-app SEO copy. Spec §11.3 flagged this as OPTIONAL / "flag, don't gate"; implementor deliberately left it (impl report §6.3). Not visible on-screen; recommend a future SEO-copy refresh. Does NOT block ship.
- **Note:** invariant name divergence (spec §5/§7 text used `-TAB-`; dispatch + registry + guard + job use `-DOWNLOAD-DEVICE-AWARE`). One canonical name used consistently across enforcement — cosmetic, already flagged by implementor (§6.1). Both DRAFT invariants registered.

---

## 8. Report path
`Mingla_Artifacts/reports/TEST_ORCH-1326_1327_LINKS.md`
