# IMPLEMENTATION — ORCH-1326 [links-business-tab-reflects-live-app] + ORCH-1327 [links-tab-switcher-swing]

**Phase:** IMPLEMENT (done — gates green, fails-on-revert proven)
**Surface:** `mingla-marketing/` ONLY (`usemingla.com/links` + new `/business/download`). No app/native/Supabase/edge change.
**Worktree/branch:** `/Users/sethogieva/Desktop/mingla-orchs/orch-1326-[links-reality-and-switcher]` @ `orch-1326-links-reality-and-switcher` (rebased on `origin/main` `81f350cc2`).
**Binding contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1326_1327_LINKS_REALITY_AND_SWITCHER.md` (companion investigation same folder).

---

## 1. What was built (layman first)

- **ORCH-1327 (the swing):** the `/links` Explorer↔Business toggle highlight was a framer-motion shared-layout pill mounted/unmounted per tab, so it swept in a diagonal arc. Replaced with **ONE persistent, absolutely-positioned `bg-warm` pill** that just slides its horizontal `x` between the two equal-width slots — no `layoutId`, no mount/unmount, so it slides straight. Reduced-motion, the roving-tabindex a11y, arrow keys, and the color states are all preserved.
- **ORCH-1326 (reality):** the Business tab said "Get started on the web" → `/business` (pre-app copy). The business app is live on the App Store (ORCH-1324). Added a new server smart-redirect **`/business/download`** (iPhone → business App Store, else → business web) and repointed the Business tab CTA to it with honest copy: label **"Get the app"**, body **"Put your experiences in front of people planning their next outing. Now on iPhone — or get started on the web."**, analytics `destination: 'business_download'`.

---

## 2. Files changed / created (exactly the spec allowlist)

**Created**
- `mingla-marketing/app/business/download/page.tsx` — SSR-safe server smart-redirect (parity with `app/download/page.tsx`, minus QR/badges); `resolvePlatformFromUa(headers UA)` → iOS `redirect(BUSINESS_APP_STORE_URL)`, else `redirect(BUSINESS_WEB_URL)`; consts imported from `lib/store-links` (no hardcode); `dynamic = 'force-dynamic'`.
- `.github/scripts/strict-grep/orch-1327-links-tab-switcher-persistent-pill.mjs` — bans `layoutId` + conditionally-mounted-motion-in-`selected ?`-ternary; pins persistent pill (`initial={false}` + `animate={{ x:` + `bg-warm`), reduced-motion (`{ duration: 0 }` tied to `reduced`), roving-tabindex a11y (`role`, `aria-selected`, `tabIndex={selected ? 0 : -1}`, `onTabKeyDown`, ArrowRight/ArrowLeft), color states. `--self-test` **8/8**.
- `.github/scripts/strict-grep/orch-1326-links-business-download-route.mjs` — route (comment-stripped): requires `headers(`, `resolvePlatformFromUa`, both `BUSINESS_*` consts, `redirect(`, `platform ===`; bans `apps.apple.com`/`business.usemingla.com` literals, `navigator`/`window`, `DownloadQr`/`AppStoreBadges`/`<QRCode`, `<form`/`type="email"`, `testflight`, `PLAY_STORE_URL`; G-b FAIL if `BUSINESS_WEB_URL` absent or no `platform ===`. Config: requires `LINKS_BUSINESS_DOWNLOAD_PATH` + `'/business/download'` + `destination: 'business_download'`. `--self-test` **11/11**.
- `mingla-marketing/components/marketing/__tests__/links-tab-switcher.test.ts` — happy-path (6 cases): persistent pill present, exactly one `bg-warm` pill, reduced branch, roving tabindex, no `layoutId`.
- `mingla-marketing/components/marketing/__tests__/links-tab-switcher.tester.test.ts` — adversarial (4 cases): no `layoutId`, no motion in a `selected ?` ternary, pill `aria-hidden`+`pointer-events-none`, full a11y (role/aria-selected/onTabKeyDown/Arrow/Home/End).
- `mingla-marketing/app/business/download/__tests__/business-download-route.tester.test.ts` — adversarial (5 cases): no QR/badges, no store/web literal (consts referenced), no `PLAY_STORE_URL`, SSR-safe, non-iOS target `BUSINESS_WEB_URL` with App Store gated behind `platform === 'ios'` (no reversed mapping).

**Edited**
- `mingla-marketing/components/marketing/links-experience.tsx` — tablist `relative`; deleted the `{selected ? (<motion.span layoutId=…/>) : null}` block; inserted the ONE persistent `motion.div` pill outside the `.map` (`initial={false}`, `animate={{ x: calc(${activeIndex} * (100% + 0.25rem)) }}`, `style={{ width: 'calc(50% - 0.375rem)' }}`, `pointer-events-none absolute left-1 top-1 h-11 rounded-full bg-warm`, tween `0.18` ease `[0.4,0,0.2,1]`, `{ duration: 0 }` when `reduced`). The `layoutId` token is absent even from comments (comment reworded to "framer shared-layout pill") so the raw `grep layoutId` gate returns nothing.
- `mingla-marketing/lib/links-config.ts` — added `export const LINKS_BUSINESS_DOWNLOAD_PATH = '/business/download'`; repointed the business tab (`cta.label`→"Get the app", `cta.href`→`LINKS_BUSINESS_DOWNLOAD_PATH`, `cta.destination`→'business_download', `body`→locked copy). `LINKS_BUSINESS_PATH = BUSINESS_PATH` kept (still exported; tester still pins it).
- `mingla-marketing/lib/links-config.tester.test.ts` — **[TEST-MOD-APPROVED ORCH-1326]**: added `LINKS_BUSINESS_DOWNLOAD_PATH` import; rewrote the business-tab case to pin `/business/download` + `business_download` + `!== '/business'` + `LINKS_BUSINESS_PATH === BUSINESS_PATH`.
- `.github/workflows/strict-grep-mingla-business.yml` — 2 new jobs (`orch-1327-links-tab-switcher-persistent-pill`, `orch-1326-links-business-download-route`) after the ORCH-1324 job (multi-line `with:` style) + 2 gate-index comment lines after the ORCH-1324 index comment. Parses clean (ruby YAML: 324 jobs, both present, no dup keys).
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — registered 2 DRAFT invariants: `I-PROPOSED-1327-LINKS-TAB-PERSISTENT-PILL`, `I-PROPOSED-1326-LINKS-BUSINESS-DOWNLOAD-DEVICE-AWARE` (DRAFT → ACTIVE at CLOSE).

**Untracked forensics docs also committed:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1326_1327_LINKS_PAGE.md`, `Mingla_Artifacts/specs/SPEC_ORCH-1326_1327_LINKS_REALITY_AND_SWITCHER.md`.

---

## 3. Gate results (all GREEN)

| Gate | Command | Result |
|---|---|---|
| deps | `npm ci` (mingla-marketing) | OK |
| typecheck | `npm run typecheck` (`tsc --noEmit`) | **exit 0** |
| build | `npm run build` (`next build`) | **exit 0** — `/business/download` = ƒ (Dynamic), `/links` static 4.8kB, no dangling imports |
| new guard 1327 | `--self-test` + live | **8/8 PASS** + live PASS |
| new guard 1326 | `--self-test` + live | **11/11 PASS** + live PASS |
| ORCH-1319 guards (×4) | `--self-test` | getapp 8/8, download-route-ua 6/6, qr 5/5, no-testflight 4/4 — GREEN |
| ORCH-1324 guard | `--self-test` | 11/11 — GREEN |
| ORCH-1325 guard | `--self-test` | 10/10 — GREEN |
| ORCH-1319 no-testflight live | whole-tree scan | 752 files, zero testflight — GREEN |
| happy-path switcher test | tsc+node | **6/6 PASS** |
| adversarial switcher test | tsc+node | **4/4 PASS** |
| links-config.tester test | tsc+node | **10/10 PASS** (business case now pins /business/download) |
| adversarial route test | tsc+node | **5/5 PASS** |
| device-platform.test.ts | tsc+node | **7/7 PASS** (regression check) |
| `grep -rn layoutId links-experience.tsx` | raw grep | **NONE** (good) |

---

## 4. Fails-on-revert (proven, throwaway commits off the impl tree)

- **Switcher (ORCH-1327):** restored the original `layoutId` pill (checked out `origin/main`'s `links-experience.tsx`) → `links-tab-switcher.test.ts` **FAILS 3/6** — "switcher missing initial={false}", "switcher missing animate={{ x: … }}", "still contains `layoutId`". **fails-on-revert verified at `aecfbfc582628e91a516c527321c55dea2bd8a25`.**
- **Route (ORCH-1326):** reverted `/business/download` to web-only (dropped the `platform === 'ios') redirect(BUSINESS_APP_STORE_URL)` branch) → `business-download-route.tester.test.ts` **FAILS 2/5** — "route does not reference BUSINESS_APP_STORE_URL", "the App Store redirect is not gated behind `platform === ios`"; the `orch-1326-links-business-download-route.mjs` guard also **fires (exit 1)**. **fails-on-revert verified at `80565d3179fe6afa4ff26004a78e8634fe8dd476`.**

Both throwaway commits were discarded via `git reset --hard` back to the implementation tree; the branch contains only the single clean implementation commit.

---

## 5. Commit discipline

- Everything committed on-branch, single implementation commit (no modified-but-uncommitted).
- The commit modifying `lib/links-config.tester.test.ts` (the only test file with deletions) **carries `[TEST-MOD-APPROVED ORCH-1326]`** in its body, and it is HEAD — satisfying `test-append-only-check.js` (which reads the HEAD commit body) and the dispatch. Local append-only check confirmed the token is detected.
- No push / PR / deploy / merge (out of scope for IMPLEMENT).

---

## 6. Spec deviations / notes

1. **Invariant name for 1326:** the dispatch specifies `I-PROPOSED-1326-LINKS-BUSINESS-DOWNLOAD-DEVICE-AWARE`; SPEC §5/§7 text used `…-LINKS-BUSINESS-TAB-DEVICE-AWARE`. I used the **dispatch's `-DOWNLOAD-` name consistently** across the guard docstring, gate-index comment, the workflow job's `name:`, and the registry entry (one canonical name). Flagging the spec's internal `-TAB-` wording for orchestrator awareness.
2. **`layoutId` in comments:** SPEC §4.1(b) suggested a code comment literally containing `` `layoutId` ``, but SPEC §10 requires a raw `grep layoutId … → NOTHING`. Resolved by rewording the comment to "framer shared-layout pill" / "No shared-layout id" so the raw grep gate passes and no `layoutId` token survives anywhere in the file (the guard comment-strips regardless).
3. **`app/links/page.tsx` `<meta>` NOT touched:** SPEC §11.3 flags the metadata description as **OPTIONAL / "flag, don't gate"** and does not direct a fix; the dispatch says fix it "if the spec directs." The spec does not direct it, so it was left unchanged (still reads "…get started on the web" for business owners) — flagged here for a future optional SEO refresh.
4. Runtime device-drive (physical iPhone tap / re-drive the swing / PostHog event / reduced-motion / one-viewport SNAPSHOT) is the tester's phase (SPEC §9), not done here — this IMPLEMENT proof is source + build + guards + fails-on-revert.

---

## 7. Report path
`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1326_1327_LINKS.md`
